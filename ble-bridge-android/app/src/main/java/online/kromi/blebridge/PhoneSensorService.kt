package online.kromi.blebridge

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import org.json.JSONObject
import kotlin.math.atan2
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Reads phone hardware sensors and broadcasts data via callback as JSON.
 *
 * Sensors:
 * - Barometer (TYPE_PRESSURE) → altitude via barometric formula
 * - Accelerometer (TYPE_ACCELEROMETER) → lean angle, crash detection (>4g)
 * - Gyroscope (TYPE_GYROSCOPE) → lean rate
 * - Ambient Temperature (TYPE_AMBIENT_TEMPERATURE) → if available
 *
 * Output is throttled: accel/gyro max 5Hz, barometer/temp max 1Hz.
 */
class PhoneSensorService(
    private val context: Context,
    private val onData: (JSONObject) -> Unit
) : SensorEventListener {

    companion object {
        const val TAG = "PhoneSensor"
        private const val ACCEL_MIN_INTERVAL_MS = 200L   // 5 Hz
        private const val BARO_MIN_INTERVAL_MS = 1000L   // 1 Hz
        private const val TEMP_MIN_INTERVAL_MS = 1000L   // 1 Hz
        private const val CRASH_G_THRESHOLD = 4.0
        private const val STANDARD_PRESSURE_HPA = 1013.25
        private const val GRAVITY = 9.80665
    }

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private var barometerSensor: Sensor? = null
    private var accelerometerSensor: Sensor? = null
    private var gyroscopeSensor: Sensor? = null
    private var temperatureSensor: Sensor? = null
    private var lightSensor: Sensor? = null
    private var magnetometerSensor: Sensor? = null

    private var lastAccelSendMs = 0L
    private var lastBaroSendMs = 0L
    private var lastTempSendMs = 0L
    private var lastLightSendMs = 0L
    private var lastMagSendMs = 0L

    private var running = false

    /** Available sensor flags — set after start() */
    var hasBarometer = false; private set
    var hasAccelerometer = false; private set
    var hasGyroscope = false; private set
    var hasTemperature = false; private set
    var hasLight = false; private set
    var hasMagnetometer = false; private set

    fun start() {
        if (running) return
        running = true

        barometerSensor = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE)
        accelerometerSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        gyroscopeSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        temperatureSensor = sensorManager.getDefaultSensor(Sensor.TYPE_AMBIENT_TEMPERATURE)
        lightSensor = sensorManager.getDefaultSensor(Sensor.TYPE_LIGHT)
        magnetometerSensor = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)

        hasBarometer = barometerSensor != null
        hasAccelerometer = accelerometerSensor != null
        hasGyroscope = gyroscopeSensor != null
        hasTemperature = temperatureSensor != null
        hasLight = lightSensor != null
        hasMagnetometer = magnetometerSensor != null

        // Register with appropriate delays
        barometerSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Barometer registered")
        }
        accelerometerSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
            Log.i(TAG, "Accelerometer registered")
        }
        gyroscopeSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
            Log.i(TAG, "Gyroscope registered")
        }
        temperatureSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Ambient temperature registered")
        }
        lightSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Light sensor registered")
        }
        magnetometerSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Magnetometer registered")
        }

        Log.i(TAG, "Sensors started — baro=$hasBarometer accel=$hasAccelerometer gyro=$hasGyroscope temp=$hasTemperature mag=$hasMagnetometer")
    }

    fun stop() {
        if (!running) return
        running = false
        sensorManager.unregisterListener(this)
        Log.i(TAG, "Sensors stopped")
    }

    override fun onSensorChanged(event: SensorEvent) {
        val now = System.currentTimeMillis()

        when (event.sensor.type) {
            Sensor.TYPE_PRESSURE -> {
                if (now - lastBaroSendMs < BARO_MIN_INTERVAL_MS) return
                lastBaroSendMs = now

                val pressure = event.values[0]
                val altitude = calculateAltitude(pressure)

                val json = JSONObject().apply {
                    put("type", "barometer")
                    put("pressure", roundTo(pressure.toDouble(), 1))
                    put("altitude", roundTo(altitude, 1))
                }
                onData(json)
            }

            Sensor.TYPE_ACCELEROMETER -> {
                if (now - lastAccelSendMs < ACCEL_MIN_INTERVAL_MS) return
                lastAccelSendMs = now

                val x = event.values[0].toDouble()
                val y = event.values[1].toDouble()
                val z = event.values[2].toDouble()

                val magnitude = sqrt(x * x + y * y + z * z) / GRAVITY
                val leanAngle = Math.toDegrees(atan2(x, z))

                // Crash detection: sudden deceleration > 4g
                if (magnitude > CRASH_G_THRESHOLD) {
                    val crashJson = JSONObject().apply {
                        put("type", "crash")
                        put("magnitude", roundTo(magnitude, 1))
                    }
                    onData(crashJson)
                    Log.w(TAG, "CRASH DETECTED — magnitude=${roundTo(magnitude, 1)}g")
                }

                val json = JSONObject().apply {
                    put("type", "accel")
                    put("lean", roundTo(leanAngle, 1))
                    put("magnitude", roundTo(magnitude, 2))
                }
                onData(json)
            }

            Sensor.TYPE_GYROSCOPE -> {
                // Gyro data is sent alongside accel — throttled at same rate
                if (now - lastAccelSendMs < ACCEL_MIN_INTERVAL_MS) return

                val json = JSONObject().apply {
                    put("type", "gyro")
                    put("x", roundTo(event.values[0].toDouble(), 3))
                    put("y", roundTo(event.values[1].toDouble(), 3))
                    put("z", roundTo(event.values[2].toDouble(), 3))
                }
                onData(json)
            }

            Sensor.TYPE_AMBIENT_TEMPERATURE -> {
                if (now - lastTempSendMs < TEMP_MIN_INTERVAL_MS) return
                lastTempSendMs = now

                val json = JSONObject().apply {
                    put("type", "temperature")
                    put("value", roundTo(event.values[0].toDouble(), 1))
                }
                onData(json)
            }

            Sensor.TYPE_LIGHT -> {
                if (now - lastLightSendMs < BARO_MIN_INTERVAL_MS) return
                lastLightSendMs = now

                val lux = event.values[0].toDouble()
                val json = JSONObject().apply {
                    put("type", "light")
                    put("lux", roundTo(lux, 0))
                }
                onData(json)
            }

            Sensor.TYPE_MAGNETIC_FIELD -> {
                if (now - lastMagSendMs < BARO_MIN_INTERVAL_MS) return
                lastMagSendMs = now

                val x = event.values[0].toDouble()
                val y = event.values[1].toDouble()
                val z = event.values[2].toDouble()
                // Calculate compass heading from magnetic field
                val headingRad = atan2(y, x)
                var headingDeg = Math.toDegrees(headingRad)
                if (headingDeg < 0) headingDeg += 360.0

                val json = JSONObject().apply {
                    put("type", "magnetometer")
                    put("heading", roundTo(headingDeg, 1))
                    put("x", roundTo(x, 1))
                    put("y", roundTo(y, 1))
                    put("z", roundTo(z, 1))
                }
                onData(json)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not needed
    }

    /**
     * Barometric altitude formula:
     * altitude = 44330 * (1 - (pressure / 1013.25) ^ 0.1903)
     */
    private fun calculateAltitude(pressureHpa: Float): Double {
        return 44330.0 * (1.0 - (pressureHpa / STANDARD_PRESSURE_HPA).toDouble().pow(0.1903))
    }

    private fun roundTo(value: Double, decimals: Int): Double {
        val factor = Math.pow(10.0, decimals.toDouble())
        return Math.round(value * factor) / factor
    }
}
