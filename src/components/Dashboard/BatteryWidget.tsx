import { useBikeStore } from '../../store/bikeStore';
import { batteryEstimationService } from '../../services/battery/BatteryEstimationService';
import { ASSIST_MODE_LABELS } from '../../types/bike.types';

/**
 * BatteryWidget — Giant Trance X E+ 2 dual battery display.
 * Shows SOC, dual battery health, range estimate, consumption, time remaining.
 * Battery specs: Main 800Wh + Sub 250Wh = 1050Wh total.
 */
export function BatteryWidget() {
  const soc = useBikeStore((s) => s.battery_percent);
  const mainLife = useBikeStore((s) => s.battery_main_pct);
  const subLife = useBikeStore((s) => s.battery_sub_pct);
  const voltage = useBikeStore((s) => s.battery_voltage);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const modeName = ASSIST_MODE_LABELS[assistMode]?.toLowerCase() ?? 'power';
  const estimate = batteryEstimationService.getFullEstimate(
    soc, modeName, mainLife || 100, subLife || 100
  );

  const hasDual = mainLife > 0 && subLife > 0;
  const socColor =
    soc > 50 ? 'text-emerald-400' :
    soc > 30 ? 'text-yellow-400' :
    soc > 15 ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="bg-gray-800 rounded-xl p-3 space-y-2">
      {/* SOC + Range header */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-1">
          <span className={`text-3xl font-bold tabular-nums ${socColor}`}>{soc}</span>
          <span className="text-sm text-gray-500">%</span>
          {voltage > 0 && (
            <span className="text-[10px] text-gray-600 ml-1">{voltage.toFixed(1)}V</span>
          )}
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-white tabular-nums">
            {estimate.range_km > 0 ? `${estimate.range_km.toFixed(0)}km` : '--'}
          </div>
          {estimate.time_remaining_min > 0 && (
            <div className="text-[10px] text-gray-500">
              ~{estimate.time_remaining_min > 60
                ? `${Math.floor(estimate.time_remaining_min / 60)}h${(estimate.time_remaining_min % 60).toString().padStart(2, '0')}m`
                : `${estimate.time_remaining_min}min`
              }
            </div>
          )}
        </div>
      </div>

      {/* Dual battery bars */}
      {hasDual ? (
        <div className="space-y-1">
          <BatteryBar label="800Wh" percent={soc} health={mainLife} wh={estimate.main_remaining_wh} />
          <BatteryBar label="250Wh" percent={soc} health={subLife} wh={estimate.sub_remaining_wh} />
        </div>
      ) : (
        <BatteryBar percent={soc} wh={estimate.remaining_wh} />
      )}

      {/* Consumption + data source */}
      <div className="flex items-center justify-between text-[10px] text-gray-600">
        <span>
          {estimate.consumption_wh_km > 0
            ? `${estimate.consumption_wh_km} Wh/km`
            : '--'}
          {estimate.source === 'live' ? ' (live)' : ` (${modeName})`}
        </span>
        <span>{estimate.remaining_wh}Wh / 1050Wh</span>
      </div>
    </div>
  );
}

function BatteryBar({ percent, label, health, wh }: {
  percent: number; label?: string; health?: number; wh?: number;
}) {
  const barColor =
    percent > 50 ? 'bg-emerald-500' :
    percent > 30 ? 'bg-yellow-500' :
    percent > 15 ? 'bg-orange-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[10px] text-gray-500 w-10">{label}</span>}
      <div className="flex-1 h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
          style={{ width: `${Math.max(percent, 1)}%` }}
        />
      </div>
      <div className="text-right w-16">
        {wh !== undefined && <span className="text-[10px] text-gray-400 tabular-nums">{wh}Wh</span>}
        {health !== undefined && health < 100 && (
          <span className="text-[9px] text-gray-600 ml-1">({health}%)</span>
        )}
      </div>
    </div>
  );
}
