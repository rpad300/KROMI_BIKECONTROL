import { useMemo, useEffect, useState } from 'react';
import { useTripStore } from '../../../store/tripStore';
import { useBikeStore } from '../../../store/bikeStore';
import { di2Service } from '../../../services/di2/Di2Service';
import { localRideStore, type LocalSnapshot } from '../../../services/storage/LocalRideStore';

/** Full-screen trip summary shown after FINISH */
export function TripSummaryModal({ onClose }: { onClose: () => void }) {
  const trip = useTripStore();
  const battery = useBikeStore((s) => s.battery_percent);
  const di2Battery = useBikeStore((s) => s.di2_battery);
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>([]);

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

  // Compute HR zone distribution
  const hrZones = useMemo(() => {
    const zones = [0, 0, 0, 0, 0]; // Z1-Z5 time counts
    snapshots.forEach((s) => {
      if (s.hr_zone >= 1 && s.hr_zone <= 5) zones[s.hr_zone - 1] = (zones[s.hr_zone - 1] ?? 0) + 1;
    });
    return zones;
  }, [snapshots]);
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
        <button onClick={onClose} style={{ padding: '8px 20px', backgroundColor: '#262626', color: '#adaaaa', border: 'none', fontWeight: 900, fontSize: '11px', cursor: 'pointer' }}>
          FECHAR
        </button>
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

      {/* HR Zones */}
      {totalHrSamples > 0 && (
        <Section title="Zonas HR" subtitle={`avg ${avgHr} · max ${maxHr} bpm`}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '50px', padding: '0 4px' }}>
            {hrZones.map((count, i) => {
              const pct = (count / maxHrZone) * 100;
              const colors = ['#6e9bff', '#3fff8b', '#fbbf24', '#ff9b3f', '#ff716c'];
              const mins = (count * 5 / 60).toFixed(0); // each sample ≈ 5s
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <span className="font-label tabular-nums" style={{ fontSize: '8px', color: '#777575' }}>{mins}m</span>
                  <div style={{ width: '100%', backgroundColor: colors[i], borderRadius: '2px 2px 0 0', height: `${Math.max(pct, 4)}%`, opacity: 0.85 }} />
                  <span className="font-headline font-bold" style={{ fontSize: '10px', color: colors[i] }}>Z{i + 1}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Gear Usage */}
      {gearEntries.length > 0 && (
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

      <div style={{ height: '60px' }} />
    </div>
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
