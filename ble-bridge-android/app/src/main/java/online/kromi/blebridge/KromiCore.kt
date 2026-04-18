package online.kromi.blebridge

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import kotlin.math.*
import kotlin.math.roundToInt

/**
 * KromiCore — native Layer 1 (Physics) + Layer 2 (Physiology) + Decision Tree.
 *
 * Receives BLE sensor data directly from BLEManager callbacks.
 * Sends motor commands via BLEManager.setAdvancedTuning() without WebSocket round-trip.
 * PWA sends Layer 3-7 params via JS Bridge (updateParams).
 *
 * Latency: sensor → motor in ~15ms (vs ~110ms via WebSocket).
 * Fallback: if PWA disconnects, continues with last cached params.
 */
class KromiCore(private val bleManager: BLEManager) {

    companion object {
        const val TAG = "KromiCore"
        const val TICK_MS = 1000L

        // Motor wire ranges
        const val SUPPORT_MIN = 50.0;  const val SUPPORT_MAX = 350.0
        const val TORQUE_MIN = 20.0;   const val TORQUE_MAX = 85.0
        const val LAUNCH_MIN = 1.0;    const val LAUNCH_MAX = 7.0
        // Adaptive EMA: faster at riding speed, slower when nearly stopped (GPS noise)
        fun emaAlpha(speedKmh: Double): Double = when {
            speedKmh > 15 -> 0.35
            speedKmh > 8  -> 0.25
            speedKmh > 3  -> 0.15
            else          -> 0.08
        }

        // Speed zones (EU 25km/h)
        const val SPEED_LIMIT = 25.0
        const val FADE_START = 22.0

        // Physics constants
        const val G = 9.81
        const val CDA_MTB = 0.6
    }

    // ── Sensor state (updated by BLE callbacks, read from tick thread) ──

    @Volatile private var speed = 0.0        // km/h
    @Volatile private var cadence = 0        // rpm
    @Volatile private var power = 0          // watts
    @Volatile private var hr = 0             // bpm
    @Volatile private var gear = 0           // 1-12, 0=unknown
    @Volatile private var gradient = 0.0     // % from GPS
    @Volatile private var batterySoc = 0     // %
    @Volatile private var assistMode = 0     // 0-6, POWER=5

    // ── Cached params from PWA (Layers 3-7) ──────────────────

    private var crr = 0.006
    private var windComponent = 0.0    // m/s headwind(+) tailwind(-)
    private var airDensity = 1.225     // kg/m³
    private var batteryFactor = 1.0    // 0.20-1.0
    private var cpWatts = 150.0        // Critical Power
    private var wPrimeTotal = 15000.0  // W' total (J)
    private var tau = 300.0            // W' recovery constant (s)
    private var formMultiplier = 1.0   // 0.85-1.20
    private var glycogenCpFactor = 1.0 // 0.75-1.0 from nutrition
    private var routeRemainingKm = -1.0 // -1 = no route, else km remaining
    private var preAdjustSupport = 0.0
    private var preAdjustTorque = 0.0
    private var preAdjustCountdown = 0

    // ── Bike constants (from settings, set once) ─────────────

    private var totalMass = 159.0      // rider + bike (configurable via PWA settings)
    private var wheelCircumM = 2.290   // wheel circumference in meters (configurable)
    private var chainring = 34
    private var sprockets = intArrayOf(51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10)
    /** Total battery capacity in Wh (main + sub). Default: 800 + 250 = 1050 for Giant Trance X E+ 2 */
    private var batteryCapacityWh = 1050.0
    /** CDA (drag coefficient × frontal area) in m². Configurable via PWA bike config preset. */
    private var cdaValue = CDA_MTB

    // ── Internal state ───────────────────────────────────────

    // EMA smoothing
    private var prevSupport = 200.0
    private var prevTorque = 40.0

    // W' Balance (Skiba)
    private var wPrimeBalance = 15000.0
    private var prevWPrimeState = "green" // track transitions for logging

    // HR history for drift detection (10 min, sampled every 5s)
    private data class HRSample(val ts: Long, val hr: Int, val gradient: Double, val speed: Double)
    private val hrHistory = ArrayDeque<HRSample>()
    private val HR_HISTORY_MS = 10 * 60 * 1000L
    private var hrSampleCounter = 0

    // HR zone thresholds (updated from PWA)
    private var hrZoneBounds = intArrayOf(100, 130, 155, 175, 200) // Z1-Z5 ceilings
    private var targetZone = 2

    // Last sent wire values (dedup)
    private var lastWireS = -1; private var lastWireT = -1; private var lastWireL = -1

