import { useState, useRef } from 'react';
import { parseFitFile, enrichWithElevation, saveImportedRide, type ImportedRide } from '../../services/import/FitImportService';
import { updateStatsFromRide, type AthleteStats } from '../../services/import/AthleteProfileBuilder';
import { simulateKromi, type SimulationSummary } from '../../services/simulation/KromiSimulator';
import { enrichRouteWithTerrain } from '../../services/import/RouteTerrainService';
import { fetchHistoricalWeather } from '../../services/import/HistoricalWeatherService';

/**
 * FIT file import UI.
 * Drag & drop or file picker. Shows parsed summary before saving.
 * Multiple files supported — each builds the athlete profile.
 */
export function FitImport({ onImported }: { onImported?: () => void } = {}) {
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ ride: ImportedRide; saved: boolean; sim: SimulationSummary | null }[]>([]);
  const [stats, setStats] = useState<AthleteStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList) => {
    setImporting(true);
    setError(null);
    const newResults: typeof results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const buffer = await file.arrayBuffer();
        const ride = await parseFitFile(buffer);
        await enrichWithElevation(ride);

        // Enrich with terrain (OSM Overpass) + historical weather (Open-Meteo)
        const gpsRecords = ride.records.filter((r) => r.lat !== 0 || r.lng !== 0);
        const terrain = gpsRecords.length > 0
          ? await enrichRouteWithTerrain(gpsRecords).catch(() => null)
          : null;

        const rideDate = new Date(ride.startedAt);
        const rideHour = rideDate.getHours();
        const firstGps = gpsRecords[0];
        const weather = firstGps
          ? await fetchHistoricalWeather(firstGps.lat, firstGps.lng, rideDate, rideHour).catch(() => null)
          : null;

        const sim = simulateKromi(ride.records, terrain?.surfaces, weather ?? undefined);
        const saved = await saveImportedRide(ride, sim);
        const updatedStats = await updateStatsFromRide(ride);
        newResults.push({ ride, saved, sim });
        setStats(updatedStats);
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : 'Parse error'}`);
      }
    }

    setResults((prev) => [...prev, ...newResults]);
    setImporting(false);
    if (newResults.some((r) => r.saved)) onImported?.();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-300">Importar Rides (.FIT)</h2>

      {/* Drop zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="bg-gray-800 border-2 border-dashed border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-600 transition-colors"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".fit"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        {importing ? (
          <div className="flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-400">A importar...</span>
          </div>
        ) : (
          <>
            <span className="material-symbols-outlined text-3xl text-gray-600">upload_file</span>
            <p className="text-sm text-gray-400 mt-2">Arrasta ficheiros .FIT ou clica para seleccionar</p>
            <p className="text-xs text-gray-600 mt-1">Garmin, Wahoo, Strava exports — múltiplos ficheiros suportados</p>
          </>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 rounded-lg p-3">{error}</div>
      )}

      {/* Import results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-400">Importados ({results.length})</h3>
          {results.map(({ ride, saved, sim }) => (
            <div key={ride.id} className="bg-gray-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-bold text-sm">
                    {ride.distance_km.toFixed(1)}km · {Math.round(ride.duration_s / 60)}min · {ride.ascent_m.toFixed(0)}m D+
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(ride.startedAt).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {' · '}
                    {ride.sport}
                  </div>
                </div>
                <span className={`text-xs ${saved ? 'text-emerald-400' : 'text-red-400'}`}>
                  {saved ? '✓ Guardado' : '✗ Erro'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <Stat label="Vel média" value={`${ride.avg_speed.toFixed(1)} km/h`} />
                <Stat label="Vel max" value={`${ride.max_speed.toFixed(0)} km/h`} />
                <Stat label="FC média" value={`${ride.avg_hr} bpm`} />
                <Stat label="FC max" value={`${ride.max_hr} bpm`} />
              </div>
              <div className="grid grid-cols-5 gap-1 text-[10px]">
                <ZoneBadge zone="Z1" pct={ride.hrZones.z1_pct} color="bg-gray-600" />
                <ZoneBadge zone="Z2" pct={ride.hrZones.z2_pct} color="bg-blue-600" />
                <ZoneBadge zone="Z3" pct={ride.hrZones.z3_pct} color="bg-green-600" />
                <ZoneBadge zone="Z4" pct={ride.hrZones.z4_pct} color="bg-yellow-600" />
                <ZoneBadge zone="Z5" pct={ride.hrZones.z5_pct} color="bg-red-600" />
              </div>

              {/* KROMI Simulation */}
              {sim && (
                <div className="border-t border-gray-700 pt-2 mt-2">
                  <div className="text-xs font-bold text-emerald-400 mb-2">Simulação KROMI Intelligence</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-red-900/20 rounded-lg p-2 text-center">
                      <div className="text-red-400 font-bold text-lg">{sim.time_max_pct}%</div>
                      <div className="text-gray-500">MAX</div>
                    </div>
                    <div className="bg-yellow-900/20 rounded-lg p-2 text-center">
                      <div className="text-yellow-400 font-bold text-lg">{sim.time_mid_pct}%</div>
                      <div className="text-gray-500">MID</div>
                    </div>
                    <div className="bg-green-900/20 rounded-lg p-2 text-center">
                      <div className="text-green-400 font-bold text-lg">{sim.time_min_pct}%</div>
                      <div className="text-gray-500">MIN</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <Stat label="KROMI activo" value={`${sim.time_active_pct}% do tempo`} />
                    <Stat label="Mudanças nível" value={`${sim.level_changes}×`} />
                    <Stat label="Score médio" value={`${sim.avg_score}/100`} />
                    <Stat label="Score máximo" value={`${sim.max_score}/100`} />
                  </div>
                  <div className="mt-2 bg-gray-900 rounded-lg p-2">
                    <div className="text-[10px] text-gray-500 mb-1">Bateria simulada (início: 100%)</div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-center">
                      <div>
                        <div className="text-emerald-400 font-bold">{sim.battery_end_kromi}%</div>
                        <div className="text-[9px] text-gray-500">KROMI</div>
                      </div>
                      <div>
                        <div className="text-orange-400 font-bold">{sim.battery_end_fixed}%</div>
                        <div className="text-[9px] text-gray-500">{sim.fixed_label}</div>
                      </div>
                      <div>
                        <div className="text-red-400 font-bold">{sim.battery_end_max}%</div>
                        <div className="text-[9px] text-gray-500">MAX</div>
                      </div>
                    </div>
                    <div className={`text-[10px] mt-1 font-bold text-center ${sim.battery_saved_vs_fixed >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
                      {sim.battery_saved_vs_fixed >= 0
                        ? `+${sim.battery_saved_vs_fixed}% poupança vs config fixa`
                        : `${sim.battery_saved_vs_fixed}% vs config fixa (mais potência nas subidas)`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Athlete profile summary */}
      {stats && stats.total_rides > 0 && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-emerald-400">Perfil do Atleta ({stats.total_rides} rides)</h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat label="FC Max" value={`${stats.hr_max_observed} bpm`} />
            <Stat label="FC Média" value={`${stats.hr_avg_typical} bpm`} />
            <Stat label="Vel Média" value={`${stats.avg_speed_all} km/h`} />
            <Stat label="Dist Média" value={`${stats.avg_distance_km} km`} />
            <Stat label="D+ Média" value={`${stats.avg_ascent_m} m`} />
            <Stat label="Tempo Médio" value={`${stats.avg_duration_min} min`} />
            <Stat label="Total km" value={`${stats.total_km} km`} />
            <Stat label="Total D+" value={`${stats.total_ascent_m} m`} />
            <Stat label="Total horas" value={`${stats.total_time_h} h`} />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Forma:</span>
            <span className={
              stats.fitness_trend === 'improving' ? 'text-emerald-400' :
              stats.fitness_trend === 'maintaining' ? 'text-yellow-400' :
              stats.fitness_trend === 'declining' ? 'text-red-400' : 'text-gray-500'
            }>
              {stats.fitness_trend === 'improving' ? '↑ A melhorar' :
               stats.fitness_trend === 'maintaining' ? '→ Estável' :
               stats.fitness_trend === 'declining' ? '↓ A baixar' : 'Dados insuficientes'}
            </span>
            <span className="text-gray-600">
              ({stats.rides_last_30d} rides, {stats.km_last_30d}km nos últimos 30 dias)
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className="text-white font-bold">{value}</div>
    </div>
  );
}

function ZoneBadge({ zone, pct, color }: { zone: string; pct: number; color: string }) {
  return (
    <div className={`${color} rounded px-1.5 py-0.5 text-center text-white`}>
      {zone} {pct}%
    </div>
  );
}
