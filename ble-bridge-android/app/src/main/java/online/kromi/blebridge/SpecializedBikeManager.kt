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
 * SpecializedBikeManager — BLE connection to Specialized Turbo e-bikes.
 *
 * Protocol: MCSP (Mission Control) + BES3 (Bosch eBike System 3) protobuf.
 * Reverse-engineered from Specialized Flow APK.
 *
 * Supported: Turbo Levo, Creo, Vado, Como, Kenevo, Tero
 * Motor: Brose/Specialized with Bosch integration
 */
@SuppressLint("MissingPermission")
class SpecializedBikeManager(private val context: Context) {

    companion object {
        const val TAG = "SpecializedManager"

        // MCSP (Mission Control Service Protocol)
        val MCSP_SERVICE = UUID.fromString("00000010-eaa2-11e9-81b4-2a2ae2dbcce4")
        val MCSP_RECV    = UUID.fromString("00000011-eaa2-11e9-81b4-2a2ae2dbcce4")
        val MCSP_SEND    = UUID.fromString("00000012-eaa2-11e9-81b4-2a2ae2dbcce4")

        // BES3 (Bosch eBike System 3)
        val BES3_SERVICE = UUID.fromString("0000fe02-0000-1000-8000-00805f9b34fb")

        // COBI (Bosch Connectivity)
        val COBI_SERVICE = UUID.fromString("c0b11800-fee1-c001-fee1-fa57fee15afe")

        // Standard
        val BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        val BATTERY_LEVEL   = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        val DIS_SERVICE     = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
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
    private var protocol = "mcsp" // "mcsp" or "bes3"

    private val adapter = BluetoothAdapter.getDefaultAdapter()
    private val handler = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var sendChar: BluetoothGattCharacteristic? = null

    // ═══════════════════════════════════════
    // SCAN
    // ═══════════════════════════════════════

    fun scan(onFound: (BluetoothDevice) -> Unit) {
        val scanner = adapter?.bluetoothLeScanner ?: return
        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(MCSP_SERVICE)).build(),
            ScanFilter.Builder().setServiceUuid(ParcelUuid(BES3_SERVICE)).build(),
        )
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                scanner.stopScan(this)
                onFound(result.device)
            }
        }
        scanner.startScan(filters, settings, callback)
        handler.postDelayed({ scanner.stopScan(callback) }, SCAN_TIMEOUT_MS)
    }

    // ═══════════════════════════════════════
    // CONNECT
    // ═══════════════════════════════════════

    fun connect(address: String) {
        val device = adapter?.getRemoteDevice(address) ?: return
        Log.i(TAG, "Connecting to Specialized: ${device.name ?: address}")
        device.connectGatt(context, true, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        isConnected = false
        gatt?.close()
        gatt = null
        sendChar = null
        onData?.invoke(JSONObject().apply { put("type", "disconnected") })
    }

    // ═══════════════════════════════════════
    // COMMANDS
    // ═══════════════════════════════════════

    fun setAssistMode(mode: Int) {
        val data = encodeField(1, 2) + encodeField(2, mode)
        sendCommand(data)
        Log.i(TAG, "Assist mode → $mode")
    }

    fun toggleLight(on: Boolean) {
        val msgType = if (on) 3 else 4 // BikeLightOn / BikeLightOff
        sendCommand(encodeField(1, msgType))
        Log.i(TAG, "Light → ${if (on) "ON" else "OFF"}")
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
                    sendChar = null
                    onData?.invoke(JSONObject().apply { put("type", "disconnected") })
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return

            var recvChar: BluetoothGattCharacteristic? = null

            // Try MCSP first
            val mcsp = g.getService(MCSP_SERVICE)
            if (mcsp != null) {
                recvChar = mcsp.getCharacteristic(MCSP_RECV)
                sendChar = mcsp.getCharacteristic(MCSP_SEND)
                protocol = "mcsp"
                Log.i(TAG, "MCSP service found")
            }

            // Try BES3 fallback
            if (recvChar == null) {
                val bes3 = g.getService(BES3_SERVICE)
                if (bes3 != null) {
                    for (c in bes3.characteristics) {
                        if (c.properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) recvChar = c
                        if (c.properties and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) sendChar = c
                    }
                    protocol = "bes3"
                    Log.i(TAG, "BES3 service found")
                }
            }

            if (recvChar == null) {
                Log.e(TAG, "No MCSP or BES3 service found!")
                return
            }

            // Subscribe
            g.setCharacteristicNotification(recvChar, true)
            recvChar.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                desc.value = if (recvChar.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0)
                    BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                g.writeDescriptor(desc)
            }

            isConnected = true

            handler.postDelayed({ readDeviceInfo(g) }, 500)
            handler.postDelayed({ readBattery(g) }, 1000)

            onData?.invoke(JSONObject().apply {
                put("type", "connected")
                put("device", g.device.name ?: "Specialized Turbo")
                put("address", g.device.address)
                put("brand", "specialized")
                put("protocol", protocol)
                put("bonded", g.device.bondState == BluetoothDevice.BOND_BONDED)
            })
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val data = characteristic.value ?: return
            parseMessage(data)
        }

        override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            val data = characteristic.value ?: return
            val uuid = characteristic.uuid.toString().substring(4, 8).uppercase()
            val text = String(data).trim()

            when (uuid) {
                "2A19" -> onData?.invoke(JSONObject().apply { put("type", "battery"); put("value", data[0].toInt() and 0xFF) })
                "2A24" -> onData?.invoke(JSONObject().apply { put("type", "deviceInfo"); put("model", text) })
                "2A26" -> onData?.invoke(JSONObject().apply { put("type", "deviceInfo"); put("firmware", text) })
            }
        }
    }

    // ═══════════════════════════════════════
    // Message parsing
    // ═══════════════════════════════════════

    private fun parseMessage(data: ByteArray) {
        val fields = parseProtoFields(data)
        val hex = data.joinToString(" ") { "%02x".format(it) }
        Log.d(TAG, "Specialized $protocol: fields=$fields raw=$hex")

        onData?.invoke(JSONObject().apply {
            put("type", "specializedTelemetry")
            put("protocol", protocol)
            put("hex", hex)
            put("fields", org.json.JSONObject().also { jo ->
                for ((k, v) in fields) jo.put(k.toString(), v)
            })
        })

        for ((field, value) in fields) {
            if (value in 0..100 && field <= 5) {
                onData?.invoke(JSONObject().apply { put("type", "battery"); put("value", value) })
            }
            if (value in 0..5 && field <= 3) {
                onData?.invoke(JSONObject().apply { put("type", "assistMode"); put("value", value) })
            }
        }
    }

    // ═══════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════

    @Suppress("DEPRECATION")
    private fun sendCommand(proto: ByteArray) {
        val sc = sendChar ?: return
        val g = gatt ?: return
        sc.value = proto
        sc.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        g.writeCharacteristic(sc)
    }

    private fun readDeviceInfo(g: BluetoothGatt) {
        g.getService(DIS_SERVICE)?.let { dis ->
            dis.getCharacteristic(DIS_MODEL)?.let { handler.postDelayed({ g.readCharacteristic(it) }, 100) }
            dis.getCharacteristic(DIS_FIRMWARE)?.let { handler.postDelayed({ g.readCharacteristic(it) }, 400) }
        }
    }

    private fun readBattery(g: BluetoothGatt) {
        g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let { g.readCharacteristic(it) }
    }

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
            when (tag and 0x07) {
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