    // Active flag + logging
    @Volatile private var active = false
    private val tickThread = HandlerThread("KromiCoreTick").also { it.start() }
    private val handler = Handler(tickThread.looper)
    private var tickCount = 0L
    private var lastDetailedLog = 0L

    // ── Gap #1: Watchdog timer ──
    private var lastTickMs = System.currentTimeMillis()
    private val watchdogHandler = Handler(Looper.getMainLooper())
    private val watchdogRunnable = object : Runnable {
        override fun run() {
            val elapsed = System.currentTimeMillis() - lastTickMs
            if (active && elapsed > 3000) {
                Log.e(TAG, "WATCHDOG: tick stalled for ${elapsed}ms — sending motor OFF")
                bleManager.setTuningLevels(2, 2, 2, 2, 2)
                // Don't stop the engine — let it recover if tick resumes
            }
            watchdogHandler.postDelayed(this, 2000)
        }
    }

    // ── Gap #2: Emergency disarm ──
    fun disarm() {
        Log.w(TAG, "DISARM: Emergency motor cutoff")
        active = false
        bleManager.setTuningLevels(2, 2, 2, 2, 2)
        onTelemetry?.invoke(JSONObject().apply {
            put("type", "kromiCore")
            put("disarmed", true)
        })
    }

    // ── Gap #1 (PWA↔APK heartbeat): param version tracking + stale detection ──
    private var lastParamVersion = 0
    private var lastParamTimestamp = 0L

    // ── Gap #3: Motor temperature estimation ──
    @Volatile private var motorLoadSeconds = 0
    @Volatile private var motorCoolSeconds = 0
    private var estimatedMotorTemp = 25.0
    @Volatile private var motorThermalFactor = 1.0

    // ── Gap #6: Actual motor temperature from BLE (if available) ──
    @Volatile private var actualMotorTemp: Double? = null // null = not available from BLE

    // ── Gap #4: Brake sensor proxy ──
    private var brakingDetected = false

    // ── Gap #6: Sensor consistency ──
    private var sensorInconsistencyCount = 0
    private var lastGradient = 0.0

    // Telemetry callback for WebView display
    var onTelemetry: ((JSONObject) -> Unit)? = null

    // ═════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═════════════════════════════════════════════════════════

    fun start() {
        if (active) return
        active = true
        wPrimeBalance = wPrimeTotal
        prevSupport = 200.0; prevTorque = 40.0
        lastWireS = -1; lastWireT = -1; lastWireL = -1
        hrHistory.clear()
        // Reset safety state
        lastTickMs = System.currentTimeMillis()
        motorLoadSeconds = 0; motorCoolSeconds = 0
        estimatedMotorTemp = 25.0; motorThermalFactor = 1.0
        actualMotorTemp = null
        lastParamVersion = 0; lastParamTimestamp = 0L
        brakingDetected = false
        sensorInconsistencyCount = 0; lastGradient = 0.0
        handler.post(tickRunnable)
        watchdogHandler.post(watchdogRunnable)
        Log.i(TAG, "★ KromiCore STARTED — mass=${totalMass}kg cp=${cpWatts}W W'=${wPrimeTotal}J")
    }

    fun stop() {
        active = false
        handler.removeCallbacks(tickRunnable)
        watchdogHandler.removeCallbacks(watchdogRunnable)
        Log.i(TAG, "★ KromiCore STOPPED")
    }

    fun isActive(): Boolean = active

    private val tickRunnable = object : Runnable {
        override fun run() {
            if (!active) return
            if (assistMode == 5) { // POWER mode only
                tick()
            }
            handler.postDelayed(this, TICK_MS)
        }
    }

    // ═════════════════════════════════════════════════════════
    // SENSOR UPDATES (called from BLEManager callbacks)
    // ═════════════════════════════════════════════════════════

    fun onSpeed(v: Double) { if (v.isFinite() && v in 0.0..120.0) speed = v }
    fun onCadence(c: Int) { if (c in 0..200) cadence = c }
    fun onPower(w: Int) { if (w in 0..3000) power = w }
    fun onHR(bpm: Int) { if (bpm in 20..250) hr = bpm }
    fun onGear(g: Int) { if (g in 0..24) gear = g }
    fun onGradient(g: Double) { if (g.isFinite() && g in -50.0..50.0) gradient = g }
    fun onBattery(soc: Int) { if (soc in 0..100) batterySoc = soc }
    /** Gap #6: Motor temperature from BLE (if Giant GEV exposes it) */
    fun onMotorTemp(temp: Double) {
        if (temp in 0.0..150.0) {
            actualMotorTemp = temp
            Log.d(TAG, "◇ BLE motor temp: ${String.format("%.1f", temp)}°C")
        }
    }

