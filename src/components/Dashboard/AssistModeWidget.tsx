import { useBikeStore } from '../../store/bikeStore';
import { giantBLEService } from '../../services/bluetooth/GiantBLEService';
import { AssistMode, ASSIST_MODE_LABELS, ASSIST_MODE_COLORS } from '../../types/bike.types';

const MAIN_MODES = [AssistMode.ECO, AssistMode.TOUR, AssistMode.SPORT, AssistMode.POWER] as const;

export function AssistModeWidget() {
  const assistMode = useBikeStore((s) => s.assist_mode);

  const handleModeChange = async (mode: AssistMode) => {
    await giantBLEService.sendAssistMode(mode);
    // Haptic feedback
    if ('vibrate' in navigator) navigator.vibrate(50);
  };

  return (
    <div className="space-y-2">
      {/* Main mode buttons */}
      <div className="grid grid-cols-4 gap-2">
        {MAIN_MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => handleModeChange(mode)}
            className={`
              h-16 rounded-xl font-bold text-white text-lg
              ${assistMode === mode ? ASSIST_MODE_COLORS[mode] : 'bg-gray-700'}
              ${assistMode === mode ? 'ring-2 ring-white' : ''}
              active:scale-95 transition-transform
            `}
          >
            {ASSIST_MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {/* AUTO + WALK row */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => handleModeChange(AssistMode.AUTO)}
          className={`h-14 rounded-xl font-bold text-white text-lg
            ${assistMode === AssistMode.AUTO ? 'bg-purple-600 ring-2 ring-white' : 'bg-gray-700'}
            active:scale-95 transition-transform
          `}
        >
          AUTO
        </button>
        <button
          onPointerDown={() => handleModeChange(AssistMode.WALK)}
          onPointerUp={() => handleModeChange(AssistMode.ECO)}
          className="h-14 rounded-xl font-bold text-white text-lg bg-gray-700 active:bg-cyan-600 transition-colors"
        >
          WALK
        </button>
      </div>
    </div>
  );
}
