import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { calculateZones } from '../../types/athlete.types';
import { getSavedSensorDevice } from '../../services/bluetooth/BLEBridge';

const ZONE_STYLES: Record<number, { text: string; bg: string; glow: string }> = {
  0: { text: 'text-gray-400', bg: 'bg-gray-600', glow: '' },
  1: { text: 'text-gray-300', bg: 'bg-gray-400', glow: '' },
  2: { text: 'text-blue-400', bg: 'bg-blue-500', glow: 'shadow-blue-500/20' },
  3: { text: 'text-green-400', bg: 'bg-green-500', glow: 'shadow-green-500/20' },
  4: { text: 'text-yellow-400', bg: 'bg-yellow-500', glow: 'shadow-yellow-500/30' },
  5: { text: 'text-red-400', bg: 'bg-red-500', glow: 'shadow-red-500/40' },
};

export function HRWidget() {
  const hrBpm = useBikeStore((s) => s.hr_bpm);
  const hrConnected = useBikeStore((s) => s.ble_services.heartRate);
  const hrMax = useSettingsStore((s) => s.riderProfile.hr_max);
  const targetZone = useSettingsStore((s) => s.riderProfile.target_zone);

  const savedHR = getSavedSensorDevice('hr');
  const deviceName = savedHR?.name ?? 'HR Monitor';

  // Calculate zones from profile
  const zones = calculateZones(hrMax > 0 ? hrMax : 185);

  // Determine current zone from actual bpm vs zone boundaries
  let hrZone = 0;
  if (hrBpm > 0) {
    for (let i = zones.length - 1; i >= 0; i--) {
      if (hrBpm >= zones[i]!.min_bpm) { hrZone = i + 1; break; }
    }
  }

  const hrPct = hrMax > 0 && hrBpm > 0 ? Math.round((hrBpm / hrMax) * 100) : 0;
  const colors = ZONE_STYLES[hrZone] ?? ZONE_STYLES[0]!;
  const isTarget = hrZone === targetZone && hrBpm > 0;

  // Current zone details
  const currentZone = hrZone > 0 ? zones[hrZone - 1] : null;
  const zoneName = currentZone?.name ?? 'Repouso';

  if (!hrBpm && !hrConnected) return null;

  return (
    <div className={`bg-gray-800 rounded-xl p-3 shadow-lg ${colors.glow}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`material-symbols-outlined text-base ${hrBpm ? 'text-red-400 animate-pulse' : 'text-gray-600'}`}>
            favorite
          </span>
          <span className="text-[10px] text-gray-500 truncate max-w-[120px]">{deviceName}</span>
        </div>
        {isTarget && (
          <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">
            ZONA ALVO
          </span>
        )}
      </div>

      {/* BPM + Zone */}
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-black tabular-nums leading-none ${colors.text}`}>
            {hrBpm || '--'}
          </span>
          <span className="text-xs text-gray-500">bpm</span>
        </div>
        <div className="text-right">
          <div className={`text-xl font-black ${colors.text}`}>
            {hrZone > 0 ? `Z${hrZone}` : 'Z0'}
          </div>
          <div className="text-[10px] text-gray-500">{zoneName.replace(/^Z\d\s*/, '')}</div>
          {hrPct > 0 && <div className="text-[9px] text-gray-600">{hrPct}% FCmax</div>}
        </div>
      </div>

      {/* Zone bar with bpm ranges */}
      <div className="mt-2 flex gap-0.5 h-3">
        {zones.map((_z, i) => {
          const zNum = i + 1;
          const style = ZONE_STYLES[zNum]!;
          const isCurrent = hrZone === zNum;
          const isActive = hrZone >= zNum;
          return (
            <div
              key={zNum}
              className={`flex-1 rounded-sm transition-all duration-500 relative ${
                isCurrent ? `${style.bg} opacity-100` :
                isActive ? `${style.bg} opacity-40` :
                'bg-gray-700'
              }`}
            >
              {isCurrent && hrBpm > 0 && (
                <div className="absolute inset-0 rounded-sm animate-pulse opacity-30 bg-white" />
              )}
            </div>
          );
        })}
      </div>

      {/* Zone labels with bpm limits */}
      <div className="flex gap-0.5 mt-1">
        {zones.map((z, i) => {
          const zNum = i + 1;
          const isCurrent = hrZone === zNum;
          const isTargetZ = zNum === targetZone;
          return (
            <div key={zNum} className="flex-1 text-center">
              <div className={`text-[8px] leading-tight ${
                isCurrent ? 'text-gray-200 font-bold' :
                isTargetZ ? 'text-emerald-600 font-bold' : 'text-gray-600'
              }`}>
                Z{zNum}{isTargetZ ? '*' : ''}
              </div>
              <div className={`text-[7px] leading-tight ${
                isCurrent ? 'text-gray-400' : 'text-gray-700'
              }`}>
                {z.min_bpm}-{z.max_bpm}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
