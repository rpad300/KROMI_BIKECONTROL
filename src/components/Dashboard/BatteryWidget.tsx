import { useBikeStore } from '../../store/bikeStore';

export function BatteryWidget() {
  const percent = useBikeStore((s) => s.battery_percent);
  const range = useBikeStore((s) => s.range_km);
  const subPct = useBikeStore((s) => s.battery_sub_pct);
  const voltage = useBikeStore((s) => s.battery_voltage);
  const bleConnected = useBikeStore((s) => s.ble_status === 'connected');

  const hasDual = subPct > 0;

  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-bold ${bleConnected ? 'text-emerald-400' : 'text-gray-400'}`}>
          BAT
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold tabular-nums">
            {percent}
          </span>
          <span className="text-base text-gray-400">%</span>
          {voltage > 0 && (
            <span className="text-xs text-gray-500 ml-1">{voltage.toFixed(1)}V</span>
          )}
        </div>
      </div>

      {/* Battery bars */}
      {hasDual ? (
        <div className="space-y-1.5">
          <BatteryBar label="MAIN" percent={percent} />
          <BatteryBar label="EXT" percent={subPct} />
        </div>
      ) : (
        <BatteryBar percent={percent} />
      )}

      {/* Range */}
      {range > 0 && (
        <div className="text-right text-xs text-gray-500 mt-1.5">
          ~{range.toFixed(0)} km
        </div>
      )}
    </div>
  );
}

function BatteryBar({ percent, label }: { percent: number; label?: string }) {
  const barColor =
    percent > 50 ? 'bg-emerald-500' :
    percent > 30 ? 'bg-yellow-500' :
    percent > 15 ? 'bg-orange-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[10px] text-gray-500 w-7">{label}</span>}
      <div className="flex-1 h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
          style={{ width: `${Math.max(percent, 1)}%` }}
        />
      </div>
      {label && <span className="text-xs text-gray-400 tabular-nums w-8 text-right">{percent}%</span>}
    </div>
  );
}
