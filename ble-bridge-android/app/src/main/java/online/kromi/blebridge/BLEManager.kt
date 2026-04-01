package online.kromi.blebridge

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.util.UUID

@SuppressLint("MissingPermission")
class BLEManager(private val context: Context) {

    companion object {
        const val TAG = "BLEManager"

        val BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        val BATTERY_LEVEL = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        val CSC_SERVICE = UUID.fromString("00001816-0000-1000-8000-00805f9b34fb")
        val CSC_MEASUREMENT = UUID.fromString("00002a5b-0000-1000-8000-00805f9b34fb")
        val POWER_SERVICE = UUID.fromString("00001818-0000-1000-8000-00805f9b34fb")
        val POWER_MEASUREMENT = UUID.fromString("00002a63-0000-1000-8000-00805f9b34fb")
        val HR_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val HR_MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")

        val GEV_SERVICE = UUID.fromString("f0ba3012-6cac-4c99-9089-4b0a1df45002")
        val GEV_NOTIFY = UUID.fromString("f0ba3013-6cac-4c99-9089-4b0a1df45002")
        val PROTO_SERVICE = UUID.fromString("f0ba5201-6cac-4c99-9089-4b0a1df45002")
        val PROTO_WRITE = UUID.fromString("f0ba5202-6cac-4c99-9089-4b0a1df45002")
        val PROTO_NOTIFY = UUID.fromString("f0ba5203-6cac-4c99-9089-4b0a1df45002")

        // Giant Smart Gateway proprietary service (advertised as "0001")
        // Full UUID: 4d500001-4745-5630-3031-e50e24dcca9e (base: 4D50 = "MP")
        val SG_SERVICE = UUID.fromString("4d500001-4745-5630-3031-e50e24dcca9e")
        val SG_WRITE   = UUID.fromString("4d500002-4745-5630-3031-e50e24dcca9e")
        val SG_NOTIFY  = UUID.fromString("4d500003-4745-5630-3031-e50e24dcca9e")

        // Nordic DFU Secure (FE59)
        val DFU_SERVICE = UUID.fromString("0000fe59-0000-1000-8000-00805f9b34fb")

        val DEVICE_INFO_SERVICE = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
        val FIRMWARE_REVISION = UUID.fromString("00002a26-0000-1000-8000-00805f9b34fb")
        val HARDWARE_REVISION = UUID.fromString("00002a27-0000-1000-8000-00805f9b34fb")
        val SOFTWARE_REVISION = UUID.fromString("00002a28-0000-1000-8000-00805f9b34fb")

        val CCC_DESCRIPTOR = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    var onDataReceived: ((JSONObject) -> Unit)? = null
    var onStatusChanged: ((String) -> Unit)? = null

    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var gatt: BluetoothGatt? = null
    private var gevChar: BluetoothGattCharacteristic? = null
    private var protoWriteChar: BluetoothGattCharacteristic? = null
    private var sgWriteChar: BluetoothGattCharacteristic? = null
    private val handler = Handler(Looper.getMainLooper())
    private val pendingNotifications = mutableListOf<BluetoothGattCharacteristic>()

    private var lastWheelRevs = 0L
    private var lastWheelTime = 0L
    private var totalDistance = 0.0
    private val wheelCircumference = 2.290

    // Serial GATT operation queues
    private val pendingReads = mutableListOf<BluetoothGattCharacteristic>()
    private var hasRediscovered = false

    val isConnected: Boolean get() = gatt != null
    val isScanning: Boolean get() = scanCallback != null

    private var scanCallback: ScanCallback? = null

    /**
     * Scan for BLE devices. Each found device is reported via onFound callback.
     * onDone is called when scan completes (timeout or manual stop).
     * Scan is owned by the caller — concurrent scan requests are rejected.
     */
    fun startScan(onFound: (BluetoothDevice, Int, String) -> Unit, onDone: () -> Unit) {
        if (scanCallback != null) {
            Log.w(TAG, "Scan already in progress — ignoring")
            return
        }
        if (gatt != null) {
            Log.w(TAG, "Already connected — ignoring scan")
            return
        }

        val scanner = bluetoothAdapter?.bluetoothLeScanner ?: return
        onStatusChanged?.invoke("Scanning...")
        hasRediscovered = false

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val seen = mutableSetOf<String>()

        scanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val addr = result.device.address
                if (addr in seen) return
                seen.add(addr)

                val name = result.device.name ?: return
                val uuids = result.scanRecord?.serviceUuids?.joinToString(",") {
                    it.toString().substring(4, 8).uppercase()
                } ?: "-"

                Log.i(TAG, "Scan: $name ($addr) RSSI:${result.rssi} UUID:$uuids bond:${result.device.bondState}")
                onFound(result.device, result.rssi, uuids)
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "Scan failed: $errorCode")
                onStatusChanged?.invoke("Scan failed ($errorCode)")
            }
        }

        scanner.startScan(null, settings, scanCallback)

        // Auto-stop after 12s
        handler.postDelayed({
            stopScan(onDone)
        }, 12000)
    }

    fun stopScan(onDone: (() -> Unit)? = null) {
        scanCallback?.let { cb ->
            try {
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(cb)
            } catch (_: Exception) {}
        }
        scanCallback = null
        onDone?.invoke()
    }

    fun connectToDevice(device: BluetoothDevice) {
        // Prevent double connections
        if (gatt != null) {
            Log.w(TAG, "Already connected — disconnect first")
            onStatusChanged?.invoke("Already connected — disconnect first")
            return
        }
        Log.i(TAG, "Connecting to ${device.name} (${device.address}) bond:${device.bondState}")
        onStatusChanged?.invoke("Connecting to ${device.name}...")
        connectGatt(device)
    }

    private fun connectGatt(device: BluetoothDevice) {
        // RideControl uses TRANSPORT_LE explicitly
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        gevChar = null
        protoWriteChar = null
        sgWriteChar = null
        onDataReceived?.invoke(JSONObject().put("type", "disconnected"))
        onStatusChanged?.invoke("Disconnected")
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "GATT connected to ${g.device.name} (bond: ${g.device.bondState})")
                    onStatusChanged?.invoke("Connected, discovering services...")

                    // If bonded, services should include GEV/Proto
                    // Small delay before service discovery for stability
                    handler.postDelayed({
                        g.discoverServices()
                    }, 500)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "GATT disconnected")
                    gatt?.close()
                    gatt = null
                    gevChar = null
                    protoWriteChar = null
                    sgWriteChar = null
                    onDataReceived?.invoke(JSONObject().put("type", "disconnected"))
                    onStatusChanged?.invoke("Disconnected")
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "Service discovery failed: $status")
                return
            }

            val deviceName = g.device.name ?: "Unknown"
            val bondState = g.device.bondState

            // Log ALL discovered services with full detail
            Log.i(TAG, "╔══════════════════════════════════════════╗")
            Log.i(TAG, "║ SERVICES DISCOVERED (${g.services.size} total)")
            Log.i(TAG, "║ Device: $deviceName  Bond: $bondState")
            Log.i(TAG, "║ Rediscovery: $hasRediscovered")
            Log.i(TAG, "╚══════════════════════════════════════════╝")
            for (service in g.services) {
                val svcShort = service.uuid.toString().substring(4, 8).uppercase()
                Log.i(TAG, "┌─ Service: ${service.uuid} [$svcShort]")
                for (char in service.characteristics) {
                    val cShort = char.uuid.toString().substring(4, 8).uppercase()
                    val props = describeProperties(char.properties)
                    Log.i(TAG, "│  Char: ${char.uuid} [$cShort] props=$props (${char.properties})")
                    for (desc in char.descriptors) {
                        Log.i(TAG, "│    Desc: ${desc.uuid}")
                    }
                }
                Log.i(TAG, "└───────────────────────────────────")
            }

            onDataReceived?.invoke(JSONObject()
                .put("type", "connected")
                .put("device", deviceName)
                .put("bonded", bondState == BluetoothDevice.BOND_BONDED))
            onStatusChanged?.invoke("Connected: $deviceName (bond:$bondState, svc:${g.services.size})")

            // Send full service map to UI
            val allServices = org.json.JSONArray()
            for (service in g.services) {
                val sObj = JSONObject()
                    .put("uuid", service.uuid.toString())
                    .put("short", service.uuid.toString().substring(4, 8).uppercase())
                val chars = org.json.JSONArray()
                for (char in service.characteristics) {
                    chars.put(JSONObject()
                        .put("uuid", char.uuid.toString())
                        .put("short", char.uuid.toString().substring(4, 8).uppercase())
                        .put("props", char.properties)
                        .put("propsStr", describeProperties(char.properties)))
                }
                sObj.put("chars", chars)
                allServices.put(sObj)
            }
            onDataReceived?.invoke(JSONObject().put("type", "allServices").put("data", allServices))

            val services = JSONObject()
            pendingNotifications.clear()
            pendingReads.clear()

            // Battery
            g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let { char ->
                services.put("battery", true)
                pendingNotifications.add(char)
            } ?: services.put("battery", false)

            // CSC
            g.getService(CSC_SERVICE)?.getCharacteristic(CSC_MEASUREMENT)?.let { char ->
                services.put("csc", true)
                pendingNotifications.add(char)
            } ?: services.put("csc", false)

            // Power
            g.getService(POWER_SERVICE)?.getCharacteristic(POWER_MEASUREMENT)?.let { char ->
                services.put("power", true)
                pendingNotifications.add(char)
            } ?: services.put("power", false)

            // GEV
            g.getService(GEV_SERVICE)?.getCharacteristic(GEV_NOTIFY)?.let { char ->
                services.put("gev", true)
                gevChar = char
                pendingNotifications.add(char)
                Log.i(TAG, "★★★ GEV SERVICE FOUND! Motor control available! ★★★")
            } ?: run {
                services.put("gev", false)
                Log.w(TAG, "GEV service NOT found (bond:$bondState)")
            }

            // Proto
            g.getService(PROTO_SERVICE)?.let { service ->
                services.put("proto", true)
                service.getCharacteristic(PROTO_WRITE)?.let { protoWriteChar = it }
                service.getCharacteristic(PROTO_NOTIFY)?.let { pendingNotifications.add(it) }
                Log.i(TAG, "★★★ PROTO SERVICE FOUND! ★★★")
            } ?: run {
                services.put("proto", false)
                Log.w(TAG, "Proto service NOT found (bond:$bondState)")
            }

            // HR
            g.getService(HR_SERVICE)?.getCharacteristic(HR_MEASUREMENT)?.let { char ->
                services.put("hr", true)
                pendingNotifications.add(char)
            } ?: services.put("hr", false)

            // Smart Gateway proprietary service (4d500001)
            g.getService(SG_SERVICE)?.let { service ->
                services.put("sg", true)
                Log.i(TAG, "★★★ SMART GATEWAY SERVICE FOUND (4d500001)! ★★★")
                service.getCharacteristic(SG_WRITE)?.let {
                    sgWriteChar = it
                    Log.i(TAG, "★ SG Write char available (WRITE_NO_RSP|WRITE)")
                }
                service.getCharacteristic(SG_NOTIFY)?.let { char ->
                    pendingNotifications.add(char)
                    Log.i(TAG, "★ SG Notify char — subscribing")
                }
            } ?: services.put("sg", false)

            onDataReceived?.invoke(JSONObject().put("type", "services").put("data", services))

            // Queue Device Info reads (serialized via pendingReads)
            g.getService(DEVICE_INFO_SERVICE)?.let { svc ->
                for (char in svc.characteristics) {
                    if (char.properties and BluetoothGattCharacteristic.PROPERTY_READ != 0) {
                        pendingReads.add(char)
                    }
                }
            }

            // Queue Battery read
            g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let {
                pendingReads.add(it)
            }

            // Queue reads from unknown services
            val knownServices = setOf(
                BATTERY_SERVICE, CSC_SERVICE, POWER_SERVICE, HR_SERVICE,
                DEVICE_INFO_SERVICE, GEV_SERVICE, PROTO_SERVICE, SG_SERVICE, DFU_SERVICE,
                UUID.fromString("00001800-0000-1000-8000-00805f9b34fb"),
                UUID.fromString("00001801-0000-1000-8000-00805f9b34fb")
            )
            for (service in g.services) {
                if (service.uuid !in knownServices) {
                    Log.i(TAG, ">>> EXPLORING unknown service: ${service.uuid} <<<")
                    for (char in service.characteristics) {
                        if (char.properties and BluetoothGattCharacteristic.PROPERTY_READ != 0) {
                            pendingReads.add(char)
                        }
                        if (char.properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) {
                            pendingNotifications.add(char)
                        }
                    }
                }
            }

            Log.i(TAG, ">>> Queue: ${pendingReads.size} reads, ${pendingNotifications.size} notifications")

            // Start serial read chain → then notifications
            processNextRead(g)
        }

        override fun onCharacteristicRead(g: BluetoothGatt, char: BluetoothGattCharacteristic, status: Int) {
            val cShort = char.uuid.toString().substring(4, 8).uppercase()
            val hex = char.value?.joinToString("") { "%02x".format(it) } ?: "(null)"
            val ascii = char.value?.let { bytes ->
                String(bytes.filter { it in 0x20..0x7E }.toByteArray())
            } ?: ""

            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "READ [$cShort]: hex=$hex ascii=\"$ascii\" len=${char.value?.size ?: 0}")
                onDataReceived?.invoke(JSONObject()
                    .put("type", "charRead")
                    .put("uuid", char.uuid.toString())
                    .put("short", cShort)
                    .put("hex", hex)
                    .put("ascii", ascii)
                    .put("size", char.value?.size ?: 0))
                handleCharacteristicData(char)
            } else {
                Log.w(TAG, "READ FAILED [$cShort]: status=$status")
            }

            // Chain: next read, or start notifications
            handler.postDelayed({ processNextRead(g) }, 50)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, char: BluetoothGattCharacteristic) {
            val cShort = char.uuid.toString().substring(4, 8).uppercase()
            val knownChars = setOf("2A19", "2A5B", "2A63", "2A37")
            val isSG = char.uuid == SG_NOTIFY
            if (cShort !in knownChars && !isSG) {
                val hex = char.value?.joinToString("") { "%02x".format(it) } ?: ""
                Log.i(TAG, ">>> NOTIFY [$cShort] ${char.uuid}: hex=$hex len=${char.value?.size ?: 0}")
                onDataReceived?.invoke(JSONObject()
                    .put("type", "unknownNotify")
                    .put("uuid", char.uuid.toString())
                    .put("short", cShort)
                    .put("hex", hex)
                    .put("size", char.value?.size ?: 0))
            }
            handleCharacteristicData(char)
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, char: BluetoothGattCharacteristic, status: Int) {
            val cShort = char.uuid.toString().substring(4, 8).uppercase()
            val statusStr = if (status == BluetoothGatt.GATT_SUCCESS) "OK" else "FAIL($status)"
            Log.i(TAG, ">>> WRITE CALLBACK [$cShort]: $statusStr")
            onDataReceived?.invoke(JSONObject()
                .put("type", "sgWriteCallback")
                .put("short", cShort)
                .put("status", status)
                .put("ok", status == BluetoothGatt.GATT_SUCCESS))
        }

        override fun onDescriptorWrite(g: BluetoothGatt, desc: BluetoothGattDescriptor, status: Int) {
            val cShort = desc.characteristic.uuid.toString().substring(4, 8).uppercase()
            val isSG = desc.characteristic.uuid == SG_NOTIFY
            val statusStr = if (status == BluetoothGatt.GATT_SUCCESS) "OK" else "FAIL($status)"
            Log.i(TAG, "Subscribed [$cShort]: $statusStr${if (isSG) " ← SG NOTIFY!" else ""}")
            onDataReceived?.invoke(JSONObject()
                .put("type", "subscribed")
                .put("char", cShort)
                .put("ok", status == BluetoothGatt.GATT_SUCCESS)
                .put("isSG", isSG))
            // Small delay between subscriptions for stability
            handler.postDelayed({ enableNextNotification(g) }, 100)
        }
    }

    private fun enableNextNotification(g: BluetoothGatt) {
        if (pendingNotifications.isEmpty()) {
            Log.i(TAG, "★ All notifications enabled! Listening for data...")
            onStatusChanged?.invoke("All subscribed — listening...")
            return
        }
        val char = pendingNotifications.removeAt(0)
        val cShort = char.uuid.toString().substring(4, 8).uppercase()
        val isSG = char.uuid == SG_NOTIFY
        g.setCharacteristicNotification(char, true)
        char.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
            desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            Log.i(TAG, "Subscribing [$cShort]${if (isSG) " ← SG NOTIFY!" else ""}...")
            g.writeDescriptor(desc)
        } ?: run {
            Log.w(TAG, "No CCC descriptor for [$cShort] — skipping")
            enableNextNotification(g)
        }
    }

    private fun handleCharacteristicData(char: BluetoothGattCharacteristic) {
        val data = char.value ?: return
        val charUuid = char.uuid

        try {
            when (charUuid) {
                BATTERY_LEVEL -> {
                    val pct = data[0].toInt() and 0xFF
                    onDataReceived?.invoke(JSONObject().put("type", "battery").put("value", pct))
                }
                CSC_MEASUREMENT -> parseCSC(data)
                POWER_MEASUREMENT -> {
                    if (data.size >= 4) {
                        val watts = (data[2].toInt() and 0xFF) or ((data[3].toInt() and 0xFF) shl 8)
                        onDataReceived?.invoke(JSONObject().put("type", "power").put("value", watts))
                    }
                }
                HR_MEASUREMENT -> {
                    val flags = data[0].toInt() and 0xFF
                    val bpm = if (flags and 0x01 != 0) {
                        (data[1].toInt() and 0xFF) or ((data[2].toInt() and 0xFF) shl 8)
                    } else {
                        data[1].toInt() and 0xFF
                    }
                    val zone = when { bpm < 100 -> 1; bpm < 130 -> 2; bpm < 155 -> 3; bpm < 175 -> 4; else -> 5 }
                    onDataReceived?.invoke(JSONObject().put("type", "hr").put("bpm", bpm).put("zone", zone))
                }
                GEV_NOTIFY -> {
                    val hex = data.joinToString("") { "%02x".format(it) }
                    onDataReceived?.invoke(JSONObject().put("type", "gevRaw").put("hex", hex))
                    parseGEV(data)
                }
                PROTO_NOTIFY -> {
                    val hex = data.joinToString("") { "%02x".format(it) }
                    onDataReceived?.invoke(JSONObject().put("type", "protoRaw").put("hex", hex))
                }
                SG_NOTIFY -> {
                    val hex = data.joinToString("") { "%02x".format(it) }

                    // Parse FC-header packets
                    if (data.size >= 3 && data[0] == 0xFC.toByte()) {
                        val device = data[1].toInt() and 0xFF
                        val byte2 = data[2].toInt() and 0xFF

                        when (device) {
                            0x23 -> {
                                // Plaintext telemetry: FC 23 [len] [cmd] [payload] [xor]
                                val cmd = if (data.size > 3) data[3].toInt() and 0xFF else -1
                                Log.i(TAG, "★ SG D23 cmd=${"%02x".format(cmd)}: $hex")
                                onDataReceived?.invoke(JSONObject()
                                    .put("type", "sgTelemetry")
                                    .put("cmd", cmd)
                                    .put("hex", hex)
                                    .put("size", data.size))
                            }
                            0x22 -> {
                                Log.i(TAG, "★ SG D22 heartbeat: $hex")
                                onDataReceived?.invoke(JSONObject()
                                    .put("type", "sgHeartbeat")
                                    .put("hex", hex))
                            }
                            0x21 -> {
                                // AES encrypted: FC 21 [cmd] [16 AES bytes] [checksum]
                                val cmd = byte2
                                Log.i(TAG, "★ SG D21 cmd=${"%02x".format(cmd)} (AES): $hex")
                                onDataReceived?.invoke(JSONObject()
                                    .put("type", "sgEncrypted")
                                    .put("cmd", cmd)
                                    .put("hex", hex)
                                    .put("size", data.size))

                                // Try decrypt the 16 AES bytes (bytes 3..18)
                                if (data.size >= 19) {
                                    val aesBlock = data.copyOfRange(3, 19)
                                    for (keyIdx in intArrayOf(4, 13, 14, 8)) {
                                        val dec = GEVCrypto.decrypt(aesBlock, keyIdx)
                                        val dHex = dec.joinToString("") { "%02x".format(it) }
                                        Log.i(TAG, "  DEC K$keyIdx: $dHex")
                                    }
                                }
                            }
                            else -> {
                                Log.i(TAG, "★ SG D${"%02x".format(device)}: $hex")
                                onDataReceived?.invoke(JSONObject()
                                    .put("type", "sgNotify")
                                    .put("hex", hex)
                                    .put("size", data.size))
                            }
                        }
                    } else {
                        // Non-FC packet (like ba0000e224)
                        Log.i(TAG, "★ SG RAW: $hex len=${data.size}")
                        onDataReceived?.invoke(JSONObject()
                            .put("type", "sgNotify")
                            .put("hex", hex)
                            .put("size", data.size))
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Parse error: ${e.message}")
        }
    }

    // DeviceInfo reads are serialized via pendingReads queue — no separate method needed

    private fun parseCSC(data: ByteArray) {
        if (data.size < 7) return
        val flags = data[0].toInt() and 0xFF
        var offset = 1

        if (flags and 0x01 != 0) {
            val wheelRevs = ((data[offset].toLong() and 0xFF) or
                    ((data[offset + 1].toLong() and 0xFF) shl 8) or
                    ((data[offset + 2].toLong() and 0xFF) shl 16) or
                    ((data[offset + 3].toLong() and 0xFF) shl 24))
            val wheelTime = ((data[offset + 4].toInt() and 0xFF) or
                    ((data[offset + 5].toInt() and 0xFF) shl 8)).toLong()
            offset += 6

            if (lastWheelRevs > 0 && wheelRevs > lastWheelRevs) {
                val revDiff = wheelRevs - lastWheelRevs
                var timeDiff = wheelTime - lastWheelTime
                if (timeDiff < 0) timeDiff += 65536

                if (timeDiff > 0) {
                    val speedMps = (revDiff * wheelCircumference) / (timeDiff / 1024.0)
                    val speedKmh = speedMps * 3.6
                    totalDistance += revDiff * wheelCircumference / 1000.0

                    onDataReceived?.invoke(JSONObject()
                        .put("type", "speed")
                        .put("value", "%.1f".format(speedKmh).toDouble()))
                    onDataReceived?.invoke(JSONObject()
                        .put("type", "distance")
                        .put("value", "%.2f".format(totalDistance).toDouble()))
                }
            }
            lastWheelRevs = wheelRevs
            lastWheelTime = wheelTime
        }

        if (flags and 0x02 != 0 && offset + 3 < data.size) {
            val crankTime = ((data[offset + 2].toInt() and 0xFF) or
                    ((data[offset + 3].toInt() and 0xFF) shl 8))
            if (crankTime > 0) {
                val cadence = (60 * 1024) / crankTime
                onDataReceived?.invoke(JSONObject().put("type", "cadence").put("value", cadence))
            }
        }
    }

    private fun parseGEV(data: ByteArray) {
        if (data.size < 6) return
        if (data[0] != 0xFC.toByte()) return

        val cmdId = data[2].toInt() and 0xFF
        when (cmdId) {
            0x15 -> {
                val mode = data[4].toInt() and 0xFF
                val current = if (data.size > 5) data[5].toInt() and 0xFF else 0
                onDataReceived?.invoke(JSONObject()
                    .put("type", "assistMode").put("value", mode).put("current", current))
            }
            0x03 -> {
                if (data.size >= 8) {
                    val pct = data[4].toInt() and 0xFF
                    val voltage = ((data[5].toInt() and 0xFF) or ((data[6].toInt() and 0xFF) shl 8)) / 100.0
                    val temp = data[7].toInt() and 0xFF
                    onDataReceived?.invoke(JSONObject()
                        .put("type", "gevBattery").put("percent", pct).put("voltage", voltage).put("temp", temp))
                }
            }
            0x38 -> {
                if (data.size >= 12) {
                    val speed = ((data[4].toInt() and 0xFF) or ((data[5].toInt() and 0xFF) shl 8)) / 10.0
                    val power = ((data[10].toInt() and 0xFF) or ((data[11].toInt() and 0xFF) shl 8))
                    onDataReceived?.invoke(JSONObject()
                        .put("type", "gevRiding").put("speed", speed).put("power", power))
                }
            }
        }
    }

    private fun processNextRead(g: BluetoothGatt) {
        if (pendingReads.isNotEmpty()) {
            val char = pendingReads.removeAt(0)
            val cShort = char.uuid.toString().substring(4, 8).uppercase()
            Log.i(TAG, "Reading [$cShort]... (${pendingReads.size} remaining)")
            g.readCharacteristic(char)
        } else {
            // All reads done → start notification subscriptions
            Log.i(TAG, "All reads done → enabling ${pendingNotifications.size} notifications...")
            enableNextNotification(g)
        }
    }

    private fun describeProperties(props: Int): String {
        val flags = mutableListOf<String>()
        if (props and 0x01 != 0) flags.add("BROADCAST")
        if (props and 0x02 != 0) flags.add("READ")
        if (props and 0x04 != 0) flags.add("WRITE_NO_RSP")
        if (props and 0x08 != 0) flags.add("WRITE")
        if (props and 0x10 != 0) flags.add("NOTIFY")
        if (props and 0x20 != 0) flags.add("INDICATE")
        if (props and 0x40 != 0) flags.add("SIGNED_WRITE")
        if (props and 0x80 != 0) flags.add("EXTENDED")
        return flags.joinToString("|")
    }

    fun writeAssistMode(mode: Int) {
        val g = gatt ?: return
        val char = gevChar ?: run {
            Log.w(TAG, "GEV not available — cannot change assist mode")
            return
        }

        val packet = byteArrayOf(
            0xFC.toByte(), 0x21, 0xE2.toByte(), 0x01, mode.toByte()
        )
        var sum = 0
        for (b in packet) sum += b.toInt() and 0xFF
        val fullPacket = packet + byteArrayOf(((sum shr 8) and 0xFF).toByte(), (sum and 0xFF).toByte())

        char.value = fullPacket
        char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        g.writeCharacteristic(char)
        Log.i(TAG, "Sent assist mode: $mode (packet: ${fullPacket.joinToString("") { "%02x".format(it) }})")
    }

    fun writeProtoGet(module: String) {
        val g = gatt ?: return
        val char = protoWriteChar ?: return
        Log.i(TAG, "Proto GET request: $module")
    }

    /**
     * Test SG Write — session handshake then commands.
     *
     * From APK analysis:
     * - connectGEV uses session keys (0-3, 8) with sendCommandThenWaitNotifications
     * - After session: commands use key 4 (sendData) or 14 (data+cmd)
     * - "aesSe" = session encrypt, "sendD" = send data, "aesDa" = data encrypt
     *
     * Phase 1: Session handshake — CONNECT_GEV (0x00) with session keys 0-3, 8
     * Phase 2: If session works — commands with key 4 and 14
     * Phase 3: Mode change attempts
     */
    /**
     * b13: Based on nRF Connect capture analysis.
     *
     * DISCOVERIES:
     * - Checksum is XOR (not sum!)
     * - Device 0x23 = plaintext telemetry, 0x22 = heartbeat, 0x21 = AES encrypted
     * - Format: [FC][device][len][cmd][payload][XOR_checksum]
     * - SG sends data spontaneously (FC23 packets) — we weren't receiving them
     * - FC 22 00 DE = heartbeat/keepalive
     *
     * This test: send heartbeat + correct-format queries + start a heartbeat timer
     */
    fun testSGWrite() {
        val g = gatt ?: return
        val char = sgWriteChar ?: run {
            Log.w(TAG, "SG Write char not available!")
            onStatusChanged?.invoke("SG not connected")
            return
        }

        val tests = mutableListOf<Pair<String, ByteArray>>()

        // Heartbeat — FC 22 00 DE (from nRF capture, sent periodically by RideControl)
        tests.add("HEARTBEAT" to byteArrayOf(0xFC.toByte(), 0x22, 0x00, 0xDE.toByte()))

        // Query with device 0x23 (plaintext) + XOR checksum
        tests.add("D23_CMD40" to buildSGPacket(0x23, 0x40, byteArrayOf()))
        tests.add("D23_CMD41" to buildSGPacket(0x23, 0x41, byteArrayOf()))
        tests.add("D23_CMD42" to buildSGPacket(0x23, 0x42, byteArrayOf()))
        tests.add("D23_CMD43" to buildSGPacket(0x23, 0x43, byteArrayOf()))

        // Another heartbeat
        tests.add("HEARTBEAT2" to byteArrayOf(0xFC.toByte(), 0x22, 0x00, 0xDE.toByte()))

        // Query with device 0x22 (app commands) + XOR checksum
        tests.add("D22_CMD00" to buildSGPacket(0x22, 0x00, byteArrayOf()))
        tests.add("D22_CMD01" to buildSGPacket(0x22, 0x01, byteArrayOf()))
        tests.add("D22_CMD02" to buildSGPacket(0x22, 0x02, byteArrayOf()))

        // Old format with corrected XOR checksum (device 0x21)
        tests.add("D21_XOR_MODE" to buildSGPacket(0x21, 0x02, byteArrayOf()))

        // AES K4 with CORRECTED XOR checksum format
        val modePkt = buildSGPacket(0x21, 0x02, byteArrayOf())
        tests.add("AES_K4_XOR" to GEVCrypto.encrypt(modePkt, 4))

        // Heartbeat again
        tests.add("HEARTBEAT3" to byteArrayOf(0xFC.toByte(), 0x22, 0x00, 0xDE.toByte()))

        // Wait 3 seconds then check if spontaneous data arrives
        // (heartbeat might trigger data flow)

        Log.i(TAG, "╔═══════════════════════════════════════╗")
        Log.i(TAG, "║  nRF-BASED TEST — ${tests.size} packets      ║")
        Log.i(TAG, "║  Heartbeat + XOR checksum + dev 0x23  ║")
        Log.i(TAG, "╚═══════════════════════════════════════╝")
        onStatusChanged?.invoke("nRF test (${tests.size} packets)...")

        for ((i, test) in tests.withIndex()) {
            val (name, data) = test
            handler.postDelayed({
                val hex = data.joinToString("") { "%02x".format(it) }
                Log.i(TAG, ">>> SG [$name]: $hex (${data.size}b)")
                onDataReceived?.invoke(JSONObject()
                    .put("type", "sgWriteTest")
                    .put("name", name)
                    .put("hex", hex)
                    .put("size", data.size))

                char.value = data
                char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                val ok = g.writeCharacteristic(char)
                onDataReceived?.invoke(JSONObject()
                    .put("type", "sgWriteResult")
                    .put("name", name)
                    .put("ok", ok))
            }, (i * 600).toLong())
        }

        // After writes, continue heartbeat
        val heartbeat = byteArrayOf(0xFC.toByte(), 0x22, 0x00, 0xDE.toByte())
        val startDelay = (tests.size * 600 + 500).toLong()
        for (i in 0..14) {
            handler.postDelayed({
                char.value = heartbeat
                char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                g.writeCharacteristic(char)
                if (i == 0) Log.i(TAG, ">>> Heartbeat 15s...")
                if (i == 14) {
                    Log.i(TAG, ">>> TEST COMPLETE")
                    onStatusChanged?.invoke("Test done — check log for SG data")
                }
            }, startDelay + (i * 1000).toLong())
        }
    }

    /**
     * Passive listen — NO writes, just wait for spontaneous SG data.
     * If nRF Connect receives data without writing, we should too.
     */
    fun passiveListen() {
        Log.i(TAG, "╔═══════════════════════════════════════╗")
        Log.i(TAG, "║  PASSIVE LISTEN — no writes, just     ║")
        Log.i(TAG, "║  waiting for SG spontaneous data      ║")
        Log.i(TAG, "╚═══════════════════════════════════════╝")
        onStatusChanged?.invoke("Passive listen — 30s, no writes...")

        // Just wait and log — if SG sends FC23 data spontaneously we'll see it
        handler.postDelayed({
            Log.i(TAG, ">>> 30s passive listen complete")
            onStatusChanged?.invoke("Listen done — any SG data?")
        }, 30000)
    }

    /**
     * Build SG packet with CORRECT XOR checksum (from nRF capture analysis).
     * Format: [FC][device][len][cmd][payload][XOR_checksum]
     * len = remaining bytes from cmd to end (inclusive of checksum)
     */
    private fun buildSGPacket(device: Int, cmdId: Int, payload: ByteArray): ByteArray {
        val len = payload.size + 2  // cmd + payload + checksum
        val pkt = byteArrayOf(
            0xFC.toByte(), device.toByte(), len.toByte(), cmdId.toByte()
        ) + payload
        var xor = 0
        for (b in pkt) xor = xor xor (b.toInt() and 0xFF)
        return pkt + byteArrayOf(xor.toByte())
    }

    // Keep old format for backwards compat
    private fun buildGevPacket(cmdId: Int, payload: ByteArray): ByteArray {
        return buildSGPacket(0x21, cmdId, payload)
    }
}
