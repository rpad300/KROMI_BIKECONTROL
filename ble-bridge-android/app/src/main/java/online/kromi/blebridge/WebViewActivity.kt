package online.kromi.blebridge

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.*
import org.json.JSONObject
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * WebViewActivity — hosts the KROMI PWA inside the BLE Bridge APK.
 *
 * Flow: onCreate → setupWebView → requestPermissions → onPermissionsResult → startBLE → loadPWA
 * The PWA only loads AFTER permissions are granted to avoid lifecycle conflicts.
 */
class WebViewActivity : AppCompatActivity() {

    companion object {
        const val TAG = "WebViewActivity"
        const val PWA_URL = "https://kromi.online"
        const val FALLBACK_URL = "file:///android_asset/offline.html"
        const val PERM_REQUEST_CODE = 1001
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var wakeLock: PowerManager.WakeLock? = null
    private var pwaLoaded = false
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var cameraPhotoUri: Uri? = null
    private val FILE_CHOOSER_REQUEST = 2001

    override fun onCreate(savedInstanceState: Bundle?) {
        // Remove ActionBar BEFORE calling super
        supportActionBar?.hide()

        super.onCreate(savedInstanceState)

        // Keep screen on
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Status bar bg = PersistentBar bg (#131313) so they look like one continuous bar
        window.statusBarColor = 0xFF131313.toInt()
        window.navigationBarColor = 0xFF0e0e0e.toInt()

        // Build layout programmatically
        val root = FrameLayout(this).apply { setBackgroundColor(0xFF0e0e0e.toInt()) }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(0xFF0e0e0e.toInt())
        }

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 6)
            max = 100
            visibility = View.GONE
        }

        root.addView(webView)
        root.addView(progressBar)
        setContentView(root)

        // FULLSCREEN: hide status bar + nav bar. App handles time/battery in its own UI.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { ctrl ->
                ctrl.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
                ctrl.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        Log.i(TAG, "onCreate — setting up WebView")
        setupWebView()