    fun onAssistMode(m: Int) {
        val wasActive = assistMode == 5
        assistMode = m
        Log.d(TAG, "◇ assistMode=$m (was=$wasActive, POWER=${m == 5})")
        if (m == 5 && !wasActive) start()
        else if (m != 5 && wasActive) stop()
    }

    // ═════════════════════════════════════════════════════════
    // PARAMS FROM PWA (via JS Bridge, every 10-60s)
    // ═════════════════════════════════════════════════════════

    fun updateParams(json: JSONObject) {
        // Gap #1: Version tracking — ignore stale/duplicate param updates
        val version = json.optInt("paramVersion", 0)
        val timestamp = json.optLong("paramTimestamp", 0)

        if (version > 0 && version <= lastParamVersion) {
            Log.w(TAG, "Stale param update: v$version <= v$lastParamVersion — ignoring")
            return
        }

        lastParamVersion = version
        lastParamTimestamp = timestamp

        Log.d(TAG, "◆ PWA params update v$version: crr=${json.optDouble("crr", -1.0)} wind=${json.optDouble("wind_component_ms", -1.0)} rho=${json.optDouble("air_density", -1.0)} bat×${json.optDouble("battery_factor", -1.0)} cp=${json.optDouble("cp_effective", -1.0)} glyc×${json.optDouble("glycogen_cp_factor", -1.0)} route=${json.optDouble("route_remaining_km", -1.0)}km")
        crr = json.optDouble("crr", crr)
        windComponent = json.optDouble("wind_component_ms", windComponent)
        airDensity = json.optDouble("air_density", airDensity)
        batteryFactor = json.optDouble("battery_factor", batteryFactor)
        cpWatts = json.optDouble("cp_effective", cpWatts)
        wPrimeTotal = json.optDouble("w_prime_total", wPrimeTotal)
        tau = json.optDouble("tau", tau)
        formMultiplier = json.optDouble("form_multiplier", formMultiplier)
        glycogenCpFactor = json.optDouble("glycogen_cp_factor", glycogenCpFactor)
        routeRemainingKm = json.optDouble("route_remaining_km", routeRemainingKm)

        // Validate ranges — log warnings for out-of-bounds values
        if (batteryFactor !in 0.05..1.1) Log.w(TAG, "⚠ PARAM battery_factor=$batteryFactor OUT OF RANGE [0.05-1.1]")
        if (cpWatts !in 30.0..500.0) Log.w(TAG, "⚠ PARAM cp_effective=$cpWatts OUT OF RANGE [30-500]")
        if (glycogenCpFactor !in 0.5..1.1) Log.w(TAG, "⚠ PARAM glycogen_cp_factor=$glycogenCpFactor OUT OF RANGE [0.5-1.1]")
        if (formMultiplier !in 0.5..1.5) Log.w(TAG, "⚠ PARAM form_multiplier=$formMultiplier OUT OF RANGE [0.5-1.5]")
        if (crr !in 0.001..0.05) Log.w(TAG, "⚠ PARAM crr=$crr OUT OF RANGE [0.001-0.05]")

        json.optJSONObject("pre_adjust")?.let {
            preAdjustSupport = it.optDouble("support", 0.0)
            preAdjustTorque = it.optDouble("torque", 0.0)
            preAdjustCountdown = it.optInt("countdown", 0)
        }

        // Bike constants (set once from PWA settings)
        if (json.has("total_mass")) totalMass = json.optDouble("total_mass", totalMass)
        if (json.has("wheel_circum_m")) wheelCircumM = json.optDouble("wheel_circum_m", wheelCircumM)
        if (json.has("chainring")) chainring = json.optInt("chainring", chainring)
        if (json.has("target_zone")) targetZone = json.optInt("target_zone", targetZone)
        if (json.has("battery_capacity_wh")) batteryCapacityWh = json.optDouble("battery_capacity_wh", batteryCapacityWh)
        if (json.has("cda")) cdaValue = json.optDouble("cda", cdaValue)

        json.optJSONArray("hr_zone_bounds")?.let { arr ->
            if (arr.length() == 5) hrZoneBounds = IntArray(5) { arr.optInt(it, hrZoneBounds[it]) }
        }
        json.optJSONArray("sprockets")?.let { arr ->
            if (arr.length() >= 2) sprockets = IntArray(arr.length()) { arr.optInt(it) }
        }
    }

    // ═════════════════════════════════════════════════════════
    // MAIN TICK (every 1s)
    // ═════════════════════════════════════════════════════════

