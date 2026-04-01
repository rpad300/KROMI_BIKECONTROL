import { useBikeStore } from '../../store/bikeStore';
import { AssistMode, ASSIST_MODE_LABELS, ASSIST_MODE_COLORS } from '../../types/bike.types';

const ALL_MODES = [
  AssistMode.ECO,
  AssistMode.TOUR,
  AssistMode.SPORT,
  AssistMode.POWER,
  AssistMode.AUTO,
] as const;

/**
 * AssistModeWidget — read-only indicator of the bike's current assist mode.
 *
 * The mode is set physically via the RideControl buttons on the handlebar.
 * We read it from cmd 0x41 telemetry (fc23cmd41.assistLevel).
 * Mode changes via BLE (0x1C) are blocked by the Smart Gateway.
 * Motor intensity is controlled via SET_TUNING in the TuningWidget.
 */
export function AssistModeWidget() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const bleConnected = useBikeStore((s) => s.ble_status === 'connected');

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

      {/* Status line */}
      <div className="text-center text-[10px] text-gray-600 px-2">
        {!bleConnected
          ? 'Modo assist — liga a bike para ver'
          : assistMode === AssistMode.WALK
            ? 'WALK mode activo'
            : 'Modo controlado pelo RideControl'}
      </div>
    </div>
  );
}
