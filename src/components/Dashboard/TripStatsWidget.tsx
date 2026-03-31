import { useBikeStore } from '../../store/bikeStore';

export function TripStatsWidget() {
  const distance = useBikeStore((s) => s.distance_km);
  const rideTime = useBikeStore((s) => s.ride_time_s);
  const calories = useBikeStore((s) => s.calories);
  const elevGain = useBikeStore((s) => s.elevation_gain_m);
  const speedAvg = rideTime > 0 ? (distance / (rideTime / 3600)) : 0;

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gray-800 rounded-xl p-2">
      <div className="grid grid-cols-5 gap-1 text-center">
        <TripStat value={distance.toFixed(1)} label="km" />
        <TripStat value={formatTime(rideTime)} label="tempo" />
        <TripStat value={calories > 0 ? String(calories) : '--'} label="kcal" />
        <TripStat value={elevGain > 0 ? String(elevGain) : '--'} label="D+ m" />
        <TripStat value={speedAvg > 0 ? speedAvg.toFixed(1) : '--'} label="avg" />
      </div>
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
