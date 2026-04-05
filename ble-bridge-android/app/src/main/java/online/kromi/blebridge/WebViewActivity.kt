package online.kromi.blebridge

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.*
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

    override fun onCreate(savedInstanceState: Bundle?) {
        // Remove ActionBar BEFORE calling super
        supportActionBar?.hide()

        super.onCreate(savedInstanceState)

        // Fullscreen dark, keep screen on, draw behind status bar
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+: proper edge-to-edge
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
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = 0xFF0e0e0e.toInt()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

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
            android.Manifest.permission.BLUETOOTH_ADVERTISE,
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.ACCESS_COARSE_LOCATION,
            android.Manifest.permission.CAMERA,
            android.Manifest.permission.POST_NOTIFICATIONS,
            android.Manifest.permission.BODY_SENSORS,
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

            // Cache — clear on version change, normal otherwise
            val prefs = getSharedPreferences("kromi_wv", MODE_PRIVATE)
            val currentVer = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "?" }
            val lastVer = prefs.getString("last_version", "")
            if (currentVer != lastVer) {
                // New APK version — force fresh load to pick up any PWA changes
                android.util.Log.i("WebView", "Version changed $lastVer → $currentVer — clearing WebView cache")
                webView.clearCache(true)
                android.webkit.CookieManager.getInstance().removeAllCookies(null)
                prefs.edit().putString("last_version", currentVer).apply()
                cacheMode = WebSettings.LOAD_NO_CACHE
            } else {
                cacheMode = WebSettings.LOAD_DEFAULT
            }

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

            // Handle SSL errors — accept for kromi.online (our own domain)
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                val url = error?.url ?: ""
                Log.w(TAG, "SSL error: ${error?.primaryError} url=$url")
                if (url.contains("kromi.online") || url.contains("127.0.0.1")) {
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

            // Auto-grant geolocation for our domain
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                Log.i(TAG, "Geolocation permission for: $origin")
                callback?.invoke(origin, true, false)
            }
        }

        // Enable Chrome DevTools remote debugging
        WebView.setWebContentsDebuggingEnabled(true)
    }

    // ═══════════════════════════════════════════════════════════
    // LOAD PWA
    // ═══════════════════════════════════════════════════════════

    private fun loadPWA() {
        if (pwaLoaded) return
        Log.i(TAG, "Loading PWA: $PWA_URL")
        webView.loadUrl(PWA_URL)
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

    @SuppressLint("WakelockTimeout")
    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kromi:ride").apply { acquire() }
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

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // Re-apply fullscreen on resume
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
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
