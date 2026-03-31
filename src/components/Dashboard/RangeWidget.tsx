import { useBikeStore } from '../../store/bikeStore';

export function RangeWidget() {
  const range = useBikeStore((s) => s.range_km);
  const battery = useBikeStore((s) => s.battery_percent);

  const color =
    battery > 30 ? 'text-emerald-400' :
    battery > 15 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="bg-gray-800 rounded-xl p-2 text-center">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>
        {range > 0 ? range.toFixed(0) : '--'}
      </div>
      <div className="text-gray-500 text-xs">RNG km</div>
    </div>
  );
}
