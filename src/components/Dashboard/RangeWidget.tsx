import { useBikeStore } from '../../store/bikeStore';

export function RangeWidget() {
  const range = useBikeStore((s) => s.range_km);
  const battery = useBikeStore((s) => s.battery_percent);

  const color =
    battery > 30 ? 'text-[#3fff8b]' :
    battery > 15 ? 'text-[#fbbf24]' : 'text-[#ff716c]';

  return (
    <div className="bg-[#1a1919] rounded-sm p-2 text-center">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>
        {range > 0 ? range.toFixed(0) : '--'}
      </div>
      <div className="text-[#777575] text-xs">RNG km</div>
    </div>
  );
}
