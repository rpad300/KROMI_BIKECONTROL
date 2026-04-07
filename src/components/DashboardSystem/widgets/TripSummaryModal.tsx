import { useMemo, useEffect, useState } from 'react';
import { useTripStore } from '../../../store/tripStore';
import { useBikeStore } from '../../../store/bikeStore';
import { useRouteStore } from '../../../store/routeStore';
import { useNutritionStore } from '../../../store/nutritionStore';
import { useSettingsStore, safeBikeConfig } from '../../../store/settingsStore';
import { di2Service } from '../../../services/di2/Di2Service';
import { localRideStore, type LocalSnapshot } from '../../../services/storage/LocalRideStore';
import { usePermission } from '../../../hooks/usePermission';

/** Full-screen trip summary shown after FINISH */
export function TripSummaryModal({ onClose }: { onClose: () => void }) {
  const trip = useTripStore();
  const battery = useBikeStore((s) => s.battery_percent);
  const di2Battery = useBikeStore((s) => s.di2_battery);
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>([]);
  // Pro analysis sections (HR zones, gear usage, energy comparison, pre-ride
  // vs actual) are gated behind features.ride_analysis_pro. Free users still
  // see distance / time / speed / map / elevation / battery.
  const canSeePro = usePermission('features.ride_analysis_pro');

  const gearStats = useMemo(() => di2Service.getRideGearStats(), []);

  // Load snapshots from IndexedDB
  useEffect(() => {
    if (trip.lastSessionId) {
      localRideStore.getSessionSnapshots(trip.lastSessionId).then(setSnapshots).catch(() => {});
    }
  }, [trip.lastSessionId]);

  const fmt = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  };

  // Compute HR zone distribution — only within ride duration (movingTime)
  const hrZones = useMemo(() => {
    const zones = [0, 0, 0, 0, 0]; // Z1-Z5 time in seconds
    const rideDuration = trip.movingTime; // actual ride time in seconds
    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i]!;
      if (s.hr_zone < 1 || s.hr_zone > 5) continue;
      if (s.elapsed_s > rideDuration + 10) continue; // skip snapshots after ride ended (+10s buffer)
      // Time this snapshot represents = gap to next (or 1s for last)
      const dt = i < snapshots.length - 1
        ? Math.min(10, Math.max(0, snapshots[i + 1]!.elapsed_s - s.elapsed_s))
        : 1;
      zones[s.hr_zone - 1] = (zones[s.hr_zone - 1] ?? 0) + dt;
    }
    return zones;
  }, [snapshots, trip.movingTime]);
  const maxHrZone = Math.max(...hrZones, 1);
  const totalHrSamples = hrZones.reduce((a, b) => a + b, 0);

  // GPS points for map
  const gpsPoints = useMemo(() =>
    snapshots.filter((s) => s.lat !== 0 && s.lng !== 0).map((s) => ({ lat: s.lat, lng: s.lng, hr_zone: s.hr_zone, alt: s.altitude_m ?? 0 })),
    [snapshots],
  );

  // Altitude data for profile
  const altPoints = useMemo(() =>
    snapshots.filter((s) => (s.altitude_m ?? 0) > 0).map((s) => ({ elapsed: s.elapsed_s, alt: s.altitude_m ?? 0 })),
    [snapshots],
  );

  // Gear usage chart data
  const gearEntries = Object.entries(gearStats.gearUsageMs)
    .map(([g, ms]) => ({ gear: Number(g), ms: ms as number }))
    .sort((a, b) => a.gear - b.gear);
  const maxGearMs = Math.max(...gearEntries.map((e) => e.ms), 1);

  // Elevation gain
  const elevGain = useMemo(() => {
    let gain = 0;
    for (let i = 1; i < altPoints.length; i++) {
      const diff = altPoints[i]!.alt - altPoints[i - 1]!.alt;
      if (diff > 0) gain += diff;
    }
    return Math.round(gain);
  }, [altPoints]);

  // Max HR
  const maxHr = useMemo(() => Math.max(...snapshots.map((s) => s.hr_bpm), 0), [snapshots]);
  const avgHr = useMemo(() => {
    const hrs = snapshots.filter((s) => s.hr_bpm > 0);
    return hrs.length > 0 ? Math.round(hrs.reduce((a, s) => a + s.hr_bpm, 0) / hrs.length) : 0;
  }, [snapshots]);

  const batteryUsed = Math.max(0, trip.batteryStart - battery);

  const buildShareText = () => {
    const date = new Date().toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
    const lines = [
      `KROMI BikeControl — ${date}`,
      `${trip.tripKm.toFixed(1)}km · ${fmt(trip.movingTime)} · ${trip.avgSpeed.toFixed(1)}km/h avg`,
      elevGain > 0 ? `${elevGain}m D+ · Max ${trip.maxSpeed.toFixed(1)}km/h` : `Max ${trip.maxSpeed.toFixed(1)}km/h`,
      batteryUsed > 0 ? `Bateria: ${batteryUsed}% usada (${trip.batteryStart}% → ${battery}%)` : '',
      avgHr > 0 ? `HR avg ${avgHr} · max ${maxHr} bpm` : '',
      gearStats.shiftCount > 0 ? `${gearStats.shiftCount} shifts` : '',
    ].filter(Boolean);
    return lines.join('\n');
  };

  const handleShare = async () => {
    const text = buildShareText();
    if (navigator.share) {
      try {
        await navigator.share({ title: 'KROMI Ride', text });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      backgroundColor: '#0e0e0e', display: 'flex', flexDirection: 'column',
      overflow: 'auto',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #262626' }}>
        <div>
          <h1 className="font-headline" style={{ fontSize: '18px', fontWeight: 900, color: '#3fff8b' }}>RIDE COMPLETE</h1>
          <span className="font-label" style={{ fontSize: '9px', color: '#777575' }}>
            {new Date().toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })} · {snapshots.length} snapshots
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={handleShare} style={{ padding: '8px 16px', backgroundColor: '#262626', color: '#e966ff', border: '1px solid rgba(233,102,255,0.3)', fontWeight: 900, fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>share</span>
            PARTILHAR
          </button>
          <button onClick={onClose} style={{ padding: '8px 20px', backgroundColor: '#262626', color: '#adaaaa', border: 'none', fontWeight: 900, fontSize: '11px', cursor: 'pointer' }}>
            FECHAR
          </button>
        </div>
      </div>

      {/* Hero stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', backgroundColor: '#262626' }}>
        <StatCell label="Distancia" value={`${trip.tripKm.toFixed(1)}`} unit="km" color="#3fff8b" big />
        <StatCell label="Tempo" value={fmt(trip.movingTime)} unit="" color="#3fff8b" big />
        <StatCell label="Vel. Media" value={`${trip.avgSpeed.toFixed(1)}`} unit="km/h" color="#adaaaa" big />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', backgroundColor: '#262626' }}>
        <StatCell label="Vel. Max" value={`${trip.maxSpeed.toFixed(1)}`} unit="km/h" color="#6e9bff" />
        <StatCell label="Desnivel" value={`${elevGain}`} unit="m ↑" color="#e966ff" />
        <StatCell label="Bat. Gasta" value={`${batteryUsed}`} unit="%" color="#fbbf24" />
        <StatCell label="Shifts" value={`${gearStats.shiftCount}`} unit="" color="#6e9bff" />
      </div>

      {/* Map with route */}
      {gpsPoints.length > 2 && (
        <Section title="Percurso" subtitle={`${gpsPoints.length} pontos GPS`}>
          <RouteMap points={gpsPoints} />
        </Section>
      )}

      {/* Elevation profile */}
      {altPoints.length > 5 && (
        <Section title="Altimetria" subtitle={`${elevGain}m ↑`}>
          <ElevationChart points={altPoints} />
        </Section>
      )}

      {/* HR Zones (PRO) */}
      {canSeePro && totalHrSamples > 0 && (
        <Section title="Zonas HR" subtitle={`avg ${avgHr} · max ${maxHr} bpm`}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '50px', padding: '0 4px' }}>
            {hrZones.map((count, i) => {
              const pct = (count / maxHrZone) * 100;
              const colors = ['#6e9bff', '#3fff8b', '#fbbf24', '#ff9b3f', '#ff716c'];
              const label = count >= 60 ? `${Math.round(count / 60)}m` : `${Math.round(count)}s`;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <span className="font-label tabular-nums" style={{ fontSize: '8px', color: '#777575' }}>{label}</span>
                  <div style={{ width: '100%', backgroundColor: colors[i], borderRadius: '2px 2px 0 0', height: `${Math.max(pct, 4)}%`, opacity: 0.85 }} />
                  <span className="font-headline font-bold" style={{ fontSize: '10px', color: colors[i] }}>Z{i + 1}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Gear Usage (PRO) */}
      {canSeePro && gearEntries.length > 0 && (
        <Section title="Mudancas" subtitle={`${gearStats.shiftCount} shifts`}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '50px', padding: '0 4px' }}>
            {gearEntries.map(({ gear, ms }) => {
              const pct = (ms / maxGearMs) * 100;
              const mins = (ms / 60000).toFixed(1);
              return (
                <div key={gear} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <span className="font-label tabular-nums" style={{ fontSize: '7px', color: '#777575' }}>{mins}m</span>
                  <div style={{ width: '100%', backgroundColor: '#6e9bff', borderRadius: '2px 2px 0 0', height: `${Math.max(pct, 4)}%` }} />
                  <span className="font-headline font-bold tabular-nums" style={{ fontSize: '9px', color: '#adaaaa' }}>{gear}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Battery breakdown */}
      <Section title="Bateria" subtitle={`${trip.batteryStart}% → ${battery}%`}>
        <div style={{ display: 'flex', gap: '12px', padding: '0 4px' }}>
          <BatteryBlock label="Bike" pct={battery} />
          {di2Battery > 0 && <BatteryBlock label="Di2" pct={di2Battery} />}
        </div>
      </Section>

      {/* Energy comparison: KROMI vs standard modes (PRO) */}
      {canSeePro && <EnergyComparison distanceKm={trip.tripKm} batteryUsedPct={batteryUsed} />}

      {/* Pre-ride vs Actual comparison (PRO) */}
      {canSeePro && (
        <PreRideComparison
          actualKm={trip.tripKm}
          actualTimeMin={Math.round(trip.movingTime / 60)}
          actualBatteryUsed={batteryUsed}
          elevGain={elevGain}
        />
      )}

      {/* Upsell hint shown to free users in place of locked sections */}
      {!canSeePro && (
        <div style={{
          margin: '12px 4px', padding: '12px',
          backgroundColor: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)',
          borderRadius: '6px', fontSize: '11px', color: '#fbbf24', textAlign: 'center',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>
            workspace_premium
          </span>
          Análise PRO desbloqueia zonas HR, distribuição de mudanças e simulação energética.
        </div>
      )}

      <div style={{ height: '60px' }} />
    </div>
  );
}

/** Energy comparison: KROMI actual vs standard modes + smart rider simulation */
function EnergyComparison({ distanceKm, batteryUsedPct }: { distanceKm: number; batteryUsedPct: number }) {
  const bike = safeBikeConfig(useSettingsStore.getState().bikeConfig);
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>([]);
  const trip = useTripStore();

  useEffect(() => {
    if (trip.lastSessionId) {
      localRideStore.getSessionSnapshots(trip.lastSessionId).then(setSnapshots).catch(() => {});
    }
  }, [trip.lastSessionId]);

  if (distanceKm < 0.1 || batteryUsedPct <= 0) return null;

  const totalBatteryWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);
  const kromiWh = Math.round((batteryUsedPct / 100) * totalBatteryWh);
  const kromiWhKm = distanceKm > 0 ? Math.round((kromiWh / distanceKm) * 10) / 10 : 0;

  // Mode consumption rates (Wh/km)
  const modeRates: Record<string, number> = {
    ECO: bike.consumption_eco,
    TOUR: bike.consumption_tour,
    ACTIVE: bike.consumption_active,
    SPORT: bike.consumption_sport,
  };

  // === SIMULATE what a smart rider would do per segment ===
  // Considers gradient + HR state + recovery lag (rider doesn't instantly drop modes)
  const smartRiderWh = useMemo(() => {
    if (snapshots.length < 5) return null;
    let totalWh = 0;
    const modeTime: Record<string, number> = { ECO: 0, TOUR: 0, ACTIVE: 0, SPORT: 0 };
    let currentMode = 'TOUR'; // rider starts in TOUR typically
    const modeOrder = ['ECO', 'TOUR', 'ACTIVE', 'SPORT'];

    for (let i = 0; i < snapshots.length - 1; i++) {
      const s = snapshots[i]!;
      const next = snapshots[i + 1]!;
      const dt = Math.min(10, Math.max(0, next.elapsed_s - s.elapsed_s));
      if (dt <= 0 || s.elapsed_s > trip.movingTime + 10) continue;

      const distKm = (s.speed_kmh || 0) * (dt / 3600);
      const grad = s.gradient_pct ?? 0;
      const speed = s.speed_kmh || 0;
      const hrZone = s.hr_zone ?? 0;

      // What mode would the terrain suggest?
      let terrainMode: string;
      if (speed < 3) terrainMode = 'ECO';
      else if (grad > 8) terrainMode = 'SPORT';
      else if (grad > 4) terrainMode = 'ACTIVE';
      else if (grad > 1) terrainMode = 'TOUR';
      else if (grad < -3) terrainMode = 'ECO';
      else terrainMode = 'TOUR';

      // HR adjustment: if HR is high, rider keeps stronger mode even on flat
      // A rider coming out of a climb with HR zone 4 doesn't drop to ECO immediately
      if (hrZone >= 4 && modeOrder.indexOf(terrainMode) < modeOrder.indexOf('ACTIVE')) {
        terrainMode = 'ACTIVE'; // exhausted rider keeps at least ACTIVE
      } else if (hrZone >= 3 && modeOrder.indexOf(terrainMode) < modeOrder.indexOf('TOUR')) {
        terrainMode = 'TOUR'; // moderate effort → at least TOUR
      }

      // Mode switching lag: rider only changes mode when terrain clearly demands it
      // Don't drop more than 1 mode at a time (realistic button pressing)
      const targetIdx = modeOrder.indexOf(terrainMode);
      const currentIdx = modeOrder.indexOf(currentMode);
      if (targetIdx > currentIdx) {
        // Going UP is immediate (rider feels the need)
        currentMode = terrainMode;
      } else if (targetIdx < currentIdx) {
        // Going DOWN is gradual — drop 1 level per ~10s
        // Only drop if we've been in this terrain for a bit
        if (currentIdx - targetIdx >= 1) {
          currentMode = modeOrder[currentIdx - 1] ?? currentMode;
        }
      }

      totalWh += (modeRates[currentMode] ?? 15) * distKm;
      modeTime[currentMode] = (modeTime[currentMode] ?? 0) + dt;
    }

    return { totalWh: Math.round(totalWh), modeTime };
  }, [snapshots, trip.movingTime]);

  // Build comparison bars
  const strategies = [
    { label: 'ECO', wh: Math.round((modeRates.ECO ?? 6) * distanceKm), color: '#3fff8b' },
    { label: 'TOUR', wh: Math.round((modeRates.TOUR ?? 15) * distanceKm), color: '#60a5fa' },
    { label: 'ACTIVE', wh: Math.round((modeRates.ACTIVE ?? 22) * distanceKm), color: '#fbbf24' },
    { label: 'SPORT', wh: Math.round((modeRates.SPORT ?? 28) * distanceKm), color: '#ff716c' },
  ];

  if (smartRiderWh) {
    strategies.push({ label: 'MANUAL', wh: smartRiderWh.totalWh, color: '#adaaaa' });
  }
  strategies.push({ label: 'KROMI', wh: kromiWh, color: '#e966ff' });

  const maxWh = Math.max(...strategies.map(s => s.wh), 1);

  // Best comparison: KROMI vs smart manual rider
  const vsManual = smartRiderWh ? smartRiderWh.totalWh - kromiWh : 0;
  const vsManualPct = smartRiderWh && smartRiderWh.totalWh > 0 ? Math.round((vsManual / smartRiderWh.totalWh) * 100) : 0;

  return (
    <Section title="Consumo Energia" subtitle={`KROMI: ${kromiWhKm} Wh/km`}>
      {/* Bar chart */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '90px', padding: '0 2px' }}>
        {strategies.map(({ label, wh, color }) => {
          const pct = maxWh > 0 ? (wh / maxWh) * 100 : 0;
          const isKromi = label === 'KROMI';
          const isManual = label === 'MANUAL';
          return (
            <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
              <span className="font-label tabular-nums" style={{ fontSize: '7px', color: '#777575' }}>{wh}Wh</span>
              <div style={{
                width: '100%',
                backgroundColor: color,
                borderRadius: '2px 2px 0 0',
                height: `${Math.max(pct, 4)}%`,
                opacity: isKromi ? 1 : isManual ? 0.7 : 0.4,
                border: isKromi ? `2px solid ${color}` : isManual ? `1px dashed ${color}` : 'none',
                boxShadow: isKromi ? `0 0 10px ${color}50` : 'none',
              }} />
              <span className="font-headline font-bold" style={{ fontSize: isKromi || isManual ? '8px' : '7px', color }}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* Smart rider mode breakdown */}
      {smartRiderWh && (
        <div style={{ marginTop: '6px', padding: '6px', backgroundColor: '#1a1919', borderRadius: '4px' }}>
          <div style={{ fontSize: '9px', color: '#777575', marginBottom: '4px' }}>Simulação rider manual (muda modo por terreno):</div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '10px' }}>
            {Object.entries(smartRiderWh.modeTime).filter(([, t]) => t > 0).map(([mode, time]) => {
              const colors: Record<string, string> = { ECO: '#3fff8b', TOUR: '#60a5fa', ACTIVE: '#fbbf24', SPORT: '#ff716c' };
              return (
                <span key={mode} style={{ color: colors[mode] }}>
                  {mode} {time >= 60 ? `${Math.round(time / 60)}m` : `${Math.round(time)}s`}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Savings message */}
      {vsManual > 0 && (
        <div style={{ marginTop: '6px', textAlign: 'center', fontSize: '12px' }}>
          <span style={{ color: '#e966ff', fontWeight: 700 }}>KROMI poupou {vsManual}Wh vs rider manual</span>
          <span style={{ color: '#777575' }}> ({vsManualPct}% menos energia)</span>
        </div>
      )}
      {vsManual <= 0 && kromiWh > 0 && (
        <div style={{ marginTop: '6px', textAlign: 'center', fontSize: '11px', color: '#777575' }}>
          KROMI: {kromiWh}Wh · {batteryUsedPct}% bateria · {kromiWhKm}Wh/km
        </div>
      )}
    </Section>
  );
}

/** Pre-ride vs Actual comparison — only shows if pre-ride analysis exists */
function PreRideComparison({ actualTimeMin, actualBatteryUsed }: {
  actualKm: number; actualTimeMin: number; actualBatteryUsed: number; elevGain: number;
}) {
  const preRide = useRouteStore((s) => s.preRideAnalysis);
  const nutrition = useNutritionStore((s) => s.state);

  if (!preRide) return null;

  // Estimate actual Wh from battery used: 625Wh × %used / 100
  const actualWh = Math.round((actualBatteryUsed / 100) * 625);

  const rows: { label: string; predicted: string; actual: string; delta: string; color: string }[] = [
    {
      label: 'Tempo',
      predicted: `${preRide.estimated_time_min} min`,
      actual: `${actualTimeMin} min`,
      delta: `${actualTimeMin - preRide.estimated_time_min > 0 ? '+' : ''}${actualTimeMin - preRide.estimated_time_min} min`,
      color: Math.abs(actualTimeMin - preRide.estimated_time_min) < 10 ? '#3fff8b' : '#fbbf24',
    },
    {
      label: 'Motor Wh',
      predicted: `${preRide.total_wh} Wh`,
      actual: `${actualWh} Wh`,
      delta: `${actualWh - preRide.total_wh > 0 ? '+' : ''}${actualWh - preRide.total_wh} Wh`,
      color: actualWh <= preRide.total_wh ? '#3fff8b' : actualWh < preRide.total_wh * 1.2 ? '#fbbf24' : '#ff716c',
    },
  ];

  if (nutrition) {
    rows.push({
      label: 'Carbs ingeridos',
      predicted: `${preRide.carbs_needed_g}g recomendados`,
      actual: `${nutrition.carbs_ingested_g}g`,
      delta: nutrition.carbs_ingested_g >= preRide.carbs_needed_g * 0.8 ? 'OK' : 'Deficit',
      color: nutrition.carbs_ingested_g >= preRide.carbs_needed_g * 0.8 ? '#3fff8b' : '#ff716c',
    });
    rows.push({
      label: 'Hidratacao',
      predicted: `${preRide.fluid_needed_ml}ml recomendados`,
      actual: `${nutrition.fluid_ingested_ml}ml`,
      delta: nutrition.fluid_ingested_ml >= preRide.fluid_needed_ml * 0.7 ? 'OK' : 'Deficit',
      color: nutrition.fluid_ingested_ml >= preRide.fluid_needed_ml * 0.7 ? '#3fff8b' : '#ff716c',
    });
  }

  const accuracy = preRide.total_wh > 0
    ? Math.round((1 - Math.abs(actualWh - preRide.total_wh) / preRide.total_wh) * 100)
    : 0;

  return (
    <Section title="Previsto vs Real" subtitle={`${Math.max(0, accuracy)}% precisao`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '4px', fontSize: '8px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span></span>
          <span style={{ textAlign: 'right' }}>Previsto</span>
          <span style={{ textAlign: 'right' }}>Real</span>
          <span style={{ textAlign: 'right' }}>Delta</span>
        </div>
        {/* Rows */}
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '4px', fontSize: '11px', padding: '4px 0', borderBottom: '1px solid #1a1919' }}>
            <span style={{ color: '#adaaaa', fontWeight: 600 }}>{r.label}</span>
            <span style={{ textAlign: 'right', color: '#777575' }}>{r.predicted}</span>
            <span style={{ textAlign: 'right', color: 'white', fontWeight: 700 }}>{r.actual}</span>
            <span style={{ textAlign: 'right', color: r.color, fontWeight: 700 }}>{r.delta}</span>
          </div>
        ))}
        {/* Consumption accuracy bar */}
        <div style={{ marginTop: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#777575', marginBottom: '3px' }}>
            <span>Precisao da previsao</span>
            <span style={{ color: accuracy > 85 ? '#3fff8b' : accuracy > 70 ? '#fbbf24' : '#ff716c', fontWeight: 700 }}>{Math.max(0, accuracy)}%</span>
          </div>
          <div style={{ height: '4px', backgroundColor: '#262626', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '2px',
              backgroundColor: accuracy > 85 ? '#3fff8b' : accuracy > 70 ? '#fbbf24' : '#ff716c',
              width: `${Math.max(0, accuracy)}%`,
            }} />
          </div>
        </div>
      </div>
    </Section>
  );
}

/** SVG Route Map — draws GPS path colored by HR zone */
function RouteMap({ points }: { points: { lat: number; lng: number; hr_zone: number }[] }) {
  const zoneColors = ['#6e9bff', '#3fff8b', '#fbbf24', '#ff9b3f', '#ff716c'];

  // Draw segments colored by HR zone
  const segments = useMemo(() => {
    if (points.length < 2) return [];
    const segs: { d: string; color: string }[] = [];

    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const padLat = (maxLat - minLat) * 0.1 || 0.001;
    const padLng = (maxLng - minLng) * 0.1 || 0.001;
    const w = 300, h = 150;
    const toX = (lng: number) => ((lng - (minLng - padLng)) / ((maxLng + padLng) - (minLng - padLng))) * w;
    const toY = (lat: number) => h - ((lat - (minLat - padLat)) / ((maxLat + padLat) - (minLat - padLat))) * h;

    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1]!;
      const p1 = points[i]!;
      const zone = p1.hr_zone > 0 ? p1.hr_zone : 1;
      segs.push({
        d: `M${toX(p0.lng).toFixed(1)},${toY(p0.lat).toFixed(1)} L${toX(p1.lng).toFixed(1)},${toY(p1.lat).toFixed(1)}`,
        color: zoneColors[Math.min(zone - 1, 4)] ?? '#adaaaa',
      });
    }
    return segs;
  }, [points]);

  return (
    <svg viewBox="0 0 300 150" style={{ width: '100%', height: '120px', backgroundColor: '#1a1919', borderRadius: '4px' }}>
      {/* Route segments colored by HR zone */}
      {segments.map((seg, i) => (
        <path key={i} d={seg.d} stroke={seg.color} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.85" />
      ))}
      {/* Start/end markers */}
      {points.length > 0 && <StartEndMarkers points={points} />}
    </svg>
  );
}

function StartEndMarkers({ points }: { points: { lat: number; lng: number }[] }) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padLat = (maxLat - minLat) * 0.1 || 0.001;
  const padLng = (maxLng - minLng) * 0.1 || 0.001;
  const toX = (lng: number) => ((lng - (minLng - padLng)) / ((maxLng + padLng) - (minLng - padLng))) * 300;
  const toY = (lat: number) => 150 - ((lat - (minLat - padLat)) / ((maxLat + padLat) - (minLat - padLat))) * 150;
  const s = points[0]!;
  const e = points[points.length - 1]!;
  return (
    <>
      <circle cx={toX(s.lng)} cy={toY(s.lat)} r="4" fill="#3fff8b" />
      <circle cx={toX(e.lng)} cy={toY(e.lat)} r="4" fill="#ff716c" />
    </>
  );
}

/** SVG Elevation Chart */
function ElevationChart({ points }: { points: { elapsed: number; alt: number }[] }) {
  const { path, area, viewBox, minAlt, maxAlt } = useMemo(() => {
    if (points.length < 2) return { path: '', area: '', viewBox: '0 0 300 80', minAlt: 0, maxAlt: 100 };

    const alts = points.map((p) => p.alt);
    const min = Math.min(...alts);
    const max = Math.max(...alts);
    const range = max - min || 1;
    const w = 300, h = 80;

    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.alt - min) / range) * (h - 10) - 5;
      return { x, y };
    });

    const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const areaD = d + ` L${w},${h} L0,${h} Z`;

    return { path: d, area: areaD, viewBox: `0 0 ${w} ${h}`, minAlt: Math.round(min), maxAlt: Math.round(max) };
  }, [points]);

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={viewBox} style={{ width: '100%', height: '80px', backgroundColor: '#1a1919', borderRadius: '4px' }}>
        <defs>
          <linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e966ff" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#e966ff" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#altGrad)" />
        <path d={path} stroke="#e966ff" strokeWidth="1.5" fill="none" opacity="0.8" />
      </svg>
      <div style={{ position: 'absolute', top: '4px', left: '6px', display: 'flex', gap: '8px' }}>
        <span className="font-label tabular-nums" style={{ fontSize: '8px', color: '#e966ff' }}>{maxAlt}m</span>
      </div>
      <div style={{ position: 'absolute', bottom: '4px', left: '6px' }}>
        <span className="font-label tabular-nums" style={{ fontSize: '8px', color: '#777575' }}>{minAlt}m</span>
      </div>
    </div>
  );
}

function StatCell({ label, value, unit, color, big }: {
  label: string; value: string; unit: string; color: string; big?: boolean;
}) {
  return (
    <div style={{ backgroundColor: '#131313', padding: big ? '12px 10px' : '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
      <span className="font-label" style={{ fontSize: '8px', color: '#777575', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
        <span className="font-headline font-bold tabular-nums" style={{ fontSize: big ? '22px' : '16px', color, lineHeight: 1 }}>{value}</span>
        {unit && <span className="font-label" style={{ fontSize: '9px', color: '#777575' }}>{unit}</span>}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid #1a1919' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span className="font-headline" style={{ fontSize: '12px', fontWeight: 900, color: '#adaaaa', textTransform: 'uppercase' }}>{title}</span>
        <span className="font-label" style={{ fontSize: '9px', color: '#777575' }}>{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function BatteryBlock({ label, pct }: { label: string; pct: number }) {
  const color = pct > 50 ? '#3fff8b' : pct > 30 ? '#fbbf24' : pct > 15 ? '#fbbf24' : '#ff716c';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="font-label" style={{ fontSize: '9px', color: '#777575' }}>{label}</span>
        <span className="font-headline font-bold tabular-nums" style={{ fontSize: '13px', color }}>{pct}%</span>
      </div>
      <div style={{ height: '5px', backgroundColor: '#262626', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '3px', backgroundColor: color, width: `${Math.max(pct, 1)}%` }} />
      </div>
    </div>
  );
}
