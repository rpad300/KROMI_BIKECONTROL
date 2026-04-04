package online.kromi.blebridge

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity

/**
 * WebViewActivity — hosts the KROMI PWA inside the BLE Bridge APK.
 *
 * Benefits over Chrome tab:
 * - Android process keeps running (foreground service)
 * - WebView is not killed by Chrome's tab management
 * - Same process as BLE bridge = no WebSocket latency issues
 * - PWA auto-updates from kromi.online (no APK update needed for UI changes)
 * - Wake lock managed by Android, not by unreliable JS API
 *
 * The WebSocket bridge (localhost:8765) still works for both this WebView
 * AND external Chrome connections — full backwards compatibility.
 */
class WebViewActivity : AppCompatActivity() {

    companion object {
        const val TAG = "WebViewActivity"
        const val PWA_URL = "https://kromi.online"
        const val FALLBACK_URL = "file:///android_asset/offline.html"
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var wakeLock: PowerManager.WakeLock? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Fullscreen, keep screen on, portrait
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
        window.statusBarColor = 0xFF0e0e0e.toInt()
        window.navigationBarColor = 0xFF0e0e0e.toInt()

        // Simple layout: ProgressBar + WebView
        val root = android.widget.FrameLayout(this).apply {
            setBackgroundColor(0xFF0e0e0e.toInt())
        }

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                8
            )
            max = 100
            progressDrawable.setColorFilter(0xFF3fff8b.toInt(), android.graphics.PorterDuff.Mode.SRC_IN)
        }

        webView = WebView(this).apply {
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        root.addView(webView)
        root.addView(progressBar)
        setContentView(root)

        setupWebView()

        // Start BLE Bridge service (if not already running)
        startBLEService()

        // Acquire partial wake lock for ride reliability
        acquireWakeLock()

        // Load PWA
        webView.loadUrl(PWA_URL)
        Log.i(TAG, "Loading PWA: $PWA_URL")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            // Enable IndexedDB (critical for LocalRideStore)
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            // WebView user agent — append KROMI identifier for PWA detection
            userAgentString = "$userAgentString KROMI-WebView/${getAppVersion()}"
        }

        // JavaScript interface — lets PWA call native functions
        webView.addJavascriptInterface(KromiBridge(), "KromiBridge")

        // Handle page loading
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progressBar.visibility = View.GONE
                Log.i(TAG, "Page loaded: $url")
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                // Only handle main frame errors
                if (request?.isForMainFrame == true) {
                    Log.e(TAG, "Load error: ${error?.description}")
                    // Show offline fallback
                    view?.loadUrl(FALLBACK_URL)
                }
            }

            // Allow localhost WebSocket connections (mixed content from HTTPS to ws://127.0.0.1)
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Open external links (tel:, mailto:, maps:) in system apps
                if (!url.startsWith("https://kromi.online") && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (_: Exception) {}
                    return true
                }
                return false
            }
        }

        // Handle JS console, geolocation, file uploads
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    Log.d(TAG, "[JS] ${it.sourceId()}:${it.lineNumber()} ${it.message()}")
                }
                return true
            }

            // Geolocation permission — auto-grant for our own domain
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                callback?.invoke(origin, true, false)
            }
        }

        // Enable remote debugging in debug builds
        WebView.setWebContentsDebuggingEnabled(true)
    }

    private fun startBLEService() {
        if (BLEBridgeService.instance == null) {
            val serviceIntent = Intent(this, BLEBridgeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            Log.i(TAG, "BLE Bridge service started")
        } else {
            Log.i(TAG, "BLE Bridge service already running")
        }
    }

    @SuppressLint("WakelockTimeout")
    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kromi:ride").apply {
            acquire()
        }
    }

    private fun getAppVersion(): String {
        return try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (_: Exception) { "?" }
    }

    // ── JavaScript Interface ──

    inner class KromiBridge {
        /** PWA can check if running inside KROMI APK */
        @JavascriptInterface
        fun isKromiApp(): Boolean = true

        /** Get APK version */
        @JavascriptInterface
        fun getVersion(): String = getAppVersion()

        /** Open BLE debug panel */
        @JavascriptInterface
        fun openDebugPanel() {
            startActivity(Intent(this@WebViewActivity, MainActivity::class.java))
        }

        /** Check if BLE service is running */
        @JavascriptInterface
        fun isBLEServiceRunning(): Boolean = BLEBridgeService.instance != null

        /** Check if BLE is connected to bike */
        @JavascriptInterface
        fun isBLEConnected(): Boolean = BLEBridgeService.instance?.bleManager?.isConnected == true
    }

    // ── Back button navigation ──

    @Deprecated("Use OnBackPressedDispatcher")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            // Don't close app — move to background (service keeps running)
            moveTaskToBack(true)
        }
    }

    // ── Lifecycle ──

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // Re-apply fullscreen
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        webView.destroy()
        super.onDestroy()
    }
}
