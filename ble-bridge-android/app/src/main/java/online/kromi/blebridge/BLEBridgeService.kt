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

        // Start WebSocket server
        wsServer = BridgeWebSocketServer(WS_PORT) { command ->
            handleCommand(command)
        }
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
        wsServer?.stop()
        bleManager.disconnect()
        instance = null
        super.onDestroy()
    }

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
        val intent = Intent(this, MainActivity::class.java)
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
