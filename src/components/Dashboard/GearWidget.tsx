import { useBikeStore } from '../../store/bikeStore';
import { useTorqueStore } from '../../store/torqueStore';

export function GearWidget() {
  const gear = useBikeStore((s) => s.gear);
  const isShifting = useBikeStore((s) => s.is_shifting);
  const totalGears = useBikeStore((s) => s.total_gears);
  const di2Battery = useBikeStore((s) => s.di2_battery);
  const bikeBattery = useBikeStore((s) => s.battery_percent);
  const shiftCount = useBikeStore((s) => s.shift_count);
  const di2Connected = useBikeStore((s) => s.ble_services.di2);
  const gearAdvisory = useTorqueStore((s) => s.gearAdvisory);

  if (!gear && !di2Connected) return null;

  return (
    <div className="bg-[#1a1919] rounded-sm p-3">
      {/* Gear number + cassette bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#adaaaa] text-sm">Mudanca</span>
          <span className={`text-3xl font-bold tabular-nums ${isShifting ? 'text-[#fbbf24] animate-pulse' : 'text-white'}`}>
            {gear || '--'}
          </span>
          <span className="text-[#777575] text-sm">/ {totalGears}</span>
        </div>
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

      {/* Batteries: bike + Di2 */}
      <div className="mt-2 space-y-1">
        <BatteryRow label="Bike" pct={bikeBattery} />
        {di2Battery > 0 && <BatteryRow label="Di2" pct={di2Battery} />}
      </div>

      {/* Shift count */}
      {di2Connected && shiftCount > 0 && (
        <div className="flex items-center justify-between mt-1.5 text-[9px] text-[#777575]">
          <span className="text-[#3fff8b]">Di2 conectado</span>
          <span className="tabular-nums">{shiftCount} shifts</span>
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

function BatteryRow({ label, pct }: { label: string; pct: number }) {
  const color =
    pct > 50 ? 'bg-[#3fff8b]' :
    pct > 30 ? 'bg-[#fbbf24]' :
    pct > 15 ? 'bg-[#fbbf24]' : 'bg-[#ff716c]';
  const textColor =
    pct > 50 ? 'text-[#3fff8b]' :
    pct > 30 ? 'text-[#fbbf24]' : 'text-[#ff716c]';

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-[#777575] w-6">{label}</span>
      <div className="flex-1 h-1.5 bg-[#262626] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
      <span className={`text-[9px] tabular-nums w-7 text-right font-bold ${textColor}`}>{pct}%</span>
    </div>
  );
}
