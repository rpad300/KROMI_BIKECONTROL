import { useIntelligenceStore } from '../../store/intelligenceStore';

const LEVEL_LABELS = { 1: 'MAX', 2: 'MID', 3: 'MIN' } as const;
const LEVEL_BG = { 1: 'bg-red-600', 2: 'bg-yellow-600', 3: 'bg-green-600' } as const;

/**
 * IntelligenceWidget — transparent view of KROMI's decisions.
 * Shows the score, level, and which factors contributed.
 * Only visible when KROMI is active (POWER mode).
 */
export function IntelligenceWidget() {
  const active = useIntelligenceStore((s) => s.active);
  const score = useIntelligenceStore((s) => s.score);
  const level = useIntelligenceStore((s) => s.level);
  const factors = useIntelligenceStore((s) => s.factors);
  const preemptive = useIntelligenceStore((s) => s.preemptive);

  if (!active) return null;

  const scoreColor =
    score > 65 ? 'text-red-400' :
    score > 35 ? 'text-yellow-400' : 'text-green-400';

  return (
    <div className="bg-gray-800 rounded-xl p-3 space-y-2">
      {/* Header: KROMI + score + level */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-emerald-400">KROMI</span>
          <span className={`text-2xl font-bold tabular-nums ${scoreColor}`}>{score}</span>
          <span className="text-[10px] text-gray-600">/100</span>
        </div>
        <div className={`px-3 py-1 rounded-lg font-bold text-white text-sm ${LEVEL_BG[level]}`}>
          {LEVEL_LABELS[level]}
        </div>
      </div>

      {/* Score bar */}
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            score > 65 ? 'bg-red-500' : score > 35 ? 'bg-yellow-500' : 'bg-green-500'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* Level zones */}
      <div className="flex text-[9px] text-gray-600 justify-between px-0.5">
        <span>MIN</span>
        <span className="ml-[30%]">MID</span>
        <span>MAX</span>
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
            <span className={`font-bold tabular-nums w-8 text-right ${
              f.value > 0 ? 'text-red-400' : f.value < 0 ? 'text-green-400' : 'text-gray-600'
            }`}>
              {f.value > 0 ? '+' : ''}{f.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
