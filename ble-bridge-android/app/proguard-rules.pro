# Keep WebSocket server
-keep class org.java_websocket.** { *; }
# Keep JS bridge interface
-keepclassmembers class online.kromi.blebridge.WebViewActivity$* {
    @android.webkit.JavascriptInterface <methods>;
}
# Keep BLE GATT callbacks
-keep class * extends android.bluetooth.BluetoothGattCallback { *; }
