package online.kromi.blebridge

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var connectBtn: Button
    private lateinit var disconnectBtn: Button
    private lateinit var unbondBtn: Button
    private lateinit var servicesText: TextView
    private lateinit var sensorsText: TextView
    private lateinit var logText: TextView
    private lateinit var logScrollView: ScrollView
    private lateinit var clearLogBtn: Button
    private lateinit var copyLogBtn: Button
    private lateinit var testBtn: Button
    private lateinit var wsClientsText: TextView

    private val logLines = mutableListOf<String>()
    private val maxLogLines = 300
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    private val handler = Handler(Looper.getMainLooper())

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val status = intent.getStringExtra("status") ?: return
            runOnUiThread {
                statusText.text = status
                appendLog("BLE", status)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        connectBtn = findViewById(R.id.connectBtn)
        disconnectBtn = findViewById(R.id.disconnectBtn)
        unbondBtn = findViewById(R.id.unbondBtn)
        servicesText = findViewById(R.id.servicesText)
        sensorsText = findViewById(R.id.sensorsText)
        logText = findViewById(R.id.logText)
        logScrollView = findViewById(R.id.logScrollView)
        clearLogBtn = findViewById(R.id.clearLogBtn)
        copyLogBtn = findViewById(R.id.copyLogBtn)
        testBtn = findViewById(R.id.testBtn)
        wsClientsText = findViewById(R.id.wsClientsText)

        requestPermissions()

        connectBtn.setOnClickListener {
            appendLog("UI", "Scan tapped")
            showDevicePicker()
        }

        disconnectBtn.setOnClickListener {
            appendLog("UI", "Disconnect tapped")
            BLEBridgeService.instance?.bleManager?.disconnect()
                ?: appendLog("ERR", "Service not running!")
        }

        unbondBtn.setOnClickListener { unbondBikeDevices() }

        clearLogBtn.setOnClickListener {
            logLines.clear()
            logText.text = ""
            appendLog("LOG", "Cleared")
        }

        copyLogBtn.setOnClickListener {
            val clipboard = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
            val clip = android.content.ClipData.newPlainText("BLE Bridge Log", logLines.joinToString("\n"))
            clipboard.setPrimaryClip(clip)
            Toast.makeText(this, "Log copied to clipboard!", Toast.LENGTH_SHORT).show()
            appendLog("LOG", "Copied ${logLines.size} lines to clipboard")
        }

        testBtn.setOnClickListener { runBLETest() }

        // Start foreground service
        val serviceIntent = Intent(this, BLEBridgeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        registerReceiver(statusReceiver, IntentFilter("online.kromi.blebridge.STATUS"),
            RECEIVER_NOT_EXPORTED)

        appendLog("INIT", "BLE Bridge v0.6.0 started")
        appendLog("WS", "Server on ws://localhost:8765")

        // Setup service logging after a short delay (service may not be ready immediately)
        handler.postDelayed({ setupServiceLogging() }, 500)

        handleDeepLink(intent)
    }

    private fun setupServiceLogging() {
        val service = BLEBridgeService.instance
        if (service == null) {
            appendLog("WARN", "Service not ready, retrying...")
            handler.postDelayed({ setupServiceLogging() }, 1000)
            return
        }

        service.bleManager.onDataReceived = { json ->
            service.wsServer?.broadcastData(json)
            runOnUiThread { handleDataForUI(json) }
        }

        service.bleManager.onStatusChanged = { status ->
            service.updateNotification(status)
            runOnUiThread {
                statusText.text = status
                appendLog("BLE", status)
            }
            val intent = Intent("online.kromi.blebridge.STATUS")
            intent.putExtra("status", status)
            sendBroadcast(intent)
        }

        appendLog("INIT", "Service hooked OK")
    }

    private fun handleDataForUI(json: JSONObject) {
        val type = json.optString("type", "")
        when (type) {
            "connected" -> {
                appendLog("BLE", "Connected: ${json.optString("device")} bonded:${json.optBoolean("bonded")}")
            }
            "disconnected" -> appendLog("BLE", "Disconnected")
            "services" -> {
                val d = json.optJSONObject("data") ?: return
                val s = listOf("battery", "csc", "power", "sg", "gev", "proto", "hr")
                    .joinToString(" ") { k ->
                        val v = if (d.optBoolean(k)) "✅" else "❌"
                        "${k.take(3).uppercase()}:$v"
                    }
                servicesText.text = s
                appendLog("SVC", s)
            }
            "battery" -> appendLog("BAT", "${json.optInt("value")}%")
            "speed" -> appendLog("SPD", "${json.optDouble("value")} km/h")
            "power" -> appendLog("PWR", "${json.optInt("value")}W")
            "cadence" -> appendLog("CAD", "${json.optInt("value")} rpm")
            "hr" -> appendLog("HR", "${json.optInt("bpm")} bpm Z${json.optInt("zone")}")
            "assistMode" -> appendLog("AST", "Mode ${json.optInt("value")} current:${json.optInt("current")}")
            "gevRaw" -> appendLog("GEV", json.optString("hex"))
            "protoRaw" -> appendLog("PRT", json.optString("hex"))
            "gevBattery" -> appendLog("GEV", "Bat:${json.optInt("percent")}% ${json.optDouble("voltage")}V ${json.optInt("temp")}°C")
            "gevRiding" -> appendLog("GEV", "Spd:${json.optDouble("speed")} Pwr:${json.optInt("power")}")
            "deviceInfo" -> appendLog("DEV", "FW:${json.optString("firmware")} HW:${json.optString("hardware")} SW:${json.optString("software")}")
            "allServices" -> {
                val arr = json.optJSONArray("data") ?: return
                appendLog("SVC", "══ Full service map (${arr.length()} services) ══")
                for (i in 0 until arr.length()) {
                    val svc = arr.getJSONObject(i)
                    appendLog("SVC", "┌ ${svc.optString("short")}: ${svc.optString("uuid")}")
                    val chars = svc.optJSONArray("chars") ?: continue
                    for (j in 0 until chars.length()) {
                        val c = chars.getJSONObject(j)
                        appendLog("SVC", "│  ${c.optString("short")} ${c.optString("propsStr")} (${c.optInt("props")})")
                    }
                }
                appendLog("SVC", "══════════════════════════════════")
            }
            "charRead" -> appendLog("RD", "[${json.optString("short")}] hex=${json.optString("hex")} ascii=\"${json.optString("ascii")}\" len=${json.optInt("size")}")
            "charReadFail" -> appendLog("RD!", "[${json.optString("short")}] FAILED status=${json.optInt("status")}")
            "unknownNotify" -> appendLog("NTF", "[${json.optString("short")}] hex=${json.optString("hex")} len=${json.optInt("size")}")
            "sgNotify" -> appendLog("SG!", "hex=${json.optString("hex")} ascii=\"${json.optString("ascii")}\" len=${json.optInt("size")}")
            "barometer" -> updateSensor("Baro", "${json.optDouble("pressure").toInt()}hPa/${json.optDouble("altitude").toInt()}m")
            "light" -> updateSensor("Light", "${json.optDouble("lux").toInt()}lux")
            "accel" -> updateSensor("Lean", "${json.optDouble("lean").toInt()}°")
            "temperature" -> updateSensor("Temp", "${json.optDouble("value")}°C")
        }

        val clients = BLEBridgeService.instance?.wsServer?.connections?.size ?: 0
        wsClientsText.text = "WS: $clients"
    }

    private val sensorValues = mutableMapOf<String, String>()
    private fun updateSensor(key: String, value: String) {
        sensorValues[key] = value
        sensorsText.text = listOf("Baro", "Light", "Lean", "Temp")
            .joinToString(" ") { "$it:${sensorValues[it] ?: "-"}" }
    }

    @SuppressLint("MissingPermission")
    private fun showDevicePicker() {
        val ble = BLEBridgeService.instance?.bleManager
        if (ble == null) {
            appendLog("ERR", "Service not running!")
            return
        }
        if (ble.isConnected) {
            appendLog("UI", "Already connected — disconnect first")
            return
        }

        val devices = mutableListOf<BluetoothDevice>()
        val deviceLabels = mutableListOf<String>()
        val adapter = android.widget.ArrayAdapter<String>(
            this, android.R.layout.simple_list_item_1, deviceLabels)

        // Create dialog with a ListView that updates live
        val dialog = AlertDialog.Builder(this)
            .setTitle("Scanning for devices...")
            .setAdapter(adapter) { _, which ->
                ble.stopScan()
                val chosen = devices[which]
                appendLog("UI", "Selected: ${chosen.name} (${chosen.address})")
                ble.connectToDevice(chosen)
            }
            .setNegativeButton("Cancel") { d, _ ->
                ble.stopScan()
                d.dismiss()
            }
            .create()

        appendLog("UI", "Starting scan...")
        dialog.show()

        ble.startScan(
            onFound = { device, rssi, uuids ->
                val name = device.name ?: "?"
                val marker = when {
                    name.contains("GBHA", true) || name.contains("Giant", true) -> " [GIANT]"
                    uuids.contains("F0BA", true) -> " [GEV]"
                    uuids.contains("1816") || uuids.contains("1818") -> " [BIKE?]"
                    uuids.contains("180D") -> " [HR]"
                    else -> ""
                }
                val label = "$name  RSSI:$rssi  $uuids$marker"

                runOnUiThread {
                    devices.add(device)
                    deviceLabels.add(label)
                    adapter.notifyDataSetChanged()
                    dialog.setTitle("Found ${devices.size} devices (scanning...)")
                    appendLog("SCAN", "$name | ${device.address} | RSSI:$rssi | $uuids$marker")
                }
            },
            onDone = {
                runOnUiThread {
                    if (devices.isEmpty()) {
                        dialog.dismiss()
                        Toast.makeText(this, "No devices found", Toast.LENGTH_SHORT).show()
                    } else {
                        dialog.setTitle("${devices.size} devices found — tap to connect")
                    }
                    appendLog("SCAN", "Scan complete: ${devices.size} devices")
                }
            }
        )
    }

    @SuppressLint("MissingPermission")
    private fun unbondBikeDevices() {
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return
        var count = 0
        for (device in adapter.bondedDevices) {
            val name = device.name ?: ""
            if (name.contains("GBHA", true) || name.contains("Giant", true) || name.contains("bicla", true)) {
                try {
                    val method = device.javaClass.getMethod("removeBond")
                    method.invoke(device)
                    appendLog("BOND", "Removed bond: $name (${device.address})")
                    count++
                } catch (e: Exception) {
                    appendLog("ERR", "Failed to unbond $name: ${e.message}")
                }
            }
        }
        if (count == 0) {
            appendLog("BOND", "No bike devices found in bonded list")
            appendLog("BOND", "Bonded devices with bike-like names: none")
            appendLog("BOND", "Try manually in Android Settings > Bluetooth")
        } else {
            appendLog("BOND", "Removed $count bond(s)")
        }
    }

    @SuppressLint("MissingPermission")
    private fun runBLETest() {
        appendLog("TEST", "══════ BLE TEST START ══════")

        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null) {
            appendLog("TEST", "❌ No Bluetooth adapter")
            return
        }
        appendLog("TEST", "✅ Bluetooth: ${if (adapter.isEnabled) "ON" else "OFF"}")

        // Permissions
        val perms = listOf("BLUETOOTH_SCAN", "BLUETOOTH_CONNECT", "ACCESS_FINE_LOCATION")
        for (p in perms) {
            val full = if (p.startsWith("BLUETOOTH")) "android.permission.$p" else "android.permission.$p"
            val ok = ContextCompat.checkSelfPermission(this, full) == PackageManager.PERMISSION_GRANTED
            appendLog("TEST", "${if (ok) "✅" else "❌"} $p")
        }

        // WebSocket
        val ws = BLEBridgeService.instance?.wsServer
        appendLog("TEST", "${if (ws != null) "✅" else "❌"} WebSocket (${ws?.connections?.size ?: 0} clients)")

        // Sensors
        val ss = BLEBridgeService.instance?.phoneSensorService
        if (ss != null) {
            appendLog("TEST", "Sensors: baro:${ss.hasBarometer} accel:${ss.hasAccelerometer} gyro:${ss.hasGyroscope} light:${ss.hasLight} temp:${ss.hasTemperature}")
        }

        // Bonded devices
        appendLog("TEST", "Bonded: ${adapter.bondedDevices.size} devices")
        for (d in adapter.bondedDevices) {
            val name = d.name ?: "?"
            // Highlight potential bike devices
            val marker = if (name.contains("GBHA", true) || name.contains("Giant", true) || name.contains("bicla", true)) " ◀◀◀ BIKE?" else ""
            appendLog("BOND", "  $name (${d.address})$marker")
        }

        // BLE state
        val ble = BLEBridgeService.instance?.bleManager
        appendLog("TEST", "BLE connected: ${ble?.isConnected ?: false}")

        // Full scan — no filters, find EVERYTHING
        appendLog("TEST", "Scanning ALL devices (15s)...")
        val scanner = adapter.bluetoothLeScanner ?: run {
            appendLog("TEST", "❌ Scanner not available")
            return
        }
        val found = mutableSetOf<String>()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val name = result.device.name ?: "(unnamed)"
                val addr = result.device.address
                val key = addr
                if (key in found) return
                found.add(key)

                val rssi = result.rssi
                val uuids = result.scanRecord?.serviceUuids?.joinToString(",") {
                    it.toString().substring(4, 8).uppercase()
                } ?: "-"
                val mfr = result.scanRecord?.manufacturerSpecificData
                val mfrStr = if (mfr != null && mfr.size() > 0) "mfr:${mfr.keyAt(0)}" else ""
                val bond = result.device.bondState

                // Highlight potential bikes
                val marker = when {
                    name.contains("GBHA", true) -> " ★★★ GIANT!"
                    name.contains("Giant", true) -> " ★★★ GIANT!"
                    name.contains("bicla", true) -> " ★★ BIKE?"
                    uuids.contains("F0BA", true) -> " ★★★ GEV!"
                    uuids.contains("1816") -> " ★ CSC"
                    uuids.contains("1818") -> " ★ PWR"
                    uuids.contains("180D") -> " ★ HR"
                    else -> ""
                }

                runOnUiThread {
                    appendLog("SCAN", "$name | $addr | RSSI:$rssi | bond:$bond | UUID:$uuids $mfrStr$marker")
                }
            }
        }

        // Scan without any filter to find everything
        scanner.startScan(null, settings, callback)

        handler.postDelayed({
            try { scanner.stopScan(callback) } catch (_: Exception) {}
            appendLog("TEST", "Found ${found.size} devices total")
            appendLog("TEST", "══════ BLE TEST END ══════")
            appendLog("TEST", "Tap COPY LOG to share results")
        }, 15000)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        if (intent?.scheme == "kromi-bridge") {
            appendLog("LINK", "Deep link received")
            BLEBridgeService.instance?.bleManager?.let {
                if (!it.isConnected) {
                    appendLog("LINK", "Not connected — tap SCAN to select device")
                }
            }
            moveTaskToBack(true)
        }
    }

    override fun onResume() {
        super.onResume()
        handler.postDelayed({ setupServiceLogging() }, 300)
    }

    override fun onDestroy() {
        try { unregisterReceiver(statusReceiver) } catch (_: Exception) {}
        super.onDestroy()
    }

    private fun appendLog(tag: String, message: String) {
        val time = timeFormat.format(Date())
        val line = "[$time] $tag: $message"
        logLines.add(line)
        if (logLines.size > maxLogLines) logLines.removeAt(0)
        logText.text = logLines.joinToString("\n")
        logScrollView.post { logScrollView.fullScroll(ScrollView.FOCUS_DOWN) }
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
