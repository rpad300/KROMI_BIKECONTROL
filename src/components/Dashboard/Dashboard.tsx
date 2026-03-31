import { SpeedDisplay } from './SpeedDisplay';
import { BatteryWidget } from './BatteryWidget';
import { PowerCadenceWidget } from './PowerCadenceWidget';
import { AssistModeWidget } from './AssistModeWidget';
import { ElevationProfile } from './ElevationProfile';
import { AutoAssistWidget } from './AutoAssistWidget';
import { HRWidget } from './HRWidget';
import { GearWidget } from './GearWidget';
import { TorqueWidget } from './TorqueWidget';
import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';

export function Dashboard() {
  const gpsActive = useMapStore((s) => s.gpsActive);

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

      {/* Heart rate */}
      <HRWidget />

      {/* Elevation profile (needs GPS) */}
      {gpsActive && <ElevationProfile />}

      {/* Auto-assist status */}
      <AutoAssistWidget />

      {/* Gear (Di2) */}
      <GearWidget />

      {/* Torque control */}
      <TorqueWidget />
    </div>
  );
}

function StatusBar() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const battery = useBikeStore((s) => s.battery_percent);
  const gpsActive = useMapStore((s) => s.gpsActive);

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
        <span className={gpsActive ? 'text-green-400' : 'text-gray-600'}>
          {gpsActive ? '● GPS' : '○ GPS'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {battery > 0 && <span>🔋 {battery}%</span>}
        <span className="tabular-nums">{time}</span>
      </div>
    </div>
  );
}
