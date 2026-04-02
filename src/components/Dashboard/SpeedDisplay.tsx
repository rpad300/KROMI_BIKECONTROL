import { useBikeStore } from '../../store/bikeStore';

export function SpeedDisplay() {
  const speed = useBikeStore((s) => s.speed_kmh);
  const distance = useBikeStore((s) => s.distance_km);
  const rideTime = useBikeStore((s) => s.ride_time_s);

  const integer = Math.floor(speed);
  const decimal = Math.round((speed - integer) * 10);

  // Elapsed time from ride start (wall clock approximation)
  // ride_time_s is moving time; we estimate stopped time from speed=0 periods
  const formatTime = (s: number) => {
    if (s <= 0) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
      : `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="text-center py-2">
      {/* Speed */}
      <div className="flex items-baseline justify-center">
        <span className="text-6xl font-bold tabular-nums tracking-tight">{integer}</span>
        <span className="text-3xl font-bold text-gray-400">.{decimal}</span>
        <span className="text-sm text-gray-500 ml-1 self-end mb-2">km/h</span>
      </div>

      {/* Compact stats bar: distance | duration | avg speed */}
      <div className="flex items-center justify-center gap-4 mt-1">
        <div className="flex items-baseline gap-0.5">
          <span className="text-sm font-bold text-gray-300 tabular-nums">{distance.toFixed(2)}</span>
          <span className="text-[10px] text-gray-600">km</span>
        </div>
        {rideTime > 0 && (
          <>
            <div className="w-px h-3 bg-gray-700" />
            <div className="flex items-baseline gap-0.5">
              <span className="text-sm font-bold text-gray-300 tabular-nums">{formatTime(rideTime)}</span>
              <span className="text-[10px] text-gray-600">tempo</span>
            </div>
            <div className="w-px h-3 bg-gray-700" />
            <div className="flex items-baseline gap-0.5">
              <span className="text-sm font-bold text-gray-300 tabular-nums">
                {(distance / (rideTime / 3600)).toFixed(1)}
              </span>
              <span className="text-[10px] text-gray-600">avg</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
