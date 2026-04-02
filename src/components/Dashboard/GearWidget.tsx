import { useBikeStore } from '../../store/bikeStore';
import { useTorqueStore } from '../../store/torqueStore';

export function GearWidget() {
  const gear = useBikeStore((s) => s.gear);
  const isShifting = useBikeStore((s) => s.is_shifting);
  const gearAdvisory = useTorqueStore((s) => s.gearAdvisory);

  if (!gear) return null; // Di2 not connected

  return (
    <div className="bg-[#1a1919] rounded-sm p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#adaaaa] text-sm">Mudanca</span>
          <span className={`text-3xl font-bold tabular-nums ${isShifting ? 'text-[#fbbf24] animate-pulse' : 'text-white'}`}>
            {gear}
          </span>
          <span className="text-[#777575] text-sm">/ 12</span>
        </div>
        {/* Cassette visual bar */}
        <div className="flex gap-0.5 items-end h-5">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
            <div
              key={g}
              className={`w-1.5 rounded-sm ${g === gear ? 'bg-blue-400' : 'bg-[#494847]'}`}
              style={{ height: `${(g / 12) * 100}%` }}
            />
          ))}
        </div>
      </div>

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
