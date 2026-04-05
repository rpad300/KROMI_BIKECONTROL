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
 * SensorManager — manages BLE connections to external sensors.
 * Each sensor type gets its own independent GATT connection.
 * Supports: HR, Power Meter, Di2, SRAM AXS.
 */
@SuppressLint("MissingPermission")
class SensorManager(private val context: Context) {

    companion object {
        const val TAG = "SensorManager"

        // Standard BLE GATT services
        val HR_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val HR_MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        val POWER_SERVICE = UUID.fromString("00001818-0000-1000-8000-00805f9b34fb")
        val POWER_MEASUREMENT = UUID.fromString("00002a63-0000-1000-8000-00805f9b34fb")
        // Di2 E-Tube — Shimano proprietary (SHIMANO_BLE base)
        val DI2_SERVICE = UUID.fromString("000018FF-5348-494D-414E-4F5F424C4500")
        val DI2_NOTIFY = UUID.fromString("00002AF9-5348-494D-414E-4F5F424C4500")
        // SRAM AXS
        val SRAM_SERVICE = UUID.fromString("4d500001-4745-5630-3031-e50e24dcca9e")
        val SRAM_NOTIFY = UUID.fromString("4d500003-4745-5630-3031-e50e24dcca9e")

        val CCC_DESCRIPTOR = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        const val SCAN_TIMEOUT_MS = 15000L
        const val RECONNECT_DELAY_MS = 5000L
    }

    /** Sensor type definition */
    data class SensorType(
        val key: String,            // "hr", "power", "di2", "sram"
        val serviceUuid: UUID,
        val notifyUuid: UUID,
    )

    private val SENSOR_TYPES = mapOf(
        "hr" to SensorType("hr", HR_SERVICE, HR_MEASUREMENT),
        "power" to SensorType("power", POWER_SERVICE, POWER_MEASUREMENT),
        "di2" to SensorType("di2", DI2_SERVICE, DI2_NOTIFY),
        "sram" to SensorType("sram", SRAM_SERVICE, SRAM_NOTIFY),
    )

    var onData: ((JSONObject) -> Unit)? = null
    /** Address to exclude from scans (e.g., the connected bike gateway) */
    var excludeAddress: String? = null

    private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private val handler = Handler(Looper.getMainLooper())

    // Per-sensor state
    private val connections = mutableMapOf<String, BluetoothGatt>()
    private val addresses = mutableMapOf<String, String>()
    private val autoReconnect = mutableMapOf<String, Boolean>()
    private var activeScanCallback: ScanCallback? = null

    fun isConnected(sensor: String): Boolean = connections.containsKey(sensor)

    // ═══════════════════════════════════════
    // SCAN for a sensor type (auto-connect first found)
    // ═══════════════════════════════════════

    fun scanFor(sensorKey: String) {
        val type = SENSOR_TYPES[sensorKey]
        if (type == null) {
            Log.w(TAG, "Unknown sensor type: $sensorKey")
            return
        }
        val scanner = adapter?.bluetoothLeScanner ?: return

        // Stop any active scan
        activeScanCallback?.let { scanner.stopScan(it) }

        Log.i(TAG, "Scanning for $sensorKey (exclude: $excludeAddress)...")

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(type.serviceUuid))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device

                // Skip the bike gateway
                if (device.address == excludeAddress) return

                val name = device.name ?: sensorKey.uppercase()
                Log.i(TAG, "$sensorKey found: $name (${device.address}) — auto-connecting")

