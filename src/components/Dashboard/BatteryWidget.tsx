import { useBikeStore } from '../../store/bikeStore';
import { batteryEstimationService } from '../../services/battery/BatteryEstimationService';
import { ASSIST_MODE_LABELS } from '../../types/bike.types';

export function BatteryWidget() {
  const soc = useBikeStore((s) => s.battery_percent);
  const bat1 = useBikeStore((s) => s.battery_main_pct); // individual SOC or health
  const bat2 = useBikeStore((s) => s.battery_sub_pct);  // individual SOC or health
  const voltage = useBikeStore((s) => s.battery_voltage);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const modeName = ASSIST_MODE_LABELS[assistMode]?.toLowerCase() ?? 'power';
  const estimate = batteryEstimationService.getFullEstimate(soc, modeName, bat1 || 100, bat2 || 100);

  const hasDual = bat1 > 0 || bat2 > 0;

  // Use individual battery data from SG cmd 0x43
  const mainSoc = bat1 > 0 ? bat1 : soc;
  const subSoc = bat2 > 0 ? bat2 : soc;

  const socColor =
    soc > 50 ? 'text-emerald-400' :
    soc > 30 ? 'text-yellow-400' :
    soc > 15 ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="bg-gray-800 rounded-xl p-2.5 flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-1 mb-1">
        <span className="material-symbols-outlined text-xs text-gray-500">battery_full</span>
        <span className="text-[8px] text-gray-600">
          {estimate.remaining_wh}Wh / 1050Wh
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

      {/* Dual battery bars */}
      {hasDual ? (
        <div className="space-y-1 mt-1.5">
          <BatteryBar label="800" soc={mainSoc} health={bat1} wh={Math.round(800 * mainSoc / 100)} />
          <BatteryBar label="250" soc={subSoc} health={bat2} wh={Math.round(250 * subSoc / 100)} />
        </div>
      ) : (
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mt-1.5">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${barColor(soc)}`}
            style={{ width: `${Math.max(soc, 1)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function barColor(pct: number): string {
  return pct > 50 ? 'bg-emerald-500' : pct > 30 ? 'bg-yellow-500' : pct > 15 ? 'bg-orange-500' : 'bg-red-500';
}

function BatteryBar({ label, soc, health, wh }: {
  label: string; soc: number; health: number; wh: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] text-gray-600 w-5 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${barColor(soc)}`}
          style={{ width: `${Math.max(soc, 1)}%` }}
        />
      </div>
      <span className="text-[8px] text-gray-500 w-10 text-right tabular-nums">{wh}Wh</span>
      {health > 0 && health < 100 && (
        <span className="text-[7px] text-gray-600">({health}%)</span>
      )}
    </div>
  );
}
