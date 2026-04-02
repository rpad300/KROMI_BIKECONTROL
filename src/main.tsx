import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initBLE } from './services/bluetooth/BLEBridge';
import './index.css';

// Auto-update service worker — forces new code on deploy (no manual cache clear)
registerSW({
  onNeedRefresh() {
    // Automatically apply update — user was getting stale cached code
    console.log('[SW] New version available — auto-updating...');
    window.location.reload();
  },
  onOfflineReady() {
    console.log('[SW] Offline ready');
  },
});

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
