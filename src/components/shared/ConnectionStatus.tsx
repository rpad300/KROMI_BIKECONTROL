import { useState } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { bleMode, connectDevice } from '../../services/bluetooth/BLEBridge';
import { wsClient } from '../../services/bluetooth/WebSocketBLEClient';
import { useSettingsStore } from '../../store/settingsStore';
import { DeviceScanner } from './DeviceScanner';

/**
 * ConnectionStatus — minimal, non-intrusive connection indicator.
 *
 * Design rules:
 * - If bike is connected → HIDDEN (nothing to show)
 * - If connecting/reconnecting → small status bar (non-blocking)
 * - If bridge is up but bike not connected → discrete dot indicator,
 *   NOT a full-width banner asking to connect (auto-connect handles it)
 * - Full scanner only shown on explicit user action (tap the indicator)
 */
export function ConnectionStatus() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const [showScanner, setShowScanner] = useState(false);
  const bikeConfig = useSettingsStore((s) => s.bikeConfig);
  const hasBikeConfigured = !!(bikeConfig?.sensors?.motor?.address);
  const bridgeUp = bleMode === 'websocket' && wsClient.isConnected;

  // Connected → hide completely
  if (bleStatus === 'connected') return null;

  // Scanner overlay (explicit user action)
  if (showScanner) {
    return (
      <DeviceScanner
        onConnected={() => setShowScanner(false)}
        onCancel={() => setShowScanner(false)}
      />
    );
  }

  // Actively connecting → small non-blocking status
  if (bleStatus === 'connecting' || bleStatus === 'reconnecting') {
    return (
      <div className="fixed top-0 left-0 right-0 bg-yellow-900/80 px-4 py-2 flex items-center gap-2 z-50">
        <div className="w-3 h-3 border-2 border-yellow-300 border-t-transparent rounded-full animate-spin" />
        <span className="text-yellow-300 text-xs font-bold">
          {bleStatus === 'connecting' ? 'A ligar...' : 'A reconectar...'}
        </span>
      </div>
    );
  }

  // Bridge up, bike configured but not connected (auto-connect already tried)
  // PersistentBar already shows "● OFF" and 0% battery — no need for extra pill.
  // User can go to BLE tab to manually retry.
  if (bridgeUp && hasBikeConfigured) {
    return null;
  }

  // Bridge up, NO bike configured → show setup prompt
  if (bridgeUp && !hasBikeConfigured) {
    return (
      <div className="fixed top-0 left-0 right-0 px-4 py-3 flex items-center justify-between z-50"
           style={{ backgroundColor: 'rgba(14,14,14,0.9)', borderBottom: '1px solid var(--ev-outline-variant)' }}>
        <div>
          <div className="text-white font-bold text-sm">Configurar Bike</div>
          <div className="text-xs" style={{ color: 'var(--ev-on-surface-muted)' }}>Nenhuma bike registada</div>
        </div>
        <button
          onClick={() => setShowScanner(true)}
          className="px-3 py-1.5 font-bold text-xs active:scale-95"
          style={{ backgroundColor: 'var(--ev-primary)', color: '#000' }}
        >
          Scan
        </button>
      </div>
    );
  }

  // No bridge, disconnected → minimal indicator
  return null;
}
