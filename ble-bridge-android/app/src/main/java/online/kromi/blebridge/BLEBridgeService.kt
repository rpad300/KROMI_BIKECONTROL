package online.kromi.blebridge

import android.app.*
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Build
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject

class BLEBridgeService : Service() {

    companion object {
        const val TAG = "BLEBridgeService"
        const val CHANNEL_ID = "ble_bridge_channel"
        const val NOTIFICATION_ID = 1
        const val WS_PORT = 8765

        var instance: BLEBridgeService? = null
    }

    lateinit var bleManager: BLEManager
    lateinit var sensorManager: SensorManager
    lateinit var shimanoProtocol: ShimanoProtocol
    lateinit var accessoryService: AccessoryService
    lateinit var boschManager: BoschBikeManager
    lateinit var specializedManager: SpecializedBikeManager
    lateinit var shimanoMotorManager: ShimanoMotorManager
    var wsServer: BridgeWebSocketServer? = null
    var phoneSensorService: PhoneSensorService? = null
    lateinit var kromiCore: KromiCore

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()

        // Start foreground FIRST to avoid ForegroundServiceDidNotStartInTimeException
        startForeground(NOTIFICATION_ID, buildNotification("Initializing..."))

        bleManager = BLEManager(this)
        kromiCore = KromiCore(bleManager)

        // Forward BLE data to WebSocket AND feed KromiCore sensor inputs
        bleManager.onDataReceived = { json ->
            wsServer?.broadcastData(json)
            feedKromiCore(json)
        }

        // KromiCore telemetry → WebSocket → PWA UI
        kromiCore.onTelemetry = { telemetry ->
            wsServer?.broadcastData(telemetry)
        }

        sensorManager = SensorManager(this)
        sensorManager.onData = { json ->
            wsServer?.broadcastData(json)
        }

        shimanoProtocol = ShimanoProtocol(this)
        shimanoProtocol.onData = { json ->
            wsServer?.broadcastData(json)
        }

        accessoryService = AccessoryService(this)
        accessoryService.onData = { json ->
            wsServer?.broadcastData(json)
        }

        boschManager = BoschBikeManager(this)
        boschManager.onData = { json ->
            wsServer?.broadcastData(json)
            feedKromiCore(json)
        }

        specializedManager = SpecializedBikeManager(this)
        specializedManager.onData = { json ->
            wsServer?.broadcastData(json)
            feedKromiCore(json)
        }

        shimanoMotorManager = ShimanoMotorManager(this)
        shimanoMotorManager.onData = { json ->
            wsServer?.broadcastData(json)
            feedKromiCore(json)
        }

        // Start phone sensors and forward data to WebSocket + KromiCore
        phoneSensorService = PhoneSensorService(this) { sensorJson ->
            wsServer?.broadcastData(sensorJson)
            feedPhoneSensorToKromiCore(sensorJson)
        }
        phoneSensorService?.start()
        bleManager.onStatusChanged = { status ->
            updateNotification(status)
            // Broadcast status to activity (package-scoped for security)
            val intent = Intent("online.kromi.blebridge.STATUS")
            intent.putExtra("status", status)
            intent.setPackage(packageName)
            sendBroadcast(intent)
        }

