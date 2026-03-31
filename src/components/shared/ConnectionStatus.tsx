import { useBikeStore } from '../../store/bikeStore';
import { connectBike } from '../../services/bluetooth/BLEBridge';

export function ConnectionStatus() {
  const bleStatus = useBikeStore((s) => s.ble_status);

  const handleConnect = async () => {
    try {
      await connectBike();
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  if (bleStatus === 'connected') return null;

  const statusConfig = {
    disconnected: { bg: 'bg-red-900/90', text: 'Desligado', showButton: true },
    connecting: { bg: 'bg-yellow-900/90', text: 'A ligar...', showButton: false },
    reconnecting: { bg: 'bg-orange-900/90', text: 'A reconectar...', showButton: false },
    connected: { bg: 'bg-green-900/90', text: 'Ligado', showButton: false },
  } as const;

  const config = statusConfig[bleStatus];

  return (
    <div className={`fixed top-0 left-0 right-0 ${config.bg} px-4 py-3 flex items-center justify-between z-50`}>
      <div>
        <div className="text-white font-bold text-sm">{config.text}</div>
      </div>
      {config.showButton && (
        <button
          onClick={handleConnect}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm active:scale-95 transition-transform"
        >
          Ligar Bike
        </button>
      )}
    </div>
  );
}
