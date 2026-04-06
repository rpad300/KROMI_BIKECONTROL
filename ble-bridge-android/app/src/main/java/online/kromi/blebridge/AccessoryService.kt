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
 * AccessoryService — manages BLE connections to iGPSPORT lights and radar.
 *
 * Uses Nordic UART Service (NUS) with 20-byte binary header + protobuf payload.
 * Protocol reverse-engineered from iGPSPORT Ride APK (jadx decompile).
 *
 * Supported accessories:
 *   - iGPSPORT lights (VS1800S, LR series) — mode switch, battery, brake flash
 *   - iGPSPORT radar — vehicle detection, distance, speed, threat level
 */
@SuppressLint("MissingPermission")
class AccessoryService(private val context: Context) {

    companion object {
        const val TAG = "AccessoryService"

        // Nordic UART Service — User Control channel (CA8E)
        val NUS_SERVICE = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca8e")
        val NUS_TX = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca8e") // Write TO device
        val NUS_RX = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca8e") // Notify FROM device

        // Standard BLE services
        val BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        val BATTERY_LEVEL = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        val DEVICE_INFO_SERVICE = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")

        val CCC_DESCRIPTOR = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        // Protocol constants (from PeripheralCommon.java)
        const val PST_BLE_LIGHT: Byte = 106  // 0x6A
        const val PST_RADAR: Byte = 104      // 0x68

        const val POT_GET: Byte = 2
        const val POT_SET: Byte = 1

        // Light sub-services
        const val BLS_MODE_CUR: Byte = 2   // Current mode
        const val BLS_MODE_SUP: Byte = 1   // Supported modes
        const val BLS_BAT_PCT: Byte = 6    // Battery percentage
        const val BLS_LEFT_TIME: Byte = 5  // Remaining time

        const val SCAN_TIMEOUT_MS = 15000L
        const val RECONNECT_DELAY_MS = 5000L
        const val BATTERY_POLL_MS = 60000L  // Read battery every 60s
    }

    var onData: ((JSONObject) -> Unit)? = null
    var excludeAddress: String? = null

    private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private val handler = Handler(Looper.getMainLooper())

    // Connections per accessory type
    private val connections = mutableMapOf<String, BluetoothGatt>()
    private val txChars = mutableMapOf<String, BluetoothGattCharacteristic>()
    private val addresses = mutableMapOf<String, String>()
    private val autoReconnect = mutableMapOf<String, Boolean>()
    private var activeScanCallback: ScanCallback? = null

    // Light state
    private var lightMode = 0
    private var lightBattery = 0
    private var responseBuffer = ByteArray(0)

    fun isConnected(key: String): Boolean = connections.containsKey(key)

    // ═══════════════════════════════════════
    // SCAN for NUS-based accessories
    // ═══════════════════════════════════════

    fun scanFor(key: String) {
        val scanner = adapter?.bluetoothLeScanner ?: return
        activeScanCallback?.let { scanner.stopScan(it) }

        Log.i(TAG, "Scanning for $key accessory (exclude: $excludeAddress)...")

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(NUS_SERVICE))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device
                if (device.address == excludeAddress) return

                val name = device.name ?: ""
                // Classify: light vs radar based on name pattern
                val isLight = name.contains("VS1", true) || name.contains("LR", true) ||
                    name.lowercase().contains("light")
                val isRadar = name.lowercase().contains("radar")

                val matchesKey = when (key) {
                    "light" -> isLight || (!isRadar) // Default NUS devices to light
                    "radar" -> isRadar
                    else -> true
                }

