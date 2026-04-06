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
 * ShimanoMotorManager — BLE connection to Shimano STEPS e-bike motors.
 *
 * Protocol: SBI (Shimano Bicycle Information) over 0x18EF service.
 * Reverse-engineered from Shimano E-TUBE RIDE APK.
 *
 * Supports: EP800, EP600, EP8, E8000, E7000, E6100, E5000
 */
@SuppressLint("MissingPermission")
class ShimanoMotorManager(private val context: Context) {

    companion object {
        const val TAG = "ShimanoMotor"

        // Shimano BLE base: "-5348-494D-414E-4F5F424C4500" = "-SHIMANO_BLE\0"
        private const val SHIMANO_BASE = "-5348-494D-414E-4F5F424C4500"

        val SBI_SERVICE       = UUID.fromString("000018EF$SHIMANO_BASE")
        val SBI_PERIODIC_INFO = UUID.fromString("00002AC1$SHIMANO_BASE") // Notify
        val SBI_CONTROL_POINT = UUID.fromString("00002AC4$SHIMANO_BASE") // Indicate+Write
        val SBI_SERIAL_NUMBER = UUID.fromString("00002AC5$SHIMANO_BASE") // Read

        // Standard
        val POWER_SERVICE   = UUID.fromString("00001818-0000-1000-8000-00805f9b34fb")
        val POWER_MEAS      = UUID.fromString("00002a63-0000-1000-8000-00805f9b34fb")
        val BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        val BATTERY_LEVEL   = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        val DIS_SERVICE     = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
        val CCC_DESCRIPTOR  = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        // SBI opcodes
        const val SBI_CHANGE_ASSIST = 0x02
        const val SBI_CHANGE_LIGHT  = 0x03
        const val SBI_REQUEST_STATUS = 0x05
        const val SBI_RESPONSE_CODE = 0x80.toByte()

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
    private var controlPoint: BluetoothGattCharacteristic? = null
    private var sequenceNumber = 0

    // ══════════���════════════════════════════
    // SCAN
    // ═════════════════════════════════════���═

    fun scan(onFound: (BluetoothDevice) -> Unit) {
        val scanner = adapter?.bluetoothLeScanner ?: return
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SBI_SERVICE)).build()
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

    // ══════════════��══════════════════════���═
    // CONNECT
    // ═══════════════════════════════════���═══

    fun connect(address: String) {
        val device = adapter?.getRemoteDevice(address) ?: return
        Log.i(TAG, "Connecting to Shimano STEPS: ${device.name ?: address}")
        device.connectGatt(context, true, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        isConnected = false
        gatt?.close()
        gatt = null
        controlPoint = null
        onData?.invoke(JSONObject().apply { put("type", "disconnected") })
    }

    // ═════════════════��═════════════════════
    // COMMANDS
    // ═════════════════════════════════��═════

    /** Set assist mode: 0=OFF, 1=ECO, 2=TRAIL, 3=BOOST */
    fun setAssistMode(mode: Int) {
        sendSbiCommand(SBI_CHANGE_ASSIST, byteArrayOf(mode.toByte()))
        Log.i(TAG, "Assist → $mode (${arrayOf("OFF","ECO","TRAIL","BOOST").getOrElse(mode) { "?" }})")
    }

    /** Toggle light: 1=off, 2=on */
    fun setLight(on: Boolean) {
        sendSbiCommand(SBI_CHANGE_LIGHT, byteArrayOf(if (on) 0x02 else 0x01))
        Log.i(TAG, "Light → ${if (on) "ON" else "OFF"}")
    }

    /** Request STEPS status (triggers notification) */
    fun requestStatus() {
        sendSbiCommand(SBI_REQUEST_STATUS, byteArrayOf())
    }

    // ═══════════════════════════════════════
    // GATT
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
                    controlPoint = null
                    onData?.invoke(JSONObject().apply { put("type", "disconnected") })
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return

            val sbi = g.getService(SBI_SERVICE)
            if (sbi == null) { Log.e(TAG, "SBI service not found!"); return }

            // Subscribe to periodic info (STEPS telemetry)
            sbi.getCharacteristic(SBI_PERIODIC_INFO)?.let { char ->
                g.setCharacteristicNotification(char, true)
                char.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                    desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    g.writeDescriptor(desc)
                }
                Log.i(TAG, "Periodic info notifications enabled")
            }

