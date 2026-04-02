import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getSavedSensorDevice } from '../../services/bluetooth/BLEBridge';

const ZONE_COLORS: Record<number, { text: string; bg: string; glow: string }> = {
  0: { text: 'text-gray-500', bg: 'bg-gray-600', glow: '' },
  1: { text: 'text-gray-400', bg: 'bg-gray-500', glow: '' },
  2: { text: 'text-blue-400', bg: 'bg-blue-500', glow: 'shadow-blue-500/20' },
  3: { text: 'text-green-400', bg: 'bg-green-500', glow: 'shadow-green-500/20' },
  4: { text: 'text-yellow-400', bg: 'bg-yellow-500', glow: 'shadow-yellow-500/30' },
  5: { text: 'text-red-400', bg: 'bg-red-500', glow: 'shadow-red-500/40' },
};

const ZONE_NAMES: Record<number, string> = {
  0: '—', 1: 'Recuperacao', 2: 'Base',
  3: 'Aerobico', 4: 'Limiar', 5: 'Maximo',
};

export function HRWidget() {
  const hrBpm = useBikeStore((s) => s.hr_bpm);
  const hrZone = useBikeStore((s) => s.hr_zone);
  const hrMax = useSettingsStore((s) => s.riderProfile.hr_max);
  const targetZone = useSettingsStore((s) => s.riderProfile.target_zone);
  const hrConnected = useBikeStore((s) => s.ble_services.heartRate);

  const savedHR = getSavedSensorDevice('hr');
  const deviceName = savedHR?.name ?? 'HR Monitor';
  const colors = ZONE_COLORS[hrZone] ?? ZONE_COLORS[0]!;
  const hrPct = hrMax > 0 ? Math.round((hrBpm / hrMax) * 100) : 0;
  const isTarget = hrZone === targetZone;

  if (!hrBpm && !hrConnected) {
    return null;
  }

  return (
    <div className={`bg-gray-800 rounded-xl p-3 shadow-lg ${colors.glow}`}>
      {/* Header: device name + connection status */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`material-symbols-outlined text-base ${hrBpm ? 'text-red-400 animate-pulse' : 'text-gray-600'}`}>
            favorite
          </span>
          <span className="text-[10px] text-gray-500 truncate max-w-[120px]">{deviceName}</span>
        </div>
        {isTarget && hrBpm > 0 && (
          <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">
            ZONA ALVO
          </span>
        )}
      </div>

      {/* Main BPM display */}
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-black tabular-nums leading-none ${colors.text}`}>
            {hrBpm || '--'}
          </span>
          <span className="text-xs text-gray-500">bpm</span>
        </div>

        <div className="text-right">
          <div className={`text-xl font-black ${colors.text}`}>Z{hrZone || '-'}</div>
          <div className="text-[10px] text-gray-500">{ZONE_NAMES[hrZone]}</div>
          {hrPct > 0 && (
            <div className="text-[9px] text-gray-600">{hrPct}% FCmax</div>
          )}
        </div>
      </div>

      {/* Zone bar with segments */}
      <div className="mt-2 flex gap-0.5 h-2.5">
        {[1, 2, 3, 4, 5].map((z) => {
          const zColors = ZONE_COLORS[z]!;
          const isActive = hrZone >= z;
          const isCurrent = hrZone === z;
          return (
            <div
              key={z}
              className={`flex-1 rounded-sm transition-all duration-500 ${
                isCurrent ? `${zColors.bg} opacity-100` :
                isActive ? `${zColors.bg} opacity-40` :
                'bg-gray-700'
              }`}
            />
          );
        })}
      </div>

      {/* Zone labels under bar */}
      <div className="flex gap-0.5 mt-0.5">
        {[1, 2, 3, 4, 5].map((z) => (
          <div key={z} className={`flex-1 text-center text-[8px] ${
            z === hrZone ? 'text-gray-300 font-bold' :
            z === targetZone ? 'text-emerald-600' : 'text-gray-700'
          }`}>
            Z{z}{z === targetZone ? '*' : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
