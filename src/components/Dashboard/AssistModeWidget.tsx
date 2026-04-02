import { useBikeStore } from '../../store/bikeStore';
import { AssistMode, ASSIST_MODE_LABELS, ASSIST_MODE_COLORS } from '../../types/bike.types';

// Row 1: SMART + standard assist modes (RideControl order)
const ROW1 = [AssistMode.SMART, AssistMode.ECO, AssistMode.TOUR, AssistMode.ACTIVE] as const;
// Row 2: higher modes + manual
const ROW2 = [AssistMode.SPORT, AssistMode.POWER, AssistMode.OFF] as const;

export function AssistModeWidget() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const bleConnected = useBikeStore((s) => s.ble_status === 'connected');
  const kromiActive = assistMode === AssistMode.POWER;

  return (
    <div className="space-y-1.5">
      {/* Row 1 */}
      <div className="grid grid-cols-4 gap-1.5">
        {ROW1.map((mode) => <ModePill key={mode} mode={mode} active={assistMode === mode} />)}
      </div>
      {/* Row 2 */}
      <div className="grid grid-cols-3 gap-1.5">
        {ROW2.map((mode) => <ModePill key={mode} mode={mode} active={assistMode === mode} />)}
      </div>

      {/* KROMI status */}
      <div className={`text-center text-[10px] px-2 ${kromiActive ? 'text-[#3fff8b]' : 'text-[#777575]'}`}>
        {!bleConnected
          ? 'Liga a bike para ver o modo'
          : kromiActive
            ? 'KROMI activo — assist inteligente'
            : 'Muda para PWR no RideControl para activar KROMI'}
      </div>
    </div>
  );
}

function ModePill({ mode, active }: { mode: AssistMode; active: boolean }) {
  return (
    <div
      className={`
        h-10 rounded-sm font-bold text-sm flex items-center justify-center
        ${active ? `${ASSIST_MODE_COLORS[mode]} text-white ring-2 ring-white` : 'bg-[#1a1919] text-[#777575]'}
        transition-colors
      `}
    >
      {ASSIST_MODE_LABELS[mode]}
    </div>
  );
}
