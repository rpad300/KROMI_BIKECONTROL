package online.kromi.blebridge

import android.util.Log
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.net.InetSocketAddress

class BridgeWebSocketServer(
    port: Int = 8765,
    private val onCommand: (JSONObject) -> Unit
) : WebSocketServer(InetSocketAddress("0.0.0.0", port)) {

    companion object {
        const val TAG = "WSServer"
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        Log.i(TAG, "Client connected: ${conn.remoteSocketAddress}")
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
        connections.forEach { conn ->
            try {
                conn.send(msg)
            } catch (_: Exception) {}
        }
    }
}
