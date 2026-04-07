import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initBLE } from './services/bluetooth/BLEBridge';
import { syncQueue } from './services/sync/SyncQueue';
import { localRideStore } from './services/storage/LocalRideStore';
import { rideSessionManager } from './services/storage/RideHistory';
import { isKromiWebView } from './utils/platform';
import { supaFetch } from './lib/supaFetch';
import './index.css';

// App version from git tag (injected at build time)
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// Remote diagnostic log — fire-and-forget, includes version + GPS
function dlog(msg: string) {
  console.log('[DIAG]', msg);

  // Get current GPS from mapStore (lazy import to avoid circular deps)
  let lat = 0, lng = 0;
  try {
    const mapState = (window as unknown as Record<string, unknown>).__mapStoreGet as (() => { latitude: number; longitude: number }) | undefined;
    if (mapState) { const m = mapState(); lat = m.latitude; lng = m.longitude; }
  } catch { /* no GPS yet */ }

  supaFetch('/rest/v1/debug_logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      level: 'info',
      message: `[${APP_VERSION}] ${msg}`,
      data: {
        ts: new Date().toISOString(),
        v: APP_VERSION,
        lat: lat !== 0 ? Math.round(lat * 10000) / 10000 : null,
        lng: lng !== 0 ? Math.round(lng * 10000) / 10000 : null,
      },
    }),
  }).catch(() => {});
}
(window as unknown as Record<string, unknown>).__dlog = dlog;

dlog(`PWA boot — webview=${isKromiWebView()} online=${navigator.onLine}`);

// Init LocalRideStore (bulletproof ride storage) + SyncQueue early
localRideStore.init().then(async () => {
  dlog('LocalRideStore init OK');
  // Backfill user_id on legacy rows (Session 18 one-shot migration).
  // Must run AFTER auth has been rehydrated so currentViewerId() resolves
  // — the authStore.persist hydration is synchronous at import time.
  try {
    const n = await localRideStore.backfillUserIdOnLegacyRows();
    if (n > 0) dlog(`LocalRideStore backfilled ${n} legacy rows`);
  } catch (err) {
    dlog(`LocalRideStore backfill FAILED: ${String(err)}`);
  }
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

const updateSW = registerSW({
  onNeedRefresh() {
    if (rideSessionManager.isActive()) {
      console.log('[SW] Update available but ride active — deferring reload');
      pendingSWUpdate = true;
      return;
    }
    console.log('[SW] New version available — updating...');
    window.location.reload();
  },
  onOfflineReady() {
    console.log('[SW] Offline ready');
  },
});

// Check for SW updates every 60s (ensures WebView picks up Vercel deploys quickly)
setInterval(() => {
  updateSW(true); // true = revalidate
}, 60_000);

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

// Start adaptive brightness — auto-adjusts theme based on ambient light from BLE bridge
import('./services/sensors/AdaptiveBrightnessService').then(({ adaptiveBrightnessService }) => {
  adaptiveBrightnessService.start();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
