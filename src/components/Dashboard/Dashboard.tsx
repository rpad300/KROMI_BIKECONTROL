import { useState } from 'react';
import { SpeedDisplay } from './SpeedDisplay';
import { BatteryWidget } from './BatteryWidget';
import { AssistModeWidget } from './AssistModeWidget';
import { ElevationProfile } from './ElevationProfile';
import { AutoAssistWidget } from './AutoAssistWidget';
import { HRWidget } from './HRWidget';
import { GearWidget } from './GearWidget';
import { TorqueWidget } from './TorqueWidget';
import { MotorWidget } from './MotorWidget';
import { RideSessionWidget } from './RideSessionWidget';
import { TripStatsWidget } from './TripStatsWidget';
import { IntelligenceWidget } from './IntelligenceWidget';
import { MiniMap } from './MiniMap';
import { WeatherWidget } from './WeatherWidget';
import { TrailWidget } from './TrailWidget';
import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';

export function Dashboard() {
  const gpsActive = useMapStore((s) => s.gpsActive);
  const hrConnected = useBikeStore((s) => s.ble_services.heartRate || s.hr_bpm > 0);
  const di2Connected = useBikeStore((s) => s.ble_services.di2);
  const autoAssistEnabled = useAutoAssistStore((s) => s.enabled);
  const hasTorque = useBikeStore((s) => s.torque_nm > 0);
  const hasMotorData = useBikeStore((s) => s.power_watts > 0 || s.torque_nm > 0 || s.front_gear > 0 || s.rear_gear > 0);
  const [showSession, setShowSession] = useState(false);

  return (
    <div className="flex flex-col gap-2 p-3 pb-1">
      {/* Status bar */}
      <StatusBar />

      {/* Speed - hero element */}
      <SpeedDisplay />

      {/* Compact metrics row: Power | Battery% | Range | Cadence */}
      <CompactMetricsRow />

      {/* Assist mode buttons */}
      <AssistModeWidget />

      {/* Motor telemetry — torque, cadence, power, current + gear */}
      {hasMotorData && <MotorWidget />}

      {/* KROMI intelligence — shows scoring and decisions (POWER mode) */}
      <IntelligenceWidget />

      {/* Trip stats (always show when connected — motor provides trip data) */}
      <TripStatsWidget />

      {/* Battery + HR side by side */}
      <div className="flex gap-2">
        <BatteryWidget />
        {hrConnected && <HRWidget />}
      </div>

      {/* Weather + Trail */}
      <WeatherWidget />
      <TrailWidget />

      {/* Mini map + Elevation profile */}
      <MiniMap />
      {gpsActive && <ElevationProfile />}

      {/* Auto-assist status (only if enabled) */}
      {autoAssistEnabled && <AutoAssistWidget />}

      {/* Legacy gear/torque (only if Di2 provides additional data beyond FC23) */}
      {di2Connected && !hasMotorData && <GearWidget />}
      {hasTorque && !hasMotorData && <TorqueWidget />}

      {/* Ride session - floating button */}
      {showSession ? (
        <div className="relative">
          <button
            onClick={() => setShowSession(false)}
            className="absolute -top-1 right-0 text-gray-500 text-xs p-1 z-10"
          >
            &#x2715;
          </button>
          <RideSessionWidget />
        </div>
      ) : (
        <button
          onClick={() => setShowSession(true)}
          className="w-full h-14 rounded-xl font-bold text-white text-lg bg-gray-700 active:scale-95 transition-transform"
        >
          VOLTA
        </button>
      )}
    </div>
  );
}

/** Compact 4-column metrics row */
function CompactMetricsRow() {
  const power = useBikeStore((s) => s.power_watts);
  const battery = useBikeStore((s) => s.battery_percent);
  const rangeEstimated = useBikeStore((s) => s.range_km);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);
  const estimatedModes = useBikeStore((s) => s.range_estimated_modes);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const cadence = useBikeStore((s) => s.cadence_rpm);

  // Use motor-reported range for current mode when available
  const modeMap: Record<number, string> = { 1: 'eco', 2: 'tour', 3: 'active', 4: 'sport', 5: 'power', 6: 'smart' };
  const modeKey = modeMap[assistMode] ?? 'power';
  const motorRange = rangePerMode ? (rangePerMode as Record<string, number>)[modeKey] : 0;
  const range = motorRange && motorRange > 0 ? motorRange : rangeEstimated;
  const rangePrefix = estimatedModes.has(modeKey) ? '~' : '';

  const batColor =
    battery > 30 ? 'text-emerald-400' :
    battery > 15 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="grid grid-cols-4 gap-1.5">
      <MetricCell value={String(power)} label="PWR" unit="W" />
      <MetricCell value={String(battery)} label="BAT" unit="%" color={batColor} />
      <MetricCell value={range > 0 ? `${rangePrefix}${range.toFixed(0)}` : '--'} label="RNG" unit="km" />
      <MetricCell value={String(cadence)} label="CAD" unit="rpm" />
    </div>
  );
}

function MetricCell({ value, label, unit, color }: {
  value: string; label: string; unit: string; color?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-2 text-center">
      <div className={`text-xl font-bold tabular-nums ${color ?? 'text-white'}`}>{value}</div>
      <div className="text-[10px] text-gray-500">{label} <span className="text-gray-600">{unit}</span></div>
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
