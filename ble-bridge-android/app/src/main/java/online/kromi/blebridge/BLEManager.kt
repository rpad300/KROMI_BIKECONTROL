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

    val isConnected: Boolean get() = gatt != null
    val isScanning: Boolean get() = scanCallback != null

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

    private fun connectGatt(device: BluetoothDevice) {
        // RideControl uses TRANSPORT_LE explicitly
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        gevChar = null
        protoWriteChar = null
        sgWriteChar = null
        onDataReceived?.invoke(JSONObject().put("type", "disconnected"))
        onStatusChanged?.invoke("Disconnected")
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "GATT connected to ${g.device.name} (bond: ${g.device.bondState})")
                    onStatusChanged?.invoke("Connected, requesting MTU...")

                    // Request high priority + large MTU, then discover services in onMtuChanged
                    g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                    g.requestMtu(247)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "GATT disconnected")
                    gatt?.close()
                    gatt = null
                    gevChar = null
                    protoWriteChar = null
                    sgWriteChar = null
                    onDataReceived?.invoke(JSONObject().put("type", "disconnected"))
                    onStatusChanged?.invoke("Disconnected")
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

            // HR
            g.getService(HR_SERVICE)?.getCharacteristic(HR_MEASUREMENT)?.let { char ->
                services.put("hr", true)
                pendingNotifications.add(char)
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

                            // === FC23 DIAGNOSTIC BUILD (b21) ===
                            // Goal: identify correct byte offsets while pedaling
                            // Packet: [FC][23][b2][b3][b4]...[b19] = 20 bytes
                            // b2 seems to be len (0x11=17), b3 = cmd sub-type (0x40-0x43)

                            val cmdType = data[3].toInt() and 0xFF
                            val rawHex = data.joinToString(" ") { "%02X".format(it) }

                            // Log raw bytes for ALL cmd types, throttled per type
                            val now = System.currentTimeMillis()
                            val typeKey = "fc23_$cmdType"
                            val lastLog = fc23LogTimes.getOrDefault(typeKey, 0L)
                            if (now - lastLog > 3000) {
                                fc23LogTimes[typeKey] = now
                                // Log with indexed bytes for easy field identification
                                val indexed = data.mapIndexed { i, b -> "[%d]=%02X".format(i, b) }.joinToString(" ")
                                Log.i(TAG, "FC23 cmd=%02X: $indexed".format(cmdType))
                            }

                            // Send raw hex to PWA for all types
                            onDataReceived?.invoke(JSONObject()
                                .put("type", "fc23raw")
                                .put("cmd", cmdType)
                                .put("hex", rawHex)
                                .put("size", data.size))

                            // === ONLY PARSE cmd 0x41 (riding telemetry) ===
                            if (cmdType != 0x41) return

                            // Two parsing strategies to compare:
                            // A) RideControl style: data[2..19] (includes len+cmd as first 2 bytes)
                            // B) Shifted +2: data[4..19] (skip len+cmd, real data starts at byte 4)

                            // Helper: LE int16 from absolute data index
                            fun leShort(idx: Int): Int {
                                return (data[idx].toInt() and 0xFF) or ((data[idx + 1].toInt() and 0xFF) shl 8)
                            }
                            fun leSigned(idx: Int): Int {
                                val v = leShort(idx)
                                return if (v > 32767) v - 65536 else v
                            }

                            // Strategy A: RideControl offsets (base=2)
                            val a_spd = leSigned(2) / 10.0
                            val a_trq = leSigned(4) / 10.0
                            val a_cad = leSigned(6) / 10.0
                            val a_pwr = leSigned(14) / 10.0
                            val a_soc = data[17].toInt() and 0xFF

                            // Strategy B: Shifted offsets (base=4, skip len+cmd)
                            val b_spd = leSigned(4) / 10.0
                            val b_trq = leSigned(6) / 10.0
                            val b_cad = leSigned(8) / 10.0
                            val b_acur = (leShort(10) and 0xFFFF) / 100.0
                            val b_dist = leSigned(12) / 10.0
                            val b_time = leShort(14) and 0xFFFF
                            val b_pwr = leSigned(16) / 10.0
                            val b_carr = data[18].toInt() and 0xFF
                            val b_soc = data[19].toInt() and 0xFF

                            if (now - lastTelemetryLog > 2000) {
                                lastTelemetryLog = now
                                Log.i(TAG, "CMD41 StratA: spd=%.1f trq=%.1f cad=%.1f pwr=%.1f soc=%d"
                                    .format(a_spd, a_trq, a_cad, a_pwr, a_soc))
                                Log.i(TAG, "CMD41 StratB: spd=%.1f trq=%.1f cad=%.1f pwr=%.1f soc=%d car=%d dist=%.1f t=%d"
                                    .format(b_spd, b_trq, b_cad, b_pwr, b_soc, b_carr, b_dist, b_time))
                            }

                            // Send BOTH strategies to PWA for comparison
                            onDataReceived?.invoke(JSONObject()
                                .put("type", "sgRidingDiag")
                                .put("rawHex", rawHex)
                                .put("a_speed", a_spd).put("a_torque", a_trq)
                                .put("a_cadence", a_cad).put("a_power", a_pwr)
                                .put("a_soc", a_soc)
                                .put("b_speed", b_spd).put("b_torque", b_trq)
                                .put("b_cadence", b_cad).put("b_power", b_pwr)
                                .put("b_soc", b_soc).put("b_carr", b_carr)
                                .put("b_dist", b_dist).put("b_time", b_time))

                            // Use Strategy B for live data (most likely correct)
                            onDataReceived?.invoke(JSONObject()
                                .put("type", "sgRiding")
                                .put("speed", b_spd)
                                .put("torque", b_trq)
                                .put("cadence", b_cad)
                                .put("power", b_pwr)
                                .put("assistRatio", b_carr)
                                .put("batterySoc", b_soc)
                                .put("tripDistance", b_dist)
                                .put("tripTime", b_time)
                                .put("accumCurrent", b_acur)
                                .put("errorCode", 0))

                            // PWA compat broadcasts (using Strategy B)
                            if (b_spd > 0.5) onDataReceived?.invoke(JSONObject().put("type", "speed").put("value", b_spd))
                            if (b_pwr > 0) onDataReceived?.invoke(JSONObject().put("type", "power").put("value", b_pwr.toInt()))
                            if (b_cad > 0) onDataReceived?.invoke(JSONObject().put("type", "cadence").put("value", b_cad.toInt()))
                            if (b_soc in 1..100) onDataReceived?.invoke(JSONObject().put("type", "battery").put("value", b_soc))
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
                                    0x13 -> {
                                        // Battery data: [0]=cmd, [1]=?, [2]=soc%, [3]=life%, [4-5]=capacity
                                        val soc = dec[2].toInt() and 0xFF
                                        val life = dec[3].toInt() and 0xFF
                                        Log.i(TAG, "★ BATTERY: SOC=$soc% life=$life%")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "sgBattery")
                                            .put("soc", soc)
                                            .put("life", life))
                                    }
                                    0x2C -> {
                                        // Tuning data response
                                        val hex = dec.joinToString("") { "%02x".format(it) }
                                        Log.i(TAG, "★ TUNING: $hex")
                                        onDataReceived?.invoke(JSONObject()
                                            .put("type", "sgTuning")
                                            .put("hex", hex))
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
                    val power = ((data[10].toInt() and 0xFF) or ((data[11].toInt() and 0xFF) shl 8))
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
}
