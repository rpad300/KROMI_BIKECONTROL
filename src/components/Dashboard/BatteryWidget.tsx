import { useBikeStore } from '../../store/bikeStore';

export function BatteryWidget() {
  const percent = useBikeStore((s) => s.battery_percent);

  // Estimate range based on battery and average consumption (~2.5%/km in SPORT)
  const estimatedRange = Math.round((percent / 2.5) * 10) / 10;

  const barColor =
    percent > 50 ? 'bg-green-500' :
    percent > 25 ? 'bg-yellow-500' :
    percent > 10 ? 'bg-orange-500' : 'bg-red-500';

  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-sm">Bateria</span>
        <span className="text-2xl font-bold tabular-nums">
          {percent}<span className="text-base text-gray-400">%</span>
        </span>
      </div>
      {/* Battery bar */}
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="text-right text-xs text-gray-500 mt-1">
        ~{estimatedRange} km
      </div>
    </div>
  );
}
