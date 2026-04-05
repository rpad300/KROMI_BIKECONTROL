import { useNutritionStore } from '../../store/nutritionStore';

const STATE_COLORS = {
  green: '#3fff8b',
  amber: '#fbbf24',
  critical: '#ff716c',
} as const;

/**
 * W' Balance gauge — shows remaining anaerobic capacity.
 * Full = recovered. Empty = depleted (motor goes to max support).
 * Includes drift indicator and zone breach warning.
 */
export function WPrimeWidget() {
  const physio = useNutritionStore((s) => s.physiology);

  if (!physio) return null;

  const pct = Math.round(physio.w_prime_balance * 100);
  const color = STATE_COLORS[physio.w_prime_state];
  const driftWarning = physio.drift_bpm_per_min > 0.3;
  const breachMin = physio.t_breach_minutes < 999 ? Math.round(physio.t_breach_minutes) : null;

  // Arc gauge math (semicircle)
  const radius = 40;
  const circumference = Math.PI * radius; // half circle
  const filled = (pct / 100) * circumference;

  return (
    <div className="rounded-lg border border-[#262626] bg-[#131313] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-black/40">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm" style={{ color, fontVariationSettings: "'FILL' 1" }}>bolt</span>
          <span className="text-xs font-label uppercase tracking-widest text-[#adaaaa]">W' Balance</span>
        </div>
        {physio.ef_current > 0 && (
          <span className={`text-[10px] ${physio.ef_degraded ? 'text-[#fbbf24]' : 'text-[#adaaaa]'}`}>EF {physio.ef_current.toFixed(2)}</span>
        )}
      </div>

      <div className="flex items-center gap-4 px-4 py-3">
        {/* Semicircle gauge */}
        <div className="relative w-24 h-14 flex-shrink-0">
          <svg viewBox="0 0 100 55" className="w-full h-full">
            {/* Background arc */}
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="#262626"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Filled arc */}
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference}`}
              className="transition-all duration-500"
            />
          </svg>
          {/* Center value */}
          <div className="absolute inset-0 flex items-end justify-center pb-0">
            <span className="font-headline font-black text-2xl" style={{ color }}>{pct}%</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 flex flex-col gap-1">
          {/* Drift */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#777575] uppercase">Drift</span>
            <span className={`text-sm font-bold ${driftWarning ? 'text-[#fbbf24]' : 'text-[#adaaaa]'}`}>
              {physio.drift_bpm_per_min.toFixed(1)} bpm/min
            </span>
          </div>

          {/* Zone breach */}
          {breachMin !== null && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#777575] uppercase">Breach</span>
              <span className={`text-sm font-bold ${breachMin < 8 ? 'text-[#ff716c]' : 'text-[#fbbf24]'}`}>
                {breachMin} min
              </span>
            </div>
          )}

          {/* IRC */}
          {physio.irc >= 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#777575] uppercase">IRC</span>
              <span className="text-sm font-bold text-[#adaaaa]">{physio.irc.toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