    private fun tick() {
        lastTickMs = System.currentTimeMillis()

        // ── Gap #1: Check PWA param freshness ──
        checkParamFreshness()

        // ── Gap #6: Sensor cross-validation ──
        validateSensorConsistency()

        // ── Gap #4: Brake detection ──
        detectBraking()

        // ── Layer 1: Physics ──
        val speedMs = speed / 3.6
        val gradRad = atan(gradient / 100.0)

        val Fg = totalMass * G * sin(gradRad)
        val Frr = crr * totalMass * G * cos(gradRad)
        val vEff = speedMs + windComponent
        val Faero = 0.5 * airDensity * cdaValue * vEff * abs(vEff)
        val Ftotal = Fg + Frr + Faero
        val Ptotal = max(0.0, Ftotal * speedMs)

        // 3-zone speed model
        val fadeFactor: Double
        val speedZone: String
        when {
            speed >= SPEED_LIMIT -> { fadeFactor = 0.0; speedZone = "free" }
            speed > FADE_START  -> { fadeFactor = (SPEED_LIMIT - speed) / (SPEED_LIMIT - FADE_START); speedZone = "fade" }
            else                -> { fadeFactor = 1.0; speedZone = "active" }
        }

        // Gear ratio + cadence estimation
        val sprocketIdx = if (gear in 1..sprockets.size) gear - 1 else 5
        val sprocket = sprockets.getOrElse(sprocketIdx) { 20 }
        val gearRatio = chainring.toDouble() / sprocket
        var cadenceEff = cadence.toDouble()
        if (cadenceEff <= 0 && speed > 2 && gear > 0) {
            cadenceEff = (speedMs * 60.0) / (gearRatio * wheelCircumM)
        }

        // P_human
        val Phuman = estimateHumanPower(cadenceEff, gearRatio)
        val Pgap = if (fadeFactor > 0) max(0.0, Ptotal - Phuman) else 0.0

        // ── Layer 2: Physiology ──

        // HR zone
        val zone = currentHRZone()
        val margin = if (zone in 1..5) hrZoneBounds[zone - 1] - hr else 999

        // HR history (sample every 5s)
        hrSampleCounter++
        if (hr > 0 && hrSampleCounter % 5 == 0) {
            hrHistory.addLast(HRSample(System.currentTimeMillis(), hr, gradient, speed))
            val cutoff = System.currentTimeMillis() - HR_HISTORY_MS
            while (hrHistory.isNotEmpty() && hrHistory.first().ts < cutoff) hrHistory.removeFirst()
        }

        // Cardiac drift
        val drift = computeDrift()

        // Zone breach projection
        val tBreach = if (drift > 0 && margin > 0) margin.toDouble() / drift else Double.MAX_VALUE

        // W' Balance (Skiba) — with glycogen correction
        val cpEff = cpWatts * glycogenCpFactor
        updateWPrime(Phuman, cpEff, 1.0) // dt=1s
        val wPrimePct = wPrimeBalance / wPrimeTotal

        // Log W' state transitions
        val wState = when { wPrimePct < 0.30 -> "CRITICAL"; wPrimePct < 0.70 -> "AMBER"; else -> "green" }
        if (wState != prevWPrimeState) {
            Log.w(TAG, "⚠ W' TRANSITION: $prevWPrimeState → $wState (${(wPrimePct * 100).roundToInt()}%) CP_eff=${cpEff.roundToInt()}W glyc×${String.format("%.2f", glycogenCpFactor)}")
            prevWPrimeState = wState
        }

        // Route-aware battery budget: if we know remaining distance,
        // modulate batteryFactor so motor paces itself to finish the route
        val batEff = if (routeRemainingKm > 0 && batterySoc > 0) {
            // Battery capacity comes from PWA settings (main_battery_wh + sub_battery_wh).
            // Default 1050Wh for Giant Trance X E+ 2 (800Wh main + 250Wh range extender).
            // batteryCapacityWh is updated via updateParams from PWA.
            val remainingWh = (batterySoc / 100.0) * batteryCapacityWh
            val neededWh = routeRemainingKm * 15.0
            val budgetRatio = if (neededWh > 0) remainingWh / neededWh else 99.0
            when {
                budgetRatio < 0.5 -> batteryFactor * 0.40
                budgetRatio < 0.7 -> batteryFactor * 0.60
                budgetRatio < 0.9 -> batteryFactor * 0.80
                else -> batteryFactor
            }
        } else batteryFactor

        // hrModifier
        val hrMod = when {
            hr <= 0            -> 1.0
            tBreach < 3        -> 0.6  // pre-emptive protection (only if very imminent)
            zone > targetZone  -> 0.7  // reduce load urgently
            zone < targetZone  -> 1.1  // can push motor more
            else               -> 1.0  // in target zone
        }

        // ── Decision Tree ──
        var supportPct = SUPPORT_MIN
        var torqueNm = TORQUE_MIN
        var launchLvl = 3.0
        var reason = ""

        // ── Gap #4: Braking override (before physics decision tree) ──
        if (brakingDetected) {
            supportPct = 0.0
            torqueNm = TORQUE_MIN
            launchLvl = LAUNCH_MIN
            reason = "Braking: cad=0 spd=${String.format("%.1f", speed)}"
            // Skip normal decision tree — jump to post-processing
        } else when {
            // P1: W' critical
            wPrimePct < 0.30 -> {
                supportPct = SUPPORT_MAX
                torqueNm = TORQUE_MAX * 0.8
                launchLvl = 5.0
                reason = "W' ${(wPrimePct * 100).toInt()}% critico"
            }
            // P2: Zone breach imminent — only hard override if <3min
            tBreach < 3 -> {
                val urgency = max(0.0, 1.0 - tBreach / 3.0)
                supportPct = SUPPORT_MIN + (SUPPORT_MAX - SUPPORT_MIN) * 0.5 * (0.5 + urgency * 0.5)
                torqueNm = TORQUE_MIN + (TORQUE_MAX - TORQUE_MIN) * 0.4 * (0.5 + urgency * 0.5)
                launchLvl = 4.0
                reason = "Breach Z$targetZone em ${tBreach.toInt()}min"
            }
            // P3: Battery emergency
            batteryFactor <= 0.20 -> {
                supportPct = SUPPORT_MIN + 20
                torqueNm = TORQUE_MIN + 5
                launchLvl = 2.0
                reason = "Bateria emergencia"
            }
            // P4: Cardiac drift
            drift > 0.4 -> {
                val gapR = if (Ptotal > 0) Pgap / Ptotal else 0.5
                supportPct = (gapR * 300 * 0.8 * batEff).coerceIn(SUPPORT_MIN, SUPPORT_MAX)
                torqueNm = min(TORQUE_MAX * 0.7, Ftotal * (wheelCircumM / (2 * PI)))
                    .coerceIn(TORQUE_MIN, TORQUE_MAX)
                launchLvl = 3.0
                reason = "Drift ${String.format("%.1f", drift)}bpm/min"
            }
            // P5: Normal physics
            speedZone != "free" -> {
                // Support from power gap
                supportPct = if (Phuman > 10) {
                    ((Pgap / Phuman) * 100 * hrMod * fadeFactor * batEff * formMultiplier)
                        .coerceIn(SUPPORT_MIN, SUPPORT_MAX)
                } else if (Ptotal > 20) {
                    (200 * hrMod * batEff).coerceIn(SUPPORT_MIN, SUPPORT_MAX)
                } else SUPPORT_MIN

                // Torque from resistance
                torqueNm = if (Ftotal > 0) {
                    (Ftotal * (wheelCircumM / (2 * PI)) * hrMod * fadeFactor * batEff)
                        .coerceIn(TORQUE_MIN, TORQUE_MAX)
                } else TORQUE_MIN

                // Grinding uphill boost
                if (cadenceEff > 0 && cadenceEff < 50 && gradient > 3) {
                    torqueNm = min(TORQUE_MAX, torqueNm * 1.3)
                }
                // Descent: minimal support
                // NOTE: Giant Trance X E+ 2 (Shimano EP800) does NOT support regenerative
                // braking. Motor assist is one-way only. On descents, motor cuts to 0%
                // and the rider relies on mechanical brakes. Battery does not recharge.
                if (gradient < -3) supportPct = min(supportPct, SUPPORT_MIN + 20)

                // Launch
                launchLvl = when {
                    speed < 3 && gradient > 5 -> 7.0
                    speed < 3 && gradient > 2 -> 5.0
                    speed < 5                 -> 4.0
                    speed > 20                -> 1.0
                    else                      -> 3.0
                }
                reason = "gap=${Pgap.toInt()}W hr×${String.format("%.1f", hrMod)} bat×${String.format("%.2f", batteryFactor)}"
            }
            // P6: Motor off
            else -> {
                supportPct = SUPPORT_MIN; torqueNm = TORQUE_MIN; launchLvl = 1.0
                reason = "Motor off >25"
            }
        }

        // ── Gap #3: Motor temperature estimation + thermal throttle ──
        updateMotorTemp(supportPct)
        supportPct *= motorThermalFactor

        // ── Pre-adjustment ramp ──
        if (preAdjustCountdown in 1..5) {
            val blend = 1.0 - (preAdjustCountdown / 5.0)
            supportPct += (preAdjustSupport - supportPct) * blend
            torqueNm += (preAdjustTorque - torqueNm) * blend
        }
        if (preAdjustCountdown > 0) preAdjustCountdown--

        // ── EMA Smoothing ──
        val alpha = emaAlpha(speed)
        supportPct = prevSupport + alpha * (supportPct - prevSupport)
        torqueNm = prevTorque + alpha * (torqueNm - prevTorque)
        prevSupport = supportPct; prevTorque = torqueNm

        // Clamp
        supportPct = supportPct.coerceIn(SUPPORT_MIN, SUPPORT_MAX)
        torqueNm = torqueNm.coerceIn(TORQUE_MIN, TORQUE_MAX)
        launchLvl = launchLvl.coerceIn(LAUNCH_MIN, LAUNCH_MAX)

        // ── Wire encode + send to motor ──
        val wireS = toWire(supportPct, SUPPORT_MIN, SUPPORT_MAX)
        val wireT = toWire(torqueNm, TORQUE_MIN, TORQUE_MAX)
        val wireL = toWire(launchLvl, LAUNCH_MIN, LAUNCH_MAX)

        if (wireS != lastWireS || wireT != lastWireT || wireL != lastWireL) {
            bleManager.setAdvancedTuning(
                powerSupport = wireS, powerTorque = wireT, powerLaunch = wireL,
                label = "KROMI_CORE"
            )
            lastWireS = wireS; lastWireT = wireT; lastWireL = wireL
            Log.i(TAG, "→ MOTOR S=$wireS/15(${supportPct.roundToInt()}%) T=$wireT/15(${torqueNm.roundToInt()}Nm) L=$wireL/15 | $reason")
        }

        // ── Score for display ──
        val score = (((supportPct - SUPPORT_MIN) / (SUPPORT_MAX - SUPPORT_MIN)) * 100).roundToInt()

        // ── Detailed logging every 10s ──
        tickCount++
        val now2 = System.currentTimeMillis()
        if (now2 - lastDetailedLog >= 10_000) {
            lastDetailedLog = now2
            Log.i(TAG, "┌─ KROMI TICK #$tickCount ──────────────────────────────")
            Log.i(TAG, "│ INPUT  spd=${String.format("%.1f", speed)}km/h cad=$cadence pwr=$power hr=$hr gear=$gear grad=${String.format("%.1f", gradient)}% bat=$batterySoc%")
            Log.i(TAG, "│ PHYS   Fg=${Fg.roundToInt()}N Frr=${Frr.roundToInt()}N Faero=${Faero.roundToInt()}N Ftotal=${Ftotal.roundToInt()}N")
            Log.i(TAG, "│ POWER  Ptotal=${Ptotal.roundToInt()}W Phuman=${Phuman.roundToInt()}W Pgap=${Pgap.roundToInt()}W zone=$speedZone fade=${String.format("%.2f", fadeFactor)}")
            Log.i(TAG, "│ PHYSIO hrZ=$zone margin=$margin drift=${String.format("%.2f", drift)}bpm/min tBreach=${if (tBreach < 999) "${tBreach.roundToInt()}min" else "safe"} hrMod=${String.format("%.2f", hrMod)}")
            Log.i(TAG, "│ W'BAL  ${(wPrimePct * 100).roundToInt()}% (${wPrimeBalance.roundToInt()}/${wPrimeTotal.roundToInt()}J) CP_eff=${cpEff.roundToInt()}W glyc×${String.format("%.2f", glycogenCpFactor)}")
            Log.i(TAG, "│ PARAMS crr=${String.format("%.4f", crr)} wind=${String.format("%.1f", windComponent)}m/s rho=${String.format("%.3f", airDensity)} bat×${String.format("%.2f", batteryFactor)}→${String.format("%.2f", batEff)} route=${if (routeRemainingKm > 0) "${String.format("%.1f", routeRemainingKm)}km" else "none"} form×${String.format("%.2f", formMultiplier)}")
            Log.i(TAG, "│ OUT    S=${supportPct.roundToInt()}%(w$wireS) T=${torqueNm.roundToInt()}Nm(w$wireT) L=${launchLvl.roundToInt()}(w$wireL) score=$score")
            Log.i(TAG, "│ REASON $reason")
            if (preAdjustCountdown > 0) Log.i(TAG, "│ PREADJ support=${preAdjustSupport.roundToInt()} torque=${preAdjustTorque.roundToInt()} in ${preAdjustCountdown}s")
            Log.i(TAG, "└──────────────────────────────────────────────")

            // Also forward detailed log to PWA via dlog
            bleManager.onDataReceived?.invoke(JSONObject().apply {
                put("type", "pwaLog")
                put("msg", "[KROMI_CORE] S=${supportPct.roundToInt()}%(w$wireS) T=${torqueNm.roundToInt()}Nm(w$wireT) L=${launchLvl.roundToInt()}(w$wireL) | zone=$speedZone grad=${String.format("%.1f", gradient)} spd=${String.format("%.0f", speed)} hr=$hr W'=${(wPrimePct * 100).roundToInt()}% | $reason")
            })
        }

        // ── Telemetry to WebView (for UI display) ──
        onTelemetry?.invoke(JSONObject().apply {
            put("type", "kromiState")
            put("support", supportPct.roundToInt())
            put("torque", torqueNm.roundToInt())
            put("launch", launchLvl.roundToInt())
            put("score", score)
            put("speedZone", speedZone)
            put("wPrimePct", (wPrimePct * 100).roundToInt())
            put("wPrimeState", when { wPrimePct < 0.30 -> "critical"; wPrimePct < 0.70 -> "amber"; else -> "green" })
            put("hrZone", zone)
            put("hrMargin", margin)
            put("drift", String.format("%.2f", drift))
            put("tBreach", if (tBreach < 999) tBreach.roundToInt() else -1)
            put("hrMod", String.format("%.2f", hrMod))
            put("Fg", Fg.roundToInt())
            put("Frr", Frr.roundToInt())
            put("Faero", Faero.roundToInt())
            put("Ptotal", Ptotal.roundToInt())
            put("Phuman", Phuman.roundToInt())
            put("Pgap", Pgap.roundToInt())
            put("reason", reason)
            put("wireS", wireS); put("wireT", wireT); put("wireL", wireL)
            put("motorTemp", String.format("%.1f", estimatedMotorTemp))
            put("motorTempSource", if (actualMotorTemp != null) "ble" else "estimated")
            put("motorThermalFactor", String.format("%.2f", motorThermalFactor))
            put("brakingDetected", brakingDetected)
            put("paramVersion", lastParamVersion)
            put("paramStaleMs", if (lastParamTimestamp > 0) System.currentTimeMillis() - lastParamTimestamp else -1)
        })
    }