        // Request permissions FIRST — PWA loads only after
        requestAllPermissions()
    }

    // ═══════════════════════════════════════════════════════════
    // PERMISSIONS — request everything upfront, load PWA after
    // ═══════════════════════════════════════════════════════════

    private fun requestAllPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            // Pre-Android 12: just start
            onPermissionsReady()
            return
        }

        val allPerms = mutableListOf(
            android.Manifest.permission.BLUETOOTH_CONNECT,
            android.Manifest.permission.BLUETOOTH_SCAN,
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.ACCESS_COARSE_LOCATION,
            android.Manifest.permission.POST_NOTIFICATIONS,
            android.Manifest.permission.ACTIVITY_RECOGNITION,
        )

        val needed = allPerms.filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isEmpty()) {
            onPermissionsReady()
        } else {
            Log.i(TAG, "Requesting ${needed.size} permissions")
            requestPermissions(needed.toTypedArray(), PERM_REQUEST_CODE)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERM_REQUEST_CODE) {
            val granted = grantResults.count { it == PackageManager.PERMISSION_GRANTED }
            Log.i(TAG, "Permissions granted: $granted / ${permissions.size}")
            onPermissionsReady()
        }
    }

    /** Called after permissions dialog is dismissed — safe to start services + load PWA */
    private fun onPermissionsReady() {
        startBLEService()
        acquireWakeLock()
        loadPWA()
    }

    // ═══════════════════════════════════════════════════════════
    // WEBVIEW SETUP
    // ═══════════════════════════════════════════════════════════

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            // Core
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true

            // Allow mixed content: HTTPS page needs ws://127.0.0.1:8765 for BLE bridge
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

            // Allow file access for offline fallback
            allowFileAccess = true
            allowContentAccess = false

            // Cache — normal mode, PWA Service Worker handles updates
            cacheMode = WebSettings.LOAD_DEFAULT

            // Media
            mediaPlaybackRequiresUserGesture = false

            // Single window — never open new windows
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)

            // User agent — append KROMI identifier so PWA knows it's in the APK
            userAgentString = "$userAgentString KROMI-WebView/${getAppVersion()}"
        }

        // JavaScript bridge — lets PWA call native functions
        webView.addJavascriptInterface(KromiBridge(), "KromiBridge")

        // WebViewClient — CRITICAL: keeps ALL navigation inside the WebView
        webView.webViewClient = object : WebViewClient() {

            // This is the KEY method — returning false = load in WebView, true = handle externally
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                val host = request.url?.host ?: ""
                Log.d(TAG, "Navigation: $url (host=$host)")

                // ALWAYS keep kromi.online and localhost in WebView
                if (host == "kromi.online" || host == "www.kromi.online"
                    || host == "127.0.0.1" || host == "localhost") {
                    return false
                }

                // tel:, mailto:, intent: etc — open in system
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {}
                    return true
                }

                // External HTTP(S) links — open in browser
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {}
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                Log.i(TAG, "Page loading: $url")
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                Log.i(TAG, "Page loaded: $url")
                progressBar.visibility = View.GONE
                pwaLoaded = true
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    Log.e(TAG, "Load error (main frame): ${error?.description} code=${error?.errorCode}")
                    view?.loadUrl(FALLBACK_URL)
                }
            }

            // Renderer crash recovery — reload PWA when Chromium renderer process dies
            override fun onRenderProcessGone(view: WebView?, detail: android.webkit.RenderProcessGoneDetail?): Boolean {
                Log.e(TAG, "WebView renderer crashed! priority=${detail?.rendererPriorityAtExit()}, didCrash=${detail?.didCrash()}")
                // Reset state and reload
                pwaLoaded = false
                view?.post {
                    view.loadUrl("about:blank")
                    view.postDelayed({ loadPWA() }, 500)
                }
                return true // we handled it, don't kill the activity
            }

            // Handle SSL errors — accept for kromi.online (our own domain)
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                val url = error?.url ?: ""
                Log.w(TAG, "SSL error: ${error?.primaryError} url=$url")
                val host = Uri.parse(url).host
                if (host == "kromi.online" || host == "www.kromi.online" || host == "127.0.0.1") {
                    handler?.proceed() // trust our own domain
                } else {
                    handler?.cancel()
                }
            }
        }

        // WebChromeClient — JS console, geolocation, progress
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                if (newProgress >= 100) progressBar.visibility = View.GONE
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    Log.d(TAG, "[JS:${it.messageLevel()}] ${it.sourceId()}:${it.lineNumber()} ${it.message()}")
                }
                return true
            }

            // Auto-grant geolocation for our domain only
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                Log.i(TAG, "Geolocation permission for: $origin")
                if (origin != null && (origin.contains("kromi.online") || origin.startsWith("file://"))) {
                    callback?.invoke(origin, true, false)
                } else {
                    callback?.invoke(origin, false, false)
                }
            }

            // File chooser — required for <input type="file"> to work in WebView
            @SuppressLint("QueryPermissionsNeeded")
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                // Cancel any pending callback
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback

                val acceptTypes = fileChooserParams?.acceptTypes ?: emptyArray()
                val wantsImage = acceptTypes.any { it.startsWith("image") }
                val wantsVideo = acceptTypes.any { it.startsWith("video") }
                val hasCapture = fileChooserParams?.isCaptureEnabled == true

                Log.i(TAG, "FileChooser: accept=${acceptTypes.joinToString()}, capture=$hasCapture")

                try {
                    if (hasCapture || wantsImage) {
                        // Create a camera intent that saves to a temp file
                        val photoFile = java.io.File.createTempFile(
                            "ride_photo_", ".jpg",
                            getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES)
                        )
                        cameraPhotoUri = androidx.core.content.FileProvider.getUriForFile(
                            this@WebViewActivity,
                            "${packageName}.fileprovider",
                            photoFile
                        )

                        val cameraIntent = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
                            putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraPhotoUri)
                        }

                        // Also offer gallery as fallback
                        val galleryIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = if (wantsVideo) "image/*,video/*" else "image/*"
                        }

                        val chooser = Intent.createChooser(galleryIntent, "Foto da Ride")
                        chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cameraIntent))
                        startActivityForResult(chooser, FILE_CHOOSER_REQUEST)
                    } else {
                        // Generic file picker
                        val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                        startActivityForResult(intent, FILE_CHOOSER_REQUEST)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "File chooser failed: ${e.message}")
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = null
                    return false
                }
                return true
            }
        }

        // Enable Chrome DevTools remote debugging (debug builds only)
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
    }

    // ═══════════════════════════════════════════════════════════
    // LOAD PWA
    // ═══════════════════════════════════════════════════════════

    private fun loadPWA() {
        if (pwaLoaded) return
        Log.i(TAG, "Loading PWA: $PWA_URL")
        webView.loadUrl(PWA_URL)

        // Wire KromiCore telemetry → WebView for UI display (deferred until service is ready)
        wireTelemetryCallback(0)
    }

    private val telemetryHandler = Handler(Looper.getMainLooper())

    private fun wireTelemetryCallback(attempt: Int) {
        val service = BLEBridgeService.instance
        if (service != null) {
            service.kromiCore.onTelemetry = { telemetry ->
                val js = "window.__kromiState && window.__kromiState(${telemetry})"
                runOnUiThread { webView.evaluateJavascript(js, null) }
            }
        } else if (attempt < 5) {
            telemetryHandler.postDelayed({ wireTelemetryCallback(attempt + 1) }, 500)
        } else {
            Log.w(TAG, "BLEBridgeService not ready after 5 attempts — telemetry callback not wired")
        }
    }

    // ═══════════════════════════════════════════════════════════
    // BLE SERVICE
    // ═══════════════════════════════════════════════════════════

    private fun startBLEService() {
        if (BLEBridgeService.instance != null) {
            Log.i(TAG, "BLE service already running")
            return
        }
        try {
            val intent = Intent(this, BLEBridgeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            Log.i(TAG, "BLE service started")
        } catch (e: Exception) {
            Log.e(TAG, "BLE service start failed: ${e.message}")
            Toast.makeText(this, "BLE service error: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    // ═══════════════════════════════════════════════════════════
    // WAKE LOCK
    // ═══════════════════════════════════════════════════════════

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kromi:ride").apply { acquire(8 * 60 * 60 * 1000L) }
        } catch (e: Exception) {
            Log.w(TAG, "WakeLock failed: ${e.message}")
        }
    }

    // ═══════════════════════════════════════════════════════════
    // JAVASCRIPT INTERFACE
    // ═══════════════════════════════════════════════════════════

    inner class KromiBridge {
        @JavascriptInterface
        fun isKromiApp(): Boolean = true

        @JavascriptInterface
        fun getVersion(): String = getAppVersion()

        @JavascriptInterface
        fun openDebugPanel() {
            startActivity(Intent(this@WebViewActivity, MainActivity::class.java))
        }

        @JavascriptInterface
        fun isBLEServiceRunning(): Boolean = BLEBridgeService.instance != null

        @JavascriptInterface
        fun isBLEConnected(): Boolean = BLEBridgeService.instance?.bleManager?.isConnected == true

        @JavascriptInterface
        fun reload() {
            runOnUiThread { webView.reload() }
        }

        // ── KromiCore JS Bridge (direct, no WebSocket) ──

        /** PWA sends Layer 3-7 cached params to native KromiCore. ~1ms. */
        @JavascriptInterface
        fun updateKromiParams(json: String) {
            try {
                val j = JSONObject(json)
                Log.d(TAG, "JS_BRIDGE updateKromiParams: bat×${j.optDouble("battery_factor", -1.0)} cp=${j.optDouble("cp_effective", -1.0)} glyc×${j.optDouble("glycogen_cp_factor", -1.0)} route=${j.optDouble("route_remaining_km", -1.0)}km wind=${j.optDouble("wind_component_ms", 0.0)}m/s")
                BLEBridgeService.instance?.kromiCore?.updateParams(j)
            } catch (e: Exception) {
                Log.w(TAG, "updateKromiParams error: ${e.message}")
            }
        }

        /** Check if KromiCore is actively controlling motor */
        @JavascriptInterface
        fun isKromiCoreActive(): Boolean = BLEBridgeService.instance?.kromiCore?.isActive() == true

        /** Send motor command directly via JS Bridge (bypass WebSocket). ~1ms vs ~40ms. */
        @JavascriptInterface
        fun setAdvancedTuning(powerSupport: Int, powerTorque: Int, powerLaunch: Int) {
            Log.i(TAG, "JS_BRIDGE setAdvancedTuning: S=$powerSupport/15 T=$powerTorque/15 L=$powerLaunch/15")
            BLEBridgeService.instance?.bleManager?.setAdvancedTuning(
                powerSupport = powerSupport,
                powerTorque = powerTorque,
                powerLaunch = powerLaunch,
                label = "JS_BRIDGE"
            )
        }

        /** Send assist mode directly via JS Bridge */
        @JavascriptInterface
        fun sendAssistMode(mode: Int) {
            Log.i(TAG, "JS_BRIDGE sendAssistMode: mode=$mode")
            BLEBridgeService.instance?.bleManager?.writeAssistMode(mode)
        }

        /** Send gradient from PWA GPS to KromiCore */
        @JavascriptInterface
        fun setGradient(gradient: Double) {
            BLEBridgeService.instance?.kromiCore?.onGradient(gradient)
        }
    }

    // ═══════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════

    @Deprecated("Use OnBackPressedDispatcher")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            moveTaskToBack(true) // don't kill app, keep service running
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST) {
            val result = if (resultCode == RESULT_OK) {
                // Check if camera was used (data is null when camera saves to EXTRA_OUTPUT)
                val uri = data?.data
                if (uri != null) {
                    arrayOf(uri)
                } else if (cameraPhotoUri != null) {
                    // Camera captured to our temp file
                    arrayOf(cameraPhotoUri!!)
                } else null
            } else null

            Log.i(TAG, "FileChooser result: ${result?.joinToString()}")
            fileChooserCallback?.onReceiveValue(result)
            fileChooserCallback = null
            if (result == null) cameraPhotoUri = null
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // Re-apply fullscreen on resume
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { ctrl ->
                ctrl.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
                ctrl.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        webView.destroy()
        super.onDestroy()
    }

    private fun getAppVersion(): String {
        return try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (_: Exception) { "?" }
    }
}
