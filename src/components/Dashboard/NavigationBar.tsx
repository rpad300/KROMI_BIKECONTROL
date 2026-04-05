/**
 * NavigationBar — shows route navigation info during active ride with GPX.
 *
 * Displays: progress, distance remaining, next event, deviation warning.
 * Only visible when navigation.active === true.
 */

import { useRouteStore } from '../../store/routeStore';

export function NavigationBar() {
  const nav = useRouteStore((s) => s.navigation);
  const route = useRouteStore((s) => s.activeRoute);

  if (!nav.active || !route) return null;

  const remainKm = (nav.distanceRemaining_m / 1000).toFixed(1);
  const deviated = nav.deviationM > 50;

  return (
    <div className="bg-[#1a1919] border-b border-[#333] px-3 py-2">
      {/* Progress bar */}
      <div className="h-1.5 bg-[#262626] rounded-full mb-2 overflow-hidden">
        <div
          className="h-full bg-[#3fff8b] rounded-full transition-all duration-1000"
          style={{ width: `${Math.min(100, nav.progress_pct)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        {/* Route name + remaining */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="material-symbols-outlined text-[#3fff8b] text-base">navigation</span>
          <div className="truncate">
            <span className="text-white font-semibold">{remainKm} km</span>
            <span className="text-[#6b7280] ml-1">restantes</span>
          </div>
        </div>

        {/* Next event */}
        {nav.nextEventText && (
          <div className="flex items-center gap-1 text-[#f59e0b] text-[10px] ml-2">
            <span className="material-symbols-outlined text-sm">warning</span>
            <span className="truncate max-w-[140px]">{nav.nextEventText}</span>
          </div>
        )}

        {/* Deviation warning */}
        {deviated && (
          <div className="flex items-center gap-1 text-[#ff716c] text-[10px] ml-2 animate-pulse">
            <span className="material-symbols-outlined text-sm">wrong_location</span>
            <span>Fora da rota ({nav.deviationM}m)</span>
          </div>
        )}

        {/* Progress % */}
        <div className="text-[#6b7280] text-[10px] ml-2 whitespace-nowrap">
          {nav.progress_pct.toFixed(0)}%
        </div>
      </div>
    </div>
  );
}