            // Control point (write + indicate)
            sbi.getCharacteristic(SBI_CONTROL_POINT)?.let { char ->
                controlPoint = char
                handler.postDelayed({
                    g.setCharacteristicNotification(char, true)
                    char.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                        desc.value = BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                        g.writeDescriptor(desc)
                    }
                }, 500) // Delay after first descriptor write
                Log.i(TAG, "Control point ready")
            }

            // Subscribe to Cycling Power (motor watts)
            handler.postDelayed({
                g.getService(POWER_SERVICE)?.getCharacteristic(POWER_MEAS)?.let { char ->
                    g.setCharacteristicNotification(char, true)
                    char.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
                        desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        g.writeDescriptor(desc)
                    }
                    Log.i(TAG, "Power measurement notifications enabled")
                }
            }, 1000)

            // Read battery
            handler.postDelayed({
                g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let {
                    g.readCharacteristic(it)
                }
            }, 1500)

            isConnected = true

            onData?.invoke(JSONObject().apply {
                put("type", "connected")
                put("device", g.device.name ?: "Shimano STEPS")
                put("address", g.device.address)
                put("brand", "shimano")
                put("bonded", g.device.bondState == BluetoothDevice.BOND_BONDED)
            })

            // Request initial status
            handler.postDelayed({ requestStatus() }, 2000)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val data = characteristic.value ?: return
            val uuid = characteristic.uuid

            when {
                uuid == SBI_PERIODIC_INFO -> parsePeriodicInfo(data)
                uuid == SBI_CONTROL_POINT -> parseControlResponse(data)
                uuid == POWER_MEAS -> parsePowerMeasurement(data)
            }
        }

        override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            val data = characteristic.value ?: return
            if (characteristic.uuid == BATTERY_LEVEL && data.isNotEmpty()) {
                val pct = data[0].toInt() and 0xFF
                onData?.invoke(JSONObject().apply { put("type", "battery"); put("value", pct) })
            }
        }
    }

    // ═══════════════════════════════════════
    // SBI Command Writer
    // ═══════════════════════════════════════

    @Suppress("DEPRECATION")
    private fun sendSbiCommand(opCode: Int, params: ByteArray) {
        val cp = controlPoint ?: return
        val g = gatt ?: return
        sequenceNumber = (sequenceNumber + 1) and 0x7F
        val cmd = ByteArray(2 + params.size)
        cmd[0] = opCode.toByte()
        cmd[1] = sequenceNumber.toByte()
        System.arraycopy(params, 0, cmd, 2, params.size)
        cp.value = cmd
        cp.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        g.writeCharacteristic(cp)
        Log.d(TAG, "SBI cmd: op=0x${opCode.toString(16)} seq=$sequenceNumber params=${params.joinToString { "%02x".format(it) }}")
    }

    // ═══════════════════════════════════════
    // Parsers
    // ═══════════════════════════════════════

    private fun parsePeriodicInfo(data: ByteArray) {
        if (data.isEmpty()) return
        when (data[0].toInt() and 0xFF) {
            0x01 -> parseStepsStatus(data)
            0x02 -> parseTravelingInfo1(data)
            0x03 -> parseTravelingInfo2(data)
        }
    }

    /** STEPS_STATUS — battery, errors, profile, light, assist state */
    private fun parseStepsStatus(data: ByteArray) {
        if (data.size < 18) return

        val error = data[1].toInt() and 0xFF
        val maintenance = (data[4].toInt() and 0xFF) == 1
        val lightStatus = data[6].toInt() and 0xFF
        val forcedEco = (data[7].toInt() and 0xFF) == 1
        val shiftAdvice = data[8].toInt() and 0xFF
        val nomCapacity = ((data[10].toInt() and 0xFF) shl 8) or (data[9].toInt() and 0xFF) // LE
        val profile = data[15].toInt() and 0xFF

        val lightOn = if (lightStatus != 0xFF) lightStatus == 2 else null

        onData?.invoke(JSONObject().apply {
            put("type", "stepsStatus")
            put("error", if (error != 0xFF) error else -1)
            put("maintenance", maintenance)
            if (lightOn != null) put("lightOn", lightOn)
            put("forcedEco", forcedEco)
            put("shiftAdvice", if (shiftAdvice != 0xFF) shiftAdvice else 0)
            put("nominalCapacity", if (nomCapacity != 0xFFFF) nomCapacity else -1)
            put("profile", profile)
        })

        Log.d(TAG, "STEPS: err=$error maint=$maintenance light=$lightOn eco=$forcedEco cap=$nomCapacity prof=$profile")
    }

    /** TRAVELING_INFORMATION1 — assist mode, speed, cadence, time */
    private fun parseTravelingInfo1(data: ByteArray) {
        if (data.size < 10) return

        val rawAssist = data[1].toInt() and 0xFF
        val assistMode = rawAssist and 0x0F // Lower nibble = mode

        val rawSpeed = ((data[3].toInt() and 0xFF) shl 8) or (data[2].toInt() and 0xFF)
        val speed = if (rawSpeed.toShort().toInt() != -32768) rawSpeed.toShort().toFloat() / 100f else -1f

        val cadence = data[5].toInt() and 0xFF

        onData?.invoke(JSONObject().apply {
            put("type", "assistMode")
            put("value", assistMode)
        })
        if (speed >= 0) {
            onData?.invoke(JSONObject().apply {
                put("type", "speed")
                put("value", speed)
            })
        }
        if (cadence != 0xFF) {
            onData?.invoke(JSONObject().apply {
                put("type", "cadence")
                put("value", cadence)
            })
        }

        Log.d(TAG, "TRAVEL1: assist=$assistMode spd=${"%.1f".format(speed)} cad=$cadence")
    }

    /** TRAVELING_INFORMATION2 — distance, range per mode */
    private fun parseTravelingInfo2(data: ByteArray) {
        if (data.size < 19) return

        fun u32le(off: Int): Long = ((data[off+3].toLong() and 0xFF) shl 24) or ((data[off+2].toLong() and 0xFF) shl 16) or ((data[off+1].toLong() and 0xFF) shl 8) or (data[off].toLong() and 0xFF)
        fun u16le(off: Int): Int = ((data[off+1].toInt() and 0xFF) shl 8) or (data[off].toInt() and 0xFF)

        val tripDist = u32le(1)
        val totalDist = u32le(5)
        val rangeBoost = u16le(13)
        val rangeTrail = u16le(15)
        val rangeEco = u16le(17)

        if (rangeBoost != 0xFFFF || rangeTrail != 0xFFFF || rangeEco != 0xFFFF) {
            onData?.invoke(JSONObject().apply {
                put("type", "rangePerMode")
                put("boost", if (rangeBoost != 0xFFFF) rangeBoost else 0)
                put("trail", if (rangeTrail != 0xFFFF) rangeTrail else 0)
                put("eco", if (rangeEco != 0xFFFF) rangeEco else 0)
            })
        }

        if (totalDist != 0xFFFFFFFFL) {
            onData?.invoke(JSONObject().apply {
                put("type", "distance")
                put("value", totalDist.toDouble() / 1000.0)
            })
        }

        Log.d(TAG, "TRAVEL2: trip=${"%.1f".format(tripDist/1000.0)}km total=${"%.0f".format(totalDist/1000.0)}km range: eco=$rangeEco trail=$rangeTrail boost=$rangeBoost")
    }

    /** Cycling Power Measurement — motor watts */
    private fun parsePowerMeasurement(data: ByteArray) {
        if (data.size < 4) return
        val watts = ((data[3].toInt() and 0xFF) shl 8) or (data[2].toInt() and 0xFF)
        if (watts in 0..2000) {
            onData?.invoke(JSONObject().apply {
                put("type", "power")
                put("value", watts)
            })
        }
    }

    private fun parseControlResponse(data: ByteArray) {
        if (data.size < 3 || data[0] != SBI_RESPONSE_CODE) return
        val seq = data[1].toInt() and 0xFF
        val code = data[2].toInt() and 0xFF
        Log.i(TAG, "SBI response: seq=$seq code=$code ${if (code == 0) "OK" else "FAIL"}")
    }

    fun destroy() {
        gatt?.close()
        gatt = null
    }
}
