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
import org.json.JSONObject
import java.util.UUID

/**
 * BoschBikeManager — BLE connection to Bosch eBike systems.
 *
 * Protocol: MCSP (Motor Control Service Protocol) with STP segmentation.
 * Reverse-engineered from Bosch eBike Connect APK.
 *
 * Supports: Performance Line CX, Active Line Plus, Cargo Line
 * Displays: Kiox, Nyon, Intuvia, SmartphoneHub
 */
@SuppressLint("MissingPermission")
class BoschBikeManager(private val context: Context) {

    companion object {
        const val TAG = "BoschBikeManager"

        // Bosch MCSP (Motor Control Service Protocol) — UUID prefix "BOSC" in ASCII
        val MCSP_SERVICE = UUID.fromString("424f5343-4820-4d43-5350-76012e002e00")
        val MCSP_READ    = UUID.fromString("424f5343-4820-4d43-5350-20204d49534f")
        val MCSP_WRITE   = UUID.fromString("424f5343-4820-4d43-5350-20204d4f5349")

        // Bosch BSS (BootStrap Service)
        val BSS_SERVICE  = UUID.fromString("424f5343-4820-4253-5376-76012e002e00")

        // Standard
        val BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        val BATTERY_LEVEL   = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        val DIS_SERVICE     = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
        val DIS_MFG_NAME    = UUID.fromString("00002a29-0000-1000-8000-00805f9b34fb")
        val DIS_MODEL       = UUID.fromString("00002a24-0000-1000-8000-00805f9b34fb")
        val DIS_FIRMWARE    = UUID.fromString("00002a26-0000-1000-8000-00805f9b34fb")
        val CCC_DESCRIPTOR  = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        const val SCAN_TIMEOUT_MS = 15000L
    }

    var onData: ((JSONObject) -> Unit)? = null
    var isConnected = false
        private set
    var connectedAddress: String? = null
        private set

    private val adapter = BluetoothAdapter.getDefaultAdapter()
    private val handler = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private var pendingSegments = mutableListOf<ByteArray>()

    // ═══════════════════════════════════════
    // SCAN
    // ═══════════════════════════════════════

