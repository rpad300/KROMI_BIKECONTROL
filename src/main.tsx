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

// Init LocalRideStore (bulletproof ride storage) + SyncQueue early
localRideStore.init().then(() => {
  localRideStore.startSyncLoop();
  // Purge old synced data on startup (>30 days)
  localRideStore.purgeOldSyncedData().catch(() => {});
}).catch((err) => console.warn('[LocalRideStore] Early init failed:', err));

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
      console.log('[SW] Update available but ride active — deferring reload');
      pendingSWUpdate = true;
      return;
    }
    if (inWebView) {
      // In WebView: DON'T auto-reload — it can kill the app
      // The next app open will get the new version from cache
      console.log('[SW] Update available inside WebView — deferring to next launch');
      pendingSWUpdate = true;
      return;
    }
    console.log('[SW] New version available — auto-updating...');
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