                scanner.stopScan(this)
                activeScanCallback = null
                connectSensor(sensorKey, device.address)
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "$sensorKey scan failed: $errorCode")
                onData?.invoke(JSONObject().apply {
                    put("type", "sensorError")
                    put("sensor", sensorKey)
                    put("error", "Scan failed: $errorCode")
                })
            }
        }

        activeScanCallback = callback
        scanner.startScan(listOf(filter), settings, callback)

        handler.postDelayed({
            if (activeScanCallback === callback) {
                scanner.stopScan(callback)
                activeScanCallback = null
                Log.i(TAG, "$sensorKey scan timeout")
                onData?.invoke(JSONObject().apply {
                    put("type", "sensorError")
                    put("sensor", sensorKey)
                    put("error", "Nenhum sensor encontrado")
                })
            }
        }, SCAN_TIMEOUT_MS)
    }

    // ═══════════════════════════════════════
    // CONNECT to sensor by address
    // ═══════════════════════════════════════

    fun connectSensor(sensorKey: String, address: String) {
        if (connections.containsKey(sensorKey)) {
            Log.i(TAG, "$sensorKey already connected, disconnecting first")
            disconnectSensor(sensorKey)
            handler.postDelayed({ connectSensor(sensorKey, address) }, 500)
            return
        }

        val device = adapter?.getRemoteDevice(address)
        if (device == null) {
            Log.e(TAG, "$sensorKey: invalid address $address")
            return
        }

        addresses[sensorKey] = address
        autoReconnect[sensorKey] = true
        Log.i(TAG, "Connecting $sensorKey: ${device.name ?: address}")

        device.connectGatt(context, true, createGattCallback(sensorKey), BluetoothDevice.TRANSPORT_LE)
        Log.i(TAG, "$sensorKey connectGatt with autoConnect=true")
    }

    fun disconnectSensor(sensorKey: String) {
        autoReconnect[sensorKey] = false
        connections[sensorKey]?.close()
        connections.remove(sensorKey)
        onData?.invoke(JSONObject().apply {
            put("type", "sensorDisconnected")
            put("sensor", sensorKey)
        })
    }

    // ═══════════════════════════════════════
    // GATT callback factory
    // ═══════════════════════════════════════

    private fun createGattCallback(sensorKey: String) = object : BluetoothGattCallback() {

        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "$sensorKey connected: ${gatt.device.name ?: gatt.device.address}")
                    connections[sensorKey] = gatt
                    gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "$sensorKey disconnected")
                    connections.remove(sensorKey)
                    onData?.invoke(JSONObject().apply {
                        put("type", "sensorDisconnected")
                        put("sensor", sensorKey)
                    })
                    if (autoReconnect[sensorKey] == true && addresses[sensorKey] != null) {
                        Log.i(TAG, "$sensorKey auto-reconnect in ${RECONNECT_DELAY_MS}ms")
                        handler.postDelayed({
                            connectSensor(sensorKey, addresses[sensorKey]!!)
                        }, RECONNECT_DELAY_MS)
                    }
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return

            val type = SENSOR_TYPES[sensorKey] ?: return
            val char = gatt.getService(type.serviceUuid)?.getCharacteristic(type.notifyUuid)
            if (char == null) {
                Log.e(TAG, "$sensorKey: characteristic not found!")
                return
            }

            gatt.setCharacteristicNotification(char, true)
            char.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                gatt.writeDescriptor(desc)
            }

            Log.i(TAG, "$sensorKey notifications enabled")
            onData?.invoke(JSONObject().apply {
                put("type", "sensorConnected")
                put("sensor", sensorKey)
                put("name", gatt.device.name ?: sensorKey.uppercase())
                put("address", gatt.device.address)
            })
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            val data = characteristic.value ?: return
            when (sensorKey) {
                "hr" -> parseHR(data)
                "power" -> parsePower(data)
                "di2" -> parseDi2(data)
                "sram" -> parseSRAM(data)
            }
        }
    }

    // ═══════════════════════════════════════
    // Data parsers
    // ═══════════════════════════════════════

    private fun parseHR(data: ByteArray) {
        if (data.isEmpty()) return
        val flags = data[0].toInt() and 0xFF
        val bpm = if (flags and 0x01 != 0 && data.size >= 3) {
            (data[1].toInt() and 0xFF) or ((data[2].toInt() and 0xFF) shl 8)
        } else if (data.size >= 2) {
            data[1].toInt() and 0xFF
        } else return
        onData?.invoke(JSONObject().apply {
            put("type", "hr")
            put("bpm", bpm)
            put("zone", 0) // PWA calculates from profile
        })
    }

    private fun parsePower(data: ByteArray) {
        if (data.size < 4) return
        val watts = (data[2].toInt() and 0xFF) or ((data[3].toInt() and 0xFF) shl 8)
        onData?.invoke(JSONObject().apply {
            put("type", "power")
            put("value", watts)
        })
    }

    private fun parseDi2(data: ByteArray) {
        val hex = data.joinToString("") { "%02x".format(it) }
        onData?.invoke(JSONObject().apply {
            put("type", "di2Raw")
            put("hex", hex)
            put("length", data.size)
        })
    }

    private fun parseSRAM(data: ByteArray) {
        val hex = data.joinToString("") { "%02x".format(it) }
        onData?.invoke(JSONObject().apply {
            put("type", "sramRaw")
            put("hex", hex)
            put("length", data.size)
        })
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
    }
}
