/**
 * Platform detection — detect if PWA is running inside KROMI APK WebView
 * or in a regular browser (Chrome, etc.)
 */

declare global {
  interface Window {
    KromiBridge?: {
      isKromiApp(): boolean;
      getVersion(): string;
      openDebugPanel(): void;
      isBLEServiceRunning(): boolean;
      isBLEConnected(): boolean;
      reload(): void;
    };
  }
}

/** Check if running inside KROMI APK WebView */
export function isKromiWebView(): boolean {
  // Method 1: JavaScript interface injected by WebViewActivity
  if (window.KromiBridge?.isKromiApp?.()) return true;
  // Method 2: User agent contains KROMI-WebView
  if (navigator.userAgent.includes('KROMI-WebView')) return true;
  return false;
}

/** Get KROMI APK version (null if not in WebView) */
export function getKromiAppVersion(): string | null {
  if (window.KromiBridge) return window.KromiBridge.getVersion() ?? null;
  const match = navigator.userAgent.match(/KROMI-WebView\/([\d.]+)/);
  return match?.[1] ?? null;
}

/** Open BLE debug panel (only works inside KROMI APK) */
export function openBLEDebugPanel(): void {
  window.KromiBridge?.openDebugPanel();
}

/** Check if BLE service is running (only in KROMI APK) */
export function isBLEServiceRunning(): boolean {
  return window.KromiBridge?.isBLEServiceRunning?.() ?? false;
}

/** Check if BLE is connected to bike (only in KROMI APK) */
export function isNativeBLEConnected(): boolean {
  return window.KromiBridge?.isBLEConnected?.() ?? false;
}
