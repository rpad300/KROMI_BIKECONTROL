package online.kromi.blebridge

import android.util.Log
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.net.InetSocketAddress

class BridgeWebSocketServer(
    port: Int = 8765,
    private val onCommand: (JSONObject) -> Unit,
    var appVersion: String = "unknown",
    var onClientConnected: (() -> Unit)? = null
) : WebSocketServer(InetSocketAddress(port)) {
    // NOTE: Binds to 0.0.0.0 intentionally — Android WebView runs in a separate process
    // and may not be able to connect to 127.0.0.1. Security is handled via the
    // WebSocket handshake (bridgeInfo exchange) rather than bind address restriction.

    init {
        isReuseAddr = true                    // Allow restart if previous instance didn't clean up
        connectionLostTimeout = 30            // Detect dead connections after 30s
    }

    companion object {
        const val TAG = "WSServer"
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        Log.i(TAG, "Client connected: ${conn.remoteSocketAddress}")
        // Send bridge info on connect so PWA can verify version
        try {
            conn.send(JSONObject()
                .put("type", "bridgeInfo")
                .put("version", appVersion)
                .put("package", "online.kromi.blebridge")
                .toString())
        } catch (_: Exception) {}
        // Notify service so it can re-emit current state to the new client
        onClientConnected?.invoke()
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        Log.i(TAG, "Client disconnected: $reason")
    }

    override fun onMessage(conn: WebSocket, message: String) {
        try {
            val json = JSONObject(message)
            Log.d(TAG, "Received: $message")
            onCommand(json)
        } catch (e: Exception) {
            Log.e(TAG, "Invalid message: $message")
        }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        Log.e(TAG, "WebSocket error: ${ex.message}")
    }

    override fun onStart() {
        Log.i(TAG, "WebSocket server started on port ${address.port}")
    }

    fun broadcastData(json: JSONObject) {
        val msg = json.toString()
        connections.toList().forEach { conn ->
            try {
                conn.send(msg)
            } catch (_: Exception) {}
        }
    }
}
