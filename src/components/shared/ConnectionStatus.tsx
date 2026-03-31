import { useBikeStore } from '../../store/bikeStore';
import { connectBike, bleMode } from '../../services/bluetooth/BLEBridge';
import { wsClient } from '../../services/bluetooth/WebSocketBLEClient';

export function ConnectionStatus() {
  const bleStatus = useBikeStore((s) => s.ble_status);

  if (bleStatus === 'connected') return null;

  const bridgeUp = bleMode === 'websocket' && wsClient.isConnected;

  const handleConnect = async () => {
    try {
      await connectBike();
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  if (bridgeUp) {
    // Bridge is running but bike not connected — user should use APK to scan
    return (
      <div className="fixed top-0 left-0 right-0 bg-yellow-900/90 px-4 py-3 flex items-center justify-between z-50">
        <div>
          <div className="text-white font-bold text-sm">Bridge activo — bike desligada</div>
          <div className="text-yellow-300 text-xs">Toca SCAN no BLE Bridge APK</div>
        </div>
        <button
          onClick={handleConnect}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs active:scale-95 transition-transform"
        >
          Auto-ligar
        </button>
      </div>
    );
  }

  const statusConfig = {
    disconnected: { bg: 'bg-red-900/90', text: 'Desligado' },
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