                if (matchesKey) {
                    Log.i(TAG, "$key found: $name (${device.address}) — auto-connecting")
                    scanner.stopScan(this)
                    activeScanCallback = null
                    connectAccessory(key, device.address)
                }
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "$key scan failed: $errorCode")
            }
        }

        activeScanCallback = callback
        scanner.startScan(listOf(filter), settings, callback)

        handler.postDelayed({
            if (activeScanCallback === callback) {
                scanner.stopScan(callback)
                activeScanCallback = null
                Log.i(TAG, "$key scan timeout")
            }
        }, SCAN_TIMEOUT_MS)
    }

    // ═══════════════════════════════════════
    // CONNECT to accessory by address
    // ═══════════════════════════════════════

    fun connectAccessory(key: String, address: String) {
        if (connections.containsKey(key)) {
            disconnectAccessory(key)
            handler.postDelayed({ connectAccessory(key, address) }, 500)
            return
        }

        val device = adapter?.getRemoteDevice(address) ?: return
        addresses[key] = address
        autoReconnect[key] = true
        Log.i(TAG, "Connecting $key: ${device.name ?: address}")

        device.connectGatt(context, true, createGattCallback(key), BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnectAccessory(key: String) {
        autoReconnect[key] = false
        connections[key]?.close()
        connections.remove(key)
        txChars.remove(key)
        onData?.invoke(JSONObject().apply {
            put("type", "sensorDisconnected")
            put("sensor", key)
        })
    }

    // ═══════════════════════════════════════
    // SEND light command (from PWA)
    // ═══════════════════════════════════════

    fun setLightMode(mode: Int) {
        val txChar = txChars["light"] ?: return
        val gatt = connections["light"] ?: return

        val cmd = buildSwitchModeCommand(mode)
        writeNUS(gatt, txChar, cmd)
        lightMode = mode
        Log.i(TAG, "Light mode → $mode")
    }

    fun readLightBattery() {
        val txChar = txChars["light"] ?: return
        val gatt = connections["light"] ?: return
        writeNUS(gatt, txChar, buildReadBatteryCommand())
    }

    fun readLightMode() {
        val txChar = txChars["light"] ?: return
        val gatt = connections["light"] ?: return
        writeNUS(gatt, txChar, buildReadCurrentModeCommand())
    }

    // ═══════════════════════════════════════
    // GATT callback
    // ═══════════════════════════════════════

    private fun createGattCallback(key: String) = object : BluetoothGattCallback() {

        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "$key connected: ${gatt.device.name ?: gatt.device.address}")
                    connections[key] = gatt
                    gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "$key disconnected")
                    connections.remove(key)
                    txChars.remove(key)
                    onData?.invoke(JSONObject().apply {
                        put("type", "sensorDisconnected")
                        put("sensor", key)
                    })
                    if (autoReconnect[key] == true && addresses[key] != null) {
                        handler.postDelayed({
                            connectAccessory(key, addresses[key]!!)
                        }, RECONNECT_DELAY_MS)
                    }
                }
            }
        }

        @Suppress("DEPRECATION")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return

            // Subscribe to NUS RX notifications
            val nusService = gatt.getService(NUS_SERVICE)
            if (nusService != null) {
                val rxChar = nusService.getCharacteristic(NUS_RX)
                val txChar = nusService.getCharacteristic(NUS_TX)

                if (rxChar != null) {
                    gatt.setCharacteristicNotification(rxChar, true)
                    rxChar.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                        desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        gatt.writeDescriptor(desc)
                    }
                    Log.i(TAG, "$key NUS RX notifications enabled")
                }

                if (txChar != null) {
                    txChars[key] = txChar
                    Log.i(TAG, "$key NUS TX ready")
                }
            }

            // Read standard battery service
            handler.postDelayed({
                readStandardBattery(gatt, key)
            }, 1000)

            // Notify PWA of connection
            onData?.invoke(JSONObject().apply {
                put("type", "sensorConnected")
                put("sensor", key)
                put("name", gatt.device.name ?: key.uppercase())
                put("address", gatt.device.address)
            })

            // Query initial state for light
            if (key == "light") {
                handler.postDelayed({ readLightMode() }, 1500)
                handler.postDelayed({ readLightBattery() }, 2000)

                // Periodic battery poll
                startBatteryPolling(key)
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val data = characteristic.value ?: return
            val uuid = characteristic.uuid

            if (uuid == NUS_RX) {
                when (key) {
                    "light" -> handleLightResponse(data)
                    "radar" -> handleRadarResponse(data)
                }
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            val data = characteristic.value ?: return
            val uuid = characteristic.uuid.toString().substring(4, 8).uppercase()

            if (uuid == "2A19") { // Battery Level
                val pct = data[0].toInt() and 0xFF
                if (key == "light") {
                    lightBattery = pct
                    onData?.invoke(JSONObject().apply {
                        put("type", "lightBattery")
                        put("pct", pct)
                    })
                }
                onData?.invoke(JSONObject().apply {
                    put("type", "sensorBattery")
                    put("sensor", key)
                    put("percent", pct)
                })
            }
        }
    }

    // ═══════════════════════════════════════
    // NUS write helper
    // ═══════════════════════════════════════

    @Suppress("DEPRECATION")
    private fun writeNUS(gatt: BluetoothGatt, txChar: BluetoothGattCharacteristic, data: ByteArray) {
        // Send in 20-byte MTU chunks
        val mtu = 20
        var offset = 0
        while (offset < data.size) {
            val chunk = data.copyOfRange(offset, minOf(offset + mtu, data.size))
            txChar.value = chunk
            txChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            gatt.writeCharacteristic(txChar)
            offset += mtu
            if (offset < data.size) Thread.sleep(20) // Small delay between chunks
        }
    }

    // ═══════════════════════════════════════
    // Standard battery read
    // ═══════════════════════════════════════

    private fun readStandardBattery(gatt: BluetoothGatt, key: String) {
        gatt.getService(BATTERY_SERVICE)
            ?.getCharacteristic(BATTERY_LEVEL)
            ?.let { gatt.readCharacteristic(it) }
    }

    private fun startBatteryPolling(key: String) {
        handler.postDelayed(object : Runnable {
            override fun run() {
                val gatt = connections[key] ?: return
                readStandardBattery(gatt, key)
                if (key == "light") readLightBattery()
                handler.postDelayed(this, BATTERY_POLL_MS)
            }
        }, BATTERY_POLL_MS)
    }

    // ═══════════════════════════════════════
    // iGPSPORT Protocol — Header + Protobuf
    // ═══════════════════════════════════════

    /**
     * CRC8 — same algorithm as iGPSPORT BaseHead20Bytes
     */
    private fun crc8(data: ByteArray, start: Int = 0, length: Int = data.size): Int {
        var crc = 0
        for (i in start until start + length) {
            crc = crc xor (data[i].toInt() and 0xFF)
            for (j in 0 until 8) {
                crc = if (crc and 0x80 != 0) ((crc shl 1) xor 0x07) and 0xFF
                else (crc shl 1) and 0xFF
            }
        }
        return crc
    }

    /**
     * Build 20-byte header + protobuf command.
     */
    private fun buildCommand(
        serviceType: Byte,
        subService: Byte,
        operateType: Byte,
        protoData: ByteArray
    ): ByteArray {
        val header = ByteArray(20)
        header[0] = 0x01
        header[1] = serviceType
        header[2] = subService
        header[3] = 0xFF.toByte()
        header[4] = operateType
        header[5] = 0xFF.toByte()
        header[6] = 0xFF.toByte()
        header[7] = ((protoData.size shr 8) and 0xFF).toByte()
        header[8] = (protoData.size and 0xFF).toByte()
        header[9] = if (protoData.isNotEmpty()) crc8(protoData).toByte() else 0
        header[10] = 0x01 // END_TYPE_PB
        for (i in 11..18) header[i] = 0xFF.toByte()
        header[19] = crc8(header, 0, 19).toByte()

        return header + protoData
    }

    /**
     * Encode protobuf varint field.
     */
    private fun encodeVarint(value: Int): ByteArray {
        val bytes = mutableListOf<Byte>()
        var v = value and 0x7FFFFFFF
        while (v > 0x7F) {
            bytes.add(((v and 0x7F) or 0x80).toByte())
            v = v ushr 7
        }
        bytes.add((v and 0x7F).toByte())
        return bytes.toByteArray()
    }

    private fun encodeField(fieldNumber: Int, value: Int): ByteArray {
        val tag = (fieldNumber shl 3) or 0 // wire type 0 = varint
        return encodeVarint(tag) + encodeVarint(value)
    }

    private fun buildProto(fields: List<Pair<Int, Int>>): ByteArray {
        var result = ByteArray(0)
        for ((field, value) in fields) {
            result += encodeField(field, value)
        }
        return result
    }

    // ── Light command builders ──────────────────────────────────

    private fun buildReadCurrentModeCommand(): ByteArray {
        val proto = buildProto(listOf(
            1 to PST_BLE_LIGHT.toInt(),
            2 to POT_GET.toInt(),
            3 to BLS_MODE_CUR.toInt()
        ))
        return buildCommand(PST_BLE_LIGHT, BLS_MODE_CUR, POT_GET, proto)
    }

    private fun buildSwitchModeCommand(mode: Int): ByteArray {
        val proto = buildProto(listOf(
            1 to PST_BLE_LIGHT.toInt(),
            2 to POT_SET.toInt(),
            3 to BLS_MODE_CUR.toInt(),
            10 to mode  // cur_mode field
        ))
        return buildCommand(PST_BLE_LIGHT, BLS_MODE_CUR, POT_SET, proto)
    }

    private fun buildReadBatteryCommand(): ByteArray {
        val proto = buildProto(listOf(
            1 to PST_BLE_LIGHT.toInt(),
            2 to POT_GET.toInt(),
            3 to BLS_BAT_PCT.toInt()
        ))
        return buildCommand(PST_BLE_LIGHT, BLS_BAT_PCT, POT_GET, proto)
    }

    private fun buildReadSupportedModesCommand(): ByteArray {
        val proto = buildProto(listOf(
            1 to PST_BLE_LIGHT.toInt(),
            2 to POT_GET.toInt(),
            3 to BLS_MODE_SUP.toInt()
        ))
        return buildCommand(PST_BLE_LIGHT, BLS_MODE_SUP, POT_GET, proto)
    }

    // ═══════════════════════════════════════
    // Response parsers
    // ═══════════════════════════════════════

    private fun handleLightResponse(data: ByteArray) {
        // Accumulate response data (may span multiple notifications)
        responseBuffer += data
        if (responseBuffer.size < 20) return

        // Parse 20-byte header
        val dataSize = ((responseBuffer[7].toInt() and 0xFF) shl 8) or (responseBuffer[8].toInt() and 0xFF)
        val totalExpected = 20 + dataSize
        if (responseBuffer.size < totalExpected) return

        val subService = responseBuffer[2].toInt() and 0xFF
        val protoData = responseBuffer.copyOfRange(20, totalExpected)
        responseBuffer = if (responseBuffer.size > totalExpected) {
            responseBuffer.copyOfRange(totalExpected, responseBuffer.size)
        } else ByteArray(0)

        // Parse protobuf fields
        val fields = parseProtoFields(protoData)
        val hex = protoData.joinToString(" ") { "%02x".format(it) }
        Log.d(TAG, "Light response sub=$subService fields=$fields raw=$hex")

        when (subService) {
            BLS_MODE_CUR.toInt() and 0xFF -> {
                val mode = fields[10] ?: fields[4] ?: return
                lightMode = mode
                onData?.invoke(JSONObject().apply {
                    put("type", "lightMode")
                    put("mode", mode)
                })
                onData?.invoke(JSONObject().apply {
                    put("type", "lightStatus")
                    put("mode", mode)
                    put("battery", lightBattery)
                    put("name", connections["light"]?.device?.name ?: "Light")
                })
            }
            BLS_BAT_PCT.toInt() and 0xFF -> {
                val pct = fields[5] ?: return
                lightBattery = pct
                onData?.invoke(JSONObject().apply {
                    put("type", "lightBattery")
                    put("pct", pct)
                })
            }
            BLS_LEFT_TIME.toInt() and 0xFF -> {
                val timeMs = fields[6] ?: return
                Log.i(TAG, "Light remaining time: ${timeMs}ms")
            }
            BLS_MODE_SUP.toInt() and 0xFF -> {
                Log.i(TAG, "Light supported modes: $fields")
            }
        }
    }

    private fun handleRadarResponse(data: ByteArray) {
        // Accumulate + parse header
        responseBuffer += data
        if (responseBuffer.size < 20) return

        val dataSize = ((responseBuffer[7].toInt() and 0xFF) shl 8) or (responseBuffer[8].toInt() and 0xFF)
        val totalExpected = 20 + dataSize
        if (responseBuffer.size < totalExpected) return

        val protoData = responseBuffer.copyOfRange(20, totalExpected)
        responseBuffer = if (responseBuffer.size > totalExpected) {
            responseBuffer.copyOfRange(totalExpected, responseBuffer.size)
        } else ByteArray(0)

        val fields = parseProtoFields(protoData)
        Log.d(TAG, "Radar response fields=$fields")

        // Radar target: field 6=level, 7=range(cm), 8=speed(km/h)
        val level = fields[6] ?: 0
        val rangeCm = fields[7] ?: 0
        val speed = fields[8] ?: 0

        if (level > 0 || rangeCm > 0) {
            onData?.invoke(JSONObject().apply {
                put("type", "radarTarget")
                put("level", level)
                put("range", rangeCm)
                put("speed", speed)
            })
        } else {
            onData?.invoke(JSONObject().apply {
                put("type", "radarClear")
            })
        }
    }

    /**
     * Parse protobuf varint fields from binary data.
     * Returns map of field_number → value.
     */
    private fun parseProtoFields(data: ByteArray): Map<Int, Int> {
        val fields = mutableMapOf<Int, Int>()
        var offset = 0

        while (offset < data.size) {
            // Decode tag
            var tag = 0; var shift = 0; var b: Int
            do {
                if (offset >= data.size) return fields
                b = data[offset++].toInt() and 0xFF
                tag = tag or ((b and 0x7F) shl shift)
                shift += 7
            } while (b and 0x80 != 0 && shift < 35)

            val fieldNumber = tag ushr 3
            val wireType = tag and 0x07

            when (wireType) {
                0 -> { // Varint
                    var value = 0; shift = 0
                    do {
                        if (offset >= data.size) return fields
                        b = data[offset++].toInt() and 0xFF
                        value = value or ((b and 0x7F) shl shift)
                        shift += 7
                    } while (b and 0x80 != 0 && shift < 35)
                    fields[fieldNumber] = value
                }
                2 -> { // Length-delimited
                    var length = 0; shift = 0
                    do {
                        if (offset >= data.size) return fields
                        b = data[offset++].toInt() and 0xFF
                        length = length or ((b and 0x7F) shl shift)
                        shift += 7
                    } while (b and 0x80 != 0)
                    offset += length // Skip embedded data
                }
                else -> return fields // Unknown wire type
            }
        }
        return fields
    }

    fun destroy() {
        activeScanCallback?.let {
            adapter?.bluetoothLeScanner?.stopScan(it)
        }
        for ((key, _) in connections.toMap()) {
            autoReconnect[key] = false
            connections[key]?.close()
        }
        connections.clear()
        txChars.clear()
        handler.removeCallbacksAndMessages(null)
    }
}
