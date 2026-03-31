package online.kromi.blebridge

import android.Manifest
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var connectBtn: Button
    private lateinit var servicesText: TextView
    private lateinit var sensorsText: TextView
    private lateinit var logText: TextView
    private lateinit var logScrollView: ScrollView
    private lateinit var clearLogBtn: Button
    private lateinit var wsClientsText: TextView

    private val logLines = mutableListOf<String>()
    private val maxLogLines = 200
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val status = intent.getStringExtra("status") ?: return
            runOnUiThread { statusText.text = status }
        }
    }

    private val dataReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val json = intent.getStringExtra("json") ?: return
            runOnUiThread {
                try {
                    val msg = JSONObject(json)
                    handleDataForUI(msg)
                } catch (_: Exception) {}
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        connectBtn = findViewById(R.id.connectBtn)
        servicesText = findViewById(R.id.servicesText)
        sensorsText = findViewById(R.id.sensorsText)
        logText = findViewById(R.id.logText)
        logScrollView = findViewById(R.id.logScrollView)
        clearLogBtn = findViewById(R.id.clearLogBtn)
        wsClientsText = findViewById(R.id.wsClientsText)

        requestPermissions()

        connectBtn.setOnClickListener {
            val service = BLEBridgeService.instance
            if (service != null) {
                if (service.bleManager.isConnected) {
                    service.bleManager.disconnect()
                    connectBtn.text = "Connect"
                    connectBtn.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF00E676.toInt())
                } else {
                    service.bleManager.connect()
                    connectBtn.text = "Disconnect"
                    connectBtn.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFFEF4444.toInt())
                }
            }
        }

        clearLogBtn.setOnClickListener {
            logLines.clear()
            logText.text = ""
            appendLog("LOG", "Console cleared")
        }

        // Start foreground service
        val serviceIntent = Intent(this, BLEBridgeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        // Register receivers
        registerReceiver(statusReceiver, IntentFilter("online.kromi.blebridge.STATUS"),
            RECEIVER_NOT_EXPORTED)
        registerReceiver(dataReceiver, IntentFilter("online.kromi.blebridge.DATA"),
            RECEIVER_NOT_EXPORTED)

        // Hook into service for log forwarding
        setupServiceLogging()

        // Handle deep link
        handleDeepLink(intent)

        appendLog("INIT", "BLE Bridge started")
        appendLog("WS", "Server on ws://localhost:8765")
    }

    private fun setupServiceLogging() {
        val service = BLEBridgeService.instance ?: return

        // Hook data received for logging
        val originalCallback = service.bleManager.onDataReceived
        service.bleManager.onDataReceived = { json ->
            originalCallback?.invoke(json)
            runOnUiThread {
                handleDataForUI(json)
            }
            // Broadcast for UI update
            val dataIntent = Intent("online.kromi.blebridge.DATA")
            dataIntent.putExtra("json", json.toString())
            sendBroadcast(dataIntent)
        }

        service.bleManager.onStatusChanged = { status ->
            service.updateNotification(status)
            runOnUiThread {
                statusText.text = status
                appendLog("BLE", status)
                if (status.startsWith("Connected")) {
                    connectBtn.text = "Disconnect"
                    connectBtn.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFFEF4444.toInt())
                } else if (status == "Disconnected" || status.contains("failed")) {
                    connectBtn.text = "Connect"
                    connectBtn.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF00E676.toInt())
                }
            }
            val statusIntent = Intent("online.kromi.blebridge.STATUS")
            statusIntent.putExtra("status", status)
            sendBroadcast(statusIntent)
        }
    }

    private fun handleDataForUI(json: JSONObject) {
        val type = json.optString("type", "")
        when (type) {
            "connected" -> {
                val device = json.optString("device", "?")
                val bonded = json.optBoolean("bonded", false)
                appendLog("BLE", "Connected: $device (bonded: $bonded)")
            }
            "disconnected" -> appendLog("BLE", "Disconnected")
            "services" -> {
                val data = json.optJSONObject("data")
                if (data != null) {
                    val bat = if (data.optBoolean("battery")) "✓" else "✗"
                    val csc = if (data.optBoolean("csc")) "✓" else "✗"
                    val pwr = if (data.optBoolean("power")) "✓" else "✗"
                    val gev = if (data.optBoolean("gev")) "✓" else "✗"
                    val proto = if (data.optBoolean("proto")) "✓" else "✗"
                    val hr = if (data.optBoolean("hr")) "✓" else "✗"
                    servicesText.text = "Bat:$bat  CSC:$csc  Pwr:$pwr  GEV:$gev  Proto:$proto  HR:$hr"
                    appendLog("SVC", servicesText.text.toString())
                }
            }
            "battery" -> appendLog("BAT", "${json.optInt("value")}%")
            "speed" -> appendLog("SPD", "${json.optDouble("value", 0.0)} km/h")
            "power" -> appendLog("PWR", "${json.optInt("value")}W")
            "cadence" -> appendLog("CAD", "${json.optInt("value")} rpm")
            "hr" -> appendLog("HR", "${json.optInt("bpm")} bpm (Z${json.optInt("zone")})")
            "assistMode" -> appendLog("AST", "Mode: ${json.optInt("value")}")
            "gevRaw" -> appendLog("GEV", json.optString("hex", ""))
            "protoRaw" -> appendLog("PRT", json.optString("hex", ""))
            "deviceInfo" -> {
                val fw = json.optString("firmware", "-")
                val hw = json.optString("hardware", "-")
                appendLog("DEV", "FW:$fw HW:$hw")
            }
            "barometer" -> {
                val alt = json.optDouble("altitude", 0.0)
                val press = json.optDouble("pressure", 0.0)
                updateSensorDisplay("Baro", "${press.toInt()}hPa/${alt.toInt()}m")
            }
            "light" -> updateSensorDisplay("Light", "${json.optDouble("lux", 0.0).toInt()} lux")
            "accel" -> updateSensorDisplay("Lean", "${json.optDouble("lean", 0.0).toInt()}°")
            "temperature" -> updateSensorDisplay("Temp", "${json.optDouble("value", 0.0)}°C")
        }

        // Update WS client count
        val clients = BLEBridgeService.instance?.wsServer?.connections?.size ?: 0
        wsClientsText.text = "WS: $clients"
    }

    private val sensorValues = mutableMapOf<String, String>()

    private fun updateSensorDisplay(key: String, value: String) {
        sensorValues[key] = value
        val parts = listOf("Baro", "Light", "Lean", "Temp")
            .map { "$it: ${sensorValues[it] ?: "-"}" }
        sensorsText.text = parts.joinToString("  ")
    }

    private fun appendLog(tag: String, message: String) {
        val time = timeFormat.format(Date())
        val line = "[$time] $tag: $message"
        logLines.add(line)
        if (logLines.size > maxLogLines) {
            logLines.removeAt(0)
        }
        logText.text = logLines.joinToString("\n")
        logScrollView.post { logScrollView.fullScroll(ScrollView.FOCUS_DOWN) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        if (intent?.scheme == "kromi-bridge") {
            appendLog("LINK", "Deep link: ${intent.data}")
            BLEBridgeService.instance?.let { service ->
                if (!service.bleManager.isConnected) {
                    service.bleManager.connect()
                }
            }
            moveTaskToBack(true)
        }
    }

    override fun onResume() {
        super.onResume()
        // Re-hook service logging in case service restarted
        setupServiceLogging()
    }

    override fun onDestroy() {
        try { unregisterReceiver(statusReceiver) } catch (_: Exception) {}
        try { unregisterReceiver(dataReceiver) } catch (_: Exception) {}
        super.onDestroy()
    }

    private fun requestPermissions() {
        val perms = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms.add(Manifest.permission.BLUETOOTH_SCAN)
            perms.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        perms.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 1)
        }
    }
}
