import { useBikeStore } from '../../store/bikeStore';

const ZONE_COLORS: Record<number, string> = {
  0: 'text-gray-500', 1: 'text-gray-400', 2: 'text-green-400',
  3: 'text-blue-400', 4: 'text-yellow-400', 5: 'text-red-400',
};

const ZONE_NAMES: Record<number, string> = {
  0: '—', 1: 'Recuperacao', 2: 'Base',
  3: 'Aerobico', 4: 'Limiar', 5: 'Maximo',
};

export function HRWidget() {
  const hrBpm = useBikeStore((s) => s.hr_bpm);
  const hrZone = useBikeStore((s) => s.hr_zone);

  if (!hrBpm) {
    return (
      <div className="bg-gray-800 rounded-xl p-3 text-center">
        <div className="text-gray-600 text-sm">Sem monitor FC</div>
      </div>
    );
  }

  const color = ZONE_COLORS[hrZone] ?? 'text-gray-400';

  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <div className={`text-3xl font-bold tabular-nums ${color}`}>
          {hrBpm}
          <span className="text-sm ml-1">bpm</span>
        </div>
        <div className={`text-right ${color}`}>
          <div className="text-lg font-bold">Z{hrZone}</div>
          <div className="text-xs">{ZONE_NAMES[hrZone]}</div>
        </div>
      </div>
      {/* HR bar relative to ~200bpm max */}
      <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-1000 rounded-full ${
            hrZone <= 2 ? 'bg-green-500' :
            hrZone === 3 ? 'bg-blue-500' :
            hrZone === 4 ? 'bg-yellow-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.min((hrBpm / 200) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