    // ═════════════════════════════════════════════════════════
    // SAFETY HELPERS
    // ═════════════════════════════════════════════════════════

    /** Gap #3 + Gap #6: Motor temperature — prefer actual BLE temp, fallback to heuristic */
    private fun updateMotorTemp(supportPct: Double) {
        val temp = actualMotorTemp
        if (temp != null) {
            // Gap #6: Use actual BLE motor temperature
            estimatedMotorTemp = temp
        } else {
            // Fallback to heuristic estimation (existing load-based logic)
            val supportRatio = supportPct / SUPPORT_MAX
            if (supportRatio > 0.7) {
                motorLoadSeconds++
                motorCoolSeconds = 0
                estimatedMotorTemp += 0.5 * supportRatio
            } else if (supportRatio < 0.3) {
                motorCoolSeconds++
                motorLoadSeconds = 0
                estimatedMotorTemp = maxOf(25.0, estimatedMotorTemp - 0.2)
            }
        }

        // Gap #6: Gradual throttle curve instead of hard cutoffs
        motorThermalFactor = when {
            estimatedMotorTemp > 80 -> 0.5
            estimatedMotorTemp > 70 -> 0.5 + (80 - estimatedMotorTemp) * 0.025  // 0.5-0.75 linear
            estimatedMotorTemp > 60 -> 0.75 + (70 - estimatedMotorTemp) * 0.025 // 0.75-1.0 linear
            else -> 1.0
        }

        if (estimatedMotorTemp > 70) {
            Log.w(TAG, "Motor temp ${String.format("%.1f", estimatedMotorTemp)}°C (${if (actualMotorTemp != null) "BLE" else "est"}) — thermal factor=${String.format("%.2f", motorThermalFactor)}")
        }
    }

