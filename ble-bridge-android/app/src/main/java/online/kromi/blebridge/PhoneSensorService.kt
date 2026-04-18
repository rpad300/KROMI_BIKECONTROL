package online.kromi.blebridge

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.util.Log
import org.json.JSONObject
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Reads phone hardware sensors and broadcasts data via callback as JSON.
 *
 * Continuous sensors (SensorEventListener):
 * - Barometer (TYPE_PRESSURE) → altitude via barometric formula
 * - Accelerometer (TYPE_ACCELEROMETER) → lean angle, legacy crash detection
 * - Gyroscope (TYPE_GYROSCOPE) → lean rate
 * - Ambient Temperature (TYPE_AMBIENT_TEMPERATURE) → if available
 * - Light (TYPE_LIGHT) → ambient lux
 * - Magnetometer (TYPE_MAGNETIC_FIELD) → raw magnetic data (heading via rotation vector)
 * - Rotation Vector (TYPE_ROTATION_VECTOR) → tilt-compensated heading, pitch, roll
 * - Gravity (TYPE_GRAVITY) → road gradient proxy
 * - Linear Acceleration (TYPE_LINEAR_ACCELERATION) → crash detection & terrain roughness
 * - Proximity (TYPE_PROXIMITY) → pocket/backpack detection
 * - Step Counter (TYPE_STEP_COUNTER) → hike-a-bike detection
 * - Step Detector (TYPE_STEP_DETECTOR) → individual step events
 * - Orientation (TYPE_ORIENTATION) → fallback azimuth/pitch/roll (deprecated)
 *
 * One-shot trigger sensors (TriggerEventListener):
 * - Significant Motion (TYPE_SIGNIFICANT_MOTION) → auto wake
 * - Stationary Detect (TYPE_STATIONARY_DETECT) → auto-pause
 * - Motion Detect (TYPE_MOTION_DETECT) → auto-resume
 *
 * Output is throttled per-sensor to avoid flooding the BLE bridge.
 */
