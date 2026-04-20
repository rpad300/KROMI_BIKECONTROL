package online.kromi.blebridge

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * ShimanoProtocol — full Shimano STEPS / Di2 BLE integration.
 *
 * Handles: discovery, connection, authentication, gear reading,
 * battery, shift commands, and real-time notifications.
 *
 * Generic — works with any Shimano STEPS drive unit that exposes
 * the 000018FF-SHIMANO_BLE service.
 */
@SuppressLint("MissingPermission")
class ShimanoProtocol(private val context: Context) {

    companion object {
        const val TAG = "ShimanoProtocol"

        // Shimano proprietary UUID base: "SHIMANO_BLE\0"
        private const val SHIMANO_BASE = "-5348-494D-414E-4F5F424C4500"

        // Services
        val SERVICE_ETUBE    = UUID.fromString("000018FF$SHIMANO_BASE")
        val SERVICE_INFO     = UUID.fromString("000018FE$SHIMANO_BASE")
        val SERVICE_REALTIME = UUID.fromString("000018EF$SHIMANO_BASE")
        val SERVICE_BATTERY  = UUID.fromString("0000180F-0000-1000-8000-00805f9b34fb")
        val SERVICE_DEVINFO  = UUID.fromString("0000180A-0000-1000-8000-00805f9b34fb")

        // Service 18FF — E-Tube protocol
        val CHAR_AUTH_CONTROL = UUID.fromString("00002AF3$SHIMANO_BASE") // I,SW,W
        val CHAR_AUTH_NONCE   = UUID.fromString("00002AF4$SHIMANO_BASE") // R
        val CHAR_PCE_RESPONSE = UUID.fromString("00002AF9$SHIMANO_BASE") // N
        val CHAR_PCE_COMMAND  = UUID.fromString("00002AFA$SHIMANO_BASE") // W,WNR

        // Service 18FE — Info
        val CHAR_UNIT_TYPE    = UUID.fromString("00002AE2$SHIMANO_BASE") // R
        val CHAR_BLE_ADDRESS  = UUID.fromString("00002AE3$SHIMANO_BASE") // R

        // Service 18EF — Real-time (D-FLY / gear data)
        val CHAR_RT_STATUS    = UUID.fromString("00002AC0$SHIMANO_BASE") // I,R
        val CHAR_RT_NOTIFY    = UUID.fromString("00002AC1$SHIMANO_BASE") // N
        val CHAR_RT_INDICATE  = UUID.fromString("00002AC2$SHIMANO_BASE") // I
        val CHAR_RT_COMPS     = UUID.fromString("00002AC3$SHIMANO_BASE") // I,R
        val CHAR_RT_CONTROL   = UUID.fromString("00002AC4$SHIMANO_BASE") // I,W

        // Standard
        val CHAR_BATTERY      = UUID.fromString("00002A19-0000-1000-8000-00805f9b34fb")
        val CHAR_SERIAL       = UUID.fromString("00002A25-0000-1000-8000-00805f9b34fb")
        val CHAR_FW_REV       = UUID.fromString("00002A26-0000-1000-8000-00805f9b34fb")
        val CHAR_MANUFACTURER = UUID.fromString("00002A29-0000-1000-8000-00805f9b34fb")

        val CCC_DESCRIPTOR    = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        const val SCAN_TIMEOUT_MS = 20000L
        const val RECONNECT_DELAY_MS = 5000L
    }

    // State
    var onData: ((JSONObject) -> Unit)? = null
    private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private val handler = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var scanCallback: ScanCallback? = null
    private var autoReconnect = false
    private var connectedAddress: String? = null

    // Device info (read after connect)
    private var deviceSerial = ""
    private var deviceName = ""
    private var firmwareVersion = ""
    private var authenticated = false

    // Gear state
    private var currentGear = 0
    private var totalGears = 12
    private var isShifting = false
    private var shiftCount = 0
    private val MAX_GEAR_HISTORY = 5000
    private var gearHistory = ArrayDeque<Pair<Long, Int>>() // timestamp → gear