    /** Gap #1: Check if PWA params are stale (no update in >60s) */
    private fun checkParamFreshness() {
        val elapsed = System.currentTimeMillis() - lastParamTimestamp
        if (lastParamTimestamp > 0 && elapsed > 60_000) {
            Log.w(TAG, "PWA params stale for ${elapsed / 1000}s — using cached values with reduced confidence")
            // Don't crash — just log warning and continue with last good values
        }
    }

    /** Gap #4: Detect braking via cadence=0 while speed > 5 km/h */
    private fun detectBraking() {
        brakingDetected = cadence == 0 && speed > 5.0
        if (brakingDetected) {
            Log.d(TAG, "Braking detected: cadence=0, speed=$speed — cutting assist")
        }
    }

    /** Gap #6: Cross-validate sensors for consistency */
    private fun validateSensorConsistency() {
        // Speed vs cadence: if cadence > 0 and speed = 0 for > 5s, likely sensor error
        if (cadence > 30 && speed < 1.0) {
            sensorInconsistencyCount++
            if (sensorInconsistencyCount > 5) {
                Log.w(TAG, "Sensor inconsistency: cadence=$cadence but speed=$speed — using speed only")
                cadence = 0
            }
        } else {
            sensorInconsistencyCount = 0
        }

        // Power sanity: if power > 0 but cadence = 0 and speed = 0, ignore power
        if (power > 50 && cadence == 0 && speed < 1.0) {
            Log.w(TAG, "Ghost power: power=$power but no movement — zeroing")
            power = 0
        }

        // Gradient sanity: rate-of-change check
        if (abs(gradient - lastGradient) > 10.0) {
            Log.w(TAG, "Gradient spike: ${lastGradient}% → ${gradient}% — smoothing")
            gradient = lastGradient + (gradient - lastGradient) * 0.3
        }
        lastGradient = gradient
    }

