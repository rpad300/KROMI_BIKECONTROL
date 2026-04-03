import { useState, useEffect } from 'react';
import { rideSessionManager } from '../../services/storage/RideHistory';
import { useAthleteStore } from '../../store/athleteStore';
import { useMapStore } from '../../store/mapStore';
import { batteryEfficiencyTracker } from '../../services/learning/BatteryEfficiencyTracker';

export function RideSessionWidget() {
  const rideActive = useAthleteStore((s) => s.rideActive);
  const gpsActive = useMapStore((s) => s.gpsActive);
  const hasGps = useMapStore((s) => s.latitude !== 0 && s.longitude !== 0);
  const [elapsed, setElapsed] = useState(0);
  const [confirmStop, setConfirmStop] = useState(false);

  // Timer update every second
  useEffect(() => {
    if (!rideActive) { setElapsed(0); return; }
    const id = setInterval(() => {
      setElapsed(rideSessionManager.getState().elapsedS);
    }, 1000);
    return () => clearInterval(id);
  }, [rideActive]);

  const handleStart = async () => {
    await rideSessionManager.startSession();
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
  };

  const handleStop = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      setTimeout(() => setConfirmStop(false), 3000); // Reset after 3s
      return;
    }
    await rideSessionManager.stopSession();
    setConfirmStop(false);
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100, 50, 100]);
  };

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const saving = batteryEfficiencyTracker.getSavingPercent();
  const { snapshotCount } = rideSessionManager.getState();

  if (!rideActive) {
    const gpsReady = gpsActive && hasGps;
    return (
      <div className="space-y-1">
        <button
          onClick={handleStart}
          disabled={!gpsReady}
          className={`w-full h-16 rounded-sm font-bold text-white text-xl active:scale-95 transition-transform flex items-center justify-center gap-3 ${
            gpsReady ? 'bg-[#24f07e]' : 'bg-[#333333] opacity-60'
          }`}
        >
          <span className="text-2xl">&#9654;</span>
          {gpsReady ? 'INICIAR VOLTA' : 'A AGUARDAR GPS...'}
        </button>
        {!gpsReady && (
          <div className="flex items-center justify-center gap-2 text-[10px] text-[#777575]">
            <span className="w-2 h-2 rounded-full bg-[#fbbf24] animate-pulse" />
            {!gpsActive ? 'GPS inactivo — verifica permissões' : 'A fixar posição...'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#1a1919] rounded-sm p-3 space-y-3">
      {/* Timer + recording indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ff716c] animate-pulse" />
          <span className="text-[#ff716c] text-sm font-bold">A GRAVAR</span>
        </div>
        <span className="text-3xl font-bold tabular-nums text-white">
          {formatTime(elapsed)}
        </span>
      </div>

      {/* Live stats */}
      <div className="flex items-center justify-between text-xs text-[#adaaaa]">
        <span>{snapshotCount} snapshots</span>
        {saving > 0 && <span className="text-[#3fff8b]">Poupanca: {saving}% vs SPORT</span>}
      </div>

      {/* Stop button */}
      <button
        onClick={handleStop}
        className={`w-full h-14 rounded-sm font-bold text-white text-lg active:scale-95 transition-all ${
          confirmStop
            ? 'bg-[#d7383b] animate-pulse'
            : 'bg-red-800'
        }`}
      >
        {confirmStop ? 'CONFIRMAR TERMINAR' : 'TERMINAR VOLTA'}
      </button>
    </div>
  );
}
