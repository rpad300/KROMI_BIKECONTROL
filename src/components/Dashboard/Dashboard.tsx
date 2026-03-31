import { SpeedDisplay } from './SpeedDisplay';
import { BatteryWidget } from './BatteryWidget';
import { PowerCadenceWidget } from './PowerCadenceWidget';
import { AssistModeWidget } from './AssistModeWidget';
import { useBikeStore } from '../../store/bikeStore';

export function Dashboard() {
  const bleStatus = useBikeStore((s) => s.ble_status);

  return (
    <div className="flex flex-col gap-3 p-3 pb-1">
      {/* Status bar */}
      <StatusBar />

      {/* Speed - hero element */}
      <SpeedDisplay />

      {/* Power + Cadence */}
      <PowerCadenceWidget />

      {/* Battery */}
      <BatteryWidget />

      {/* Assist mode buttons */}
      <AssistModeWidget />

      {/* Elevation profile placeholder - Phase 2 */}
      {bleStatus === 'connected' && (
        <div className="bg-gray-800 rounded-xl p-3 h-20 flex items-center justify-center">
          <span className="text-gray-500 text-sm">Perfil elevacao (Fase 2)</span>
        </div>
      )}
    </div>
  );
}

function StatusBar() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const battery = useBikeStore((s) => s.battery_percent);

  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const bleIndicator = {
    connected: 'text-green-400',
    connecting: 'text-yellow-400',
    reconnecting: 'text-orange-400',
    disconnected: 'text-red-400',
  } as const;

  return (
    <div className="flex items-center justify-between text-xs text-gray-400 px-1">
      <div className="flex items-center gap-3">
        <span className={bleIndicator[bleStatus]}>
          {bleStatus === 'connected' ? '● BLE' : '○ BLE'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {battery > 0 && <span>🔋 {battery}%</span>}
        <span className="tabular-nums">{time}</span>
      </div>
    </div>
  );
}