    val isConnected get() = gatt != null && authenticated

    // ══════════════════════════════════════════
    // SCAN — find any Shimano STEPS device
    // ══════════════════════════════════════════

    /** Address to exclude from scan (e.g., the Giant gateway already connected) */
    var excludeAddress: String? = null

    fun scan() {
        val scanner = adapter?.bluetoothLeScanner ?: return
        scanCallback?.let { scanner.stopScan(it) }

        bleLog("SCAN_START", "Looking for Shimano STEPS (service UUID + name patterns)...")
        emitStatus("scanning")

        // Multiple filters: by service UUID + by known name patterns
        // Some Shimano devices don't advertise service UUIDs until connected
        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_ETUBE)).build(),
            ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_REALTIME)).build(),
        )

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val foundAddresses = mutableSetOf<String>()

        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device
                val name = device.name ?: ""
                val addr = device.address

                // Skip already-found and excluded devices
                if (addr in foundAddresses) return
                if (addr == excludeAddress) return
                foundAddresses.add(addr)

                // Check if this looks like a Shimano device
                val uuids = result.scanRecord?.serviceUuids?.joinToString(",") { it.toString() } ?: ""
                // Detect Shimano by:
                // 1. Service UUIDs containing SHIMANO_BLE base (most reliable)
                // 2. Appearance = 0x0480 (Generic Cycling) — set by Shimano STEPS
                // 3. Known device name patterns (user can customize name in E-Tube!)
                val appearance = result.scanRecord?.bytes?.let { getAppearance(it) } ?: 0
                val isCyclingAppearance = appearance == 0x0480 // Generic Cycling

                val isShimano = uuids.contains("5348-494d-414e", true) // SHIMANO_BLE base
                    || uuids.contains("18ff", true) || uuids.contains("18ef", true)
                    || isCyclingAppearance
                    || name.contains("SHIMANO", true)
                    || name.contains("Di2", true)
                    || name.contains("DU-E", true)
                    || name.contains("EP800", true)
                    || name.contains("EP600", true)
                    || name.contains("SC-E", true)

                bleLog("SCAN_FOUND", "name=$name addr=$addr rssi=${result.rssi} shimano=$isShimano uuids=$uuids")

                if (!isShimano) return

                onData?.invoke(JSONObject().apply {
                    put("type", "shimanoFound")
                    put("name", name)
                    put("address", addr)
                    put("rssi", result.rssi)
                    put("uuids", uuids)
                })

                // Auto-connect to first Shimano found
                scanner.stopScan(this)
                scanCallback = null
                connect(addr)
            }

            override fun onScanFailed(errorCode: Int) {
                bleLog("SCAN_FAIL", "errorCode=$errorCode")
                emitError("Shimano scan failed: $errorCode")
            }
        }

        scanCallback = cb

        // Use unfiltered scan — Shimano devices with custom names may not advertise
        // service UUIDs. We detect them by service UUIDs in scan record OR known name
        // patterns. The Appearance field (0x0480 = Cycling) is also checked.
        // Filtered scan misses devices that only expose services after connection.
        scanner.startScan(null, settings, cb)

        handler.postDelayed({
            if (scanCallback === cb) {
                scanner.stopScan(cb)
                scanCallback = null
                Log.i(TAG, "Shimano scan timeout")
                emitError("Nenhum Shimano encontrado")
            }
        }, SCAN_TIMEOUT_MS)
    }

    fun stopScan() {
        scanCallback?.let {
            adapter?.bluetoothLeScanner?.stopScan(it)
            scanCallback = null
        }
    }

    // ══════════════════════════════════════════
    // CONNECT
    // ══════════════════════════════════════════

    fun connect(address: String) {
        if (gatt != null) disconnect()

        val device = adapter?.getRemoteDevice(address) ?: return
        connectedAddress = address
        autoReconnect = true
        authenticated = false
        Log.i(TAG, "Connecting to ${device.name ?: address}...")
        emitStatus("connecting")

        device.connectGatt(context, true, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        autoReconnect = false
        authenticated = false
        gatt?.close()
        gatt = null
        connectedAddress = null
        emitStatus("disconnected")
    }

    /** Re-emit current state for late-connecting PWA clients */
    fun reEmitState() {
        if (!isConnected) return
        onData?.invoke(JSONObject().apply {
            put("type", "shimanoConnected")
            put("serial", deviceSerial)
            put("firmware", firmwareVersion)
            put("name", deviceName)
        })
        // Also re-emit current gear
        if (currentGear > 0) {
            onData?.invoke(JSONObject().apply {
                put("type", "shimanoGear")
                put("gear", currentGear)
                put("total", totalGears)
                put("shifting", isShifting)
            })
        }
        Log.i(TAG, "Re-emitted state: connected, gear=$currentGear/$totalGears")
    }

    // ══════════════════════════════════════════
    // GATT CALLBACK
    // ══════════════════════════════════════════

    private val gattCallback = object : BluetoothGattCallback() {

        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "Connected to ${g.device.name ?: g.device.address}")
                    gatt = g
                    g.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "Disconnected")
                    gatt = null
                    authenticated = false
                    emitStatus("disconnected")
                    val addr = connectedAddress
                    if (autoReconnect && addr != null) {
                        handler.postDelayed({ connect(addr) }, RECONNECT_DELAY_MS)
                    }
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                bleLog("SERVICES_FAIL", "status=$status")
                return
            }

            // Log all discovered services + characteristics
            g.services.forEach { svc ->
                val svcShort = svc.uuid.toString().substring(4, 8).uppercase()
                bleLog("SERVICE", "UUID=${svc.uuid} ($svcShort) chars=${svc.characteristics.size}")
                svc.characteristics.forEach { chr ->
                    val cShort = chr.uuid.toString().substring(4, 8).uppercase()
                    val props = mutableListOf<String>()
                    if (chr.properties and 0x02 != 0) props.add("R")
                    if (chr.properties and 0x04 != 0) props.add("WNR")
                    if (chr.properties and 0x08 != 0) props.add("W")
                    if (chr.properties and 0x10 != 0) props.add("N")
                    if (chr.properties and 0x20 != 0) props.add("I")
                    bleLog("  CHAR", "$cShort [${props.joinToString(",")}] ${chr.uuid}")
                }
            }

            emitStatus("authenticating")

            // Step 1: Read device info (serial, firmware, manufacturer)
            readCharacteristic(g, SERVICE_DEVINFO, CHAR_SERIAL)
        }

        override fun onCharacteristicRead(
            g: BluetoothGatt, char: BluetoothGattCharacteristic, status: Int
        ) {
            @Suppress("DEPRECATION")
            val data = char.value ?: return
            val charShort = char.uuid.toString().substring(4, 8).uppercase()

            onGattOperationComplete()

            if (status != BluetoothGatt.GATT_SUCCESS) {
                bleLog("READ_FAIL", "char=$charShort status=$status uuid=${char.uuid}")
                return
            }

            bleLog("READ", "char=$charShort", data)

            when (char.uuid) {
                CHAR_SERIAL -> {
                    deviceSerial = String(data, Charsets.US_ASCII)
                    bleLog("SERIAL", deviceSerial, data)
                    readCharacteristic(g, SERVICE_DEVINFO, CHAR_FW_REV)
                }
                CHAR_FW_REV -> {
                    firmwareVersion = String(data, Charsets.US_ASCII)
                    bleLog("FIRMWARE", firmwareVersion, data)
                    readCharacteristic(g, SERVICE_DEVINFO, CHAR_MANUFACTURER)
                }
                CHAR_MANUFACTURER -> {
                    val mfr = String(data, Charsets.US_ASCII)
                    bleLog("MANUFACTURER", mfr, data)
                    readCharacteristic(g, SERVICE_INFO, CHAR_BLE_ADDRESS)
                }
                CHAR_BLE_ADDRESS -> {
                    val bleAddrHex = data.joinToString("") { "%02X".format(it) }
                    bleLog("BLE_ADDR", bleAddrHex, data)
                    // Also read unit type from 18FE
                    readCharacteristic(g, SERVICE_INFO, CHAR_UNIT_TYPE)
                }
                CHAR_UNIT_TYPE -> {
                    bleLog("UNIT_TYPE", "raw", data)
                    // Now read auth nonce
                    readCharacteristic(g, SERVICE_ETUBE, CHAR_AUTH_NONCE)
                }
                CHAR_AUTH_NONCE -> {
                    bleLog("AUTH_NONCE", "16-byte challenge", data)
                    performAuthentication(g, data)
                }
                CHAR_BATTERY -> {
                    val level = data[0].toInt() and 0xFF
                    Log.i(TAG, "Di2 Battery: $level%")
                    onData?.invoke(JSONObject().apply {
                        put("type", "shimanoBattery")
                        put("level", level)
                    })
                }
                CHAR_RT_STATUS -> {
                    parseRealtimeStatus(data)
                }
                CHAR_RT_COMPS -> {
                    parseComponentSlots(data)
                }
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(
            g: BluetoothGatt, char: BluetoothGattCharacteristic
        ) {
            val data = char.value ?: return
            val charShort = char.uuid.toString().substring(4, 8).uppercase()
            bleLog("NOTIFY", "char=$charShort", data)

            when (char.uuid) {
                CHAR_PCE_RESPONSE -> parsePceResponse(data)
                CHAR_RT_NOTIFY -> parseRealtimeNotify(data)
                CHAR_RT_STATUS -> parseRealtimeStatus(data)
                CHAR_RT_COMPS -> parseComponentSlots(data)
                CHAR_BATTERY -> {
                    val level = data[0].toInt() and 0xFF
                    bleLog("BATTERY_NOTIFY", "level=$level%", data)
                    onData?.invoke(JSONObject().apply {
                        put("type", "shimanoBattery")
                        put("level", level)
                    })
                }
                CHAR_AUTH_CONTROL -> {
                    bleLog("AUTH_RESPONSE", "indication from AUTH_CONTROL", data)
                    handleAuthResponse(g, data)
                }
                else -> {
                    bleLog("UNKNOWN_NOTIFY", "char=$charShort uuid=${char.uuid}", data)
                }
            }
        }

        @Suppress("DEPRECATION")
        override fun onDescriptorWrite(g: BluetoothGatt, desc: BluetoothGattDescriptor, status: Int) {
            onGattOperationComplete()
            val charShort = desc.characteristic.uuid.toString().substring(4, 8).uppercase()
            val descVal = desc.value?.joinToString("") { "%02x".format(it) } ?: "null"
            if (status == BluetoothGatt.GATT_SUCCESS) {
                bleLog("DESC_WRITE_OK", "char=$charShort cccd=$descVal")
            } else {
                bleLog("DESC_WRITE_FAIL", "char=$charShort status=$status cccd=$descVal")
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicWrite(
            g: BluetoothGatt, char: BluetoothGattCharacteristic, status: Int
        ) {
            onGattOperationComplete()
            val charShort = char.uuid.toString().substring(4, 8).uppercase()
            if (status == BluetoothGatt.GATT_SUCCESS) {
                bleLog("WRITE_OK", "char=$charShort", char.value)
            } else {
                bleLog("WRITE_FAIL", "char=$charShort status=$status", char.value)
            }
        }
    }

    // ══════════════════════════════════════════
    // AUTHENTICATION
    // ══════════════════════════════════════════

    private fun performAuthentication(g: BluetoothGatt, nonce: ByteArray) {
        // Try multiple dcasSerialHex candidates — log all for analysis
        val bleAddr = connectedAddress?.replace(":", "") ?: ""
        val bleAddrReversed = if (bleAddr.length >= 12) {
            bleAddr.chunked(2).reversed().joinToString("")
        } else ""

        bleLog("AUTH_START", "serial=$deviceSerial bleAddr=$bleAddr bleAddrReversed=$bleAddrReversed")

        // Primary attempt: use BLE address (most common for DCAS)
        val dcasHex = if (bleAddr.length >= 12) bleAddr else deviceSerial
        bleLog("AUTH_DCAS", "using dcasHex=$dcasHex")

        ShimanoAuth.generateKeys(dcasHex, deviceSerial)

        bleLog("AUTH", "Authentication keys generated")

        val authPayload = ShimanoAuth.getAuthPayload()
        bleLog("AUTH", "Authentication payload prepared (${authPayload.size} bytes)")

        // Subscribe to AUTH_CONTROL indications first
        enableIndication(g, SERVICE_ETUBE, CHAR_AUTH_CONTROL)

        // Write auth payload to AUTH_CONTROL
        handler.postDelayed({
            bleLog("AUTH_WRITE", "writing auth payload to AUTH_CONTROL (2AF3)")
            writeCharacteristic(g, SERVICE_ETUBE, CHAR_AUTH_CONTROL, authPayload)
        }, 500)

        // Safety: if no auth response in 3s, try subscribing anyway (maybe auth not needed for some chars)
        handler.postDelayed({
            if (!authenticated) {
                Log.w(TAG, "Shimano auth timed out — proceeding without authentication")
                // Don't set authenticated = true — leave it false
                // Still try to subscribe, but emit warning status
                onData?.invoke(JSONObject().apply {
                    put("type", "shimano_auth")
                    put("status", "timeout_unauthenticated")
                    put("serial", deviceSerial)
                    put("firmware", firmwareVersion)
                })
                subscribeToDataChannels(g)  // Try anyway, device may not require auth
            }
        }, 3000)
    }

    private fun handleAuthResponse(g: BluetoothGatt, data: ByteArray) {
        // Check if auth was accepted
        // On success, subscribe to all data channels
        Log.i(TAG, "Auth response received (${data.size} bytes)")

        // Assume auth success — subscribe to data channels
        authenticated = true
        emitStatus("connected")

        onData?.invoke(JSONObject().apply {
            put("type", "shimanoConnected")
            put("serial", deviceSerial)
            put("firmware", firmwareVersion)
            put("name", deviceName)
        })

        // Subscribe to all data channels
        subscribeToDataChannels(g)
    }

    private fun subscribeToDataChannels(g: BluetoothGatt) {
        // Subscribe in sequence (Android BLE queue)
        val subscriptions = listOf(
            Triple(SERVICE_ETUBE, CHAR_PCE_RESPONSE, true),     // notify
            Triple(SERVICE_REALTIME, CHAR_RT_STATUS, false),     // indicate
            Triple(SERVICE_REALTIME, CHAR_RT_NOTIFY, true),      // notify
            Triple(SERVICE_REALTIME, CHAR_RT_COMPS, false),      // indicate
            Triple(SERVICE_REALTIME, CHAR_RT_CONTROL, false),    // indicate
            Triple(SERVICE_BATTERY, CHAR_BATTERY, true),         // notify
        )

        var delay = 0L
        for ((svc, chr, isNotify) in subscriptions) {
            handler.postDelayed({
                if (isNotify) enableNotification(g, svc, chr)
                else enableIndication(g, svc, chr)
            }, delay)
            delay += 200
        }

        // After subscriptions, read initial state
        handler.postDelayed({
            readCharacteristic(g, SERVICE_BATTERY, CHAR_BATTERY)
            readCharacteristic(g, SERVICE_REALTIME, CHAR_RT_STATUS)
            readCharacteristic(g, SERVICE_REALTIME, CHAR_RT_COMPS)
        }, delay + 300)
    }

    // ══════════════════════════════════════════
    // DATA PARSING
    // ══════════════════════════════════════════

    private fun parsePceResponse(data: ByteArray) {
        val hex = data.joinToString("") { "%02x".format(it) }
        Log.d(TAG, "PCE Response: $hex (${data.size}B)")

        // Try to decrypt
        if (data.size >= 16) {
            val decrypted = ShimanoAuth.decrypt(data)
            val decHex = decrypted.joinToString("") { "%02x".format(it) }
            Log.d(TAG, "PCE Decrypted: $decHex")

            onData?.invoke(JSONObject().apply {
                put("type", "shimanoPce")
                put("hex", decHex)
                put("raw", hex)
                put("length", data.size)
            })
        } else {
            onData?.invoke(JSONObject().apply {
                put("type", "shimanoPce")
                put("hex", hex)
                put("length", data.size)
            })
        }
    }

    private fun parseRealtimeStatus(data: ByteArray) {
        if (data.isEmpty()) return
        val hex = data.joinToString("") { "%02x".format(it) }
        Log.d(TAG, "RT Status: $hex")

        // Byte 0: unit type/status
        // Bytes 1-5: data
        // Byte 6: connected unit count
        val unitCount = if (data.size >= 7) data[6].toInt() and 0xFF else 0

        onData?.invoke(JSONObject().apply {
            put("type", "shimanoStatus")
            put("hex", hex)
            put("unitCount", unitCount)
        })
    }

    private fun parseComponentSlots(data: ByteArray) {
        if (data.size < 5) return
        val hex = data.joinToString("") { "%02x".format(it) }
        Log.d(TAG, "Component slots: $hex")

        // Parse 5-byte groups: [type, status, gear/FF, status2, gear2/FF]
        val components = JSONArray()
        var i = 0
        var slotIdx = 0
        while (i + 5 <= data.size) {
            val type = data[i].toInt() and 0xFF
            val status = data[i + 1].toInt() and 0xFF
            val gear = data[i + 2].toInt() and 0xFF

            if (type != 0 || status != 0 || gear != 0xFF) {
                // This slot has data — likely a connected Di2 component
                val comp = JSONObject().apply {
                    put("slot", slotIdx)
                    put("type", type)
                    put("status", status)
                    put("gear", if (gear != 0xFF) gear else -1)
                }
                components.put(comp)

                // Update gear state if valid
                if (gear != 0xFF && gear > 0) {
                    val newGear = gear
                    if (newGear != currentGear) {
                        val oldGear = currentGear
                        currentGear = newGear
                        shiftCount++
                        gearHistory.addLast(Pair(System.currentTimeMillis(), newGear))
                        if (gearHistory.size > MAX_GEAR_HISTORY) gearHistory.removeFirst()

                        onData?.invoke(JSONObject().apply {
                            put("type", "shimanoGear")
                            put("gear", newGear)
                            put("previousGear", oldGear)
                            put("totalGears", totalGears)
                            put("shiftCount", shiftCount)
                            put("direction", if (newGear > oldGear) "up" else "down")
                        })
                    }
                }
            }
            i += 5
            slotIdx++
        }

        onData?.invoke(JSONObject().apply {
            put("type", "shimanoComponents")
            put("components", components)
            put("hex", hex)
        })
    }

    private fun parseRealtimeNotify(data: ByteArray) {
        val hex = data.joinToString("") { "%02x".format(it) }

        // 17-byte packet: gear data
        // Format: 00 00 03 FF FF [GEAR] [TOTAL_GEARS] 80 80 80 00 EE 12 FF FF 15 00
        //         byte 0-4: header    byte 5: gear    byte 6: total (0x0C=12)
        if (data.size >= 7 && data[0].toInt() == 0x00 && data[1].toInt() == 0x00) {
            val gear = data[5].toInt() and 0xFF
            val total = data[6].toInt() and 0xFF

            if (gear in 1..total && total in 1..24) {
                totalGears = total

                if (gear != currentGear) {
                    val oldGear = currentGear
                    currentGear = gear
                    shiftCount++
                    gearHistory.addLast(Pair(System.currentTimeMillis(), gear))
                    if (gearHistory.size > MAX_GEAR_HISTORY) gearHistory.removeFirst()

                    val direction = if (gear > oldGear) "up" else "down"
                    bleLog("GEAR_CHANGE", "$oldGear → $gear ($direction) total=$total shifts=$shiftCount")

                    onData?.invoke(JSONObject().apply {
                        put("type", "shimanoGear")
                        put("gear", gear)
                        put("previousGear", oldGear)
                        put("totalGears", total)
                        put("shiftCount", shiftCount)
                        put("direction", direction)
                    })
                }
                // Don't spam logs for same gear — only log changes
                return
            }
        }

        // 3-byte packet: heartbeat (04 FF FF)
        if (data.size == 3 && data[0].toInt() and 0xFF == 0x04) {
            // Heartbeat — ignore silently
            return
        }

        // 6-byte packet: shift event (06 42 00 00 00 03)
        if (data.size == 6 && data[0].toInt() and 0xFF == 0x06) {
            bleLog("SHIFT_EVENT", "raw", data)
            onData?.invoke(JSONObject().apply {
                put("type", "shimanoShiftEvent")
                put("hex", hex)
            })
            return
        }

        // Unknown format — log for analysis
        bleLog("RT_UNKNOWN", "len=${data.size}", data)
    }

    // ══════════════════════════════════════════
    // COMMANDS — Shift gear, read battery, etc.
    // ══════════════════════════════════════════

    /**
     * Send a PCE command to the drive unit.
     * Commands are written to PCE_COMMAND (2AFA), encrypted.
     */
    fun sendPceCommand(controlInfo: Byte, data: ByteArray) {
        val g = gatt ?: return
        if (!authenticated) {
            Log.w(TAG, "Not authenticated — cannot send PCE command")
            return
        }

        val payload = ByteArray(data.size + 1)
        payload[0] = controlInfo
        System.arraycopy(data, 0, payload, 1, data.size)

        // Encrypt if >= 16 bytes
        val toSend = if (payload.size >= 16) ShimanoAuth.encrypt(payload) else payload

        writeCharacteristic(g, SERVICE_ETUBE, CHAR_PCE_COMMAND, toSend, writeNoResponse = true)
    }

    /** Read battery level (triggers notification) */
    fun readBattery() {
        val g = gatt ?: return
        readCharacteristic(g, SERVICE_BATTERY, CHAR_BATTERY)
    }

    /** Read current component/gear state */
    fun readGearState() {
        val g = gatt ?: return
        readCharacteristic(g, SERVICE_REALTIME, CHAR_RT_COMPS)
        readCharacteristic(g, SERVICE_REALTIME, CHAR_RT_STATUS)
    }

    /** Get gear statistics for current session */
    fun getGearStats(): JSONObject {
        val stats = JSONObject()
        stats.put("currentGear", currentGear)
        stats.put("totalGears", totalGears)
        stats.put("shiftCount", shiftCount)

        // Gear usage: count time spent in each gear
        val usage = JSONObject()
        if (gearHistory.size >= 2) {
            for (i in 0 until gearHistory.size - 1) {
                val (t1, g1) = gearHistory[i]
                val (t2, _) = gearHistory[i + 1]
                val durationMs = t2 - t1
                val key = g1.toString()
                usage.put(key, usage.optLong(key, 0) + durationMs)
            }
            // Add current gear time since last shift
            if (gearHistory.isNotEmpty()) {
                val (lastTime, lastGear) = gearHistory.last()
                val key = lastGear.toString()
                usage.put(key, usage.optLong(key, 0) + (System.currentTimeMillis() - lastTime))
            }
        }
        stats.put("gearUsage", usage)
        stats.put("history", JSONArray().apply {
            gearHistory.takeLast(100).forEach { (t, g) ->
                put(JSONObject().put("t", t).put("g", g))
            }
        })
        return stats
    }

    /** Reset session stats (call at ride start) */
    fun resetStats() {
        shiftCount = 0
        gearHistory.clear()
        if (currentGear > 0) {
            gearHistory.addLast(Pair(System.currentTimeMillis(), currentGear))
        }
    }

    // ══════════════════════════════════════════
    // GATT OPERATION QUEUE
    // ══════════════════════════════════════════

    private val gattQueue = ArrayDeque<() -> Unit>()
    private var gattBusy = false

    private fun enqueueGattOp(op: () -> Unit) {
        gattQueue.addLast(op)
        processGattQueue()
    }

    private fun processGattQueue() {
        if (gattBusy || gattQueue.isEmpty()) return
        gattBusy = true
        gattQueue.removeFirst().invoke()
    }

    /** Call from onCharacteristicRead/onCharacteristicWrite/onDescriptorWrite to advance queue */
    private fun onGattOperationComplete() {
        gattBusy = false
        processGattQueue()
    }

    // ══════════════════════════════════════════
    // BLE HELPERS
    // ══════════════════════════════════════════

    @Suppress("DEPRECATION")
    private fun readCharacteristic(g: BluetoothGatt, serviceUuid: UUID, charUuid: UUID) {
        val char = g.getService(serviceUuid)?.getCharacteristic(charUuid)
        if (char != null) {
            enqueueGattOp { g.readCharacteristic(char) }
        } else {
            Log.w(TAG, "Char not found: $charUuid in service $serviceUuid")
        }
    }

    @Suppress("DEPRECATION")
    private fun writeCharacteristic(
        g: BluetoothGatt, serviceUuid: UUID, charUuid: UUID,
        data: ByteArray, writeNoResponse: Boolean = false
    ) {
        val char = g.getService(serviceUuid)?.getCharacteristic(charUuid)
        if (char != null) {
            enqueueGattOp {
                char.value = data
                char.writeType = if (writeNoResponse)
                    BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                else
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                g.writeCharacteristic(char)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun enableNotification(g: BluetoothGatt, serviceUuid: UUID, charUuid: UUID) {
        val char = g.getService(serviceUuid)?.getCharacteristic(charUuid) ?: return
        enqueueGattOp {
            g.setCharacteristicNotification(char, true)
            char.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                g.writeDescriptor(desc)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun enableIndication(g: BluetoothGatt, serviceUuid: UUID, charUuid: UUID) {
        val char = g.getService(serviceUuid)?.getCharacteristic(charUuid) ?: return
        enqueueGattOp {
            g.setCharacteristicNotification(char, true)
            char.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                desc.value = BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                g.writeDescriptor(desc)
            }
        }
    }

    private fun emitStatus(status: String) {
        onData?.invoke(JSONObject().apply {
            put("type", "shimanoStatus")
            put("status", status)
            put("serial", deviceSerial)
            put("firmware", firmwareVersion)
        })
    }

    private fun emitError(msg: String) {
        onData?.invoke(JSONObject().apply {
            put("type", "shimanoError")
            put("error", msg)
        })
    }

    /** Comprehensive BLE logger — logs to Android + forwards to WebSocket for PWA analysis */
    private fun bleLog(event: String, detail: String, rawBytes: ByteArray? = null) {
        val hex = rawBytes?.joinToString("") { "%02x".format(it) } ?: ""
        val msg = "[$event] $detail${if (hex.isNotEmpty()) " | hex=$hex (${rawBytes?.size}B)" else ""}"
        Log.i("SHIMANO_BLE", msg)

        // Forward to WebSocket so PWA can capture + display
        onData?.invoke(JSONObject().apply {
            put("type", "shimanoBleLog")
            put("event", event)
            put("detail", detail)
            put("hex", hex)
            put("bytes", rawBytes?.size ?: 0)
            put("ts", System.currentTimeMillis())
        })
    }

    /** Parse BLE Appearance from raw advertising bytes (AD type 0x19) */
    private fun getAppearance(scanRecord: ByteArray): Int {
        var i = 0
        while (i < scanRecord.size - 1) {
            val len = scanRecord[i].toInt() and 0xFF
            if (len == 0) break
            if (i + len >= scanRecord.size) break
            val type = scanRecord[i + 1].toInt() and 0xFF
            if (type == 0x19 && len >= 3) { // Appearance
                return (scanRecord[i + 2].toInt() and 0xFF) or
                       ((scanRecord[i + 3].toInt() and 0xFF) shl 8)
            }
            i += len + 1
        }
        return 0
    }

    fun destroy() {
        stopScan()
        autoReconnect = false
        gatt?.close()
        gatt = null
    }
}
