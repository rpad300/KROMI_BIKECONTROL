import { useAutoAssistStore } from '../../store/autoAssistStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ASSIST_MODE_LABELS, AssistMode } from '../../types/bike.types';

export function AutoAssistWidget() {
  const enabled = useAutoAssistStore((s) => s.enabled);
  const decision = useAutoAssistStore((s) => s.lastDecision);
  const overrideActive = useAutoAssistStore((s) => s.overrideActive);
  const overrideRemaining = useAutoAssistStore((s) => s.overrideRemaining);
  const terrain = useAutoAssistStore((s) => s.terrain);
  const toggleEnabled = useSettingsStore((s) => s.updateAutoAssist);

  const handleToggle = () => {
    toggleEnabled({ enabled: !enabled });
  };

  // Pre-emptive alert (climb detected ahead)
  const isPreemptive = decision?.is_preemptive && decision.action === 'change_mode';
  const nextTransition = terrain?.next_transition;

  return (
    <div className="bg-gray-800 rounded-xl p-3 space-y-2">
      {/* Header + toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleToggle}
          className={`flex items-center gap-2 font-bold text-sm ${
            enabled ? 'text-blue-400' : 'text-gray-500'
          }`}
        >
          <span>{enabled ? '🤖' : '○'}</span>
          <span>AUTO {enabled ? 'ON' : 'OFF'}</span>
        </button>

        {/* Override countdown */}
        {overrideActive && (
          <span className="text-yellow-400 text-sm font-bold">
            ✋ Override {overrideRemaining}s
          </span>
        )}

        {/* Current decision reason */}
        {enabled && !overrideActive && decision && (
          <span className="text-gray-400 text-xs truncate max-w-[60%] text-right">
            {decision.reason}
          </span>
        )}
      </div>

      {/* Pre-emptive alert banner */}
      {isPreemptive && nextTransition && (
        <div className="bg-yellow-900/60 border border-yellow-600/40 rounded-lg px-3 py-2 flex items-center gap-2 animate-pulse">
          <span className="text-yellow-400 text-lg">⚡</span>
          <div className="flex-1">
            <div className="text-yellow-300 font-bold text-sm">
              {nextTransition.type.includes('climb') ? 'Subida' : 'Descida'} em{' '}
              {Math.round(nextTransition.distance_m)}m
            </div>
            <div className="text-yellow-400/70 text-xs">
              {nextTransition.gradient_after_pct > 0 ? '+' : ''}
              {nextTransition.gradient_after_pct.toFixed(1)}% →{' '}
              {ASSIST_MODE_LABELS[decision!.new_mode as AssistMode] ?? '?'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
