import { useIntelligenceStore } from '../../store/intelligenceStore';
import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getTargetZone } from '../../types/athlete.types';

/**
 * IntelligenceWidget — explains WHY the motor is doing what it's doing.
 * Not just bars and numbers — contextual explanation of the decision.
 */
export function IntelligenceWidget() {
  const active = useIntelligenceStore((s) => s.active);
  const intensity = useIntelligenceStore((s) => s.intensity);
  const supportI = useIntelligenceStore((s) => s.supportIntensity);
  const torqueI = useIntelligenceStore((s) => s.torqueIntensity);
  const launchI = useIntelligenceStore((s) => s.launchIntensity);
  const actual = useIntelligenceStore((s) => s.actual);
  const factors = useIntelligenceStore((s) => s.factors);
  const preemptive = useIntelligenceStore((s) => s.preemptive);
  const hr = useBikeStore((s) => s.hr_bpm);
  const rider = useSettingsStore((s) => s.riderProfile);

  if (!active) return null;

  const targetZone = getTargetZone(rider);
  const hasHR = hr > 0;

  // Generate contextual explanation
  let explanation = '';
  let explanationColor = 'text-gray-400';

  // Determine wire value and battery state for consistent messaging
  const calibration = useIntelligenceStore.getState().calibration;
  const batteryLimiting = useIntelligenceStore.getState().factors.some(
    (f) => f.name === 'Bateria' && f.value < 0
  );
  const isWire0 = calibration.support === 0; // MAX

  // Consistent UI pattern:
  // wire 0 + HR above: "Motor MAX — HR Xbpm acima, a proteger"
  // wire 1 + HR above: "Motor a ajudar — HR Xbpm acima"
  // wire 1 + battery:  "Motor limitado pela bateria — HR Xbpm acima (SOC Y%)"
  // wire 0/1 + in zone: "A manter Z — HR controlada ✓"
  // wire 2 + below:     "Motor reduzido — HR Xbpm abaixo, podes mais"
  if (!hasHR) {
    explanation = 'Sem sensor HR — a estimar pelo terreno';
    explanationColor = 'text-gray-500';
  } else if (hr > targetZone.max_bpm) {
    const above = hr - targetZone.max_bpm;
    const soc = useBikeStore.getState().battery_percent;
    if (batteryLimiting) {
      explanation = `Motor limitado pela bateria — HR ${above}bpm acima de ${targetZone.name} (SOC ${soc}%)`;
      explanationColor = 'text-orange-400';
    } else if (isWire0) {
      explanation = `Motor MAX — HR ${above}bpm acima de ${targetZone.name}, a proteger`;
      explanationColor = 'text-red-400';
    } else {
      explanation = `Motor a ajudar — HR ${above}bpm acima de ${targetZone.name}`;
      explanationColor = 'text-yellow-400';
    }
  } else if (hr < targetZone.min_bpm) {
    const below = targetZone.min_bpm - hr;
    explanation = `Motor reduzido — HR ${below}bpm abaixo de ${targetZone.name}, podes mais`;
    explanationColor = 'text-blue-400';
  } else {
    explanation = `A manter ${targetZone.name} — HR controlada ✓`;
    explanationColor = 'text-emerald-400';
  }

  return (
    <div className="bg-gray-800 rounded-xl p-3 space-y-2">
      {/* Decision explanation — the most important line */}
      <div className={`text-xs font-bold ${explanationColor}`}>
        {explanation}
      </div>

      {/* Header: intensity + motor state */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-emerald-400">KROMI</span>
          <span className="text-xl font-bold tabular-nums text-white">{intensity}%</span>
        </div>
        <div className="text-[10px] text-gray-500 text-right">
          S{actual.support}% T{actual.torque} R{actual.launch}
        </div>
      </div>

      {/* 3 independent intensity bars */}
      <div className="space-y-1">
        <IntensityBar label="Support" value={supportI} actual={`${actual.support}%`} color="bg-blue-500" />
        <IntensityBar label="Torque" value={torqueI} actual={`${actual.torque}/${actual.midTorque}/${actual.lowTorque}`} color="bg-orange-500" />
        <IntensityBar label="Launch" value={launchI} actual={`${actual.launch}`} color="bg-purple-500" />
      </div>

      {/* Pre-emptive alert */}
      {preemptive && (
        <div className="bg-blue-900/30 border border-blue-800/50 rounded-lg px-3 py-1.5 text-xs text-blue-300">
          ⚡ {preemptive}
        </div>
      )}

      {/* Factors */}
      <div className="space-y-0.5">
        {factors.map((f) => (
          <div key={f.name} className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500 w-20">{f.name}</span>
            <span className="text-gray-400 flex-1 text-right mr-2 truncate">{f.detail}</span>
            {f.value !== 0 && (
              <span className={`font-bold tabular-nums w-8 text-right ${f.value > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {f.value > 0 ? '+' : ''}{f.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function IntensityBar({ label, value, actual, color }: {
  label: string; value: number; actual: string; color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-14">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden relative">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${value}%` }} />
        <div className="absolute top-0 left-[35%] w-px h-full bg-gray-500/30" />
        <div className="absolute top-0 left-[65%] w-px h-full bg-gray-500/30" />
      </div>
      <span className="text-[10px] text-gray-500 tabular-nums w-20 text-right">{actual}</span>
    </div>
  );
}
