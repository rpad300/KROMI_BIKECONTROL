import { useIntelligenceStore } from '../../store/intelligenceStore';

const WIRE_LABELS = { 0: 'MAX', 1: 'MID', 2: 'MIN' } as const;
const WIRE_BG = { 0: 'bg-red-600', 1: 'bg-yellow-600', 2: 'bg-green-600' } as const;

/**
 * IntelligenceWidget — shows KROMI's continuous calibration.
 * Intensity 0-100% → mapped to motor wire value (0/1/2).
 * Transparent: shows every factor and the motor's current state.
 */
export function IntelligenceWidget() {
  const active = useIntelligenceStore((s) => s.active);
  const intensity = useIntelligenceStore((s) => s.intensity);
  const wireValue = useIntelligenceStore((s) => s.wireValue);
  const factors = useIntelligenceStore((s) => s.factors);
  const preemptive = useIntelligenceStore((s) => s.preemptive);
  const assistPct = useIntelligenceStore((s) => s.motorAssistPct);
  const torqueNm = useIntelligenceStore((s) => s.motorTorqueNm);
  const whKm = useIntelligenceStore((s) => s.motorConsumptionWhKm);

  if (!active) return null;

  const barColor = intensity > 65 ? 'bg-red-500' : intensity > 35 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="bg-gray-800 rounded-xl p-3 space-y-2">
      {/* Header: intensity + wire value + motor state */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-emerald-400">KROMI</span>
          <span className="text-2xl font-bold tabular-nums text-white">{intensity}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right text-[10px] text-gray-500">
            <div>{assistPct}% · {torqueNm}Nm</div>
            <div>{whKm}Wh/km</div>
          </div>
          <div className={`px-3 py-1.5 rounded-lg font-bold text-white text-sm ${WIRE_BG[wireValue]}`}>
            {WIRE_LABELS[wireValue]}
          </div>
        </div>
      </div>

      {/* Intensity bar (continuous) */}
      <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${intensity}%` }} />
        {/* Wire value zone markers */}
        <div className="absolute top-0 left-[35%] w-px h-full bg-gray-500 opacity-50" />
        <div className="absolute top-0 left-[65%] w-px h-full bg-gray-500 opacity-50" />
      </div>
      <div className="flex text-[8px] text-gray-600 justify-between px-0.5">
        <span>MIN (wire 2)</span>
        <span>MID (wire 1)</span>
        <span>MAX (wire 0)</span>
      </div>

      {/* Pre-emptive alert */}
      {preemptive && (
        <div className="bg-blue-900/30 border border-blue-800/50 rounded-lg px-3 py-1.5 text-xs text-blue-300">
          ⚡ {preemptive}
        </div>
      )}

      {/* Factor breakdown */}
      <div className="space-y-1">
        {factors.map((f) => (
          <div key={f.name} className="flex items-center justify-between text-xs">
            <span className="text-gray-500 w-20">{f.name}</span>
            <span className="text-gray-400 flex-1 text-right mr-2 truncate">{f.detail}</span>
            {f.value !== 0 && (
              <span className={`font-bold tabular-nums w-8 text-right ${
                f.value > 0 ? 'text-red-400' : 'text-green-400'
              }`}>
                {f.value > 0 ? '+' : ''}{f.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
