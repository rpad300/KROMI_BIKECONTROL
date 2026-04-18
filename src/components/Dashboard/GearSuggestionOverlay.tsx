import { useAutoAssistStore } from '../../store/autoAssistStore';

/**
 * GearSuggestionOverlay — floating banner at top of dashboard.
 * Appears 3-10s before a gradient transition, suggesting optimal gear.
 * Auto-hides when no suggestion is active.
 */
export function GearSuggestionOverlay() {
  const suggestion = useAutoAssistStore((s) => s.gearSuggestion);

  if (!suggestion) return null;

  const { currentGear, suggestedGear, reason, secondsUntilTransition } = suggestion;

  const reasonLabel =
    reason === 'upcoming_climb' ? 'CLIMB AHEAD' :
    reason === 'upcoming_descent' ? 'DESCENT AHEAD' :
    reason === 'cadence_optimization' ? 'CADENCE OPT' :
    'GEAR CHANGE';

  return (
    <div className="fixed top-16 left-0 right-0 mx-4 bg-[#131313] border-l-2 border-[#fbbf24] p-3 rounded z-50 animate-slideDown shadow-lg shadow-black/40">
      <div className="flex items-center gap-3">
        <span
          className="material-symbols-outlined text-[#fbbf24]"
          style={{ fontSize: '24px' }}
        >
          settings_suggest
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-label uppercase tracking-widest text-[#a0a0a0]">
            {reasonLabel}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-white font-headline tabular-nums">
              {currentGear}
            </span>
            <span className="material-symbols-outlined text-[#fbbf24]" style={{ fontSize: '16px' }}>
              arrow_forward
            </span>
            <span className="text-lg font-bold text-[#fbbf24] font-headline tabular-nums">
              {suggestedGear}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xl font-bold font-headline tabular-nums text-[#fbbf24]">
            {secondsUntilTransition}s
          </span>
        </div>
      </div>
    </div>
  );
}
