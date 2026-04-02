import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { calculateZones } from '../../types/athlete.types';
import { getSavedSensorDevice } from '../../services/bluetooth/BLEBridge';

const ZONE_COLORS: Record<number, string> = {
  0: '#777575',
  1: '#adaaaa',
  2: '#6e9bff',
  3: '#3fff8b',
  4: '#fbbf24',
  5: '#ff716c',
};

const ZONE_BG: Record<number, string> = {
  0: '#494847',
  1: '#777575',
  2: '#0058ca',
  3: '#24f07e',
  4: '#d97706',
  5: '#d7383b',
};

export function HRWidget() {
  const hrBpm = useBikeStore((s) => s.hr_bpm);
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

  const color = ZONE_COLORS[hrZone] ?? '#777575';
  const hrPct = hrMax > 0 && hrBpm > 0 ? Math.round((hrBpm / hrMax) * 100) : 0;
  const isTarget = hrZone === targetZone && hrBpm > 0;

  // ALWAYS render — never return null (prevents mount/unmount flicker)
  return (
    <div className="flex-1 min-w-0" style={{ backgroundColor: '#201f1f', padding: '10px', borderRadius: '2px' }}>
      {/* Header — NO animate-pulse */}
      <div className="flex items-center gap-1 mb-1">
        <span
          className="material-symbols-outlined text-xs"
          style={{ color: hrBpm > 0 ? '#ff716c' : '#494847', fontVariationSettings: "'FILL' 1", transition: 'color 0.5s' }}
        >
          favorite
        </span>
        <span style={{ fontSize: '8px', color: '#777575' }} className="truncate">{savedHR?.name ?? 'Heart Rate'}</span>
        {isTarget && (
          <span style={{ fontSize: '7px', backgroundColor: 'rgba(63,255,139,0.2)', color: '#3fff8b', padding: '0 4px', marginLeft: 'auto' }}>ALVO</span>
        )}
      </div>

      {/* BPM + Zone — transition prevents flicker */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-0.5">
          <span
            className="text-2xl font-black tabular-nums leading-none"
            style={{ color, transition: 'color 0.5s' }}
          >
            {hrBpm > 0 ? hrBpm : '--'}
          </span>
          <span style={{ fontSize: '9px', color: '#777575' }}>bpm</span>
        </div>
        <div className="text-right">
          <span className="text-sm font-black font-headline" style={{ color, transition: 'color 0.5s' }}>
            {hrBpm > 0 ? `Z${hrZone}` : '--'}
          </span>
          {hrPct > 0 && <div style={{ fontSize: '8px', color: '#777575' }}>{hrPct}%</div>}
        </div>
      </div>

      {/* Zone bar */}
      <div className="flex gap-px h-1.5 mt-1.5">
        {zones.map((_z, i) => {
          const zNum = i + 1;
          const bg = ZONE_BG[zNum] ?? '#494847';
          const active = hrZone === zNum;
          const past = hrZone > zNum;
          return (
            <div
              key={zNum}
              style={{
                flex: 1,
                borderRadius: '1px',
                backgroundColor: active ? bg : past ? bg : '#262626',
                opacity: active ? 1 : past ? 0.3 : 1,
                transition: 'background-color 0.5s, opacity 0.5s',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