    // ═════════════════════════════════════════════════════════
    // PHYSICS HELPERS
    // ═════════════════════════════════════════════════════════

    private fun estimateHumanPower(cadenceEff: Double, gearRatio: Double): Double {
        // Prefer power meter
        if (power > 0 && power < 600) return power.toDouble()
        // Filter sensor noise: need meaningful speed AND cadence
        if (speed < 5 || cadenceEff < 20) return 0.0
        // Consistency: expected speed from cadence×gear vs actual (reject if >2x mismatch)
        val expectedSpeedKmh = cadenceEff * gearRatio * wheelCircumM * 60.0 / 1000.0
        if (expectedSpeedKmh > 0 && (speed / expectedSpeedKmh > 2.0 || speed / expectedSpeedKmh < 0.5)) return 0.0

        val riderKg = totalMass - 24.0
        val cadFactor = when { cadenceEff < 60 -> 1.2; cadenceEff < 80 -> 1.0; else -> 0.85 }
        val pedalTorque = riderKg * 0.015 * cadFactor * gearRatio
        return pedalTorque * (2 * PI * cadenceEff / 60.0)
    }

    private fun currentHRZone(): Int {
        if (hr <= 0) return 0
        for (i in hrZoneBounds.indices.reversed()) {
            if (hr >= hrZoneBounds[i]) return (i + 2).coerceAtMost(5) // Zone 2-5 (above bound i → zone i+2, capped at 5)
        }
        return 1 // Below zone 1 threshold
    }

