import { useBikeStore } from '../../store/bikeStore';

export function PowerCadenceWidget() {
  const power = useBikeStore((s) => s.power_watts);
  const cadence = useBikeStore((s) => s.cadence_rpm);

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Power */}
      <div className="bg-gray-800 rounded-xl p-3 text-center">
        <div className="text-3xl font-bold tabular-nums">{power}</div>
        <div className="text-gray-400 text-sm">W</div>
      </div>
      {/* Cadence */}
      <div className="bg-gray-800 rounded-xl p-3 text-center">
        <div className="text-3xl font-bold tabular-nums">{cadence}</div>
        <div className="text-gray-400 text-sm">RPM</div>
      </div>
    </div>
  );
}
