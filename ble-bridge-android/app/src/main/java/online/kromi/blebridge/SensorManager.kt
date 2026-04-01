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
 * SensorManager — manages BLE connections to external sensors (HR, Power, etc.)
 * Independent from the main BLEManager (gateway) connection.
 *
 * Each sensor type gets its own GATT connection. Auto-reconnects on disconnect.
 */
@SuppressLint("MissingPermission")
class SensorManager(private val context: Context) {

    companion object {
        const val TAG = "SensorManager"

        val HR_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val HR_MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        val CCC_DESCRIPTOR = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        const val SCAN_TIMEOUT_MS = 15000L
        const val RECONNECT_DELAY_MS = 5000L
    }

    var onData: ((JSONObject) -> Unit)? = null

    private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private val handler = Handler(Looper.getMainLooper())

    // HR sensor state
    private var hrGatt: BluetoothGatt? = null
    private var hrAddress: String? = null
    private var hrAutoReconnect = true

    val isHRConnected: Boolean get() = hrGatt != null

    // ═══════════════════════════════════════
    // SCAN for HR sensors
    // ═══════════════════════════════════════

    private var hrScanCallback: ScanCallback? = null

    fun scanForHR() {
        val scanner = adapter?.bluetoothLeScanner ?: return
        Log.i(TAG, "Scanning for HR sensors (auto-connect first found)...")

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(HR_SERVICE))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device
                val name = device.name ?: "HR Monitor"
                Log.i(TAG, "HR sensor found: $name (${device.address}) — auto-connecting")

                // Stop scan and auto-connect to first HR device found
                scanner.stopScan(this)
                hrScanCallback = null
                connectHR(device.address)
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "HR scan failed: $errorCode")
                onData?.invoke(JSONObject().apply {
                    put("type", "sensorError")
                    put("sensor", "hr")
                    put("error", "Scan failed: $errorCode")
                })
            }
        }

        hrScanCallback = callback
        scanner.startScan(listOf(filter), settings, callback)

        // Stop scan after timeout if nothing found
        handler.postDelayed({
            if (hrScanCallback === callback) {
                scanner.stopScan(callback)
                hrScanCallback = null
                Log.i(TAG, "HR scan timeout — no devices found")
                onData?.invoke(JSONObject().apply {
                    put("type", "sensorError")
                    put("sensor", "hr")
                    put("error", "Nenhum sensor HR encontrado")
                })
            }
        }, SCAN_TIMEOUT_MS)
    }

    // ═══════════════════════════════════════
    // CONNECT to HR sensor by address
    // ═══════════════════════════════════════

    fun connectHR(address: String) {
        if (hrGatt != null) {
            Log.i(TAG, "HR already connected, disconnecting first")
            disconnectHR()
            handler.postDelayed({ connectHR(address) }, 500)
            return
        }

        val device = adapter?.getRemoteDevice(address)
        if (device == null) {
            Log.e(TAG, "HR: invalid address $address")
            return
        }

        hrAddress = address
        hrAutoReconnect = true
        Log.i(TAG, "Connecting to HR: ${device.name ?: address}")

        device.connectGatt(context, true, hrGattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnectHR() {
        hrAutoReconnect = false
        hrGatt?.close()
        hrGatt = null
        onData?.invoke(JSONObject().apply {
            put("type", "sensorDisconnected")
            put("sensor", "hr")
        })
    }

    // ═══════════════════════════════════════
    // GATT callback for HR sensor
    // ═══════════════════════════════════════

    private val hrGattCallback = object : BluetoothGattCallback() {

        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "HR connected: ${gatt.device.name ?: gatt.device.address}")
                    hrGatt = gatt
                    gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "HR disconnected")
                    hrGatt = null
                    onData?.invoke(JSONObject().apply {
                        put("type", "sensorDisconnected")
                        put("sensor", "hr")
                    })
                    // Auto-reconnect
                    if (hrAutoReconnect && hrAddress != null) {
                        Log.i(TAG, "HR auto-reconnect in ${RECONNECT_DELAY_MS}ms")
                        handler.postDelayed({ connectHR(hrAddress!!) }, RECONNECT_DELAY_MS)
                    }
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return

            val hrChar = gatt.getService(HR_SERVICE)?.getCharacteristic(HR_MEASUREMENT)
            if (hrChar == null) {
                Log.e(TAG, "HR characteristic not found!")
                return
            }

            // Enable notifications
            gatt.setCharacteristicNotification(hrChar, true)
            hrChar.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                gatt.writeDescriptor(desc)
            }

            Log.i(TAG, "HR notifications enabled")
            onData?.invoke(JSONObject().apply {
                put("type", "sensorConnected")
                put("sensor", "hr")
                put("name", gatt.device.name ?: "HR Monitor")
                put("address", gatt.device.address)
            })
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            if (characteristic.uuid == HR_MEASUREMENT) {
                val data = characteristic.value ?: return
                val flags = data[0].toInt() and 0xFF
                val bpm = if (flags and 0x01 != 0) {
                    (data[1].toInt() and 0xFF) or ((data[2].toInt() and 0xFF) shl 8)
                } else {
                    data[1].toInt() and 0xFF
                }
                // Zone calculated by PWA from athlete profile — just send BPM
                onData?.invoke(JSONObject().apply {
                    put("type", "hr")
                    put("bpm", bpm)
                    put("zone", 0) // PWA calculates from profile
                })
            }
        }
    }

    fun destroy() {
        hrAutoReconnect = false
        hrGatt?.close()
        hrGatt = null
    }
}
