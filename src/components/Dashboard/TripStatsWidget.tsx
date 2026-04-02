import { useBikeStore } from '../../store/bikeStore';

export function TripStatsWidget() {
  const distance = useBikeStore((s) => s.distance_km);
  const tripDist = useBikeStore((s) => s.trip_distance_km);
  const rideTime = useBikeStore((s) => s.ride_time_s);
  const tripTime = useBikeStore((s) => s.trip_time_s);
  const calories = useBikeStore((s) => s.calories);
  const elevGain = useBikeStore((s) => s.elevation_gain_m);
  const motorOdo = useBikeStore((s) => s.motor_odo_km);
  // Prefer motor trip data when available
  const dist = tripDist > 0 ? tripDist : distance;
  const time = tripTime > 0 ? tripTime : rideTime;
  const speedAvg = time > 0 ? (dist / (time / 3600)) : 0;

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gray-800 rounded-xl p-2">
      <div className="grid grid-cols-5 gap-1 text-center">
        <TripStat value={dist.toFixed(1)} label="km" />
        <TripStat value={formatTime(time)} label="tempo" />
        <TripStat value={calories > 0 ? String(calories) : '--'} label="kcal" />
        <TripStat value={elevGain > 0 ? String(elevGain) : '--'} label="D+ m" />
        <TripStat value={speedAvg > 0 ? speedAvg.toFixed(1) : '--'} label="avg" />
      </div>
      {motorOdo > 0 && (
        <div className="text-[8px] text-gray-600 text-right mt-0.5">ODO: {motorOdo.toLocaleString()}km</div>
      )}
    </div>
  );
}

function TripStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-base font-bold tabular-nums text-white">{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}
