import { useBikeStore } from '../../store/bikeStore';
import { batteryEstimationService } from '../../services/battery/BatteryEstimationService';
import { ASSIST_MODE_LABELS } from '../../types/bike.types';

export function BatteryWidget() {
  const soc = useBikeStore((s) => s.battery_percent);
  const voltage = useBikeStore((s) => s.battery_voltage);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const modeName = ASSIST_MODE_LABELS[assistMode]?.toLowerCase() ?? 'power';
  const estimate = batteryEstimationService.getFullEstimate(soc, modeName, 100, 100);

  const socColor =
    soc > 50 ? 'text-emerald-400' :
    soc > 30 ? 'text-yellow-400' :
    soc > 15 ? 'text-orange-400' : 'text-red-400';

  const barColor =
    soc > 50 ? 'bg-emerald-500' :
    soc > 30 ? 'bg-yellow-500' :
    soc > 15 ? 'bg-orange-500' : 'bg-red-500';

  return (
    <div className="bg-gray-800 rounded-xl p-2.5 flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-1 mb-1">
        <span className="material-symbols-outlined text-xs text-gray-500">battery_full</span>
        <span className="text-[8px] text-gray-600">
          {estimate.remaining_wh}Wh
          {voltage > 0 && ` · ${voltage.toFixed(1)}V`}
        </span>
      </div>

      {/* SOC + Range */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-0.5">
          <span className={`text-2xl font-black tabular-nums leading-none ${socColor}`}>{soc}</span>
          <span className="text-[9px] text-gray-600">%</span>
        </div>
        <div className="text-right">
          <span className="text-sm font-bold text-white tabular-nums">
            {estimate.range_km > 0 ? `${estimate.range_km.toFixed(0)}km` : '--'}
          </span>
          {estimate.consumption_wh_km > 0 && (
            <div className="text-[8px] text-gray-600">{estimate.consumption_wh_km}Wh/km</div>
          )}
        </div>
      </div>

      {/* Battery bar */}
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mt-1.5">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
          style={{ width: `${Math.max(soc, 1)}%` }}
        />
      </div>
    </div>
  );
}
