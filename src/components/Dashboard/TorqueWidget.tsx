import { useTorqueStore } from '../../store/torqueStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { ClimbType } from '../../services/torque/TorqueEngine';

const CLIMB_COLORS: Record<ClimbType, string> = {
  [ClimbType.SHORT_STEEP]:    'text-red-400',
  [ClimbType.PUNCHY]:         'text-orange-400',
  [ClimbType.LONG_STEEP]:     'text-yellow-400',
  [ClimbType.SHORT_MODERATE]: 'text-blue-400',
  [ClimbType.LONG_MODERATE]:  'text-green-400',
  [ClimbType.ROLLING]:        'text-cyan-400',
  [ClimbType.FLAT]:           'text-gray-400',
  [ClimbType.DESCENT]:        'text-blue-300',
};

export function TorqueWidget() {
  const { torque_nm, support_pct, launch_value, climb_type, reason } = useTorqueStore();
  const terrain = useAutoAssistStore((s) => s.terrain);
  const gradient = terrain?.current_gradient_pct ?? 0;

  if (torque_nm === 0 && support_pct === 0) return null;

  return (
    <div className="bg-gray-800 rounded-xl p-3">
      {/* Climb type label */}
      <div className={`text-sm font-bold mb-2 ${CLIMB_COLORS[climb_type] ?? 'text-gray-400'}`}>
        {reason}
      </div>

      {/* Motor parameters */}
      <div className="grid grid-cols-3 gap-2">
        <TorqueBar label="Nm" value={torque_nm} max={85} color="bg-red-500" />
        <TorqueBar label="Suporte" value={support_pct} max={360} color="bg-blue-500" suffix="%" />
        <TorqueBar label="Resposta" value={launch_value} max={10} color="bg-yellow-500" />
      </div>

      {/* Current gradient */}
      <div className="mt-2 text-xs text-gray-500 text-right">
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
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 h-1.5 bg-gray-700 rounded-full">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );
}