        // Start WebSocket server — pass app version for PWA compatibility check
        val appVer = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "?" } catch (_: Exception) { "?" }
        wsServer = BridgeWebSocketServer(WS_PORT, { command ->
            handleCommand(command)
        }, appVer)
        wsServer?.onClientConnected = {
            // Re-emit current Di2 state so late-connecting PWA shows correct status
            if (shimanoProtocol.isConnected) {
                Handler(Looper.getMainLooper()).postDelayed({
                    shimanoProtocol.reEmitState()
                }, 500)
            }
        }
        try {
            wsServer?.start()
            Log.i(TAG, "WebSocket server started on port $WS_PORT")
        } catch (e: Exception) {
            Log.e(TAG, "WebSocket server failed to start on port $WS_PORT", e)
        }

        updateNotification("Ready — waiting for connection")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        kromiCore.stop()
        phoneSensorService?.stop()
        shimanoProtocol.destroy()
        accessoryService.destroy()
        boschManager.destroy()
        specializedManager.destroy()
        shimanoMotorManager.destroy()
        sensorManager.destroy()
        try { wsServer?.stop(1000) } catch (_: Exception) {}  // timeout 1s, don't block
        bleManager.disconnect()
        instance = null
        super.onDestroy()
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun handleCommand(json: JSONObject) {
        when (json.optString("type")) {
            "connect" -> {
                // WebSocket connect: scan and auto-connect to first bike-like device
                if (bleManager.isConnected) {
                    Log.i(TAG, "WS connect: already connected")
                    return
                }
                if (bleManager.isScanning) {
                    Log.i(TAG, "WS connect: scan already in progress (device picker?)")
                    return
                }
                bleManager.startScan(
                    onFound = { device, _, uuids ->
                        val name = device.name ?: ""
                        // Bike MUST have Giant identifier (name or GEV service).
                        // CSC (1816) or Power (1818) alone are NOT enough — could be external sensor.
                        val isGiant = name.contains("GBHA", true) || name.contains("Giant", true) || uuids.contains("F0BA", true)
                        val isBike = isGiant && (uuids.contains("1816") || uuids.contains("1818") || uuids.contains("F0BA", true))
                        if (isBike && !bleManager.isConnected) {
                            bleManager.stopScan()
                            bleManager.connectToDevice(device)
                        }
                    },
                    onDone = {}
                )
            }

            // === PWA-driven scan: send each found device to PWA for user selection ===
            "scan" -> {
                if (bleManager.isScanning) {
                    Log.i(TAG, "WS scan: already scanning")
                    return
                }
                if (bleManager.isConnected) {
                    bleManager.disconnect()
                    Handler(Looper.getMainLooper()).postDelayed({
                        Log.i(TAG, "WS scan: starting PWA-driven scan after disconnect delay")
                        startPwaScan()
                    }, 500)
                    return
                }
                Log.i(TAG, "WS scan: starting PWA-driven scan")
                startPwaScan()
            }

            "stopScan" -> {
                bleManager.stopScan()
                val done = JSONObject().apply { put("type", "scanDone") }
                wsServer?.broadcastData(done)
            }

            // === List Android bonded (paired) BLE devices ===
            "listBonded" -> {
                val adapter = android.bluetooth.BluetoothAdapter.getDefaultAdapter()
                val bonded = adapter?.bondedDevices ?: emptySet()
                val arr = org.json.JSONArray()
                for (device in bonded) {
                    val d = JSONObject().apply {
                        put("name", device.name ?: "Unknown")
                        put("address", device.address)
                        put("type", device.type) // 1=Classic, 2=LE, 3=Dual
                        put("uuids", (device.uuids ?: emptyArray()).joinToString(",") { it.uuid.toString() })
                    }
                    arr.put(d)
                }
                val msg = JSONObject().apply {
                    put("type", "bondedList")
                    put("devices", arr)
                }
                wsServer?.broadcastData(msg)
                Log.i(TAG, "listBonded: ${bonded.size} devices")
            }

            // === Connect to specific device by MAC address (PWA device picker) ===
            "connectDevice" -> {
                val address = json.optString("address", "")
                if (address.isEmpty()) {
                    Log.e(TAG, "connectDevice: missing address")
                    return
                }
                if (bleManager.isScanning) bleManager.stopScan()
                if (bleManager.isConnected) {
                    bleManager.disconnect()
                    Handler(Looper.getMainLooper()).postDelayed({
                        connectToAddress(address)
                    }, 500)
                    return
                }
                connectToAddress(address)
            }

            // === External sensor management (hr, power, di2, sram, light, radar) ===
            "scanSensor" -> {
                val sensor = json.optString("sensor", "")
                when (sensor) {
                    "di2" -> {
                        shimanoProtocol.excludeAddress = bleManager.connectedAddress
                        shimanoProtocol.scan()
                    }
                    "light", "radar" -> {
                        accessoryService.excludeAddress = bleManager.connectedAddress
                        accessoryService.scanFor(sensor)
                    }
                    else -> {
                        sensorManager.excludeAddress = bleManager.connectedAddress
                        sensorManager.scanFor(sensor)
                    }
                }
            }

            "connectSensor" -> {
                val sensor = json.optString("sensor", "")
                val address = json.optString("address", "")
                when (sensor) {
                    "di2" -> {
                        if (address.isNotEmpty()) shimanoProtocol.connect(address)
                        else { shimanoProtocol.excludeAddress = bleManager.connectedAddress; shimanoProtocol.scan() }
                    }
                    "light", "radar" -> {
                        accessoryService.excludeAddress = bleManager.connectedAddress
                        if (address.isNotEmpty()) accessoryService.connectAccessory(sensor, address)
                        else accessoryService.scanFor(sensor)
                    }
                    else -> {
                        sensorManager.excludeAddress = bleManager.connectedAddress
                        if (address.isNotEmpty()) sensorManager.connectSensor(sensor, address)
                        else sensorManager.scanFor(sensor)
                    }
                }
            }

            "disconnectSensor" -> {
                val sensor = json.optString("sensor", "")
                when (sensor) {
                    "light", "radar" -> accessoryService.disconnectAccessory(sensor)
                    else -> sensorManager.disconnectSensor(sensor)
                }
            }

            // === Light accessory commands ===
            "lightSetMode" -> {
                val mode = json.optInt("mode", 0)
                accessoryService.setLightMode(mode)
            }
            "lightReadBattery" -> {
                accessoryService.readLightBattery()
            }
            "lightReadMode" -> {
                accessoryService.readLightMode()
            }

            // === Multi-brand bike connection ===
            "connectBosch" -> {
                val address = json.optString("address", "")
                if (address.isNotEmpty()) {
                    boschManager.connect(address)
                } else {
                    boschManager.scan { device ->
                        boschManager.connect(device.address)
                    }
                }
            }
            "connectSpecialized" -> {
                val address = json.optString("address", "")
                if (address.isNotEmpty()) {
                    specializedManager.connect(address)
                } else {
                    specializedManager.scan { device ->
                        specializedManager.connect(device.address)
                    }
                }
            }
            "disconnectBosch" -> boschManager.disconnect()
            "disconnectSpecialized" -> specializedManager.disconnect()
            "boschAssist" -> boschManager.setAssistMode(json.optInt("mode", 1))
            "specializedAssist" -> specializedManager.setAssistMode(json.optInt("mode", 0))
            "specializedLight" -> specializedManager.toggleLight(json.optBoolean("on", true))

            // === Shimano STEPS motor (EP800/EP600/E8000) ===
            "connectShimanoMotor" -> {
                val address = json.optString("address", "")
                if (address.isNotEmpty()) shimanoMotorManager.connect(address)
                else shimanoMotorManager.scan { device -> shimanoMotorManager.connect(device.address) }
            }
            "disconnectShimanoMotor" -> shimanoMotorManager.disconnect()
            "shimanoMotorAssist" -> shimanoMotorManager.setAssistMode(json.optInt("mode", 1))
            "shimanoMotorLight" -> shimanoMotorManager.setLight(json.optBoolean("on", true))
            "shimanoMotorStatus" -> shimanoMotorManager.requestStatus()

            "readBattery" -> bleManager.readBatteryDetails()
            "disconnect" -> bleManager.disconnect()
            "assistMode" -> bleManager.writeAssistMode(json.optInt("value", 1))
            "assistUp" -> {
                // Increment current assist mode
                // The PWA should track current mode, but we can handle simple up/down
                Log.i(TAG, "Assist up command received")
            }
            "assistDown" -> {
                Log.i(TAG, "Assist down command received")
            }
            "protoGet" -> bleManager.writeProtoGet(json.optString("module", "bikeInfo"))
            "testSG" -> bleManager.testSGWrite()
            "startSession" -> bleManager.startGEVSession()

            // === Motor tuning control (SET_TUNING) ===
            "setTuning" -> {
                // PWA sends: {type:"setTuning", power:0, sport:1, active:2, tour:1, eco:2}
                // Levels 0-2 (0=max watts, 2=min watts)
                val p = json.optInt("power", -1)
                val s = json.optInt("sport", -1)
                val a = json.optInt("active", -1)
                val t = json.optInt("tour", -1)
                val e = json.optInt("eco", -1)
                if (p < 0 || s < 0 || a < 0 || t < 0 || e < 0) {
                    Log.e(TAG, "setTuning: missing fields (need power,sport,active,tour,eco)")
                    return
                }
                Log.i(TAG, "WS setTuning: P=$p S=$s A=$a T=$t E=$e")
                bleManager.setTuningLevels(p, s, a, t, e, "WS_TUNE")
            }
            "setTuningPower" -> {
                // Quick command: only change POWER mode level, keep others at current
                // PWA sends: {type:"setTuningPower", level:0}
                val lv = json.optInt("level", 0)
                Log.i(TAG, "WS setTuningPower: level=$lv")
                // Set POWER to requested, keep all others at level 1 (medium)
                bleManager.setTuningLevels(lv, 1, 1, 1, 1, "WS_TUNE_PWR")
            }
            "readTuning" -> {
                Log.i(TAG, "WS readTuning")
                val plain = ByteArray(16).also { it[0] = 0x2C; it[1] = 0x00 }
                bleManager.sendEncryptedCommand(plain, 0, "WS_READ_TUNE")
            }
            "advancedTuning" -> {
                // PWA sends: {type:"advancedTuning", powerSupport:12, powerTorque:10, powerLaunch:8, ...}
                bleManager.setAdvancedTuning(
                    powerSupport = json.optInt("powerSupport", -1),
                    powerTorque = json.optInt("powerTorque", -1),
                    powerLaunch = json.optInt("powerLaunch", -1),
                    sportSupport = json.optInt("sportSupport", -1),
                    sportTorque = json.optInt("sportTorque", -1),
                    sportLaunch = json.optInt("sportLaunch", -1),
                    activeSupport = json.optInt("activeSupport", -1),
                    activeTorque = json.optInt("activeTorque", -1),
                    activeLaunch = json.optInt("activeLaunch", -1),
                    tourSupport = json.optInt("tourSupport", -1),
                    tourTorque = json.optInt("tourTorque", -1),
                    tourLaunch = json.optInt("tourLaunch", -1),
                    ecoSupport = json.optInt("ecoSupport", -1),
                    ecoTorque = json.optInt("ecoTorque", -1),
                    ecoLaunch = json.optInt("ecoLaunch", -1),
                )
            }
            // === KromiCore emergency disarm ===
            "disarm" -> {
                kromiCore.disarm()
                wsServer?.broadcastData(JSONObject().apply {
                    put("type", "motorDisarmed")
                    put("timestamp", System.currentTimeMillis())
                })
            }

            // === KromiCore params from PWA (Layers 3-7 cached values) ===
            "kromiParams" -> {
                kromiCore.updateParams(json)
            }

            "tuneMax" -> bleManager.tuningMax()
            "tuneMin" -> bleManager.tuningMin()
            "tuneRestore" -> bleManager.tuningRestore()
            "pwaLog" -> {
                val msg = json.optString("msg", "")
                Log.i("PWA", msg)
                // Echo to UI log via onDataReceived
                bleManager.onDataReceived?.invoke(JSONObject()
                    .put("type", "pwaLog").put("msg", msg))
            }

            // === Shimano STEPS / Di2 ===
            "shimanoScan" -> {
                // Don't scan if already connected — scan disconnects the active connection
                if (shimanoProtocol.isConnected) {
                    Log.i(TAG, "shimanoScan ignored — already connected, re-emitting state")
                    shimanoProtocol.reEmitState()
                } else {
                    shimanoProtocol.excludeAddress = bleManager.connectedAddress
                    shimanoProtocol.scan()
                }
            }
            "shimanoConnect" -> {
                val address = json.optString("address", "")
                if (address.isNotEmpty()) {
                    shimanoProtocol.connect(address)
                } else {
                    shimanoProtocol.scan() // auto-find + connect
                }
            }
            "shimanoDisconnect" -> {
                shimanoProtocol.disconnect()
            }
            "shimanoBattery" -> {
                shimanoProtocol.readBattery()
            }
            "shimanoGearState" -> {
                shimanoProtocol.readGearState()
            }
            "shimanoGearStats" -> {
                val stats = shimanoProtocol.getGearStats()
                stats.put("type", "shimanoGearStats")
                wsServer?.broadcastData(stats)
            }
            "shimanoResetStats" -> {
                shimanoProtocol.resetStats()
            }
            "shimanoPceCommand" -> {
                val ctrl = json.optInt("controlInfo", 0).toByte()
                val hexData = json.optString("data", "")
                val data = hexData.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
                shimanoProtocol.sendPceCommand(ctrl, data)
            }
        }
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun startPwaScan() {
        bleManager.startScan(
            onFound = { device, rssi, uuids ->
                val name = device.name ?: "(unnamed)"
                val tags = mutableListOf<String>()
                val isGiantDevice = name.contains("GBHA", true) || name.contains("Giant", true) || uuids.contains("F0BA", true)
                if (isGiantDevice) tags.add("GIANT")
                if (uuids.contains("F0BA", true)) tags.add("GEV")
                if (isGiantDevice && (uuids.contains("1816") || uuids.contains("1818"))) tags.add("BIKE")

                val isBosch = uuids.contains("424F5343", true) || uuids.contains("DC435FBE", true) ||
                    name.contains("Nyon", true) || name.contains("Kiox", true) || name.contains("Bosch", true)
                if (isBosch) { tags.add("BOSCH"); tags.add("BIKE") }

                val isSpecialized = uuids.contains("EAA2-11E9", true) || uuids.contains("FE02", true) ||
                    uuids.contains("C0B1", true) || name.contains("Turbo", true) || name.contains("Levo", true) ||
                    name.contains("Creo", true) || name.contains("Vado", true) || name.contains("Como", true)
                if (isSpecialized) { tags.add("SPECIALIZED"); tags.add("BIKE") }

                val isShimanoMotor = uuids.contains("18EF", true) ||
                    name.startsWith("EP", true) || name.startsWith("E8", true) ||
                    name.startsWith("E7", true) || name.startsWith("E6", true) ||
                    name.startsWith("E5", true) || name.contains("STEPS", true)
                if (isShimanoMotor && !tags.contains("DI2")) { tags.add("SHIMANO_STEPS"); tags.add("BIKE") }

                val isSpecTurbo = uuids.contains("3731-3032-494D", true) || uuids.contains("4B49-4E4F-5254", true)
                if (isSpecTurbo) { tags.add("SPECIALIZED"); tags.add("TURBO_CONNECT"); tags.add("BIKE") }

                val isFazua = name.contains("Avinox", true) || name.contains("Fazua", true) || name.contains("Evation", true)
                if (isFazua) { tags.add("FAZUA"); tags.add("BIKE") }

                val isYamaha = name.contains("Yamaha", true) || name.startsWith("PW-", true) || name.startsWith("PWSeries", true)
                if (isYamaha) { tags.add("YAMAHA"); tags.add("BIKE") }
                if (!isGiantDevice && uuids.contains("1816")) tags.add("CAD")
                if (uuids.contains("180D", true)) tags.add("HR")
                if (uuids.contains("1818", true) && !tags.contains("GIANT")) tags.add("POWER")
                if (name.contains("SRAM", true) || uuids.contains("4D50", true)) tags.add("SRAM")
                if (name.contains("Di2", true) || name.contains("SHIMANO", true)
                    || uuids.contains("5348-494D-414E", true)
                    || uuids.contains("18FF", true)
                    || uuids.contains("18EF", true))
                    tags.add("DI2")
                if (uuids.contains("DCCA8E", true) || uuids.contains("dcca8e", true)) {
                    val isRadar = name.lowercase().contains("radar")
                    if (isRadar) tags.add("RADAR") else tags.add("LIGHT")
                }
                if (name.startsWith("VS", true) || name.startsWith("LR", true)) tags.add("LIGHT")

                val isGarminAccessory = uuids.contains("6A4E", true) || uuids.contains("16AA8022", true)
                if (isGarminAccessory) {
                    tags.add("GARMIN")
                    if (uuids.contains("6A4E8022", true) || name.startsWith("RTL", true) ||
                        (name.contains("Varia", true) && (name.contains("R", true) || name.contains("Radar", true)))) {
                        tags.add("RADAR")
                        tags.add("LIGHT")
                    } else {
                        tags.add("LIGHT")
                    }
                }
                if (name.startsWith("HL", true) || name.startsWith("UT", true)) tags.add("LIGHT")

                val result = JSONObject().apply {
                    put("type", "scanResult")
                    put("name", name)
                    put("address", device.address)
                    put("rssi", rssi)
                    put("uuids", uuids)
                    put("tags", org.json.JSONArray(tags))
                }
                wsServer?.broadcastData(result)
            },
            onDone = {
                val done = JSONObject().apply { put("type", "scanDone") }
                wsServer?.broadcastData(done)
                Log.i(TAG, "WS scan: complete")
            }
        )
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun connectToAddress(address: String) {
        Log.i(TAG, "WS connectDevice: $address")
        val adapter = android.bluetooth.BluetoothAdapter.getDefaultAdapter()
        val device = adapter?.getRemoteDevice(address)
        if (device != null) {
            bleManager.connectToDevice(device)
        } else {
            Log.e(TAG, "connectDevice: invalid address $address")
            val err = JSONObject().apply {
                put("type", "connectFailed")
                put("reason", "Invalid address: $address")
            }
            wsServer?.broadcastData(err)
        }
    }

    /**
     * Feed BLE sensor data to KromiCore for native motor control.
     * Called on every onDataReceived from BLEManager.
     * KromiCore extracts what it needs — speed, cadence, power, HR, gear, battery, assist mode.
     */
    private fun feedKromiCore(json: JSONObject) {
        try {
            val type = json.optString("type")
            when (type) {
                "speed"     -> {
                    val spd = json.optDouble("value", 0.0)
                    kromiCore.onSpeed(spd)
                    phoneSensorService?.setCurrentSpeed(spd.toFloat())
                }
                "cadence"   -> {
                    // Handle both internal (motor crank) and external cadence sensors
                    val rpm = json.optInt("value", 0)
                    val source = json.optString("source", "")
                    if (source == "external" && rpm > 0) {
                        Log.d(TAG, "feedKromiCore EXT_CADENCE: $rpm rpm")
                    }
                    kromiCore.onCadence(rpm)
                }
                "power"     -> kromiCore.onPower(json.optInt("value", 0))
                "hr"        -> kromiCore.onHR(json.optInt("bpm", 0))
                "battery"   -> kromiCore.onBattery(json.optInt("value", 0))
                "sgRiding"  -> {
                    val spd = json.optDouble("speed", 0.0)
                    val cad = json.optInt("cadence", 0)
                    val mode = json.optInt("assistMode", -1)
                    Log.d(TAG, "feedKromiCore sgRiding: spd=${"%.1f".format(spd)} cad=$cad mode=$mode")
                    kromiCore.onSpeed(spd)
                    phoneSensorService?.setCurrentSpeed(spd.toFloat())
                    if (json.has("cadence")) kromiCore.onCadence(cad)
                    if (json.has("assistMode")) kromiCore.onAssistMode(mode)
                }
                "gevRiding" -> {
                    if (json.has("speed")) kromiCore.onSpeed(json.optDouble("speed", 0.0))
                }
                "sgAssist"  -> {
                    val mode = json.optInt("mode", 0)
                    Log.d(TAG, "feedKromiCore sgAssist: mode=$mode (${listOf("OFF","ECO","TOUR","ACTV","SPRT","PWR","SMART").getOrElse(mode) { "?" }})")
                    kromiCore.onAssistMode(mode)
                }
                "shimanoGear" -> {
                    val gear = json.optInt("gear", 0)
                    Log.d(TAG, "feedKromiCore shimanoGear: gear=$gear")
                    kromiCore.onGear(gear)
                }
                // NOTE: duplicate "cadence" case merged into the first "cadence" branch above
                "gradient"  -> {
                    kromiCore.onGradient(json.optDouble("value", 0.0))
                }
                "assistMode" -> {
                    // GEV motor reports assist mode (0x15 response)
                    val mode = json.optInt("value", 0)
                    Log.d(TAG, "feedKromiCore assistMode(GEV 0x15): mode=$mode (${listOf("OFF","ECO","TOUR","ACTV","SPRT","PWR","SMART").getOrElse(mode) { "?" }})")
                    kromiCore.onAssistMode(mode)
                }
                "fc23cmd41" -> {
                    // FC23 telemetry stream — assist mode (primary source, every 2s)
                    val mode = json.optInt("wireMode", 0)
                    Log.d(TAG, "feedKromiCore assistMode(FC23 0x41): mode=$mode (${listOf("OFF","ECO","TOUR","ACTV","SPRT","PWR","SMART").getOrElse(mode) { "?" }})")
                    kromiCore.onAssistMode(mode)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "feedKromiCore error: ${e.message}")
        }
    }

    /**
     * Feed phone sensor data into KromiCore for motor control decisions.
     * Also forwards speed back to PhoneSensorService for hike-a-bike detection.
     */
    private fun feedPhoneSensorToKromiCore(json: JSONObject) {
        try {
            when (json.optString("type")) {
                // Gravity-based gradient estimate (works without GPS/barometer)
                "gravity_gradient" -> {
                    val gradient = json.optDouble("gradient_pct", 0.0)
                    val confidence = json.optDouble("confidence", 0.0)
                    // Only use gravity gradient if confidence reasonable and no better source
                    if (confidence >= 0.3) {
                        kromiCore.onGradient(gradient)
                    }
                }
                // Tilt-compensated heading (rotation vector, works on handlebar mount)
                "orientation" -> {
                    // Heading is used by lookahead in PWA, not directly by KromiCore
                    // but available if needed for future use
                }
                // Crash detection — disarm motor immediately
                "crash_detected" -> {
                    val impactG = json.optDouble("impact_g", 0.0)
                    Log.e(TAG, "CRASH DETECTED: ${impactG}g impact — disarming motor")
                    kromiCore.disarm()
                    wsServer?.broadcastData(JSONObject().apply {
                        put("type", "motorDisarmed")
                        put("reason", "crash_detected")
                        put("impact_g", impactG)
                        put("timestamp", System.currentTimeMillis())
                    })
                }
                // Auto-pause: rider stopped → reduce motor to minimum
                "ride_stationary" -> {
                    Log.i(TAG, "Rider stationary — auto-pause")
                }
                // Auto-resume: rider moving again
                "ride_resumed" -> {
                    Log.i(TAG, "Rider resumed — auto-resume")
                }
                // Hike-a-bike detection: disable motor, rider is walking
                "step_counter" -> {
                    val hiking = json.optBoolean("hiking", false)
                    if (hiking) {
                        Log.i(TAG, "Hike-a-bike detected — motor assist not needed")
                    }
                }
                // Speed update to PhoneSensorService for hike-a-bike detection
                "speed" -> {
                    phoneSensorService?.setCurrentSpeed(json.optDouble("value", 0.0).toFloat())
                }
            }
        } catch (e: Exception) {
            // Don't crash on sensor data errors
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "BLE Bridge",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Giant eBike BLE connection bridge"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val intent = Intent(this, WebViewActivity::class.java)
        val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("BikeControl BLE Bridge")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pending)
            .setOngoing(true)
            .build()
    }

    fun updateNotification(text: String) {
        val notification = buildNotification(text)
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, notification)
    }
}
