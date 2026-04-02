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
const APK_DOWNLOAD_URL = 'https://github.com/rpad300/KROMI_BIKECONTROL/releases/download/v0.7.1/ble-bridge-0.7.1.apk';

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

    // Try to connect
    wsClient.connect();
    await wait(1500);

    if (wsClient.isConnected) {
      setState('connected');
      setTimeout(() => setState('hidden'), 2000);
      return;
    }

    // Not running — try to launch via intent
    setState('launching');
    launchBridge();
    await wait(3000);

    // Check again
    if (wsClient.isConnected) {
      setState('connected');
      setTimeout(() => setState('hidden'), 2000);
      return;
    }

    // Bridge not available — show install prompt
    setState('install');
  }

  function launchBridge() {
    // Android Chrome supports intent:// URLs to launch apps
    try {
      window.location.href = BRIDGE_INTENT_URL;
    } catch {
      // Intent failed — app not installed
    }
  }

  if (state === 'hidden' || dismissed) return null;

  if (state === 'checking' || state === 'launching') {
    return (
      <div className="fixed top-0 left-0 right-0 bg-gray-900/95 px-4 py-3 z-50 flex items-center gap-3 border-b border-gray-700">
        <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-300">
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
    <div className="fixed top-0 left-0 right-0 bg-gray-900/95 px-4 py-4 z-50 border-b border-gray-700">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-yellow-400 text-xl mt-0.5">download</span>
        <div className="flex-1">
          <p className="text-sm text-white font-bold">Instalar BLE Bridge</p>
          <p className="text-xs text-gray-400 mt-1">
            Para controlar o motor (assist mode) e aceder a dados avancados, instala a app BLE Bridge.
          </p>
          <div className="flex gap-2 mt-3">
            <a
              href={APK_DOWNLOAD_URL}
              className="bg-emerald-500 text-black text-sm font-bold px-4 py-2 rounded-lg active:scale-95 transition-transform"
            >
              Descarregar APK
            </a>
            <button
              onClick={() => {
                launchBridge();
                setTimeout(checkBridge, 3000);
              }}
              className="bg-gray-700 text-white text-sm px-4 py-2 rounded-lg active:scale-95 transition-transform"
            >
              Ja instalei
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="text-gray-500 text-sm px-2"
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
