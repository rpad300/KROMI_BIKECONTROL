import { useState, useEffect } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { bleMode, getSavedDevice, connectDevice } from '../../services/bluetooth/BLEBridge';
import { wsClient } from '../../services/bluetooth/WebSocketBLEClient';
import { DeviceScanner } from './DeviceScanner';

export function ConnectionStatus() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const [showScanner, setShowScanner] = useState(false);
  const [autoConnectAttempted, setAutoConnectAttempted] = useState(false);

  const bridgeUp = bleMode === 'websocket' && wsClient.isConnected;
  const saved = getSavedDevice();

  // Auto-connect to saved device when bridge becomes available
  useEffect(() => {
    if (bridgeUp && saved && bleStatus === 'disconnected' && !autoConnectAttempted) {
      setAutoConnectAttempted(true);
      console.log(`[Connection] Auto-connecting to saved device: ${saved.name} (${saved.address})`);
      connectDevice(saved.address);
    }
  }, [bridgeUp, saved, bleStatus, autoConnectAttempted]);

  // Reset auto-connect flag on disconnect so it retries next time
  useEffect(() => {
    if (bleStatus === 'disconnected') {
      // Small delay to avoid immediate re-attempt on intentional disconnect
      const t = setTimeout(() => setAutoConnectAttempted(false), 5000);
      return () => clearTimeout(t);
    }
  }, [bleStatus]);

  if (bleStatus === 'connected') return null;

  // Scanner overlay
  if (showScanner) {
    return (
      <DeviceScanner
        onConnected={() => setShowScanner(false)}
        onCancel={() => setShowScanner(false)}
      />
    );
  }

  // Bridge up, bike not connected
  if (bridgeUp) {
    return (
      <div className="fixed top-0 left-0 right-0 bg-yellow-900/90 px-4 py-3 flex items-center justify-between z-50">
        <div className="flex-1">
          <div className="text-white font-bold text-sm">
            {saved ? `A ligar a ${saved.name}...` : 'Bridge activo'}
          </div>
          <div className="text-yellow-300 text-xs">
            {saved ? saved.address : 'Nenhuma bike guardada'}
          </div>
        </div>
        <div className="flex gap-2">
          {saved && (
            <button
              onClick={() => connectDevice(saved.address)}
              className="bg-[#0058ca] text-white px-3 py-1.5 rounded-lg font-bold text-xs active:scale-95 transition-transform"
            >
              Ligar
            </button>
          )}
          <button
            onClick={() => setShowScanner(true)}
            className="bg-[#24f07e] text-white px-3 py-1.5 rounded-lg font-bold text-xs active:scale-95 transition-transform"
          >
            {saved ? 'Outra' : 'Scan'}
          </button>
        </div>
      </div>
    );
  }

  // No bridge
  const statusConfig = {
    disconnected: { bg: 'bg-[#9f0519]/90', text: 'Desligado' },
    connecting: { bg: 'bg-yellow-900/90', text: 'A ligar...' },
    reconnecting: { bg: 'bg-orange-900/90', text: 'A reconectar...' },
    connected: { bg: 'bg-green-900/90', text: 'Ligado' },
  } as const;

  const config = statusConfig[bleStatus];

  return (
    <div className={`fixed top-0 left-0 right-0 ${config.bg} px-4 py-3 flex items-center justify-between z-50`}>
      <div className="text-white font-bold text-sm">{config.text}</div>
    </div>
  );
}
