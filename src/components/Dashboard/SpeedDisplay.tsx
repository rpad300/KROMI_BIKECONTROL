import { useBikeStore } from '../../store/bikeStore';

export function SpeedDisplay() {
  const speed = useBikeStore((s) => s.speed_kmh);
  const distance = useBikeStore((s) => s.distance_km);

  const integer = Math.floor(speed);
  const decimal = Math.round((speed - integer) * 10);

  return (
    <div className="text-center py-4">
      <div className="flex items-baseline justify-center">
        <span className="text-7xl font-bold tabular-nums tracking-tight">{integer}</span>
        <span className="text-4xl font-bold text-gray-400">.{decimal}</span>
      </div>
      <div className="text-gray-400 text-lg -mt-1">km/h</div>
      <div className="text-gray-500 text-sm mt-1">{distance.toFixed(2)} km</div>
    </div>
  );
}
