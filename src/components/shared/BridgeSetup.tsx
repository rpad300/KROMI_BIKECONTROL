import { useState, useEffect } from 'react';
import { wsClient } from '../../services/bluetooth/WebSocketBLEClient';
import { bleMode } from '../../services/bluetooth/BLEBridge';

/**
 * BridgeSetup — auto-launches the BLE Bridge middleware and shows install prompt.
 *
 * Flow:
 * 1. PWA opens → checks if bridge is running (WebSocket)
 * 2. If not running → tries to launch via intent:// deep link
 * 3. If launch fails → shows install banner with APK download
 * 4. If bridge connects → banner disappears, normal app flow
 */

const BRIDGE_INTENT_URL = 'intent://start#Intent;scheme=kromi-bridge;package=online.kromi.blebridge;end';
const APK_DOWNLOAD_URL = 'https://github.com/rpad300/KROMI_BIKECONTROL/releases/latest';

export function BridgeSetup() {
  const [state, setState] = useState<'checking' | 'launching' | 'install' | 'connected' | 'hidden'>('checking');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only relevant on Android Chrome (not Capacitor native)
    if (bleMode === 'native' || !isAndroid()) {
      setState('hidden');
      return;
    }

    checkBridge();
  }, []);

  async function checkBridge() {
    // Already connected?
    if (wsClient.isConnected) {
      setState('connected');
      setTimeout(() => setState('hidden'), 2000);
      return;
    }

    // Try to connect (initBLE may have already started this)
    wsClient.connect();
    await wait(2000);

    if (wsClient.isConnected) {
      setState('connected');
      setTimeout(() => setState('hidden'), 2000);
      return;
    }

    // Not running — try to launch via intent (hidden iframe, doesn't break PWA)
    setState('launching');
    launchBridge();
    await wait(4000);

    // Retry WS connection after launch attempt
    wsClient.connect();
    await wait(2000);

    if (wsClient.isConnected) {
      setState('connected');
      setTimeout(() => setState('hidden'), 2000);
      return;
    }

    // Bridge not available — show install prompt
    setState('install');

    // Keep trying in background every 5s (user may switch to APK and back)
    const interval = setInterval(() => {
      wsClient.connect();
      setTimeout(() => {
        if (wsClient.isConnected) {
          setState('connected');
          setTimeout(() => setState('hidden'), 2000);
          clearInterval(interval);
        }
      }, 1500);
    }, 5000);

    // Cleanup on unmount
    return () => clearInterval(interval);
  }

  function launchBridge() {
    // Use hidden iframe for intent — doesn't navigate away from PWA
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = BRIDGE_INTENT_URL;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 2000);
    } catch {
      // Intent failed — app not installed
    }
  }

  if (state === 'hidden' || dismissed) return null;

  if (state === 'checking' || state === 'launching') {
    return (
      <div className="fixed top-0 left-0 right-0 px-4 py-3 z-50 flex items-center gap-3 border-b" style={{ backgroundColor: 'rgba(26,25,25,0.95)', borderColor: '#494847' }}>
        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#3fff8b', borderTopColor: 'transparent' }} />
        <span className="text-sm" style={{ color: '#adaaaa' }}>
          {state === 'checking' ? 'A verificar BLE Bridge...' : 'A iniciar BLE Bridge...'}
        </span>
      </div>
    );
  }

  if (state === 'connected') {
    // Don't show banner — ConnectionStatus handles the status display
    return null;
  }

  // state === 'install'
  return (
    <div className="fixed top-0 left-0 right-0 px-4 py-4 z-50 border-b" style={{ backgroundColor: 'rgba(26,25,25,0.95)', borderColor: '#494847' }}>
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-xl mt-0.5" style={{ color: '#fbbf24' }}>download</span>
        <div className="flex-1">
          <p className="text-sm text-white font-bold font-headline">Instalar BLE Bridge</p>
          <p className="text-xs mt-1" style={{ color: '#adaaaa' }}>
            Para controlar o motor e aceder a dados avancados, instala a app BLE Bridge.
          </p>
          <div className="flex gap-2 mt-3">
            <a
              href={APK_DOWNLOAD_URL}
              className="text-sm font-bold font-headline px-4 py-2 active:scale-95 transition-transform"
              style={{ backgroundColor: '#3fff8b', color: 'black' }}
            >
              Descarregar APK
            </a>
            <button
              onClick={() => {
                launchBridge();
                setTimeout(checkBridge, 4000);
              }}
              className="text-sm px-4 py-2 active:scale-95 transition-transform"
              style={{ backgroundColor: '#262626', color: 'white' }}
            >
              Ja instalei
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="text-sm px-2"
              style={{ color: '#777575' }}
            >
              Ignorar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
