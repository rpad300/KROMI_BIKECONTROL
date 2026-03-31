import { useBikeStore } from '../../store/bikeStore';
import { giantBLEService } from '../../services/bluetooth/GiantBLEService';
import { AssistMode, ASSIST_MODE_LABELS, ASSIST_MODE_COLORS } from '../../types/bike.types';

const MAIN_MODES = [AssistMode.ECO, AssistMode.TOUR, AssistMode.SPORT, AssistMode.POWER] as const;

export function AssistModeWidget() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const gevConnected = useBikeStore((s) => s.ble_services.gev);

  const handleModeChange = async (mode: AssistMode) => {
    // Always update local state so the UI reflects the selection
    useBikeStore.getState().setAssistMode(mode);

    // Try to send to bike if GEV is available
    if (gevConnected) {
      await giantBLEService.sendAssistMode(mode);
    }

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

      {/* Motor control status */}
      {!gevConnected && (
        <div className="text-center text-xs text-gray-600 px-2">
          Modo local — usa os botoes Ergo 3 na bike para mudar no motor
        </div>
      )}
    </div>
  );
}
