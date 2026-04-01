import { useSettingsStore } from '../../store/settingsStore';

/**
 * TuningPreview — visual impact preview of current tuning configuration.
 *
 * Shows what the 3 tuning levels mean in practice:
 * - Motor output comparison (assist%, torque, launch)
 * - Battery range estimate per level
 * - Expected ride simulation (flat, mixed, climbing scenarios)
 *
 * Uses factory/configured specs — no live data needed.
 */
export function TuningPreview() {
  const bike = useSettingsStore((s) => s.bikeConfig);
  const rider = useSettingsStore((s) => s.riderProfile);
  const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);

  const levels = [
    { key: 'MAX', spec: bike.tuning_max, color: 'text-red-400', bg: 'bg-red-900/20' },
    { key: 'MID', spec: bike.tuning_mid, color: 'text-yellow-400', bg: 'bg-yellow-900/20' },
    { key: 'MIN', spec: bike.tuning_min, color: 'text-green-400', bg: 'bg-green-900/20' },
  ];

  // Range estimates at average 15km/h
  const avgSpeed = 15;

  // Scenarios: flat (70% MIN, 20% MID, 10% MAX), mixed (30/40/30), climbing (10/30/60)
  const scenarios = [
    {
      name: 'Plano / passeio',
      icon: '🏞️',
      mix: { max: 0.05, mid: 0.25, min: 0.70 },
    },
    {
      name: 'Misto / trail',
      icon: '⛰️',
      mix: { max: 0.30, mid: 0.40, min: 0.30 },
    },
    {
      name: 'Montanha / subida',
      icon: '🏔️',
      mix: { max: 0.55, mid: 0.30, min: 0.15 },
    },
  ];

  return (
    <div className="bg-gray-800 rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-bold text-emerald-400">Preview — Impacto das Configurações</h3>

      {/* Level comparison bars */}
      <div className="space-y-2">
        {levels.map(({ key, spec, color, bg }) => {
          const rangeKm = spec.consumption_wh_km > 0 ? Math.round(totalWh / spec.consumption_wh_km) : 0;
          const rangeH = rangeKm > 0 ? Math.round(rangeKm / avgSpeed * 10) / 10 : 0;
          const assistBar = Math.min(100, spec.assist_pct / 4); // 400% = 100% bar
          const torqueBar = Math.min(100, (spec.torque_nm / bike.max_torque_nm) * 100);

          return (
            <div key={key} className={`${bg} rounded-lg p-3`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-bold ${color}`}>{key}</span>
                <span className="text-xs text-gray-500">{rangeKm}km · {rangeH}h · {spec.consumption_wh_km}Wh/km</span>
              </div>
              <div className="space-y-1.5">
                <Bar label={`Assist ${spec.assist_pct}%`} pct={assistBar} color="bg-blue-500" />
                <Bar label={`Torque ${spec.torque_nm}Nm`} pct={torqueBar} color="bg-orange-500" />
                <Bar label={`Launch ${spec.launch}/10`} pct={spec.launch * 10} color="bg-purple-500" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Scenario simulations */}
      <div>
        <div className="text-xs text-gray-500 mb-2">Autonomia estimada por cenário ({totalWh}Wh, {rider.weight_kg}kg)</div>
        <div className="grid grid-cols-3 gap-2">
          {scenarios.map((sc) => {
            const avgConsumption =
              sc.mix.max * bike.tuning_max.consumption_wh_km +
              sc.mix.mid * bike.tuning_mid.consumption_wh_km +
              sc.mix.min * bike.tuning_min.consumption_wh_km;
            // Weight adjustment: heavier = more consumption on climbs
            const weightAdj = 1 + (rider.weight_kg - 75) * 0.005 * (sc.mix.max + sc.mix.mid * 0.5);
            const adjConsumption = Math.round(avgConsumption * weightAdj * 10) / 10;
            const rangeKm = adjConsumption > 0 ? Math.round(totalWh / adjConsumption) : 0;
            const rangeH = Math.round(rangeKm / avgSpeed * 10) / 10;
            // Fixed POWER (always MAX) comparison
            const fixedConsumption = Math.round(bike.tuning_max.consumption_wh_km * weightAdj * 10) / 10;
            const fixedRange = fixedConsumption > 0 ? Math.round(totalWh / fixedConsumption) : 0;
            const saved = rangeKm - fixedRange;

            return (
              <div key={sc.name} className="bg-gray-900 rounded-lg p-3 text-center">
                <div className="text-lg">{sc.icon}</div>
                <div className="text-xs text-gray-400 mt-1">{sc.name}</div>
                <div className="text-lg font-bold text-white mt-1">{rangeKm}km</div>
                <div className="text-[10px] text-gray-500">{rangeH}h · {adjConsumption}Wh/km</div>
                {saved > 0 && (
                  <div className="text-[10px] text-emerald-400 mt-1">+{saved}km vs fixo</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* KROMI vs Fixed comparison */}
      <div className="bg-gray-900 rounded-lg p-3">
        <div className="text-xs text-gray-500 mb-1">KROMI inteligente vs POWER fixo (cenário misto)</div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="text-xs text-gray-500">KROMI</div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden mt-1">
              <div className="h-full bg-emerald-500 rounded-full" style={{
                width: `${Math.min(100, Math.round(totalWh / (
                  0.30 * bike.tuning_max.consumption_wh_km +
                  0.40 * bike.tuning_mid.consumption_wh_km +
                  0.30 * bike.tuning_min.consumption_wh_km
                ) / totalWh * 100 * 100))}%`
              }} />
            </div>
          </div>
          <div className="flex-1">
            <div className="text-xs text-gray-500">POWER fixo</div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden mt-1">
              <div className="h-full bg-red-500 rounded-full" style={{
                width: `${Math.min(100, Math.round(totalWh / bike.tuning_max.consumption_wh_km / totalWh * 100 * 100))}%`
              }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-20 text-right">{label}</span>
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
