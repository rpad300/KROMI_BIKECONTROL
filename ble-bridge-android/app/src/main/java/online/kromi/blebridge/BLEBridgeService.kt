package online.kromi.blebridge

import android.app.*
import android.content.Intent
import android.os.IBinder
import android.os.Build
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
    var wsServer: BridgeWebSocketServer? = null
    var phoneSensorService: PhoneSensorService? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()

        bleManager = BLEManager(this)
        bleManager.onDataReceived = { json ->
            wsServer?.broadcastData(json)
        }

        sensorManager = SensorManager(this)
        sensorManager.onData = { json ->
            wsServer?.broadcastData(json)
        }

        shimanoProtocol = ShimanoProtocol(this)
        shimanoProtocol.onData = { json ->
            wsServer?.broadcastData(json)
        }

        // Start phone sensors and forward data to WebSocket
        phoneSensorService = PhoneSensorService(this) { sensorJson ->
            wsServer?.broadcastData(sensorJson)
        }
        phoneSensorService?.start()
        bleManager.onStatusChanged = { status ->
            updateNotification(status)
            // Broadcast status to activity
            val intent = Intent("online.kromi.blebridge.STATUS")
            intent.putExtra("status", status)
            sendBroadcast(intent)
        }

        // Start WebSocket server — pass app version for PWA compatibility check
        val appVer = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "?" } catch (_: Exception) { "?" }
        wsServer = BridgeWebSocketServer(WS_PORT, { command ->
            handleCommand(command)
        }, appVer)
        wsServer?.start()
        Log.i(TAG, "WebSocket server started on port $WS_PORT")

        startForeground(NOTIFICATION_ID, buildNotification("Ready — waiting for connection"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        phoneSensorService?.stop()
        shimanoProtocol.destroy()
        sensorManager.destroy()
        wsServer?.stop()
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
                        val isBike = name.contains("GBHA", true) || name.contains("Giant", true)
                            || uuids.contains("F0BA", true) || uuids.contains("1816") || uuids.contains("1818")
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
                    Thread.sleep(500)
                }
                Log.i(TAG, "WS scan: starting PWA-driven scan")
                bleManager.startScan(
                    onFound = { device, rssi, uuids ->
                        val name = device.name ?: "(unnamed)"
                        val tags = mutableListOf<String>()
                        if (name.contains("GBHA", true) || name.contains("Giant", true)) tags.add("GIANT")
                        if (uuids.contains("F0BA", true)) tags.add("GEV")
                        if (uuids.contains("1816") || uuids.contains("1818")) tags.add("BIKE")
                        if (uuids.contains("180D", true)) tags.add("HR")
                        if (uuids.contains("1818", true) && !tags.contains("GIANT")) tags.add("POWER")
                        if (name.contains("SRAM", true) || uuids.contains("4D50", true)) tags.add("SRAM")
                        if (name.contains("Di2", true) || name.contains("SHIMANO", true)
                            || uuids.contains("6E40FEC1", true)) tags.add("DI2")

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

            "stopScan" -> {
                bleManager.stopScan()
                val done = JSONObject().apply { put("type", "scanDone") }
                wsServer?.broadcastData(done)
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
                    Thread.sleep(500)
                }
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

            // === External sensor management (hr, power, di2, sram) ===
            "scanSensor" -> {
                sensorManager.excludeAddress = bleManager.connectedAddress
                val sensor = json.optString("sensor", "")
                sensorManager.scanFor(sensor)
            }

            "connectSensor" -> {
                sensorManager.excludeAddress = bleManager.connectedAddress
                val sensor = json.optString("sensor", "")
                val address = json.optString("address", "")
                if (address.isNotEmpty()) {
                    sensorManager.connectSensor(sensor, address)
                } else {
                    sensorManager.scanFor(sensor)
                }
            }

            "disconnectSensor" -> {
                val sensor = json.optString("sensor", "")
                sensorManager.disconnectSensor(sensor)
            }

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
                shimanoProtocol.excludeAddress = bleManager.connectedAddress
                shimanoProtocol.scan()
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
