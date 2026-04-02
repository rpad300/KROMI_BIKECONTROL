import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { calculateZones } from '../../types/athlete.types';
import { getSavedSensorDevice } from '../../services/bluetooth/BLEBridge';

const ZONE_STYLES: Record<number, { text: string; bg: string }> = {
  0: { text: 'text-gray-400', bg: 'bg-gray-600' },
  1: { text: 'text-gray-300', bg: 'bg-gray-400' },
  2: { text: 'text-blue-400', bg: 'bg-blue-500' },
  3: { text: 'text-green-400', bg: 'bg-green-500' },
  4: { text: 'text-yellow-400', bg: 'bg-yellow-500' },
  5: { text: 'text-red-400', bg: 'bg-red-500' },
};

export function HRWidget() {
  const hrBpm = useBikeStore((s) => s.hr_bpm);
  const hrConnected = useBikeStore((s) => s.ble_services.heartRate);
  const hrMax = useSettingsStore((s) => s.riderProfile.hr_max);
  const targetZone = useSettingsStore((s) => s.riderProfile.target_zone);

  const savedHR = getSavedSensorDevice('hr');
  const zones = calculateZones(hrMax > 0 ? hrMax : 185);

  let hrZone = 0;
  if (hrBpm > 0) {
    for (let i = zones.length - 1; i >= 0; i--) {
      if (hrBpm >= zones[i]!.min_bpm) { hrZone = i + 1; break; }
    }
  }

  const colors = ZONE_STYLES[hrZone] ?? ZONE_STYLES[0]!;
  const hrPct = hrMax > 0 && hrBpm > 0 ? Math.round((hrBpm / hrMax) * 100) : 0;
  const isTarget = hrZone === targetZone && hrBpm > 0;

  if (!hrBpm && !hrConnected) return null;

  return (
    <div className="bg-gray-800 rounded-xl p-2.5 flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-1 mb-1">
        <span className={`material-symbols-outlined text-xs ${hrBpm ? 'text-red-400 animate-pulse' : 'text-gray-600'}`}>
          favorite
        </span>
        <span className="text-[8px] text-gray-600 truncate">{savedHR?.name ?? 'HR'}</span>
        {isTarget && <span className="text-[7px] bg-emerald-500/20 text-emerald-400 px-1 rounded-full ml-auto">ALVO</span>}
      </div>

      {/* BPM + Zone */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-0.5">
          <span className={`text-2xl font-black tabular-nums leading-none ${colors.text}`}>{hrBpm || '--'}</span>
          <span className="text-[9px] text-gray-600">bpm</span>
        </div>
        <div className="text-right">
          <span className={`text-sm font-black ${colors.text}`}>Z{hrZone || '0'}</span>
          {hrPct > 0 && <div className="text-[8px] text-gray-600">{hrPct}%</div>}
        </div>
      </div>

      {/* Zone bar */}
      <div className="flex gap-px h-1.5 mt-1.5">
        {zones.map((_z, i) => {
          const zNum = i + 1;
          const style = ZONE_STYLES[zNum]!;
          return (
            <div key={zNum} className={`flex-1 rounded-sm transition-all duration-500 ${
              hrZone === zNum ? `${style.bg} opacity-100` :
              hrZone >= zNum ? `${style.bg} opacity-30` : 'bg-gray-700'
            }`} />
          );
        })}
      </div>
    </div>
  );
}
