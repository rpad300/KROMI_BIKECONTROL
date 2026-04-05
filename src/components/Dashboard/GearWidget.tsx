import { useBikeStore } from '../../store/bikeStore';
import { useTorqueStore } from '../../store/torqueStore';

export function GearWidget() {
  const gear = useBikeStore((s) => s.gear);
  const isShifting = useBikeStore((s) => s.is_shifting);
  const totalGears = useBikeStore((s) => s.total_gears);
  const di2Battery = useBikeStore((s) => s.di2_battery);
  const shiftCount = useBikeStore((s) => s.shift_count);
  const di2Connected = useBikeStore((s) => s.ble_services.di2);
  const gearAdvisory = useTorqueStore((s) => s.gearAdvisory);

  if (!gear && !di2Connected) return null;

  const batColor =
    di2Battery > 50 ? 'text-[#3fff8b]' :
    di2Battery > 20 ? 'text-[#fbbf24]' : 'text-[#ff716c]';

  return (
    <div className="bg-[#1a1919] rounded-sm p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#adaaaa] text-sm">Mudanca</span>
          <span className={`text-3xl font-bold tabular-nums ${isShifting ? 'text-[#fbbf24] animate-pulse' : 'text-white'}`}>
            {gear || '--'}
          </span>
          <span className="text-[#777575] text-sm">/ {totalGears}</span>
        </div>
        {/* Cassette visual bar */}
        <div className="flex gap-0.5 items-end h-5">
          {Array.from({ length: totalGears }, (_, i) => i + 1).map((g) => (
            <div
              key={g}
              className={`w-1.5 rounded-sm ${g === gear ? 'bg-blue-400' : 'bg-[#494847]'}`}
              style={{ height: `${(g / totalGears) * 100}%` }}
            />
          ))}
        </div>
      </div>

      {/* Di2 info row: battery + shift count */}
      {di2Connected && (
        <div className="flex items-center justify-between mt-1.5 text-[9px]">
          <div className="flex items-center gap-2">
            <span className="text-[#3fff8b]">Di2</span>
            {di2Battery > 0 && (
              <span className={`tabular-nums ${batColor}`}>
                <span className="material-symbols-outlined text-[10px] align-middle">battery_std</span>
                {di2Battery}%
              </span>
            )}
          </div>
          {shiftCount > 0 && (
            <span className="text-[#777575] tabular-nums">{shiftCount} shifts</span>
          )}
        </div>
      )}

      {/* Pre-shift advisory */}
      {gearAdvisory && (
        <div className={`mt-2 p-2 rounded-lg text-sm font-bold flex gap-2 items-center ${
          gearAdvisory.urgency === 'urgent'
            ? 'bg-[#9f0519] text-[#ff716c] animate-pulse'
            : 'bg-yellow-900 text-yellow-300'
        }`}>
          <span>{gearAdvisory.gears_to_drop}x ↓ → {gearAdvisory.target_gear}a</span>
          <span className="text-xs opacity-75">
            subida {Math.round(gearAdvisory.distance_m)}m (+{gearAdvisory.gradient_pct.toFixed(0)}%)
          </span>
        </div>
      )}
    </div>
  );
}