    /** Cardiac drift: HR change per minute at roughly constant effort */
    private fun computeDrift(): Double {
        if (hrHistory.size < 24) return 0.0 // need ~2min of data (sampled every 5s)
        val now = System.currentTimeMillis()
        val target = now - 10 * 60 * 1000L
        val old = hrHistory.firstOrNull { it.ts >= target } ?: hrHistory.first()
        val elapsedMin = (now - old.ts) / 60000.0
        if (elapsedMin < 2) return 0.0

        // Only at constant effort
        val recent = hrHistory.takeLast(6) // last ~30s
        val avgGradNow = recent.map { it.gradient }.average()
        val avgSpeedNow = recent.map { it.speed }.average()
        if (abs(avgGradNow - old.gradient) > 3 || abs(avgSpeedNow - old.speed) > 5) return 0.0

        val avgHrNow = recent.map { it.hr.toDouble() }.average()
        return (avgHrNow - old.hr) / elapsedMin
    }

    /** W' Balance — Skiba differential model */
    private fun updateWPrime(Phuman: Double, cp: Double, dt: Double) {
        if (Phuman > cp) {
            wPrimeBalance = max(0.0, wPrimeBalance - (Phuman - cp) * dt)
        } else {
            val recovery = (wPrimeTotal - wPrimeBalance) * (1 - exp(-dt / tau))
            wPrimeBalance = min(wPrimeTotal, wPrimeBalance + recovery)
        }
    }

    private fun toWire(value: Double, min: Double, max: Double): Int {
        val clamped = value.coerceIn(min, max)
        return ((clamped - min) / (max - min) * 15).roundToInt()
    }
}
