import { useTorqueStore } from '../../store/torqueStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { ClimbType } from '../../services/torque/TorqueEngine';

const CLIMB_COLORS: Record<ClimbType, string> = {
  [ClimbType.SHORT_STEEP]:    'text-[#ff716c]',
  [ClimbType.PUNCHY]:         'text-[#fbbf24]',
  [ClimbType.LONG_STEEP]:     'text-[#fbbf24]',
  [ClimbType.SHORT_MODERATE]: 'text-[#6e9bff]',
  [ClimbType.LONG_MODERATE]:  'text-[#3fff8b]',
  [ClimbType.ROLLING]:        'text-cyan-400',
  [ClimbType.FLAT]:           'text-[#adaaaa]',
  [ClimbType.DESCENT]:        'text-blue-300',
};

export function TorqueWidget() {
  const { torque_nm, support_pct, launch_value, climb_type, reason } = useTorqueStore();
  const terrain = useAutoAssistStore((s) => s.terrain);
  const gradient = terrain?.current_gradient_pct ?? 0;

  if (torque_nm === 0 && support_pct === 0) return null;

  return (
    <div className="bg-[#1a1919] rounded-sm p-3">
      {/* Climb type label */}
      <div className={`text-sm font-bold mb-2 ${CLIMB_COLORS[climb_type] ?? 'text-[#adaaaa]'}`}>
        {reason}
      </div>

      {/* Motor parameters */}
      <div className="grid grid-cols-3 gap-2">
        <TorqueBar label="Nm" value={torque_nm} max={85} color="bg-[#ff716c]" />
        <TorqueBar label="Suporte" value={support_pct} max={360} color="bg-[#6e9bff]" suffix="%" />
        <TorqueBar label="Resposta" value={launch_value} max={10} color="bg-[#fbbf24]" />
      </div>

      {/* Current gradient */}
      <div className="mt-2 text-xs text-[#777575] text-right">
        Gradiente: {gradient > 0 ? '+' : ''}{gradient.toFixed(1)}%
      </div>
    </div>
  );
}

function TorqueBar({ label, value, max, color, suffix = '' }: {
  label: string; value: number; max: number; color: string; suffix?: string;
}) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold text-white tabular-nums">{value}{suffix}</div>
      <div className="text-xs text-[#adaaaa]">{label}</div>
      <div className="mt-1 h-1.5 bg-[#262626] rounded-full">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );
}
