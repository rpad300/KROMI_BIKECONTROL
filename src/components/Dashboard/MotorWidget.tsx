import { useBikeStore } from '../../store/bikeStore';

/** Compact motor telemetry — torque, cadence, power, current + gear */
export function MotorWidget() {
  const torque = useBikeStore((s) => s.torque_nm);
  const cadence = useBikeStore((s) => s.cadence_rpm);
  const power = useBikeStore((s) => s.power_watts);
  const current = useBikeStore((s) => s.assist_current_a);
  const frontGear = useBikeStore((s) => s.front_gear);
  const rearGear = useBikeStore((s) => s.rear_gear);

  const hasGear = frontGear > 0 || rearGear > 0;
  const hasTelemetry = torque > 0 || power > 0 || cadence > 0;

  if (!hasTelemetry && !hasGear) return null;

  return (
    <div className="bg-[#1a1919] rounded-sm p-2">
      <div className="grid grid-cols-4 gap-1 text-center">
        <MCell value={power > 0 ? String(power) : '0'} label="PWR" unit="W" color={power > 200 ? 'text-[#fbbf24]' : 'text-white'} />
        <MCell value={torque > 0 ? torque.toFixed(1) : '0'} label="TRQ" unit="Nm" />
        <MCell value={cadence > 0 ? String(cadence) : '0'} label="CAD" unit="rpm" />
        <MCell value={current > 0 ? current.toFixed(1) : '0'} label="CUR" unit="A" color={current > 5 ? 'text-[#fbbf24]' : 'text-white'} />
      </div>

      {/* Gear display — from eShift FC23 cmd 0x42 */}
      {hasGear && (
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-[#494847]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#777575]">GEAR</span>
            {frontGear > 0 && (
              <span className="text-sm font-bold text-[#adaaaa]">{frontGear}×</span>
            )}
            <span className="text-xl font-black text-white tabular-nums">{rearGear}</span>
            <span className="text-[10px] text-[#777575]">/ 12</span>
          </div>
          {/* Mini cassette bar */}
          <div className="flex gap-0.5 items-end h-4">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
              <div
                key={g}
                className={`w-1 rounded-sm ${g === rearGear ? 'bg-[#6e9bff]' : 'bg-[#262626]'}`}
                style={{ height: `${(g / 12) * 100}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MCell({ value, label, unit, color }: {
  value: string; label: string; unit: string; color?: string;
}) {
  return (
    <div>
      <div className={`text-base font-bold tabular-nums leading-tight ${color ?? 'text-white'}`}>{value}</div>
      <div className="text-[9px] text-[#777575]">{label} <span className="text-[#777575]">{unit}</span></div>
    </div>
  );
}
