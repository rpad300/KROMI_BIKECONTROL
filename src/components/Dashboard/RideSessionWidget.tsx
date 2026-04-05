import { useState, useEffect } from 'react';
import { rideSessionManager } from '../../services/storage/RideHistory';
import { useAthleteStore } from '../../store/athleteStore';
import { useMapStore } from '../../store/mapStore';
import { useRouteStore } from '../../store/routeStore';
import { batteryEfficiencyTracker } from '../../services/learning/BatteryEfficiencyTracker';
import { listRoutes, getRoute, linkRideToRoute } from '../../services/routes/RouteService';

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

  const [showRouteSelect, setShowRouteSelect] = useState(false);
  const [savedRoutes, setSavedRoutes] = useState<Awaited<ReturnType<typeof listRoutes>>>([]);
  const activeRoute = useRouteStore((s) => s.activeRoute);
  const setActiveRoute = useRouteStore((s) => s.setActiveRoute);
  const startNavigation = useRouteStore((s) => s.startNavigation);

  const handleStart = async () => {
    await rideSessionManager.startSession();
    // If a route is selected, link it and start navigation
    if (activeRoute) {
      const sessionId = rideSessionManager.getSessionId();
      if (sessionId) linkRideToRoute(sessionId, activeRoute.id);
      startNavigation();
    }
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
  };

  const handleRouteSelect = async (routeId: string) => {
    const full = await getRoute(routeId);
    if (full) setActiveRoute(full, full.points);
    setShowRouteSelect(false);
  };

  const loadRouteList = async () => {
    const routes = await listRoutes();
    setSavedRoutes(routes);
    setShowRouteSelect(true);
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
      <div className="space-y-2">
        {/* Route selector */}
        {activeRoute ? (
          <div className="flex items-center gap-2 bg-[#1a2e1a] rounded-sm px-3 py-2">
            <span className="material-symbols-outlined text-[#3fff8b] text-lg">route</span>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs font-bold truncate">{activeRoute.name}</div>
              <div className="text-[#9ca3af] text-[10px]">{activeRoute.total_distance_km}km | {activeRoute.total_elevation_gain_m}m D+</div>
            </div>
            <button onClick={() => setActiveRoute(null)} className="text-[#6b7280]">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        ) : (
          <button onClick={loadRouteList}
            className="w-full flex items-center justify-center gap-2 h-10 bg-[#1a1919] rounded-sm text-[#9ca3af] text-xs border border-[#333]">
            <span className="material-symbols-outlined text-sm">route</span>
            Selecionar rota (opcional)
          </button>
        )}

        {/* Route list popup */}
        {showRouteSelect && (
          <div className="bg-[#1a1919] rounded-sm border border-[#333] max-h-48 overflow-y-auto">
            {savedRoutes.length === 0 ? (
              <div className="p-3 text-[#6b7280] text-xs">Nenhuma rota guardada</div>
            ) : savedRoutes.map(r => (
              <button key={r.id} onClick={() => handleRouteSelect(r.id)}
                className="w-full flex items-center gap-2 px-3 py-2 border-b border-[#262626] text-left hover:bg-[#262626]">
                <span className="material-symbols-outlined text-[#3fff8b] text-sm">route</span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-semibold truncate">{r.name}</div>
                  <div className="text-[#6b7280] text-[10px]">{r.total_distance_km}km | {r.total_elevation_gain_m}m D+</div>
                </div>
              </button>
            ))}
            <button onClick={() => setShowRouteSelect(false)}
              className="w-full p-2 text-[#6b7280] text-xs text-center">Cancelar</button>
          </div>
        )}

        {/* Start button */}
        <button
          onClick={handleStart}
          disabled={!gpsReady}
          className={`w-full h-16 rounded-sm font-bold text-white text-xl active:scale-95 transition-transform flex items-center justify-center gap-3 ${
            gpsReady ? 'bg-[#24f07e]' : 'bg-[#333333] opacity-60'
          }`}
        >
          <span className="text-2xl">&#9654;</span>
          {gpsReady
            ? activeRoute ? `INICIAR: ${activeRoute.name.slice(0, 20)}` : 'INICIAR VOLTA'
            : 'A AGUARDAR GPS...'}
        </button>
        {!gpsReady && (
          <div className="flex items-center justify-center gap-2 text-[10px] text-[#777575]">
            <span className="w-2 h-2 rounded-full bg-[#fbbf24] animate-pulse" />
            {!gpsActive ? 'GPS inactivo — verifica permissoes' : 'A fixar posicao...'}
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
