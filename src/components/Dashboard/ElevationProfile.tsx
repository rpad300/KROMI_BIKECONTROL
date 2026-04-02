import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { useMapStore } from '../../store/mapStore';

export function ElevationProfile() {
  const profile = useAutoAssistStore((s) => s.elevationProfile);
  const nextModeChange = useAutoAssistStore((s) => s.nextModeChange);
  const terrain = useAutoAssistStore((s) => s.terrain);
  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const alt = useMapStore((s) => s.altitude);
  const accuracy = useMapStore((s) => s.accuracy);
  const gpsError = useMapStore((s) => s.gpsError);

  if (profile.length < 2) {
    // GPS position available but no elevation profile yet
    if (lat !== 0 && lng !== 0) {
      return (
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-emerald-400 text-sm">my_location</span>
            <span className="text-[10px] text-emerald-400 font-bold">GPS Activo</span>
            <span className="text-[9px] text-gray-600 ml-auto">±{Math.round(accuracy)}m</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-400 tabular-nums">
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </div>
            {alt !== null && (
              <div className="text-xs text-gray-400">
                <span className="text-gray-300 font-bold">{Math.round(alt)}</span>
                <span className="text-gray-600 ml-0.5">m alt</span>
              </div>
            )}
          </div>
          <div className="text-[9px] text-gray-600 mt-1">Inicia uma volta para ver o perfil de elevacao</div>
        </div>
      );
    }

    return (
      <div className="bg-gray-800 rounded-xl p-3 h-16 flex items-center justify-center gap-2">
        {gpsError ? (
          <>
            <span className="material-symbols-outlined text-red-400 text-sm">location_off</span>
            <span className="text-red-400 text-xs">{gpsError}</span>
          </>
        ) : (
          <>
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-500 text-xs">A obter localizacao GPS...</span>
          </>
        )}
      </div>
    );
  }

  const gradient = terrain?.current_gradient_pct ?? 0;
  const gradientColor =
    gradient > 10 ? 'text-red-400' :
    gradient > 6 ? 'text-orange-400' :
    gradient > 2 ? 'text-yellow-400' :
    gradient > -3 ? 'text-green-400' : 'text-blue-400';

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden relative">
      {/* Chart */}
      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={profile} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="elevation"
              fill="url(#elevFill)"
              stroke="#60a5fa"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Current position indicator */}
      <div className="absolute bottom-0 left-0 w-0.5 h-full bg-white/60" />

      {/* Next mode change marker */}
      {nextModeChange && (
        <div
          className="absolute top-1 text-xs text-yellow-400 font-bold"
          style={{ left: `${nextModeChange.position_percent}%` }}
        >
          ↑ {nextModeChange.mode}
        </div>
      )}

      {/* Labels overlay */}
      <div className="absolute bottom-1 left-2 right-2 flex justify-between items-end">
        <span className={`text-xs font-bold ${gradientColor}`}>
          {gradient > 0 ? '+' : ''}{gradient.toFixed(1)}%
        </span>
        <span className="text-xs text-gray-400">
          {Math.round(profile[profile.length - 1]!.distance_from_current)}m
        </span>
      </div>
    </div>
  );
}
