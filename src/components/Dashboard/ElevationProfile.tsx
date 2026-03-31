import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { useAutoAssistStore } from '../../store/autoAssistStore';

export function ElevationProfile() {
  const profile = useAutoAssistStore((s) => s.elevationProfile);
  const nextModeChange = useAutoAssistStore((s) => s.nextModeChange);
  const terrain = useAutoAssistStore((s) => s.terrain);

  if (profile.length < 2) {
    return (
      <div className="bg-gray-800 rounded-xl p-3 h-20 flex items-center justify-center">
        <span className="text-gray-500 text-sm">Aguardando dados GPS...</span>
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
