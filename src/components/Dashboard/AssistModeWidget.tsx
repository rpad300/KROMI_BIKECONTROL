import { useBikeStore } from '../../store/bikeStore';
import { AssistMode, ASSIST_MODE_LABELS, ASSIST_MODE_COLORS } from '../../types/bike.types';

// Physical RideControl order on Trance X E+ 2 (2023)
// SMART is startup-only (not in UP/DOWN cycle)
const ALL_MODES = [
  AssistMode.ECO,
  AssistMode.TOUR,
  AssistMode.ACTIVE,
  AssistMode.SPORT,
  AssistMode.POWER,
  AssistMode.SMART,
] as const;

/**
 * AssistModeWidget — read-only indicator of the bike's current assist mode.
 *
 * The mode is set physically via the RideControl buttons on the handlebar.
 * KROMI intelligent assist is only active when bike is in POWER mode.
 * In other modes, the app is passive (telemetry only).
 */
export function AssistModeWidget() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const bleConnected = useBikeStore((s) => s.ble_status === 'connected');
  const kromiActive = assistMode === AssistMode.POWER;

  return (
    <div className="space-y-1.5">
      {/* Mode indicator pills */}
      <div className="flex gap-1.5">
        {ALL_MODES.map((mode) => {
          const active = assistMode === mode;
          return (
            <div
              key={mode}
              className={`
                flex-1 h-11 rounded-xl font-bold text-sm flex items-center justify-center
                ${active ? `${ASSIST_MODE_COLORS[mode]} text-white ring-2 ring-white` : 'bg-gray-800 text-gray-600'}
                transition-colors
              `}
            >
              {ASSIST_MODE_LABELS[mode]}
            </div>
          );
        })}
      </div>

      {/* KROMI status */}
      <div className={`text-center text-[10px] px-2 ${kromiActive ? 'text-emerald-400' : 'text-gray-600'}`}>
        {!bleConnected
          ? 'Liga a bike para ver o modo'
          : kromiActive
            ? 'KROMI activo — assist inteligente'
            : 'Muda para PWR no RideControl para activar KROMI'}
      </div>
    </div>
  );
}
