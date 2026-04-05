package online.kromi.blebridge

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.util.UUID

@SuppressLint("MissingPermission")
class BLEManager(private val context: Context) {

    companion object {
        const val TAG = "BLEManager"

        val BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        val BATTERY_LEVEL = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        val CSC_SERVICE = UUID.fromString("00001816-0000-1000-8000-00805f9b34fb")
        val CSC_MEASUREMENT = UUID.fromString("00002a5b-0000-1000-8000-00805f9b34fb")
        val POWER_SERVICE = UUID.fromString("00001818-0000-1000-8000-00805f9b34fb")
        val POWER_MEASUREMENT = UUID.fromString("00002a63-0000-1000-8000-00805f9b34fb")
        val HR_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val HR_MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")

        val GEV_SERVICE = UUID.fromString("f0ba3012-6cac-4c99-9089-4b0a1df45002")
        val GEV_NOTIFY = UUID.fromString("f0ba3013-6cac-4c99-9089-4b0a1df45002")
        val PROTO_SERVICE = UUID.fromString("f0ba5201-6cac-4c99-9089-4b0a1df45002")
        val PROTO_WRITE = UUID.fromString("f0ba5202-6cac-4c99-9089-4b0a1df45002")
        val PROTO_NOTIFY = UUID.fromString("f0ba5203-6cac-4c99-9089-4b0a1df45002")

        // Giant Smart Gateway proprietary service (advertised as "0001")
        // Full UUID: 4d500001-4745-5630-3031-e50e24dcca9e (base: 4D50 = "MP")
        val SG_SERVICE = UUID.fromString("4d500001-4745-5630-3031-e50e24dcca9e")
        val SG_WRITE   = UUID.fromString("4d500002-4745-5630-3031-e50e24dcca9e")
        val SG_NOTIFY  = UUID.fromString("4d500003-4745-5630-3031-e50e24dcca9e")

        // Nordic DFU Secure (FE59)
        val DFU_SERVICE = UUID.fromString("0000fe59-0000-1000-8000-00805f9b34fb")

        val DEVICE_INFO_SERVICE = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
        val FIRMWARE_REVISION = UUID.fromString("00002a26-0000-1000-8000-00805f9b34fb")
        val HARDWARE_REVISION = UUID.fromString("00002a27-0000-1000-8000-00805f9b34fb")
        val SOFTWARE_REVISION = UUID.fromString("00002a28-0000-1000-8000-00805f9b34fb")

        val CCC_DESCRIPTOR = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    var onDataReceived: ((JSONObject) -> Unit)? = null
    var onStatusChanged: ((String) -> Unit)? = null

    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var gatt: BluetoothGatt? = null
    private var gevChar: BluetoothGattCharacteristic? = null
    private var protoWriteChar: BluetoothGattCharacteristic? = null
    private var sgWriteChar: BluetoothGattCharacteristic? = null
    private val handler = Handler(Looper.getMainLooper())
    private val pendingNotifications = mutableListOf<BluetoothGattCharacteristic>()

    private var lastWheelRevs = 0L
    private var lastWheelTime = 0L
    private var totalDistance = 0.0
    private val wheelCircumference = 2.290

    // Serial GATT operation queues
    private val pendingReads = mutableListOf<BluetoothGattCharacteristic>()
    private var hasRediscovered = false
    var sgOnlyMode = false  // When true: skip all reads + only subscribe to SG_NOTIFY
    private var lastTelemetryLog = 0L
    private val fc23LogTimes = mutableMapOf<String, Long>()

    // FC21 readRidingData accumulator (cmd 0x1B, needs 2 responses × 14 bytes = 28 bytes)
    private val rideDataAccum = mutableListOf<Byte>()
    private var rideDataPending = false

    // Motor command ACK tracking — last sent values for verification
    private var lastSentTuning: IntArray? = null  // [power, sport, active, tour, eco]
    private var lastSentAdvanced: IntArray? = null // [ps, pt, pl, ss, st, sl, as, at, al, ts, tt, tl, es, et, el]
    private var awaitingTuningAck = false
    private var tuningAckDeadline = 0L

    // Battery SOC smoothing (cmd 0x43 fluctuates wildly)
    private val socBuffer = mutableListOf<Int>()
    private var smoothedSoc = -1

    val isConnected: Boolean get() = gatt != null
    val isScanning: Boolean get() = scanCallback != null
    val connectedAddress: String? get() = gatt?.device?.address

    private var scanCallback: ScanCallback? = null

    /**
     * Scan for BLE devices. Each found device is reported via onFound callback.
     * onDone is called when scan completes (timeout or manual stop).
     * Scan is owned by the caller — concurrent scan requests are rejected.
     */
    fun startScan(onFound: (BluetoothDevice, Int, String) -> Unit, onDone: () -> Unit) {
        if (scanCallback != null) {
            Log.w(TAG, "Scan already in progress — ignoring")
            return
        }
        if (gatt != null) {
            Log.w(TAG, "Already connected — ignoring scan")
            return
        }

        val scanner = bluetoothAdapter?.bluetoothLeScanner ?: return
        onStatusChanged?.invoke("Scanning...")
        hasRediscovered = false

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val seen = mutableSetOf<String>()

        scanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val addr = result.device.address
                if (addr in seen) return
                seen.add(addr)

                val name = result.device.name ?: return
                val uuids = result.scanRecord?.serviceUuids?.joinToString(",") {
                    it.toString().substring(4, 8).uppercase()
                } ?: "-"

                Log.i(TAG, "Scan: $name ($addr) RSSI:${result.rssi} UUID:$uuids bond:${result.device.bondState}")
                onFound(result.device, result.rssi, uuids)
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "Scan failed: $errorCode")
                onStatusChanged?.invoke("Scan failed ($errorCode)")
            }
        }

        scanner.startScan(null, settings, scanCallback)

        // Auto-stop after 12s
        handler.postDelayed({
            stopScan(onDone)
        }, 12000)
    }

    fun stopScan(onDone: (() -> Unit)? = null) {
        scanCallback?.let { cb ->
            try {
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(cb)
            } catch (_: Exception) {}
        }
        scanCallback = null
        onDone?.invoke()
    }

    fun connectToDevice(device: BluetoothDevice) {
        // Prevent double connections
        if (gatt != null) {
            Log.w(TAG, "Already connected — disconnect first")
            onStatusChanged?.invoke("Already connected — disconnect first")
            return
        }
        Log.i(TAG, "Connecting to ${device.name} (${device.address}) bond:${device.bondState}")
        onStatusChanged?.invoke("Connecting to ${device.name}...")
        connectGatt(device)
    }

    private var lastConnectedDevice: BluetoothDevice? = null
    private var shouldAutoReconnect = true
    private val reconnectHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var keepAliveRunnable: Runnable? = null
    private val KEEPALIVE_INTERVAL_MS = 30_000L // 30s

    private fun connectGatt(device: BluetoothDevice) {
        lastConnectedDevice = device
        shouldAutoReconnect = true
        // autoConnect=true lets Android reconnect automatically when device comes back in range
        gatt = device.connectGatt(context, true, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        shouldAutoReconnect = false
        lastConnectedDevice = null
        stopKeepAlive()
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        gevChar = null
        protoWriteChar = null
        sgWriteChar = null
        onDataReceived?.invoke(JSONObject().put("type", "disconnected"))
        onStatusChanged?.invoke("Disconnected")
    }

    /** Keep-alive: read RSSI every 30s to maintain BLE connection */
    private fun startKeepAlive() {
        stopKeepAlive()
        val runnable = object : Runnable {
            override fun run() {
                gatt?.let { g ->
                    g.readRemoteRssi()
                    Log.d(TAG, "Keep-alive RSSI ping")
                }
                reconnectHandler.postDelayed(this, KEEPALIVE_INTERVAL_MS)
            }
        }
        keepAliveRunnable = runnable
        reconnectHandler.postDelayed(runnable, KEEPALIVE_INTERVAL_MS)
    }

    private fun stopKeepAlive() {
        keepAliveRunnable?.let { reconnectHandler.removeCallbacks(it) }
        keepAliveRunnable = null
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "GATT connected to ${g.device.name} (bond: ${g.device.bondState})")

                    // Auto-bond if not bonded — required for motor control commands
                    if (g.device.bondState != BluetoothDevice.BOND_BONDED) {
                        Log.i(TAG, "★ Initiating BOND (required for motor control)...")
                        onStatusChanged?.invoke("Bonding...")
                        g.device.createBond()
                        // Bond callback will continue the flow, but also proceed with MTU
                        // in case bonding happens in parallel
                    }

                    onStatusChanged?.invoke("Connected, requesting MTU...")
                    // Request high priority + large MTU, then discover services in onMtuChanged
                    g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                    g.requestMtu(247)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "GATT disconnected (status=$status, autoReconnect=$shouldAutoReconnect)")
                    stopKeepAlive()
                    gatt?.close()
                    gatt = null
                    gevChar = null
                    protoWriteChar = null
                    sgWriteChar = null
                    onDataReceived?.invoke(JSONObject().put("type", "disconnected"))
                    onStatusChanged?.invoke("Disconnected")

                    // Auto-reconnect after 3s if not intentionally disconnected
                    if (shouldAutoReconnect && lastConnectedDevice != null) {
                        Log.i(TAG, "★ Auto-reconnect in 3s to ${lastConnectedDevice?.name}")
                        onStatusChanged?.invoke("Reconnecting...")
                        reconnectHandler.postDelayed({
                            if (shouldAutoReconnect && lastConnectedDevice != null && gatt == null) {
                                Log.i(TAG, "★ Reconnecting to ${lastConnectedDevice?.name}...")
                                connectGatt(lastConnectedDevice!!)
                            }
                        }, 3000)
                    }
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "Service discovery failed: $status")
                return
            }

            val deviceName = g.device.name ?: "Unknown"
            val bondState = g.device.bondState

            // Start keep-alive pings
            startKeepAlive()

            // Log ALL discovered services with full detail
            Log.i(TAG, "╔══════════════════════════════════════════╗")
            Log.i(TAG, "║ SERVICES DISCOVERED (${g.services.size} total)")
            Log.i(TAG, "║ Device: $deviceName  Bond: $bondState")
            Log.i(TAG, "║ Rediscovery: $hasRediscovered")
            Log.i(TAG, "╚══════════════════════════════════════════╝")
            for (service in g.services) {
                val svcShort = service.uuid.toString().substring(4, 8).uppercase()
                Log.i(TAG, "┌─ Service: ${service.uuid} [$svcShort]")
                for (char in service.characteristics) {
                    val cShort = char.uuid.toString().substring(4, 8).uppercase()
                    val props = describeProperties(char.properties)
                    Log.i(TAG, "│  Char: ${char.uuid} [$cShort] props=$props (${char.properties})")
                    for (desc in char.descriptors) {
                        Log.i(TAG, "│    Desc: ${desc.uuid}")
                    }
                }
                Log.i(TAG, "└───────────────────────────────────")
            }

            onDataReceived?.invoke(JSONObject()
                .put("type", "connected")
                .put("device", deviceName)
                .put("bonded", bondState == BluetoothDevice.BOND_BONDED))
            onStatusChanged?.invoke("Connected: $deviceName (bond:$bondState, svc:${g.services.size})")

            // Send full service map to UI
            val allServices = org.json.JSONArray()
            for (service in g.services) {
                val sObj = JSONObject()
                    .put("uuid", service.uuid.toString())
                    .put("short", service.uuid.toString().substring(4, 8).uppercase())
                val chars = org.json.JSONArray()
                for (char in service.characteristics) {
                    chars.put(JSONObject()
                        .put("uuid", char.uuid.toString())
                        .put("short", char.uuid.toString().substring(4, 8).uppercase())
                        .put("props", char.properties)
                        .put("propsStr", describeProperties(char.properties)))
                }
                sObj.put("chars", chars)
                allServices.put(sObj)
            }
            onDataReceived?.invoke(JSONObject().put("type", "allServices").put("data", allServices))

            val services = JSONObject()
            pendingNotifications.clear()
            pendingReads.clear()
            notifPhase = 0

            if (sgOnlyMode) {
                // SG-ONLY MODE: skip ALL reads, ONLY subscribe to SG_NOTIFY
                Log.i(TAG, "╔═══════════════════════════════════╗")
                Log.i(TAG, "║  SG-ONLY MODE — minimal BLE ops   ║")
                Log.i(TAG, "╚═══════════════════════════════════╝")
                g.getService(SG_SERVICE)?.getCharacteristic(SG_NOTIFY)?.let { char ->
                    pendingNotifications.add(char)
                    sgWriteChar = g.getService(SG_SERVICE)?.getCharacteristic(SG_WRITE)
                    services.put("sg", true)
                } ?: services.put("sg", false)
                onDataReceived?.invoke(JSONObject().put("type", "services").put("data", services))
                onStatusChanged?.invoke("SG-only: subscribing...")
                enableNextNotification(g)
                return
            }

            // Battery
            g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let { char ->
                services.put("battery", true)
                pendingNotifications.add(char)
            } ?: services.put("battery", false)

            // CSC
            g.getService(CSC_SERVICE)?.getCharacteristic(CSC_MEASUREMENT)?.let { char ->
                services.put("csc", true)
                pendingNotifications.add(char)
            } ?: services.put("csc", false)

            // Power
            g.getService(POWER_SERVICE)?.getCharacteristic(POWER_MEASUREMENT)?.let { char ->
                services.put("power", true)
                pendingNotifications.add(char)
            } ?: services.put("power", false)

            // GEV
            g.getService(GEV_SERVICE)?.getCharacteristic(GEV_NOTIFY)?.let { char ->
                services.put("gev", true)
                gevChar = char
                pendingNotifications.add(char)
                Log.i(TAG, "★★★ GEV SERVICE FOUND! Motor control available! ★★★")
            } ?: run {
                services.put("gev", false)
                Log.w(TAG, "GEV service NOT found (bond:$bondState)")
            }

            // Proto
            g.getService(PROTO_SERVICE)?.let { service ->
                services.put("proto", true)
                service.getCharacteristic(PROTO_WRITE)?.let { protoWriteChar = it }
                service.getCharacteristic(PROTO_NOTIFY)?.let { pendingNotifications.add(it) }
                Log.i(TAG, "★★★ PROTO SERVICE FOUND! ★★★")
            } ?: run {
                services.put("proto", false)
                Log.w(TAG, "Proto service NOT found (bond:$bondState)")
            }

            // HR — NOT subscribed on gateway; handled by SensorManager (external HR strap)
            g.getService(HR_SERVICE)?.let {
                services.put("hr", true) // report capability but don't subscribe
                Log.i(TAG, "HR service found on gateway (not subscribing — use external sensor)")
            } ?: services.put("hr", false)

            // Smart Gateway proprietary service (4d500001)
            g.getService(SG_SERVICE)?.let { service ->
                services.put("sg", true)
                Log.i(TAG, "★★★ SMART GATEWAY SERVICE FOUND (4d500001)! ★★★")
                service.getCharacteristic(SG_WRITE)?.let {
                    sgWriteChar = it
                    Log.i(TAG, "★ SG Write char available (WRITE_NO_RSP|WRITE)")
                }
                service.getCharacteristic(SG_NOTIFY)?.let { char ->
                    pendingNotifications.add(char)
                    Log.i(TAG, "★ SG Notify char — subscribing")
                }
            } ?: services.put("sg", false)

            onDataReceived?.invoke(JSONObject().put("type", "services").put("data", services))

            // Queue Device Info reads (serialized via pendingReads)
            g.getService(DEVICE_INFO_SERVICE)?.let { svc ->
                for (char in svc.characteristics) {
                    if (char.properties and BluetoothGattCharacteristic.PROPERTY_READ != 0) {
                        pendingReads.add(char)
                    }
                }
            }

            // Queue Battery read
            g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let {
                pendingReads.add(it)
            }

            // Queue reads from unknown services
            val knownServices = setOf(
                BATTERY_SERVICE, CSC_SERVICE, POWER_SERVICE, HR_SERVICE,
                DEVICE_INFO_SERVICE, GEV_SERVICE, PROTO_SERVICE, SG_SERVICE, DFU_SERVICE,
                UUID.fromString("00001800-0000-1000-8000-00805f9b34fb"),
                UUID.fromString("00001801-0000-1000-8000-00805f9b34fb")
            )
            for (service in g.services) {
                if (service.uuid !in knownServices) {
                    Log.i(TAG, ">>> EXPLORING unknown service: ${service.uuid} <<<")
                    for (char in service.characteristics) {
                        if (char.properties and BluetoothGattCharacteristic.PROPERTY_READ != 0) {
                            pendingReads.add(char)
                        }
                        if (char.properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) {
                            pendingNotifications.add(char)
                        }
                    }
                }
            }

            Log.i(TAG, ">>> Queue: ${pendingReads.size} reads, ${pendingNotifications.size} notifications")

            // Start serial read chain → then notifications
            processNextRead(g)
        }

        override fun onCharacteristicRead(g: BluetoothGatt, char: BluetoothGattCharacteristic, status: Int) {
            val cShort = char.uuid.toString().substring(4, 8).uppercase()
            val hex = char.value?.joinToString("") { "%02x".format(it) } ?: "(null)"
            val ascii = char.value?.let { bytes ->
                String(bytes.filter { it in 0x20..0x7E }.toByteArray())
            } ?: ""

            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "READ [$cShort]: hex=$hex ascii=\"$ascii\" len=${char.value?.size ?: 0}")
                onDataReceived?.invoke(JSONObject()
                    .put("type", "charRead")
                    .put("uuid", char.uuid.toString())
                    .put("short", cShort)
                    .put("hex", hex)
                    .put("ascii", ascii)
                    .put("size", char.value?.size ?: 0))
                handleCharacteristicData(char)
            } else {
                Log.w(TAG, "READ FAILED [$cShort]: status=$status")
            }

            // Chain: next read, or start notifications
            handler.postDelayed({ processNextRead(g) }, 50)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, char: BluetoothGattCharacteristic) {
            val cShort = char.uuid.toString().substring(4, 8).uppercase()
            val knownChars = setOf("2A19", "2A5B", "2A63", "2A37")
            val isSG = char.uuid == SG_NOTIFY
            if (cShort !in knownChars && !isSG) {
                val hex = char.value?.joinToString("") { "%02x".format(it) } ?: ""
                Log.i(TAG, ">>> NOTIFY [$cShort] ${char.uuid}: hex=$hex len=${char.value?.size ?: 0}")
                onDataReceived?.invoke(JSONObject()
                    .put("type", "unknownNotify")
                    .put("uuid", char.uuid.toString())
                    .put("short", cShort)
                    .put("hex", hex)
                    .put("size", char.value?.size ?: 0))
            }
            handleCharacteristicData(char)
        }

        override fun onReadRemoteRssi(g: BluetoothGatt, rssi: Int, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Keep-alive RSSI: $rssi dBm")
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            Log.i(TAG, "MTU changed to $mtu (status=$status)")
            onDataReceived?.invoke(JSONObject()
                .put("type", "mtu")
                .put("mtu", mtu)
                .put("ok", status == BluetoothGatt.GATT_SUCCESS))
            // NOW discover services (after MTU negotiation completes)
            onStatusChanged?.invoke("MTU $mtu — discovering services...")
            handler.postDelayed({ g.discoverServices() }, 300)
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, char: BluetoothGattCharacteristic, status: Int) {
            val cShort = char.uuid.toString().substring(4, 8).uppercase()
            val statusStr = if (status == BluetoothGatt.GATT_SUCCESS) "OK" else "FAIL($status)"
            Log.i(TAG, ">>> WRITE CALLBACK [$cShort]: $statusStr")
            onDataReceived?.invoke(JSONObject()
                .put("type", "sgWriteCallback")
                .put("short", cShort)
                .put("status", status)
                .put("ok", status == BluetoothGatt.GATT_SUCCESS))
        }

        override fun onDescriptorWrite(g: BluetoothGatt, desc: BluetoothGattDescriptor, status: Int) {
            val cShort = desc.characteristic.uuid.toString().substring(4, 8).uppercase()
            val isSG = desc.characteristic.uuid == SG_NOTIFY
            val phase = if (notifPhase == 1) "DISABLE" else "ENABLE"
            val statusStr = if (status == BluetoothGatt.GATT_SUCCESS) "OK" else "FAIL($status)"
            Log.i(TAG, "DescWrite [$cShort] $phase: $statusStr${if (isSG) " ★SG" else ""}")
            onDataReceived?.invoke(JSONObject()
                .put("type", "subscribed")
                .put("char", cShort)
                .put("phase", phase)
                .put("ok", status == BluetoothGatt.GATT_SUCCESS)
                .put("isSG", isSG))
            handler.postDelayed({ enableNextNotification(g) }, 100)
        }

        override fun onDescriptorRead(g: BluetoothGatt, desc: BluetoothGattDescriptor, status: Int) {
            val cShort = desc.characteristic.uuid.toString().substring(4, 8).uppercase()
            val isSG = desc.characteristic.uuid == SG_NOTIFY
            val hex = desc.value?.joinToString("") { "%02x".format(it) } ?: "null"
            Log.i(TAG, "DescRead [$cShort] CCCD=$hex${if (isSG) " ★SG" else ""}")
            onDataReceived?.invoke(JSONObject()
                .put("type", "subscribed")
                .put("char", cShort)
                .put("phase", "CONFIRM")
                .put("cccd", hex)
                .put("ok", hex == "0100")
                .put("isSG", isSG))
            handler.postDelayed({ enableNextNotification(g) }, 100)
        }
    }

    // Notification subscription state machine: disable → enable → read-back
    private var notifPhase = 0  // 0=disable, 1=enable, 2=read, then next

    private fun enableNextNotification(g: BluetoothGatt) {
        if (pendingNotifications.isEmpty()) {
            Log.i(TAG, "★ All notifications enabled! Listening for data...")
            onStatusChanged?.invoke("All subscribed — listening...")
            // Auto-start GEV session for FC23 telemetry (mode detection, motor data)
            handler.postDelayed({ startGEVSession() }, 500)
            return
        }
        val char = pendingNotifications.first()
        val cShort = char.uuid.toString().substring(4, 8).uppercase()
        val isSG = char.uuid == SG_NOTIFY

        char.getDescriptor(CCC_DESCRIPTOR)?.let { desc ->
            when (notifPhase) {
                0 -> {
                    // Phase 0: DISABLE first (like nRF Connect does)
                    g.setCharacteristicNotification(char, false)
                    desc.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
                    Log.i(TAG, "Sub [$cShort] phase 0: DISABLE${if (isSG) " ★SG" else ""}")
                    notifPhase = 1
                    g.writeDescriptor(desc)
                }
                1 -> {
                    // Phase 1: ENABLE
                    g.setCharacteristicNotification(char, true)
                    desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    Log.i(TAG, "Sub [$cShort] phase 1: ENABLE${if (isSG) " ★SG" else ""}")
                    notifPhase = 2
                    g.writeDescriptor(desc)
                }
                2 -> {
                    // Phase 2: READ back CCCD to confirm
                    Log.i(TAG, "Sub [$cShort] phase 2: READ CCCD${if (isSG) " ★SG" else ""}")
                    notifPhase = 0
                    pendingNotifications.removeAt(0)
                    g.readDescriptor(desc)
                }
                else -> {
                    notifPhase = 0
                    pendingNotifications.removeAt(0)
                    enableNextNotification(g)
                }
            }
        } ?: run {
            Log.w(TAG, "No CCC descriptor for [$cShort] — skipping")
            pendingNotifications.removeAt(0)
            notifPhase = 0
            enableNextNotification(g)
        }
    }

    private fun handleCharacteristicData(char: BluetoothGattCharacteristic) {
        val data = char.value ?: return
        val charUuid = char.uuid

        try {
            when (charUuid) {
                BATTERY_LEVEL -> {
                    val pct = data[0].toInt() and 0xFF
                    onDataReceived?.invoke(JSONObject().put("type", "battery").put("value", pct))
                }
                CSC_MEASUREMENT -> parseCSC(data)
                POWER_MEASUREMENT -> {
                    if (data.size >= 4) {
                        val watts = (data[2].toInt() and 0xFF) or ((data[3].toInt() and 0xFF) shl 8)
                        onDataReceived?.invoke(JSONObject().put("type", "power").put("value", watts))
                    }
                }
                HR_MEASUREMENT -> {
                    val flags = data[0].toInt() and 0xFF
                    val bpm = if (flags and 0x01 != 0) {
                        (data[1].toInt() and 0xFF) or ((data[2].toInt() and 0xFF) shl 8)
                    } else {
                        data[1].toInt() and 0xFF
                    }
                    val zone = when { bpm < 100 -> 1; bpm < 130 -> 2; bpm < 155 -> 3; bpm < 175 -> 4; else -> 5 }
                    onDataReceived?.invoke(JSONObject().put("type", "hr").put("bpm", bpm).put("zone", zone))
                }
                GEV_NOTIFY -> {
                    val hex = data.joinToString("") { "%02x".format(it) }
                    onDataReceived?.invoke(JSONObject().put("type", "gevRaw").put("hex", hex))
                    parseGEV(data)
                }
                PROTO_NOTIFY -> {
                    val hex = data.joinToString("") { "%02x".format(it) }
                    onDataReceived?.invoke(JSONObject().put("type", "protoRaw").put("hex", hex))
                }
                SG_NOTIFY -> {
                    if (data.size < 3 || data[0] != 0xFC.toByte()) return
                    val device = data[1].toInt() and 0xFF

                    when (device) {
                        0x23 -> {
                            if (data.size < 20) return

                            // === FC23 MULTI-CMD PARSER (b23) ===
                            // Packet: [FC][23][len][cmd][payload...][CRC]
                            // cmd 0x40: ride data (speed, motor power, ODO, SOC)
                            // cmd 0x41: motor/assist state (not ride telemetry)
                            // cmd 0x42: sensor data (zeros when stopped)
                            // cmd 0x43: battery health (dual battery life, SOC)

                            val cmdType = data[3].toInt() and 0xFF
                            val now = System.currentTimeMillis()

                            // Helper: LE uint16 from absolute data index
                            fun leU16(idx: Int): Int {
                                return (data[idx].toInt() and 0xFF) or ((data[idx + 1].toInt() and 0xFF) shl 8)
                            }
                            fun leS16(idx: Int): Int {
                                val v = leU16(idx)
                                return if (v > 32767) v - 65536 else v
                            }

                            // Throttled raw hex logging per cmd type (3s)
                            val typeKey = "fc23_$cmdType"
                            val lastLog = fc23LogTimes.getOrDefault(typeKey, 0L)
                            if (now - lastLog > 3000) {
                                fc23LogTimes[typeKey] = now
                                val rawHex = data.joinToString(" ") { "%02X".format(it) }
                                onDataReceived?.invoke(JSONObject()
                                    .put("type", "fc23raw")
                                    .put("cmd", cmdType)
                                    .put("hex", rawHex))
                            }

                            when (cmdType) {
                                0x40 -> {
                                    // RIDE DATA (indexZero) — from RideControl resolveTd23Data decompilation
                                    // Byte layout confirmed from g8/x4.java:727
                                    val speed = leU16(4) / 10.0         // [4-5] speed km/h
                                    val torqueNm = leS16(6) / 10.0      // [6-7] torque Nm (signed)
                                    val cadenceRpm = leU16(8) / 10.0    // [8-9] cadence RPM
                                    val assistCurrentA = leU16(10) / 100.0 // [10-11] assist current A
                                    val tripDistKm = leU16(12) / 10.0   // [12-13] trip/ODO distance km
                                    val tripTimeSec = leU16(14)          // [14-15] trip time seconds
                                    val powerW = leS16(16) / 10.0       // [16-17] power watts
                                    val soc = data[18].toInt() and 0xFF  // [18] battery SOC

                                    if (now - lastTelemetryLog > 2000) {
                                        lastTelemetryLog = now
                                        Log.i(TAG, "RIDE: spd=%.1f trq=%.1f cad=%.0f pwr=%.0f cur=%.2fA dist=%.1f t=%ds"
                                            .format(speed, torqueNm, cadenceRpm, powerW, assistCurrentA, tripDistKm, tripTimeSec))
                                    }

                                    onDataReceived?.invoke(JSONObject()
                                        .put("type", "sgRiding")
                                        .put("speed", speed)
                                        .put("torqueNm", torqueNm)
                                        .put("cadenceRpm", cadenceRpm)
                                        .put("assistCurrentA", assistCurrentA)
                                        .put("tripDistKm", tripDistKm)
                                        .put("tripTimeSec", tripTimeSec)
                                        .put("powerW", powerW)
                                        .put("batterySoc", soc)
                                        // Legacy compat fields
                                        .put("motorWatts", powerW)
                                        .put("odo", tripDistKm))

                                    // PWA compat broadcasts
                                    if (speed > 0.5) onDataReceived?.invoke(JSONObject().put("type", "speed").put("value", speed))
                                    if (powerW > 0) onDataReceived?.invoke(JSONObject().put("type", "power").put("value", powerW.toInt()))
                                    if (cadenceRpm > 0) onDataReceived?.invoke(JSONObject().put("type", "cadence").put("value", cadenceRpm.toInt()))
                                }
                                0x42 -> {
                                    // SENSOR/ESHIFT DATA (indexTwo) — from resolveTd23Data decompilation
                                    // byte[7] (raw offset, = extracted[5]) contains eShift gear info:
                                    //   bits 5-7: front gear level (0-7)
                                    //   bits 0-4: rear gear level (0-31)
                                    val gearByte = data[7].toInt() and 0xFF
                                    val frontGear = (gearByte shr 5) and 0x07
                                    val rearGear = gearByte and 0x1F

                                    val payload = data.copyOfRange(4, 19)
                                    val hasData = payload.any { it != 0.toByte() }
                                    if (hasData) {
                                        if (now - fc23LogTimes.getOrDefault("cmd42", 0L) > 3000) {
                                            fc23LogTimes["cmd42"] = now
                                            Log.i(TAG, "C42: front=%d rear=%d raw=%02X".format(frontGear, rearGear, gearByte))
                                        }
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "fc23cmd42")
                                            .put("frontGear", frontGear)
                                            .put("rearGear", rearGear)
                                            .put("gearByte", gearByte))
                                    }
                                }
                                0x43 -> {
                                    // BATTERY — byte[4]=bat1 SOC%, byte[5]=bat2 SOC%
                                    // byte[8] is NOT combined SOC (fluctuates wildly, unreliable)
                                    // Combined SOC = weighted average: (bat1×800 + bat2×250) / 1050
                                    val bat1Soc = data[4].toInt() and 0xFF
                                    val bat2Soc = data[5].toInt() and 0xFF
                                    val combinedSoc = Math.round((bat1Soc * 800f + bat2Soc * 250f) / 1050f).toInt()

                                    // Only send combined SOC from cmd 43 — individual SOC
                                    // comes from cmd 19/55 (calibrated, more accurate)
                                    // cmd 43 bytes are voltage-based and less reliable
                                    onDataReceived?.invoke(JSONObject()
                                        .put("type", "battery").put("value", combinedSoc))

                                    if (now - fc23LogTimes.getOrDefault("bat43", 0L) > 5000) {
                                        fc23LogTimes["bat43"] = now
                                        Log.i(TAG, "BAT43: bat1=%d%% bat2=%d%% combined=%d%%"
                                            .format(bat1Soc, bat2Soc, combinedSoc))
                                    }
                                }
                                0x41 -> {
                                    // MOTOR/ASSIST STATE — parsed using RideControl's resolveTd23Data format
                                    // FC23 cmd 0x41 = "indexOne" (part two) in the Td23 stream
                                    // Wire modes 1:1: 1=ECO, 2=TOUR, 3=ACTIVE, 4=SPORT, 5=POWER, 6=SMART
                                    // (confirmed by user with v0.9.2)
                                    // Remaining range = uint16 LE at bytes[5-6]
                                    val wireMode = data[7].toInt() and 0xFF
                                    val b5 = data[5].toInt() and 0xFF
                                    val b6 = data[6].toInt() and 0xFF
                                    val b14 = data[14].toInt() and 0xFF
                                    // uint16 LE remaining range for current mode (direct from motor!)
                                    val currentRange = b5 or (b6 shl 8)
                                    if (now - fc23LogTimes.getOrDefault("cmd41", 0L) > 2000) {
                                        fc23LogTimes["cmd41"] = now
                                        Log.i(TAG, "C41: mode=%d range=%dkm b14=%d".format(wireMode, currentRange, b14))
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "fc23cmd41")
                                            .put("wireMode", wireMode)
                                            .put("currentRange", currentRange)
                                            .put("b14", b14))
                                    }
                                }
                            }
                        }
                        0x22 -> {
                            // Heartbeat confirmation
                            onDataReceived?.invoke(JSONObject().put("type", "sgHeartbeat"))
                        }
                        0x21 -> {
                            // AES encrypted response
                            if (data.size >= 20) {
                                val keyIdx = data[18].toInt() and 0xFF
                                val aesBlock = data.copyOfRange(2, 18)
                                val dec = GEVCrypto.decrypt(aesBlock, keyIdx)
                                val dHex = dec.joinToString("") { "%02x".format(it) }
                                Log.i(TAG, "★ SG21 decrypted K$keyIdx: $dHex")

                                val cmdId = dec[0].toInt() and 0xFF
                                onDataReceived?.invoke(JSONObject()
                                    .put("type", "sgResponse")
                                    .put("cmd", cmdId)
                                    .put("key", keyIdx)
                                    .put("decrypted", dHex))

                                // Parse specific responses
                                when (cmdId) {
                                    0x02 -> {
                                        // CONNECT_GEV response
                                        val success = dec[2] == 0x01.toByte()
                                        Log.i(TAG, "★ CONNECT response: ${if (success) "SUCCESS" else "FAIL"}")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "sgConnected")
                                            .put("success", success))
                                    }
                                    0x11 -> {
                                        // cmd 17: REMAINING RANGE per mode (motor-calculated)
                                        // SG sends TWO responses: K14 = real data, K10 = ACK (zeros)
                                        // Must ignore ACK responses where power ≤ 10
                                        fun u8(b: Byte): Int = b.toInt() and 0xFF

                                        val power = u8(dec[7])    // Power+ = POWER mode
                                        val sport = u8(dec[8])    // Climb+ = SPORT mode
                                        val active = u8(dec[9])   // Climb = ACTIVE mode
                                        var tour = u8(dec[12])    // Tour = TOUR mode
                                        var eco = u8(dec[2])      // Eco
                                        var smart = u8(dec[13])   // Smart

                                        val rawHex = dec.joinToString("") { "%02x".format(it) }

                                        // Skip ACK/garbage responses (K10 has all near-zero)
                                        if (power <= 10) {
                                            Log.i(TAG, "★ RANGE ACK (skip): power=$power raw=$rawHex")
                                        } else {
                                            // Semantic overflow: ECO/TOUR/SMART must have more range than ACTIVE
                                            if (eco <= active) eco = -1
                                            if (tour <= active) tour = -1
                                            if (smart <= active) smart = -1

                                            Log.i(TAG, "★ RANGE: eco=%d tour=%d active=%d sport=%d power=%d smart=%d raw=%s"
                                                .format(eco, tour, active, sport, power, smart, rawHex))
                                            onDataReceived?.invoke(JSONObject()
                                                .put("type", "rangePerMode")
                                                .put("eco", eco)
                                                .put("tour", tour)
                                                .put("active", active)
                                                .put("sport", sport)
                                                .put("power", power)
                                                .put("smart", smart)
                                                .put("raw", rawHex))
                                        }
                                    }
                                    0x0D -> {
                                        // cmd 13: MAIN battery firmware
                                        // [2]=sw1, [3]=sw2 → "XXYY" format
                                        val sw = "%02X%02X".format(dec[2], dec[3])
                                        val hw = String(dec.copyOfRange(2, 14).filter { it != 0.toByte() }.toByteArray())
                                        Log.i(TAG, "★ MAIN BAT FW: sw=$sw hw=$hw")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "batteryInfo")
                                            .put("battery", "main")
                                            .put("field", "firmware")
                                            .put("softwareVersion", sw)
                                            .put("hardwareVersion", hw)
                                            .put("raw", dec.joinToString("") { "%02x".format(it) }))
                                    }
                                    0x0E -> {
                                        // cmd 14: MAIN battery cycles
                                        // [2-3]=LE uint16 cycles
                                        val cycles = (dec[2].toInt() and 0xFF) or ((dec[3].toInt() and 0xFF) shl 8)
                                        Log.i(TAG, "★ MAIN BAT CYCLES: $cycles")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "batteryInfo")
                                            .put("battery", "main")
                                            .put("field", "cycles")
                                            .put("cycles", cycles))
                                    }
                                    0x13 -> {
                                        // cmd 19: MAIN battery level + health
                                        val level = dec[2].toInt() and 0xFF  // capacity %
                                        val health = dec[3].toInt() and 0xFF // health %
                                        Log.i(TAG, "★ MAIN BAT: capacity=$level% health=$health%")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "batteryInfo")
                                            .put("battery", "main")
                                            .put("field", "level")
                                            .put("capacity", level)
                                            .put("health", health))
                                    }
                                    0x37 -> {
                                        // cmd 55: SUB battery level + health
                                        val level = dec[2].toInt() and 0xFF
                                        val health = dec[3].toInt() and 0xFF
                                        Log.i(TAG, "★ SUB BAT: capacity=$level% health=$health%")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "batteryInfo")
                                            .put("battery", "sub")
                                            .put("field", "level")
                                            .put("capacity", level)
                                            .put("health", health))
                                    }
                                    0x38 -> {
                                        // cmd 56: SUB battery firmware
                                        val sw = "%02X%02X".format(dec[2], dec[3])
                                        Log.i(TAG, "★ SUB BAT FW: sw=$sw")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "batteryInfo")
                                            .put("battery", "sub")
                                            .put("field", "firmware")
                                            .put("softwareVersion", sw)
                                            .put("raw", dec.joinToString("") { "%02x".format(it) }))
                                    }
                                    0x39 -> {
                                        // cmd 57: SUB battery cycles
                                        val cycles = (dec[2].toInt() and 0xFF) or ((dec[3].toInt() and 0xFF) shl 8)
                                        Log.i(TAG, "★ SUB BAT CYCLES: $cycles")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "batteryInfo")
                                            .put("battery", "sub")
                                            .put("field", "cycles")
                                            .put("cycles", cycles))
                                    }
                                    0x06 -> {
                                        // cmd 6: MODE USAGE PERCENTAGES (PASSIVE_DATA_RIDE_CONTROL_2)
                                        // 13 bytes: % time in each mode
                                        val hex = dec.joinToString("") { "%02x".format(it) }
                                        val modeNames = listOf("smart","boostPlus","boost","powerPlus","power","climbPlus","climb","normalPlus","normal","tourPlus","tour","eco","off")
                                        val json = JSONObject().put("type", "modeUsage").put("raw", hex)
                                        for (i in modeNames.indices) {
                                            val pct = if (i + 2 < dec.size) dec[i + 2].toInt() and 0xFF else 0
                                            json.put(modeNames[i], pct)
                                        }
                                        Log.i(TAG, "★ MODE_USAGE: eco=${json.optInt("eco")}% tour=${json.optInt("tour")}% active=${json.optInt("climb")}% sport=${json.optInt("climbPlus")}% power=${json.optInt("powerPlus")}%")
                                        onDataReceived?.invoke(json)
                                    }
                                    0x0A -> {
                                        // cmd 10: MOTOR AVG CURRENT PER MODE (PASSIVE_DATA_SYNC_DRIVE_2)
                                        // [2-3]=serviceToolTimes, [4-5]=lastServiceHour, [6-7]=lastServiceKm
                                        // [8-9]=boostAvgA, [10-11]=powerAvgA, [12-13]=climbAvgA
                                        fun avgA(off: Int): Double = ((dec[off].toInt() and 0xFF) or ((dec[off+1].toInt() and 0xFF) shl 8)) / 100.0
                                        val svcTimes = (dec[2].toInt() and 0xFF) or ((dec[3].toInt() and 0xFF) shl 8)
                                        val svcHour = (dec[4].toInt() and 0xFF) or ((dec[5].toInt() and 0xFF) shl 8)
                                        val svcKm = (dec[6].toInt() and 0xFF) or ((dec[7].toInt() and 0xFF) shl 8)
                                        val hex = dec.joinToString("") { "%02x".format(it) }
                                        Log.i(TAG, "★ MOTOR_AVG: svc=%d h=%d km=%d boostA=%.2f powerA=%.2f climbA=%.2f raw=%s"
                                            .format(svcTimes, svcHour, svcKm, avgA(8), avgA(10), avgA(12), hex))
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "motorAvgCurrent")
                                            .put("serviceToolTimes", svcTimes)
                                            .put("lastServiceHour", svcHour)
                                            .put("lastServiceKm", svcKm)
                                            .put("boostAvgA", avgA(8))
                                            .put("powerAvgA", avgA(10))
                                            .put("climbAvgA", avgA(12))
                                            .put("raw", hex))
                                    }
                                    0x12 -> {
                                        // cmd 18: ODO + TOTAL USAGE HOURS (ACTIVE_DATA_SYNC_DRIVE_1)
                                        val motorOdo = (dec[2].toInt() and 0xFF) or ((dec[3].toInt() and 0xFF) shl 8)
                                        val totalHours = (dec[4].toInt() and 0xFF) or ((dec[5].toInt() and 0xFF) shl 8)
                                        val hex = dec.joinToString("") { "%02x".format(it) }
                                        Log.i(TAG, "★ MOTOR_ODO: odo=%dkm hours=%dh raw=%s".format(motorOdo, totalHours, hex))
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "motorOdoHours")
                                            .put("motorOdo", motorOdo)
                                            .put("totalHours", totalHours)
                                            .put("raw", hex))
                                    }
                                    0x10 -> {
                                        // cmd 16: BATTERY CAPACITY DETAILS (PASSIVE_DATA_ENERGY_PAK_4)
                                        val maxNotChargedDay = (dec[2].toInt() and 0xFF) or ((dec[3].toInt() and 0xFF) shl 8)
                                        val notChargedCycles = (dec[4].toInt() and 0xFF) or ((dec[5].toInt() and 0xFF) shl 8)
                                        val epCapacity = ((dec[6].toInt() and 0xFF) or ((dec[7].toInt() and 0xFF) shl 8)) / 10.0
                                        val hex = dec.joinToString("") { "%02x".format(it) }
                                        Log.i(TAG, "★ BAT_CAP: notChgDays=%d notChgCycles=%d capacity=%.1fAh raw=%s"
                                            .format(maxNotChargedDay, notChargedCycles, epCapacity, hex))
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "batteryCapacity")
                                            .put("maxNotChargedDay", maxNotChargedDay)
                                            .put("notChargedCycles", notChargedCycles)
                                            .put("epCapacity", epCapacity)
                                            .put("raw", hex))
                                    }
                                    0x2C -> {
                                        // Tuning data response
                                        val hex = dec.joinToString("") { "%02x".format(it) }
                                        Log.i(TAG, "★ TUNING: $hex")

                                        // Motor ACK verification — compare received vs last sent
                                        if (awaitingTuningAck && dec.size >= 5) {
                                            awaitingTuningAck = false
                                            val b2 = dec[2].toInt() and 0xFF
                                            val b3 = dec[3].toInt() and 0xFF
                                            val b4 = dec[4].toInt() and 0xFF
                                            val recvP = b2 and 0x0F; val recvS = (b2 shr 4) and 0x0F
                                            val recvA = b3 and 0x0F; val recvT = (b3 shr 4) and 0x0F
                                            val recvE = b4 and 0x0F
                                            Log.i(TAG, "★ TUNING READBACK: PWR=$recvP SPT=$recvS ACT=$recvA TUR=$recvT ECO=$recvE")

                                            lastSentTuning?.let { sent ->
                                                val match = sent[0] == recvP && sent[1] == recvS && sent[2] == recvA && sent[3] == recvT && sent[4] == recvE
                                                if (match) {
                                                    Log.i(TAG, "✓ MOTOR ACK: tuning values CONFIRMED by motor")
                                                } else {
                                                    Log.e(TAG, "✗ MOTOR REJECTED: sent=[${sent.joinToString()}] recv=[$recvP,$recvS,$recvA,$recvT,$recvE]")
                                                }
                                            }
                                            lastSentAdvanced?.let { sent ->
                                                // For advanced tuning, just log the readback since 0x2C only returns basic levels
                                                Log.i(TAG, "✓ ADV_TUNE readback OK (0x2C basic levels). Sent PWR(s=${sent[0]} t=${sent[1]} l=${sent[2]})")
                                            }
                                        }

                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "sgTuning")
                                            .put("hex", hex))
                                    }
                                    0x1B -> {
                                        // READ_RIDING_DATA response — accumulate bytes[2..15] (14 bytes)
                                        // Log FULL decrypted block to check for framing issues
                                        val fullDec = dec.joinToString(" ") { "%02X".format(it) }
                                        Log.i(TAG, "★ RIDE_FC21 full: $fullDec")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "fc21RideRaw")
                                            .put("hex", fullDec)
                                            .put("chunk", rideDataAccum.size / 14 + 1))
                                        if (rideDataPending) {
                                            val chunk = dec.copyOfRange(2, 16)
                                            for (b in chunk) rideDataAccum.add(b)
                                            Log.i(TAG, "★ RIDE_DATA chunk: ${chunk.joinToString("") { "%02x".format(it) }} (total=${rideDataAccum.size}/28)")

                                            if (rideDataAccum.size >= 28) {
                                                rideDataPending = false
                                                val rd = rideDataAccum.toByteArray()
                                                // Parse using RideControl's exact format (all confirmed /10 divisors)
                                                fun rdS16(off: Int): Int {
                                                    val v = (rd[off].toInt() and 0xFF) or ((rd[off + 1].toInt() and 0xFF) shl 8)
                                                    return if (v > 32767) v - 65536 else v
                                                }
                                                fun rdU16(off: Int): Int {
                                                    return (rd[off].toInt() and 0xFF) or ((rd[off + 1].toInt() and 0xFF) shl 8)
                                                }

                                                val speed = rdS16(0) / 10.0
                                                val torque = rdS16(2) / 10.0
                                                val cadence = rdS16(4) / 10.0
                                                val acurValue = rdU16(6) / 100.0
                                                val tripDist = rdS16(8) / 10.0
                                                val tripTime = rdU16(10)
                                                val power = rdS16(12) / 10.0
                                                val carr = rd[14].toInt() and 0xFF
                                                val rsoc = rd[15].toInt() and 0xFF
                                                val errCode = rd[16].toInt()

                                                val rdHex = rd.joinToString(" ") { "%02x".format(it) }
                                                Log.i(TAG, "★ RIDE_FULL: spd=%.1f trq=%.1f cad=%.1f pwr=%.1f car=%d soc=%d err=%d"
                                                    .format(speed, torque, cadence, power, carr, rsoc, errCode))
                                                Log.i(TAG, "★ RIDE_RAW: $rdHex")

                                                onDataReceived?.invoke(JSONObject()
                                                    .put("type", "sgRideDataPoll")
                                                    .put("speed", speed)
                                                    .put("torque", torque)
                                                    .put("cadence", cadence)
                                                    .put("power", power)
                                                    .put("assistRatio", carr)
                                                    .put("batterySoc", rsoc)
                                                    .put("tripDistance", tripDist)
                                                    .put("tripTime", tripTime)
                                                    .put("accumCurrent", acurValue)
                                                    .put("errorCode", errCode)
                                                    .put("rawHex", rdHex))

                                                // Broadcast cadence if we got it
                                                if (cadence > 0) onDataReceived?.invoke(JSONObject()
                                                    .put("type", "cadence").put("value", cadence.toInt()))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Parse error: ${e.message}")
        }
    }

    // DeviceInfo reads are serialized via pendingReads queue — no separate method needed

    private fun parseCSC(data: ByteArray) {
        if (data.size < 7) return
        val flags = data[0].toInt() and 0xFF
        var offset = 1

        if (flags and 0x01 != 0) {
            val wheelRevs = ((data[offset].toLong() and 0xFF) or
                    ((data[offset + 1].toLong() and 0xFF) shl 8) or
                    ((data[offset + 2].toLong() and 0xFF) shl 16) or
                    ((data[offset + 3].toLong() and 0xFF) shl 24))
            val wheelTime = ((data[offset + 4].toInt() and 0xFF) or
                    ((data[offset + 5].toInt() and 0xFF) shl 8)).toLong()
            offset += 6

            if (lastWheelRevs > 0 && wheelRevs > lastWheelRevs) {
                val revDiff = wheelRevs - lastWheelRevs
                var timeDiff = wheelTime - lastWheelTime
                if (timeDiff < 0) timeDiff += 65536

                if (timeDiff > 0) {
                    val speedMps = (revDiff * wheelCircumference) / (timeDiff / 1024.0)
                    val speedKmh = speedMps * 3.6
                    totalDistance += revDiff * wheelCircumference / 1000.0

                    onDataReceived?.invoke(JSONObject()
                        .put("type", "speed")
                        .put("value", "%.1f".format(speedKmh).toDouble()))
                    onDataReceived?.invoke(JSONObject()
                        .put("type", "distance")
                        .put("value", "%.2f".format(totalDistance).toDouble()))
                }
            }
            lastWheelRevs = wheelRevs
            lastWheelTime = wheelTime
        }

        if (flags and 0x02 != 0 && offset + 3 < data.size) {
            val crankTime = ((data[offset + 2].toInt() and 0xFF) or
                    ((data[offset + 3].toInt() and 0xFF) shl 8))
            if (crankTime > 0) {
                val cadence = (60 * 1024) / crankTime
                onDataReceived?.invoke(JSONObject().put("type", "cadence").put("value", cadence))
            }
        }
    }

    private fun parseGEV(data: ByteArray) {
        if (data.size < 6) return
        if (data[0] != 0xFC.toByte()) return

        val cmdId = data[2].toInt() and 0xFF
        when (cmdId) {
            0x15 -> {
                val mode = data[4].toInt() and 0xFF
                val current = if (data.size > 5) data[5].toInt() and 0xFF else 0
                onDataReceived?.invoke(JSONObject()
                    .put("type", "assistMode").put("value", mode).put("current", current))
            }
            0x03 -> {
                if (data.size >= 8) {
                    val pct = data[4].toInt() and 0xFF
                    val voltage = ((data[5].toInt() and 0xFF) or ((data[6].toInt() and 0xFF) shl 8)) / 100.0
                    val temp = data[7].toInt() and 0xFF
                    onDataReceived?.invoke(JSONObject()
                        .put("type", "gevBattery").put("percent", pct).put("voltage", voltage).put("temp", temp))
                }
            }
            0x38 -> {
                if (data.size >= 12) {
                    val speed = ((data[4].toInt() and 0xFF) or ((data[5].toInt() and 0xFF) shl 8)) / 10.0
                    val power = ((data[10].toInt() and 0xFF) or ((data[11].toInt() and 0xFF) shl 8)) / 10.0
                    onDataReceived?.invoke(JSONObject()
                        .put("type", "gevRiding").put("speed", speed).put("power", power))
                }
            }
        }
    }

    private fun processNextRead(g: BluetoothGatt) {
        if (pendingReads.isNotEmpty()) {
            val char = pendingReads.removeAt(0)
            val cShort = char.uuid.toString().substring(4, 8).uppercase()
            Log.i(TAG, "Reading [$cShort]... (${pendingReads.size} remaining)")
            g.readCharacteristic(char)
        } else {
            // All reads done → start notification subscriptions
            Log.i(TAG, "All reads done → enabling ${pendingNotifications.size} notifications...")
            enableNextNotification(g)
        }
    }

    private fun describeProperties(props: Int): String {
        val flags = mutableListOf<String>()
        if (props and 0x01 != 0) flags.add("BROADCAST")
        if (props and 0x02 != 0) flags.add("READ")
        if (props and 0x04 != 0) flags.add("WRITE_NO_RSP")
        if (props and 0x08 != 0) flags.add("WRITE")
        if (props and 0x10 != 0) flags.add("NOTIFY")
        if (props and 0x20 != 0) flags.add("INDICATE")
        if (props and 0x40 != 0) flags.add("SIGNED_WRITE")
        if (props and 0x80 != 0) flags.add("EXTENDED")
        return flags.joinToString("|")
    }

    fun writeAssistMode(mode: Int) {
        val g = gatt ?: return
        val char = gevChar ?: run {
            Log.w(TAG, "GEV not available — cannot change assist mode")
            return
        }

        val packet = byteArrayOf(
            0xFC.toByte(), 0x21, 0xE2.toByte(), 0x01, mode.toByte()
        )
        var sum = 0
        for (b in packet) sum += b.toInt() and 0xFF
        val fullPacket = packet + byteArrayOf(((sum shr 8) and 0xFF).toByte(), (sum and 0xFF).toByte())

        char.value = fullPacket
        char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        g.writeCharacteristic(char)
        Log.i(TAG, "Sent assist mode: $mode (packet: ${fullPacket.joinToString("") { "%02x".format(it) }})")
    }

    fun writeProtoGet(module: String) {
        val g = gatt ?: return
        val char = protoWriteChar ?: return
        Log.i(TAG, "Proto GET request: $module")
    }

    /**
     * Test SG Write — session handshake then commands.
     *
     * From APK analysis:
     * - connectGEV uses session keys (0-3, 8) with sendCommandThenWaitNotifications
     * - After session: commands use key 4 (sendData) or 14 (data+cmd)
     * - "aesSe" = session encrypt, "sendD" = send data, "aesDa" = data encrypt
     *
     * Phase 1: Session handshake — CONNECT_GEV (0x00) with session keys 0-3, 8
     * Phase 2: If session works — commands with key 4 and 14
     * Phase 3: Mode change attempts
     */
    /**
     * b18: PROTOCOL CRACKED from jadx decompilation of RideControl v1.33.
     *
     * KEY FINDINGS:
     * - APP→SG starts with 0xFB (not 0xFC!)
     * - 0xFC is for SG→APP responses
     * - CONNECT_GEV: [FB,21,AES(02,00,zeros,key0),keyIdx=0,XOR_CRC] = 20 bytes
     * - enableRidingNotification: [FB,22,01,CRC] = 4 bytes → triggers FC23 telemetry
     * - CRC = XOR of all preceding bytes
     * - ASSIST_UP: [FB,21,AES(1C,03,02,00,00,zeros,key3),keyIdx=3,CRC]
     */
    /**
     * Auto-start GEV session after BLE connection + subscriptions.
     * Sends CONNECT_GEV (0x02) + enableRidingNotification to trigger FC23 telemetry.
     * Without this, the SG only responds to standard BLE services (battery, CSC, power).
     * FC23 telemetry gives us: speed, motor power, SOC, ODO, assist mode (cmd 0x41).
     */
    fun startGEVSession() {
        val g = gatt ?: return
        val char = sgWriteChar ?: run {
            Log.i(TAG, "startGEVSession: SG Write char not available — skipping")
            return
        }

        Log.i(TAG, "★ AUTO-START GEV SESSION")

        // CONNECT_GEV: [FB, 21, AES(02,00,zeros×14, key0), keyIdx=0, CRC]
        val connectPlain = ByteArray(16).also { it[0] = 0x02; it[1] = 0x00 }
        val connectEnc = GEVCrypto.encrypt(connectPlain, 0)
        val connectPkt = ByteArray(20)
        connectPkt[0] = 0xFB.toByte()
        connectPkt[1] = 0x21
        System.arraycopy(connectEnc, 0, connectPkt, 2, 16)
        connectPkt[18] = 0x00
        var xor = 0; for (i in 0..18) xor = xor xor (connectPkt[i].toInt() and 0xFF)
        connectPkt[19] = xor.toByte()

        // enableRidingNotification: [FB, 22, 01, CRC=D8]
        val enableRiding = byteArrayOf(0xFB.toByte(), 0x22, 0x01, 0xD8.toByte())

        // Send CONNECT_GEV
        char.value = connectPkt
        char.writeType = android.bluetooth.BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        g.writeCharacteristic(char)
        Log.i(TAG, ">>> CONNECT_GEV sent")
        onDataReceived?.invoke(org.json.JSONObject()
            .put("type", "sgCmd").put("name", "AUTO_CONNECT_GEV").put("ok", true))

        // Send enableRiding after 1s delay
        handler.postDelayed({
            char.value = enableRiding
            char.writeType = android.bluetooth.BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            g.writeCharacteristic(char)
            Log.i(TAG, ">>> ENABLE_RIDING sent — FC23 telemetry should start")
            onDataReceived?.invoke(org.json.JSONObject()
                .put("type", "sgCmd").put("name", "AUTO_ENABLE_RIDING").put("ok", true))
        }, 1000)

        // Repeat enableRiding a few times (sometimes first one is missed)
        for (i in 1..3) {
            handler.postDelayed({
                char.value = enableRiding
                char.writeType = android.bluetooth.BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                g.writeCharacteristic(char)
            }, (1000 + i * 2000).toLong())
        }
    }

    fun testSGWrite() {
        val g = gatt ?: return
        val char = sgWriteChar ?: run {
            Log.w(TAG, "SG Write char not available!")
            onStatusChanged?.invoke("SG not connected")
            return
        }

        val tests = mutableListOf<Pair<String, ByteArray>>()

        // === STEP 1: CONNECT_GEV ===
        // Plaintext: [0x02, 0x00, zeros×14] = 16 bytes
        // Encrypt with key 0, packet: [FB, 21, AES(16), keyIdx=0, CRC]
        val connectPlain = ByteArray(16).also { it[0] = 0x02; it[1] = 0x00 }
        val connectEnc = GEVCrypto.encrypt(connectPlain, 0)
        val connectPkt = ByteArray(20)
        connectPkt[0] = 0xFB.toByte()
        connectPkt[1] = 0x21
        System.arraycopy(connectEnc, 0, connectPkt, 2, 16)
        connectPkt[18] = 0x00  // key index
        var xor = 0; for (i in 0..18) xor = xor xor (connectPkt[i].toInt() and 0xFF)
        connectPkt[19] = xor.toByte()
        tests.add("CONNECT_GEV" to connectPkt)

        // === STEP 2: enableRidingNotification ===
        // [FB, 22, 01, CRC] where CRC = FB^22^01 = D8
        tests.add("ENABLE_RIDING" to byteArrayOf(0xFB.toByte(), 0x22, 0x01, 0xD8.toByte()))

        // === STEP 3: Wait and check for telemetry (FC 23 packets) ===
        // (handled by the heartbeat timer below)

        // === STEP 4: ASSIST_UP ===
        // Plaintext: [1C, 03, 02, 00, 00, zeros×11]
        val assistUpPlain = ByteArray(16).also { it[0] = 0x1C; it[1] = 0x03; it[2] = 0x02 }
        val assistUpEnc = GEVCrypto.encrypt(assistUpPlain, 3)
        val assistUpPkt = ByteArray(20)
        assistUpPkt[0] = 0xFB.toByte()
        assistUpPkt[1] = 0x21
        System.arraycopy(assistUpEnc, 0, assistUpPkt, 2, 16)
        assistUpPkt[18] = 0x03  // key index
        xor = 0; for (i in 0..18) xor = xor xor (assistUpPkt[i].toInt() and 0xFF)
        assistUpPkt[19] = xor.toByte()
        tests.add("ASSIST_UP" to assistUpPkt)

        // === STEP 5: READ_BATTERY ===
        // cmd=19 (0x13), bike data command, key 0
        val battPlain = ByteArray(16).also { it[0] = 0x13; it[1] = 0x00 }
        val battEnc = GEVCrypto.encrypt(battPlain, 0)
        val battPkt = ByteArray(20)
        battPkt[0] = 0xFB.toByte()
        battPkt[1] = 0x21
        System.arraycopy(battEnc, 0, battPkt, 2, 16)
        battPkt[18] = 0x00
        xor = 0; for (i in 0..18) xor = xor xor (battPkt[i].toInt() and 0xFF)
        battPkt[19] = xor.toByte()
        tests.add("READ_BATTERY" to battPkt)

        // === STEP 6: READ_TUNING ===
        val tunePlain = ByteArray(16).also { it[0] = 0x2C; it[1] = 0x00 }
        val tuneEnc = GEVCrypto.encrypt(tunePlain, 0)
        val tunePkt = ByteArray(20)
        tunePkt[0] = 0xFB.toByte()
        tunePkt[1] = 0x21
        System.arraycopy(tuneEnc, 0, tunePkt, 2, 16)
        tunePkt[18] = 0x00
        xor = 0; for (i in 0..18) xor = xor xor (tunePkt[i].toInt() and 0xFF)
        tunePkt[19] = xor.toByte()
        tests.add("READ_TUNING" to tunePkt)

        // Heartbeat again
        tests.add("HEARTBEAT3" to byteArrayOf(0xFC.toByte(), 0x22, 0x00, 0xDE.toByte()))

        // === READ_RIDING_DATA (cmd 0x1B, key 0) ===
        // Sends encrypted poll for full telemetry (speed/torque/cadence/power)
        // Expects 2 FC21 responses, each with 14 bytes of data = 28 total
        val rideReadPlain = ByteArray(16).also { it[0] = 0x1B; it[1] = 0x00 }
        val rideReadEnc = GEVCrypto.encrypt(rideReadPlain, 0)
        val rideReadPkt = ByteArray(20)
        rideReadPkt[0] = 0xFB.toByte()
        rideReadPkt[1] = 0x21
        System.arraycopy(rideReadEnc, 0, rideReadPkt, 2, 16)
        rideReadPkt[18] = 0x00
        xor = 0; for (i in 0..18) xor = xor xor (rideReadPkt[i].toInt() and 0xFF)
        rideReadPkt[19] = xor.toByte()
        rideDataAccum.clear()
        rideDataPending = true
        tests.add("READ_RIDING" to rideReadPkt)

        // Wait 3 seconds then check if spontaneous data arrives
        // (heartbeat might trigger data flow)

        Log.i(TAG, "╔═══════════════════════════════════════╗")
        Log.i(TAG, "║  nRF-BASED TEST — ${tests.size} packets      ║")
        Log.i(TAG, "║  Heartbeat + XOR checksum + dev 0x23  ║")
        Log.i(TAG, "╚═══════════════════════════════════════╝")
        onStatusChanged?.invoke("nRF test (${tests.size} packets)...")

        for ((i, test) in tests.withIndex()) {
            val (name, data) = test
            handler.postDelayed({
                val hex = data.joinToString("") { "%02x".format(it) }
                Log.i(TAG, ">>> SG [$name]: $hex (${data.size}b)")
                onDataReceived?.invoke(JSONObject()
                    .put("type", "sgWriteTest")
                    .put("name", name)
                    .put("hex", hex)
                    .put("size", data.size))

                char.value = data
                // RideControl uses WRITE_TYPE_NO_RESPONSE (WriteType=1)
                char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                val ok = g.writeCharacteristic(char)
                onDataReceived?.invoke(JSONObject()
                    .put("type", "sgWriteResult")
                    .put("name", name)
                    .put("ok", ok))
            }, (i * 1000).toLong())  // 1s between to observe responses
        }

        // After writes, send enableRiding again periodically (in case first one was missed)
        val enableRiding = byteArrayOf(0xFB.toByte(), 0x22, 0x01, 0xD8.toByte())
        val startDelay = (tests.size * 1000 + 500).toLong()
        for (i in 0..14) {
            handler.postDelayed({
                char.value = enableRiding
                char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                g.writeCharacteristic(char)
                if (i == 0) Log.i(TAG, ">>> Repeating enableRiding 15s...")
                if (i == 14) {
                    Log.i(TAG, ">>> TEST COMPLETE")
                    onStatusChanged?.invoke("Test done — check log for SG data")
                }
            }, startDelay + (i * 1000).toLong())
        }
    }

    /**
     * Passive listen — NO writes, just wait for spontaneous SG data.
     * If nRF Connect receives data without writing, we should too.
     */
    fun passiveListen() {
        Log.i(TAG, "╔═══════════════════════════════════════╗")
        Log.i(TAG, "║  PASSIVE LISTEN — no writes, just     ║")
        Log.i(TAG, "║  waiting for SG spontaneous data      ║")
        Log.i(TAG, "╚═══════════════════════════════════════╝")
        onStatusChanged?.invoke("Passive listen — 30s, no writes...")

        // Just wait and log — if SG sends FC23 data spontaneously we'll see it
        handler.postDelayed({
            Log.i(TAG, ">>> 30s passive listen complete")
            onStatusChanged?.invoke("Listen done — any SG data?")
        }, 30000)
    }

    /**
     * Build SG packet with CORRECT XOR checksum (from nRF capture analysis).
     * Format: [FC][device][len][cmd][payload][XOR_checksum]
     * len = remaining bytes from cmd to end (inclusive of checksum)
     */
    private fun buildSGPacket(device: Int, cmdId: Int, payload: ByteArray): ByteArray {
        val len = payload.size + 2  // cmd + payload + checksum
        val pkt = byteArrayOf(
            0xFC.toByte(), device.toByte(), len.toByte(), cmdId.toByte()
        ) + payload
        var xor = 0
        for (b in pkt) xor = xor xor (b.toInt() and 0xFF)
        return pkt + byteArrayOf(xor.toByte())
    }

    // Keep old format for backwards compat
    private fun buildGevPacket(cmdId: Int, payload: ByteArray): ByteArray {
        return buildSGPacket(0x21, cmdId, payload)
    }

    /**
     * Send an AES-encrypted GEV command (FB 21 format).
     * Used for ASSIST UP/DOWN, LIGHT, etc.
     * @param plaintext 16-byte plaintext (cmd + params + zeros)
     * @param keyIdx AES key index (0-14)
     * @param label human-readable name for logging
     */
    fun sendEncryptedCommand(plaintext: ByteArray, keyIdx: Int, label: String) {
        val g = gatt ?: run {
            Log.e(TAG, "sendCmd: no gatt connection")
            onDataReceived?.invoke(JSONObject().put("type", "cmdError").put("msg", "Not connected"))
            return
        }
        val svc = g.getService(SG_SERVICE) ?: run {
            Log.e(TAG, "sendCmd: SG service not found")
            return
        }
        val char = svc.getCharacteristic(SG_WRITE) ?: run {
            Log.e(TAG, "sendCmd: SG write char not found")
            return
        }

        val enc = GEVCrypto.encrypt(plaintext, keyIdx)
        val pkt = ByteArray(20)
        pkt[0] = 0xFB.toByte()
        pkt[1] = 0x21
        System.arraycopy(enc, 0, pkt, 2, 16)
        pkt[18] = keyIdx.toByte()
        var xor = 0; for (i in 0..18) xor = xor xor (pkt[i].toInt() and 0xFF)
        pkt[19] = xor.toByte()

        val hex = pkt.joinToString("") { "%02x".format(it) }
        Log.i(TAG, ">>> CMD [$label]: $hex (${pkt.size}b)")

        char.value = pkt
        char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        val ok = g.writeCharacteristic(char)

        onDataReceived?.invoke(JSONObject()
            .put("type", "sgCmd")
            .put("name", label)
            .put("ok", ok)
            .put("hex", hex))
    }

    /** Read full battery details + range for all modes */
    fun readBatteryDetails() {
        val h = android.os.Handler(android.os.Looper.getMainLooper())
        // Format: plaintext[0]=cmd, plaintext[1]=0x00, rest zeros, AES key 0
        // (same format as readTuning which uses [0x2C, 0x00, ...])
        // cmd 17 (0x11): remaining range per mode
        sendEncryptedCommand(ByteArray(16).also { it[0] = 0x11 }, 0, "RANGE_ALL_MODES")
        // cmd 13 (0x0D): main battery firmware
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x0D }, 0, "BAT_MAIN_FW") }, 400)
        // cmd 14 (0x0E): main battery cycles
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x0E }, 0, "BAT_MAIN_CYCLES") }, 800)
        // cmd 19 (0x13): main battery level + health
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x13 }, 0, "BAT_MAIN_LEVEL") }, 1200)
        // cmd 55 (0x37): sub battery level + health
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x37 }, 0, "BAT_SUB_LEVEL") }, 1600)
        // cmd 56 (0x38): sub battery firmware
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x38 }, 0, "BAT_SUB_FW") }, 2000)
        // cmd 57 (0x39): sub battery cycles
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x39 }, 0, "BAT_SUB_CYCLES") }, 2400)
        // === NEW: additional data commands from RideControl decompilation ===
        // cmd 6 (0x06): mode usage percentages (PASSIVE_DATA_RIDE_CONTROL_2)
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x06 }, 0, "MODE_USAGE") }, 2800)
        // cmd 10 (0x0A): motor avg current per mode + service stats (PASSIVE_DATA_SYNC_DRIVE_2)
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x0A }, 0, "MOTOR_AVG_CURRENT") }, 3200)
        // cmd 18 (0x12): ODO + total usage hours (ACTIVE_DATA_SYNC_DRIVE_1)
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x12 }, 0, "MOTOR_ODO_HOURS") }, 3600)
        // cmd 16 (0x10): battery capacity details (PASSIVE_DATA_ENERGY_PAK_4)
        h.postDelayed({ sendEncryptedCommand(ByteArray(16).also { it[0] = 0x10 }, 0, "BAT_CAPACITY") }, 4000)
    }

    /** Convenience: ASSIST UP — cmd=0x1C, sub=0x03, action=0x02, key 3 */
    fun assistUp() {
        logBondState("ASSIST_UP")
        val plain = ByteArray(16).also { it[0] = 0x1C; it[1] = 0x03; it[2] = 0x02 }
        sendEncryptedCommand(plain, 3, "ASSIST_UP")
    }

    /** Convenience: ASSIST DOWN — cmd=0x1C, sub=0x03, action=0x01, key 3 */
    fun assistDown() {
        logBondState("ASSIST_DOWN")
        val plain = ByteArray(16).also { it[0] = 0x1C; it[1] = 0x03; it[2] = 0x01 }
        sendEncryptedCommand(plain, 3, "ASSIST_DOWN")
    }

    /** Convenience: LIGHT TOGGLE — cmd=0x1C, sub=0x03, action=0x08, key 3 */
    fun lightToggle() {
        logBondState("LIGHT")
        val plain = ByteArray(16).also { it[0] = 0x1C; it[1] = 0x03; it[2] = 0x08 }
        sendEncryptedCommand(plain, 3, "LIGHT")
    }

    /** NORMAL MODE — exit AUTO, enter manual assist. cmd=0xA0, key 0 */
    fun normalMode() {
        logBondState("NORMAL_MODE")
        val plain = ByteArray(16).also { it[0] = 0xA0.toByte() }
        sendEncryptedCommand(plain, 0, "NORMAL_MODE")
    }

    /**
     * SET_TUNING — write tuning levels for all 5 modes.
     * cmd=0x2D, sub=0x03, key 3
     *
     * Byte layout (after cmd+sub):
     *   byte[2] = (asmo1_lv+1) | ((asmo2_lv+1) << 4)  // POWER | SPORT
     *   byte[3] = (asmo3_lv+1) | ((asmo4_lv+1) << 4)  // ACTIVE | TOUR
     *   byte[4] = (asmo5_lv+1)                          // ECO
     *
     * Levels: 0=max power, 1=medium, 2=min power
     * On wire: stored as lv+1 (1=max, 2=med, 3=min)
     *
     * @param powerLv POWER mode level (0-2)
     * @param sportLv SPORT mode level (0-2)
     * @param activeLv ACTIVE mode level (0-2)
     * @param tourLv TOUR mode level (0-2)
     * @param ecoLv ECO mode level (0-2)
     */
    fun setTuningLevels(powerLv: Int, sportLv: Int, activeLv: Int, tourLv: Int, ecoLv: Int, label: String = "SET_TUNING") {
        logBondState(label)
        val p = (powerLv + 1).coerceIn(1, 3)
        val s = (sportLv + 1).coerceIn(1, 3)
        val a = (activeLv + 1).coerceIn(1, 3)
        val t = (tourLv + 1).coerceIn(1, 3)
        val e = (ecoLv + 1).coerceIn(1, 3)

        val b2 = (p or (s shl 4)).toByte()
        val b3 = (a or (t shl 4)).toByte()
        val b4 = e.toByte()

        Log.i(TAG, "★ SET_TUNING: PWR=$powerLv SPT=$sportLv ACT=$activeLv TUR=$tourLv ECO=$ecoLv → bytes=%02X %02X %02X (key=3)"
            .format(b2.toInt() and 0xFF, b3.toInt() and 0xFF, b4.toInt() and 0xFF))

        // Track sent values for ACK verification
        lastSentTuning = intArrayOf(p, s, a, t, e)
        lastSentAdvanced = null
        awaitingTuningAck = true
        tuningAckDeadline = System.currentTimeMillis() + 2000

        val plain = ByteArray(16).also {
            it[0] = 0x2D; it[1] = 0x03
            it[2] = b2; it[3] = b3; it[4] = b4
        }
        sendEncryptedCommand(plain, 3, label)

        // Follow up with READ_TUNING to verify the change was applied
        handler.postDelayed({
            Log.i(TAG, "★ Verifying SET_TUNING with READ_TUNING (0x2C)...")
            val readPlain = ByteArray(16).also { it[0] = 0x2C; it[1] = 0x00 }
            sendEncryptedCommand(readPlain, 0, "READ_TUNING_VERIFY")
        }, 500)
    }

    /** Preset: MAX POWER — all modes at level 0 (max watts) */
    fun tuningMax() = setTuningLevels(0, 0, 0, 0, 0, "TUNE_MAX")

    /** Preset: MIN POWER — all modes at level 2 (min watts) */
    fun tuningMin() = setTuningLevels(2, 2, 2, 2, 2, "TUNE_MIN")

    /** Preset: RESTORE — original values from bike (33 22 02 = lv2,lv2,lv1,lv1,lv1) */
    fun tuningRestore() = setTuningLevels(2, 2, 1, 1, 1, "TUNE_RESTORE")

    /**
     * Test extended tuning values BEYOND the official 0-2 range.
     * Sends raw nibble values without clamping to see what the motor accepts.
     * If the motor accepts value 5 for POWER, we get finer granularity.
     */
    fun tuningExtendedTest(rawPowerVal: Int) {
        logBondState("TUNE_EXT")
        // Send raw value WITHOUT the +1 offset or clamping
        // Normal: val 1-3 on wire. Extended: try 4, 5, 6, etc.
        val wireVal = rawPowerVal.coerceIn(0, 15)  // max nibble = 0xF = 15
        val b2 = (wireVal or (2 shl 4)).toByte()  // POWER=rawVal, SPORT=lv1(normal)
        val b3 = (2 or (2 shl 4)).toByte()         // ACTIVE=lv1, TOUR=lv1
        val b4 = 2.toByte()                         // ECO=lv1

        Log.i(TAG, "★ TUNE_EXT: POWER rawWire=$wireVal → bytes=%02X %02X %02X"
            .format(b2.toInt() and 0xFF, b3.toInt() and 0xFF, b4.toInt() and 0xFF))

        val plain = ByteArray(16).also {
            it[0] = 0x2D; it[1] = 0x03
            it[2] = b2; it[3] = b3; it[4] = b4
        }
        sendEncryptedCommand(plain, 3, "TUNE_EXT_$wireVal")

        // Verify
        handler.postDelayed({
            val readPlain = ByteArray(16).also { it[0] = 0x2C; it[1] = 0x00 }
            sendEncryptedCommand(readPlain, 0, "READ_TUNE_EXT")
        }, 500)
    }

    /**
     * ADVANCED MOTOR TUNING — cmd=0xE3, sub=0x0C, key 12
     *
     * Reverse-engineered from Giant RideControl APK (MotorTuningParams).
     * Each mode has 3 parameters with 16 levels (0-15):
     *   - support: motor assist level (0=min, 15=max)
     *   - torque: motor torque response (0=min, 15=max)
     *   - launch: startup boost (0=min, 15=max)
     *
     * Wire format per mode (2 bytes):
     *   byte[n]   = support & 0x0F
     *   byte[n+1] = (torque << 4) | (launch & 0x0F)
     *
     * Order: power, sport, active, tour, eco (5 modes × 2 bytes = 10 data bytes)
     *
     * @param powerSupport  POWER mode support (0-15)
     * @param powerTorque   POWER mode torque (0-15)
     * @param powerLaunch   POWER mode launch (0-15)
     */
    fun setAdvancedTuning(
        powerSupport: Int, powerTorque: Int, powerLaunch: Int,
        sportSupport: Int = -1, sportTorque: Int = -1, sportLaunch: Int = -1,
        activeSupport: Int = -1, activeTorque: Int = -1, activeLaunch: Int = -1,
        tourSupport: Int = -1, tourTorque: Int = -1, tourLaunch: Int = -1,
        ecoSupport: Int = -1, ecoTorque: Int = -1, ecoLaunch: Int = -1,
        label: String = "ADV_TUNE"
    ) {
        logBondState(label)

        // Read current values — if -1, keep existing (from last read or defaults)
        // Defaults: mid-range (8) for modes not specified
        fun clamp(v: Int, default: Int = 8) = if (v < 0) default else v.coerceIn(0, 15)

        val ps = clamp(powerSupport);  val pt = clamp(powerTorque);  val pl = clamp(powerLaunch)
        val ss = clamp(sportSupport);  val st = clamp(sportTorque);  val sl = clamp(sportLaunch)
        val as_ = clamp(activeSupport); val at_ = clamp(activeTorque); val al = clamp(activeLaunch)
        val ts = clamp(tourSupport);   val tt = clamp(tourTorque);   val tl = clamp(tourLaunch)
        val es = clamp(ecoSupport);    val et = clamp(ecoTorque);    val el = clamp(ecoLaunch)

        Log.i(TAG, "★ ADV_TUNE: PWR(s=$ps t=$pt l=$pl) SPT(s=$ss t=$st l=$sl) ACT(s=$as_ t=$at_ l=$al) TUR(s=$ts t=$tt l=$tl) ECO(s=$es t=$et l=$el) (key=12)")

        // Track sent values for ACK verification
        lastSentAdvanced = intArrayOf(ps, pt, pl, ss, st, sl, as_, at_, al, ts, tt, tl, es, et, el)
        lastSentTuning = null
        awaitingTuningAck = true
        tuningAckDeadline = System.currentTimeMillis() + 2000

        val plain = ByteArray(16).also {
            it[0] = 0xE3.toByte(); it[1] = 0x0C
            it[2] = 0x00 // not reset mode
            // Power (index g in RideControl)
            it[3] = (ps and 0x0F).toByte()
            it[4] = ((pt shl 4) or (pl and 0x0F)).toByte()
            // Sport (index f)
            it[5] = (ss and 0x0F).toByte()
            it[6] = ((st shl 4) or (sl and 0x0F)).toByte()
            // Active (index e)
            it[7] = (as_ and 0x0F).toByte()
            it[8] = ((at_ shl 4) or (al and 0x0F)).toByte()
            // Tour (index d)
            it[9] = (ts and 0x0F).toByte()
            it[10] = ((tt shl 4) or (tl and 0x0F)).toByte()
            // Eco (index c)
            it[11] = (es and 0x0F).toByte()
            it[12] = ((et shl 4) or (el and 0x0F)).toByte()
        }
        sendEncryptedCommand(plain, 12, label)

        // Notify PWA
        onDataReceived?.invoke(JSONObject().apply {
            put("type", "advancedTuning")
            put("power", JSONObject().put("support", ps).put("torque", pt).put("launch", pl))
            put("sport", JSONObject().put("support", ss).put("torque", st).put("launch", sl))
            put("active", JSONObject().put("support", as_).put("torque", at_).put("launch", al))
            put("tour", JSONObject().put("support", ts).put("torque", tt).put("launch", tl))
            put("eco", JSONObject().put("support", es).put("torque", et).put("launch", el))
        })

        // Verify
        handler.postDelayed({
            val readPlain = ByteArray(16).also { it[0] = 0x2C; it[1] = 0x00 }
            sendEncryptedCommand(readPlain, 0, "READ_ADV_TUNE")
        }, 500)
    }

    private fun logBondState(label: String) {
        val bond = gatt?.device?.bondState ?: -1
        val bondStr = when (bond) {
            BluetoothDevice.BOND_BONDED -> "BONDED"
            BluetoothDevice.BOND_BONDING -> "BONDING..."
            BluetoothDevice.BOND_NONE -> "NOT_BONDED"
            else -> "UNKNOWN($bond)"
        }
        Log.i(TAG, "★ $label bond=$bondStr")
        onDataReceived?.invoke(JSONObject()
            .put("type", "bondState")
            .put("cmd", label)
            .put("bond", bondStr))
    }
}