class PhoneSensorService(
    private val context: Context,
    private val onData: (JSONObject) -> Unit
) : SensorEventListener {

    companion object {
        const val TAG = "PhoneSensor"
        private const val ACCEL_MIN_INTERVAL_MS = 200L        // 5 Hz
        private const val BARO_MIN_INTERVAL_MS = 1000L        // 1 Hz
        private const val TEMP_MIN_INTERVAL_MS = 1000L        // 1 Hz
        private const val ROTATION_MIN_INTERVAL_MS = 200L     // 5 Hz
        private const val GRAVITY_MIN_INTERVAL_MS = 1000L     // 1 Hz (throttled from 5Hz sensor)
        private const val LINEAR_ACCEL_MIN_INTERVAL_MS = 100L // 10 Hz (internal), roughness 0.5Hz
        private const val ROUGHNESS_INTERVAL_MS = 2000L       // 0.5 Hz
        private const val STEP_CHECK_INTERVAL_MS = 30_000L    // every 30s
        private const val TERRAIN_INTEL_INTERVAL_MS = 2000L   // 0.5 Hz
        private const val POCKET_CONFIRM_MS = 10_000L         // 10s to confirm pocket
        private const val CRASH_G_THRESHOLD = 4.0
        private const val STANDARD_PRESSURE_HPA = 1013.25
        private const val GRAVITY = 9.80665
    }

    private val sensorManager: SensorManager? =
        context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager

    // --- Existing sensors ---
    private var barometerSensor: Sensor? = null
    private var accelerometerSensor: Sensor? = null
    private var gyroscopeSensor: Sensor? = null
    private var temperatureSensor: Sensor? = null
    private var lightSensor: Sensor? = null
    private var magnetometerSensor: Sensor? = null

    // --- New continuous sensors ---
    private var rotationVectorSensor: Sensor? = null
    private var gravitySensor: Sensor? = null
    private var linearAccelSensor: Sensor? = null
    private var proximitySensor: Sensor? = null
    private var stepCounterSensor: Sensor? = null
    private var stepDetectorSensor: Sensor? = null
    private var orientationSensor: Sensor? = null

    // --- New one-shot trigger sensors ---
    private var significantMotionSensor: Sensor? = null
    private var stationarySensor: Sensor? = null
    private var motionDetectSensor: Sensor? = null

    // --- Throttle timestamps (existing) ---
    private var lastAccelSendMs = 0L
    private var lastGyroSendMs = 0L
    private var lastBaroSendMs = 0L
    private var lastTempSendMs = 0L
    private var lastLightSendMs = 0L
    private var lastMagSendMs = 0L

    // --- Throttle timestamps (new) ---
    private var lastRotationSendMs = 0L
    private var lastGravitySendMs = 0L
    private var lastLinearAccelMs = 0L
    private var lastRoughnessMs = 0L
    private var lastStepCheckMs = 0L
    private var lastTerrainIntelMs = 0L

    // --- State for new sensors ---
    // Rotation vector → tilt-compensated heading
    private var lastHeading = 0f
    private var lastPitch = 0f
    private var lastRoll = 0f

    // Gravity → gradient proxy
    private var lastGravityGradient = 0.0

    // Linear acceleration → roughness
    private val linearAccelBuffer = mutableListOf<Float>()
    private var lastRoughnessG = 0f

    // Proximity → pocket detection
    private var lastProximityNear = false
    private var proximityNearSinceMs = 0L
    private var pocketConfirmed = false

    // Step counter → hike-a-bike
    private var baselineSteps = -1f
    private var isHiking = false
    private var lastSpeedKmh = 0f  // set externally or from GPS

    private var running = false

    // --- Available sensor flags — set after start() ---
    var hasBarometer = false; private set
    var hasAccelerometer = false; private set
    var hasGyroscope = false; private set
    var hasTemperature = false; private set
    var hasLight = false; private set
    var hasMagnetometer = false; private set
    var hasRotationVector = false; private set
    var hasGravity = false; private set
    var hasLinearAccel = false; private set
    var hasProximity = false; private set
    var hasStepCounter = false; private set
    var hasStepDetector = false; private set
    var hasOrientation = false; private set
    var hasSignificantMotion = false; private set
    var hasStationary = false; private set
    var hasMotionDetect = false; private set

    // --- Trigger listeners for one-shot sensors ---
    private val significantMotionListener = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent) {
            onData(JSONObject().apply {
                put("type", "significant_motion")
                put("timestamp", System.currentTimeMillis())
            })
            Log.i(TAG, "Significant motion detected")
            // Re-register (one-shot sensors need re-registration)
            significantMotionSensor?.let {
                sensorManager?.requestTriggerSensor(this, it)
            }
        }
    }

    private val stationaryListener: TriggerEventListener = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent) {
            onData(JSONObject().apply {
                put("type", "ride_stationary")
                put("timestamp", System.currentTimeMillis())
            })
            Log.i(TAG, "Stationary detected — ride paused")
            // Re-register motion detect to know when rider starts again
            motionDetectSensor?.let {
                sensorManager?.requestTriggerSensor(motionListener, it)
            }
        }
    }

    private val motionListener: TriggerEventListener = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent) {
            onData(JSONObject().apply {
                put("type", "ride_resumed")
                put("timestamp", System.currentTimeMillis())
            })
            Log.i(TAG, "Motion detected — ride resumed")
            // Re-register stationary detect
            stationarySensor?.let {
                sensorManager?.requestTriggerSensor(stationaryListener, it)
            }
        }
    }

    /**
     * Allow external code (e.g. GPS service) to feed current speed
     * for hike-a-bike detection.
     */
    fun setCurrentSpeed(kmh: Float) {
        lastSpeedKmh = kmh
    }

    fun start() {
        if (running) return
        val sm = sensorManager ?: run {
            Log.e(TAG, "SensorManager not available")
            return
        }
        running = true

        // --- Existing sensors ---
        barometerSensor = sm.getDefaultSensor(Sensor.TYPE_PRESSURE)
        accelerometerSensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        gyroscopeSensor = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        temperatureSensor = sm.getDefaultSensor(Sensor.TYPE_AMBIENT_TEMPERATURE)
        lightSensor = sm.getDefaultSensor(Sensor.TYPE_LIGHT)
        magnetometerSensor = sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)

        // --- New continuous sensors ---
        rotationVectorSensor = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        gravitySensor = sm.getDefaultSensor(Sensor.TYPE_GRAVITY)
        linearAccelSensor = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
        proximitySensor = sm.getDefaultSensor(Sensor.TYPE_PROXIMITY)
        stepCounterSensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        stepDetectorSensor = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
        @Suppress("DEPRECATION")
        orientationSensor = sm.getDefaultSensor(Sensor.TYPE_ORIENTATION)

        // --- One-shot trigger sensors ---
        significantMotionSensor = sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)
        stationarySensor = sm.getDefaultSensor(Sensor.TYPE_STATIONARY_DETECT)
        motionDetectSensor = sm.getDefaultSensor(Sensor.TYPE_MOTION_DETECT)

        // Set availability flags
        hasBarometer = barometerSensor != null
        hasAccelerometer = accelerometerSensor != null
        hasGyroscope = gyroscopeSensor != null
        hasTemperature = temperatureSensor != null
        hasLight = lightSensor != null
        hasMagnetometer = magnetometerSensor != null
        hasRotationVector = rotationVectorSensor != null
        hasGravity = gravitySensor != null
        hasLinearAccel = linearAccelSensor != null
        hasProximity = proximitySensor != null
        hasStepCounter = stepCounterSensor != null
        hasStepDetector = stepDetectorSensor != null
        hasOrientation = orientationSensor != null
        hasSignificantMotion = significantMotionSensor != null
        hasStationary = stationarySensor != null
        hasMotionDetect = motionDetectSensor != null

        // --- Register existing continuous sensors ---
        barometerSensor?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Barometer registered")
        }
        accelerometerSensor?.let {
            sm.registerListener(this, it, 200_000)
            Log.i(TAG, "Accelerometer registered (200ms interval)")
        }
        gyroscopeSensor?.let {
            sm.registerListener(this, it, 200_000)
            Log.i(TAG, "Gyroscope registered (200ms interval)")
        }
        temperatureSensor?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Ambient temperature registered")
        }
        lightSensor?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Light sensor registered")
        }
        magnetometerSensor?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Magnetometer registered")
        }

        // --- Register new continuous sensors ---
        rotationVectorSensor?.let {
            sm.registerListener(this, it, 200_000) // 5 Hz
            Log.i(TAG, "Rotation vector registered (200ms interval)")
        }
        gravitySensor?.let {
            sm.registerListener(this, it, 200_000) // 5 Hz sensor, output throttled to 1 Hz
            Log.i(TAG, "Gravity sensor registered (200ms interval, output 1Hz)")
        }
        linearAccelSensor?.let {
            sm.registerListener(this, it, 100_000) // 10 Hz for roughness resolution
            Log.i(TAG, "Linear acceleration registered (100ms interval)")
        }
        proximitySensor?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) // on-change
            Log.i(TAG, "Proximity sensor registered")
        }
        stepCounterSensor?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Step counter registered")
        }
        stepDetectorSensor?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Step detector registered")
        }
        orientationSensor?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            Log.i(TAG, "Orientation sensor registered (deprecated fallback)")
        }

        // --- Register one-shot trigger sensors ---
        significantMotionSensor?.let {
            sm.requestTriggerSensor(significantMotionListener, it)
            Log.i(TAG, "Significant motion trigger registered")
        }
        stationarySensor?.let {
            sm.requestTriggerSensor(stationaryListener, it)
            Log.i(TAG, "Stationary detect trigger registered")
        }
        motionDetectSensor?.let {
            sm.requestTriggerSensor(motionListener, it)
            Log.i(TAG, "Motion detect trigger registered")
        }

        Log.i(TAG, buildString {
            append("Sensors started —")
            append(" baro=$hasBarometer")
            append(" accel=$hasAccelerometer")
            append(" gyro=$hasGyroscope")
            append(" temp=$hasTemperature")
            append(" mag=$hasMagnetometer")
            append(" rotation=$hasRotationVector")
            append(" gravity=$hasGravity")
            append(" linAccel=$hasLinearAccel")
            append(" proximity=$hasProximity")
            append(" stepCnt=$hasStepCounter")
            append(" stepDet=$hasStepDetector")
            append(" orient=$hasOrientation")
            append(" sigMotion=$hasSignificantMotion")
            append(" stationary=$hasStationary")
            append(" motionDet=$hasMotionDetect")
        })
    }

    fun stop() {
        if (!running) return
        running = false
        sensorManager?.unregisterListener(this)
        // Cancel one-shot trigger sensors
        significantMotionSensor?.let {
            sensorManager?.cancelTriggerSensor(significantMotionListener, it)
        }
        stationarySensor?.let {
            sensorManager?.cancelTriggerSensor(stationaryListener, it)
        }
        motionDetectSensor?.let {
            sensorManager?.cancelTriggerSensor(motionListener, it)
        }
        // Reset state
        linearAccelBuffer.clear()
        baselineSteps = -1f
        pocketConfirmed = false
        lastProximityNear = false
        isHiking = false
        Log.i(TAG, "Sensors stopped")
    }

    override fun onSensorChanged(event: SensorEvent) {
        val now = System.currentTimeMillis()

        when (event.sensor.type) {

            // ── Existing sensors ────────────────────────────────────────

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

                // Legacy crash detection (linear accel is preferred if available)
                if (magnitude > CRASH_G_THRESHOLD && !hasLinearAccel) {
                    val crashJson = JSONObject().apply {
                        put("type", "crash")
                        put("magnitude", roundTo(magnitude, 1))
                    }
                    onData(crashJson)
                    Log.w(TAG, "CRASH DETECTED (accel) — magnitude=${roundTo(magnitude, 1)}g")
                }

                val json = JSONObject().apply {
                    put("type", "accel")
                    put("lean", roundTo(leanAngle, 1))
                    put("magnitude", roundTo(magnitude, 2))
                }
                onData(json)
            }

            Sensor.TYPE_GYROSCOPE -> {
                if (now - lastGyroSendMs < ACCEL_MIN_INTERVAL_MS) return
                lastGyroSendMs = now

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
                // Raw magnetic heading (inaccurate when phone not flat)
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

            // ── New sensors ─────────────────────────────────────────────

            Sensor.TYPE_ROTATION_VECTOR -> {
                if (now - lastRotationSendMs < ROTATION_MIN_INTERVAL_MS) return
                lastRotationSendMs = now

                // Rotation vector → rotation matrix → Euler angles
                val rotationMatrix = FloatArray(9)
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                val orientation = FloatArray(3)
                SensorManager.getOrientation(rotationMatrix, orientation)

                val azimuthDeg = Math.toDegrees(orientation[0].toDouble()).toFloat()
                val pitchDeg = Math.toDegrees(orientation[1].toDouble()).toFloat()
                val rollDeg = Math.toDegrees(orientation[2].toDouble()).toFloat()

                lastHeading = (azimuthDeg + 360) % 360
                lastPitch = pitchDeg
                lastRoll = rollDeg

                onData(JSONObject().apply {
                    put("type", "orientation")
                    put("heading_deg", roundTo(lastHeading.toDouble(), 1))
                    put("pitch_deg", roundTo(pitchDeg.toDouble(), 1))
                    put("roll_deg", roundTo(rollDeg.toDouble(), 1))
                    put("tilt_compensated", true)
                })

                emitTerrainIntelligence(now)
            }

            Sensor.TYPE_GRAVITY -> {
                // Collect at 5Hz but only emit at 1Hz
                if (now - lastGravitySendMs < GRAVITY_MIN_INTERVAL_MS) return
                lastGravitySendMs = now

                val gx = event.values[0].toDouble()
                val gy = event.values[1].toDouble()
                val gz = event.values[2].toDouble()

                val totalG = sqrt(gx * gx + gy * gy + gz * gz)
                if (totalG > 9.0) { // sanity check
                    val pitchRad = asin(gy / totalG)
                    val estimatedGradient = tan(pitchRad) * 100.0 // % grade
                    lastGravityGradient = estimatedGradient

                    onData(JSONObject().apply {
                        put("type", "gravity_gradient")
                        put("gradient_pct", roundTo(estimatedGradient, 1))
                        put("confidence", 0.4) // lower than barometer, works without GPS
                    })
                }
            }

            Sensor.TYPE_LINEAR_ACCELERATION -> {
                if (now - lastLinearAccelMs < LINEAR_ACCEL_MIN_INTERVAL_MS) return
                lastLinearAccelMs = now

                val ax = event.values[0].toDouble()
                val ay = event.values[1].toDouble()
                val az = event.values[2].toDouble()
                val magnitude = sqrt(ax * ax + ay * ay + az * az)

                // Crash detection: >4g impact (gravity already removed = cleaner signal)
                if (magnitude > CRASH_G_THRESHOLD * GRAVITY) {
                    onData(JSONObject().apply {
                        put("type", "crash_detected")
                        put("impact_g", roundTo(magnitude / GRAVITY, 1))
                        put("timestamp", System.currentTimeMillis())
                    })
                    Log.w(TAG, "CRASH DETECTED (linear) — impact=${roundTo(magnitude / GRAVITY, 1)}g")
                }

                // Roughness tracking: RMS over last ~2 seconds (20 samples at 10Hz)
                linearAccelBuffer.add(magnitude.toFloat())
                if (linearAccelBuffer.size > 20) linearAccelBuffer.removeFirst()

                if (now - lastRoughnessMs > ROUGHNESS_INTERVAL_MS) {
                    lastRoughnessMs = now
                    if (linearAccelBuffer.size >= 5) {
                        val rms = sqrt(linearAccelBuffer.map { (it * it).toDouble() }.average()).toFloat()
                        lastRoughnessG = rms / GRAVITY.toFloat()
                        val confidence = if (linearAccelBuffer.size >= 15) 0.8 else 0.3
                        onData(JSONObject().apply {
                            put("type", "terrain_roughness")
                            put("roughness_g", roundTo(lastRoughnessG.toDouble(), 3))
                            put("confidence", confidence)
                        })
                    }
                }
            }

            Sensor.TYPE_PROXIMITY -> {
                // On-change sensor: near (0) or far (max_range)
                val maxRange = proximitySensor?.maximumRange ?: 5f
                val isNear = event.values[0] < maxRange
                val wasNear = lastProximityNear
                lastProximityNear = isNear

                if (isNear && !wasNear) {
                    proximityNearSinceMs = now
                    pocketConfirmed = false
                } else if (!isNear) {
                    pocketConfirmed = false
                }

                // Confirm pocket after 10 seconds of continuous near
                if (isNear && !pocketConfirmed && now - proximityNearSinceMs > POCKET_CONFIRM_MS) {
                    pocketConfirmed = true
                }

                onData(JSONObject().apply {
                    put("type", "proximity")
                    put("in_pocket", pocketConfirmed)
                    put("near", isNear)
                })
            }

            Sensor.TYPE_STEP_COUNTER -> {
                // Cumulative since boot
                if (baselineSteps < 0) baselineSteps = event.values[0]
                val stepsSinceStart = (event.values[0] - baselineSteps).toInt()

                if (now - lastStepCheckMs > STEP_CHECK_INTERVAL_MS) {
                    lastStepCheckMs = now
                    // Hike-a-bike: steps increasing AND speed < 5 km/h
                    isHiking = stepsSinceStart > 10 && lastSpeedKmh < 5f

                    onData(JSONObject().apply {
                        put("type", "step_counter")
                        put("steps", stepsSinceStart)
                        put("hiking", isHiking)
                    })
                }
            }

            Sensor.TYPE_STEP_DETECTOR -> {
                // Individual step event — just forward it
                onData(JSONObject().apply {
                    put("type", "step_detected")
                    put("timestamp", System.currentTimeMillis())
                })
            }

            @Suppress("DEPRECATION")
            Sensor.TYPE_ORIENTATION -> {
                // Deprecated fallback: only emit if rotation vector is NOT available
                if (hasRotationVector) return
                if (now - lastRotationSendMs < ROTATION_MIN_INTERVAL_MS) return
                lastRotationSendMs = now

                val azimuth = event.values[0].toDouble()
                val pitch = event.values[1].toDouble()
                val roll = event.values[2].toDouble()

                lastHeading = azimuth.toFloat()
                lastPitch = pitch.toFloat()
                lastRoll = roll.toFloat()

                onData(JSONObject().apply {
                    put("type", "orientation")
                    put("heading_deg", roundTo(azimuth, 1))
                    put("pitch_deg", roundTo(pitch, 1))
                    put("roll_deg", roundTo(roll, 1))
                    put("tilt_compensated", false) // deprecated sensor, not tilt-compensated
                })
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not needed
    }

    /**
     * Emits a combined terrain intelligence signal at 0.5 Hz,
     * merging heading, gradient, roughness, pocket, and hiking state.
     */
    private fun emitTerrainIntelligence(now: Long) {
        if (now - lastTerrainIntelMs < TERRAIN_INTEL_INTERVAL_MS) return
        lastTerrainIntelMs = now

        onData(JSONObject().apply {
            put("type", "terrain_intelligence")
            put("heading_deg", roundTo(lastHeading.toDouble(), 1))
            put("pitch_deg", roundTo(lastPitch.toDouble(), 1))
            put("roll_deg", roundTo(lastRoll.toDouble(), 1))
            put("gradient_estimate_pct", roundTo(lastGravityGradient, 1))
            put("roughness_g", roundTo(lastRoughnessG.toDouble(), 3))
            put("in_pocket", pocketConfirmed)
            put("hiking", isHiking)
            put("lean_angle_deg", roundTo(lastRoll.toDouble(), 1))
        })
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