    fun scan(onFound: (BluetoothDevice) -> Unit) {
        val scanner = adapter?.bluetoothLeScanner ?: return
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(MCSP_SERVICE)).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                scanner.stopScan(this)
                onFound(result.device)
            }
        }
        scanner.startScan(listOf(filter), settings, callback)
        handler.postDelayed({ scanner.stopScan(callback) }, SCAN_TIMEOUT_MS)
    }

    // ═══════════════════════════════════════
    // CONNECT
    // ═══════════════════════════════════════

    fun connect(address: String) {
        val device = adapter?.getRemoteDevice(address) ?: return
        Log.i(TAG, "Connecting to Bosch: ${device.name ?: address}")
        device.connectGatt(context, true, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        isConnected = false
        gatt?.close()
        gatt = null
        writeChar = null
        onData?.invoke(JSONObject().apply {
            put("type", "disconnected")
        })
    }

    // ═══════════════════════════════════════
    // COMMANDS
    // ═══════════════════════════════════════

    fun setAssistMode(mode: Int) {
        val data = encodeField(1, 1) + encodeField(2, mode) // type=assistChange, value=mode
        sendMCSP(data)
        Log.i(TAG, "Assist mode → $mode")
    }

    // ═══════════════════════════════════════
    // GATT CALLBACK
    // ═══════════════════════════════════════

    @Suppress("DEPRECATION")
    private val gattCallback = object : BluetoothGattCallback() {

        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "Connected: ${g.device.name ?: g.device.address}")
                    gatt = g
                    connectedAddress = g.device.address
                    g.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "Disconnected")
                    isConnected = false
                    gatt = null
                    writeChar = null
                    onData?.invoke(JSONObject().apply { put("type", "disconnected") })
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return

            val mcsp = g.getService(MCSP_SERVICE)
            if (mcsp == null) { Log.e(TAG, "MCSP service not found!"); return }

            val readChar = mcsp.getCharacteristic(MCSP_READ)
            writeChar = mcsp.getCharacteristic(MCSP_WRITE)

            if (readChar != null) {
                g.setCharacteristicNotification(readChar, true)
                readChar.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                    // Prefer indicate if supported, otherwise notify
                    desc.value = if (readChar.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0)
                        BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                    else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    g.writeDescriptor(desc)
                }
                Log.i(TAG, "MCSP notifications enabled")
            }

            isConnected = true

            // Read device info
            handler.postDelayed({ readDeviceInfo(g) }, 500)
            handler.postDelayed({ readBattery(g) }, 1000)

            onData?.invoke(JSONObject().apply {
                put("type", "connected")
                put("device", g.device.name ?: "Bosch eBike")
                put("address", g.device.address)
                put("brand", "bosch")
                put("bonded", g.device.bondState == BluetoothDevice.BOND_BONDED)
            })
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val data = characteristic.value ?: return
            handleMCSPData(data)
        }

        override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            val data = characteristic.value ?: return
            val uuid = characteristic.uuid.toString().substring(4, 8).uppercase()
            val text = String(data).trim()

            when (uuid) {
                "2A19" -> { // Battery
                    val pct = data[0].toInt() and 0xFF
                    onData?.invoke(JSONObject().apply { put("type", "battery"); put("value", pct) })
                }
                "2A29" -> onData?.invoke(JSONObject().apply { put("type", "deviceInfo"); put("manufacturer", text) })
                "2A24" -> onData?.invoke(JSONObject().apply { put("type", "deviceInfo"); put("model", text) })
                "2A26" -> onData?.invoke(JSONObject().apply { put("type", "deviceInfo"); put("firmware", text) })
            }
        }
    }

    // ═══════════════════════════════════════
    // MCSP STP Protocol
    // ═══════════════════════════════════════

    @Suppress("DEPRECATION")
    private fun sendMCSP(proto: ByteArray) {
        val wc = writeChar ?: return
        val g = gatt ?: return
        // STP: single segment for small payloads
        val frame = ByteArray(proto.size + 1)
        frame[0] = proto.size.toByte()
        System.arraycopy(proto, 0, frame, 1, proto.size)
        wc.value = frame
        wc.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        g.writeCharacteristic(wc)
    }

    private fun handleMCSPData(data: ByteArray) {
        if (data.isEmpty()) return
        val header = data[0].toInt() and 0xFF
        val isMore = (header and 0x80) != 0

        if (isMore) {
            pendingSegments.add(data)
            return
        }

        // Reassemble
        val fullMessage: ByteArray
        if (pendingSegments.isNotEmpty()) {
            pendingSegments.add(data)
            var total = 0
            for (seg in pendingSegments) total += seg.size - 1
            fullMessage = ByteArray(total)
            var offset = 0
            for (seg in pendingSegments) {
                System.arraycopy(seg, 1, fullMessage, offset, seg.size - 1)
                offset += seg.size - 1
            }
            pendingSegments.clear()
        } else {
            fullMessage = data.copyOfRange(1, data.size)
        }

        parseBoschMessage(fullMessage)
    }

    private fun parseBoschMessage(data: ByteArray) {
        val fields = parseProtoFields(data)
        val hex = data.joinToString(" ") { "%02x".format(it) }
        Log.d(TAG, "Bosch MCSP: fields=$fields raw=$hex")

        // Forward raw telemetry to PWA for analysis
        onData?.invoke(JSONObject().apply {
            put("type", "boschTelemetry")
            put("hex", hex)
            put("fields", org.json.JSONObject().also { jo ->
                for ((k, v) in fields) jo.put(k.toString(), v)
            })
        })

        // Parse known patterns
        for ((field, value) in fields) {
            // Battery SOC (0-100)
            if (value in 0..100 && field <= 5) {
                onData?.invoke(JSONObject().apply {
                    put("type", "battery"); put("value", value)
                })
            }
            // Assist mode (1=ECO, 2=TOUR, 3=SPORT, 4=TURBO)
            if (value in 1..4 && field <= 3) {
                onData?.invoke(JSONObject().apply {
                    put("type", "assistMode"); put("value", value)
                })
            }
        }
    }

    // ═══════════════════════════════════════
    // Device info reads
    // ═══════════════════════════════════════

    private fun readDeviceInfo(g: BluetoothGatt) {
        val reads = mutableListOf<BluetoothGattCharacteristic>()
        g.getService(DIS_SERVICE)?.let { dis ->
            dis.getCharacteristic(DIS_MFG_NAME)?.let { reads.add(it) }
            dis.getCharacteristic(DIS_MODEL)?.let { reads.add(it) }
            dis.getCharacteristic(DIS_FIRMWARE)?.let { reads.add(it) }
        }
        reads.forEachIndexed { i, char ->
            handler.postDelayed({ g.readCharacteristic(char) }, (i + 1) * 300L)
        }
    }

    private fun readBattery(g: BluetoothGatt) {
        g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let {
            g.readCharacteristic(it)
        }
    }

    // ═══════════════════════════════════════
    // Protobuf helpers
    // ═══════════════════════════════════════

    private fun encodeVarint(value: Int): ByteArray {
        val bytes = mutableListOf<Byte>()
        var v = value and 0x7FFFFFFF
        while (v > 0x7F) { bytes.add(((v and 0x7F) or 0x80).toByte()); v = v ushr 7 }
        bytes.add((v and 0x7F).toByte())
        return bytes.toByteArray()
    }

    private fun encodeField(fieldNumber: Int, value: Int): ByteArray {
        return encodeVarint((fieldNumber shl 3) or 0) + encodeVarint(value)
    }

    private fun parseProtoFields(data: ByteArray): Map<Int, Int> {
        val fields = mutableMapOf<Int, Int>()
        var offset = 0
        while (offset < data.size) {
            var tag = 0; var shift = 0; var b: Int
            do {
                if (offset >= data.size) return fields
                b = data[offset++].toInt() and 0xFF
                tag = tag or ((b and 0x7F) shl shift); shift += 7
            } while (b and 0x80 != 0 && shift < 35)
            val wireType = tag and 0x07
            when (wireType) {
                0 -> {
                    var value = 0; shift = 0
                    do {
                        if (offset >= data.size) return fields
                        b = data[offset++].toInt() and 0xFF
                        value = value or ((b and 0x7F) shl shift); shift += 7
                    } while (b and 0x80 != 0 && shift < 35)
                    fields[tag ushr 3] = value
                }
                2 -> {
                    var length = 0; shift = 0
                    do {
                        if (offset >= data.size) return fields
                        b = data[offset++].toInt() and 0xFF
                        length = length or ((b and 0x7F) shl shift); shift += 7
                    } while (b and 0x80 != 0)
                    offset += length
                }
                else -> return fields
            }
        }
        return fields
    }

    fun destroy() {
        gatt?.close()
        gatt = null
    }
}
