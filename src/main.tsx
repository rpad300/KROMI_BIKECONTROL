import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initBLE } from './services/bluetooth/BLEBridge';
import { syncQueue } from './services/sync/SyncQueue';
import { rideSessionManager } from './services/storage/RideHistory';
import './index.css';

// Init SyncQueue IndexedDB early — before any ride data needs it
syncQueue.init().catch((err) => console.warn('[SyncQueue] Early init failed:', err));

// Auto-update service worker — defer reload if ride is active
let pendingSWUpdate = false;
registerSW({
  onNeedRefresh() {
    if (rideSessionManager.isActive()) {
      // Don't reload mid-ride — defer until ride stops
      console.log('[SW] Update available but ride active — deferring reload');
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
