import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initBLE } from './services/bluetooth/BLEBridge';
import { syncQueue } from './services/sync/SyncQueue';
import { localRideStore } from './services/storage/LocalRideStore';
import { rideSessionManager } from './services/storage/RideHistory';
import { isKromiWebView } from './utils/platform';
import './index.css';

// Remote diagnostic log — fire-and-forget, no dependencies
function dlog(msg: string) {
  console.log('[DIAG]', msg);
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  fetch(`${url}/rest/v1/debug_logs`, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ level: 'info', message: msg, data: { ts: new Date().toISOString(), ua: navigator.userAgent.slice(0, 100) } }),
  }).catch(() => {});
}
(window as unknown as Record<string, unknown>).__dlog = dlog;

dlog(`PWA boot — webview=${isKromiWebView()} online=${navigator.onLine}`);

// Init LocalRideStore (bulletproof ride storage) + SyncQueue early
localRideStore.init().then(() => {
  dlog('LocalRideStore init OK');
  localRideStore.startSyncLoop();
  localRideStore.purgeOldSyncedData().catch(() => {});
}).catch((err) => {
  dlog(`LocalRideStore init FAILED: ${String(err)}`);
});

syncQueue.init().catch((err) => console.warn('[SyncQueue] Early init failed:', err));

// Auto-update service worker — defer reload if ride is active OR inside WebView
let pendingSWUpdate = false;
const inWebView = isKromiWebView();
if (inWebView) {
  console.log('[Platform] Running inside KROMI WebView APK');
}

registerSW({
  onNeedRefresh() {
    if (rideSessionManager.isActive()) {
      // NEVER reload mid-ride — defer until ride stops
      console.log('[SW] Update available but ride active — deferring reload');
      pendingSWUpdate = true;
      return;
    }
    // Safe to update — no active ride (works in both WebView and Chrome)
    console.log('[SW] New version available — updating...');
    window.location.reload();
  },
  onOfflineReady() {
    console.log('[SW] Offline ready');
  },
});

// Check for pending SW update when ride stops
const origStop = rideSessionManager.stopSession.bind(rideSessionManager);
rideSessionManager.stopSession = async function () {
  await origStop();
  if (pendingSWUpdate) {
    console.log('[SW] Ride stopped — applying deferred update');
    window.location.reload();
  }
};

// Request Wake Lock to keep screen on while riding
async function requestWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await navigator.wakeLock.request('screen');
      }
    });
  } catch (err) {
    console.warn('[WakeLock] Failed:', err);
  }
}

// Only init BLE + WakeLock on mobile (not desktop)
const isMobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
if (isMobile) {
  requestWakeLock();
  initBLE();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
