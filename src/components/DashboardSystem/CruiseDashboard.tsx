import { useBikeStore } from '../../store/bikeStore';
import { useIsEBike } from '../../hooks/useIsEBike';
import { AssistMode } from '../../types/bike.types';
import { SpeedHero } from './widgets/SpeedHero';
import { MetricGrid, METRIC } from './widgets/MetricGrid';
import { CompactIntelligence } from './widgets/CompactIntelligence';
import { IntelligenceWidget } from '../Dashboard/IntelligenceWidget';
import { MiniMap } from '../Dashboard/MiniMap';
import { ElevationProfile } from '../Dashboard/ElevationProfile';
import { ClockDisplay } from '../shared/ClockDisplay';

/** CRUISE Dashboard — flat terrain, efficiency focused */
export function CruiseDashboard() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);
  const gear = useBikeStore((s) => s.gear || s.rear_gear);
  const temp = useBikeStore((s) => s.temperature_c);
  const tripTime = useBikeStore((s) => s.trip_time_s);
  const isEBike = useIsEBike();
  const bleConnected = useBikeStore((s) => s.ble_status === 'connected');
  const motorActive = assistMode >= 1 && assistMode <= 6;
  const showIntelligence = isEBike && bleConnected && motorActive;

  const formatTime = (s: number) => s > 0 ? `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}` : '0:00';

  const modes = [
    { mode: AssistMode.ECO, label: 'ECO', key: 'eco' },
    { mode: AssistMode.TOUR, label: 'TOUR', key: 'tour' },
    { mode: AssistMode.ACTIVE, label: 'ACTV', key: 'active' },
    { mode: AssistMode.SPORT, label: 'SPRT', key: 'sport' },
    { mode: AssistMode.POWER, label: 'PWR', key: 'power' },
    { mode: AssistMode.SMART, label: 'AUTO', key: 'smart' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Speed Hero — 20% */}
      <div style={{ height: '20%', flexShrink: 0 }}><SpeedHero /></div>

      {/* Key metrics — 10% */}
      <div style={{ height: '10%', flexShrink: 0 }}>
        <MetricGrid cols={5} metrics={[METRIC.power, METRIC.cadence, METRIC.gradient, METRIC.gear, METRIC.range]} />
      </div>

      {/* Battery strip — all batteries at a glance — 6% */}
      <div style={{ height: '6%', flexShrink: 0 }}>
        <BatteryStrip />
      </div>

      {/* KROMI Intelligence — 5% */}
      <div style={{ height: '5%', flexShrink: 0 }}><CompactIntelligence /></div>

      {/* Elevation profile — 14% */}
      <div style={{ height: '14%', flexShrink: 0, padding: '4px', backgroundColor: '#131313' }}>
        <ElevationProfile />
      </div>

      {/* Clock + Weather + Trip strip — 5% */}
      <div style={{ height: '5%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#1a1919', borderTop: '1px solid rgba(73,72,71,0.1)', borderBottom: '1px solid rgba(73,72,71,0.1)' }}>
        <ClockDisplay />
        {temp > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '12px', color: '#6e9bff' }}>thermostat</span>
            <span className="font-headline tabular-nums" style={{ fontSize: '11px' }}>{temp.toFixed(0)}°C</span>
          </div>
        )}
        <span className="font-headline tabular-nums" style={{ fontSize: '11px', color: '#adaaaa' }}>{formatTime(tripTime)}</span>
        {gear > 0 && <span className="font-headline font-bold" style={{ fontSize: '11px' }}>G{gear}</span>}
      </div>

      {/* Assist mode buttons — 10% (e-bike only) */}
      {isEBike && <div style={{ height: '10%', flexShrink: 0, display: 'flex', gap: '3px', padding: '4px 6px', backgroundColor: 'black', alignItems: 'stretch' }}>
        {modes.map(({ mode, label, key }) => {
          const active = assistMode === mode;
          const range = rangePerMode ? (rangePerMode as Record<string, number>)[key] : undefined;
          return (
            <button key={mode} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              backgroundColor: active ? '#3fff8b' : '#262626', color: active ? 'black' : '#adaaaa',
              border: 'none', cursor: 'default', fontFamily: "'Space Grotesk'", fontWeight: 900,
              fontSize: '9px', letterSpacing: '-0.02em', textTransform: 'uppercase',
              boxShadow: active ? '0 0 16px rgba(63,255,139,0.3)' : 'none',
            }}>
              <span>{label}</span>
              {(range ?? 0) > 0 && <span style={{ fontSize: '7px', fontWeight: 700, color: active ? 'rgba(0,0,0,0.6)' : '#777575' }}>{range}km</span>}
            </button>
          );
        })}
      </div>}

      {/* Bottom section — KROMI intelligence when motor active, map when disconnected */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {showIntelligence ? (
          <div style={{ height: '100%', overflow: 'hidden' }}>
            <IntelligenceWidget />
          </div>
        ) : (
          <MiniMap />
        )}
      </div>
    </div>
  );
}

/** Compact battery strip — shows all batteries in one row */
function BatteryStrip() {
  const soc = useBikeStore((s) => s.battery_percent);
  const bat1 = useBikeStore((s) => s.battery_main_pct);
  const bat2 = useBikeStore((s) => s.battery_sub_pct);
  const di2Bat = useBikeStore((s) => s.di2_battery);
  const rangeKm = useBikeStore((s) => s.range_km);

  const hasDual = bat1 > 0 || bat2 > 0;
  const mainSoc = bat1 > 0 ? bat1 : soc;
  const subSoc = bat2 > 0 ? bat2 : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '100%', padding: '0 8px', backgroundColor: '#131313' }}>
      {/* Main battery (or combined) */}
      {hasDual ? (
        <>
          <BatBar label="800" pct={mainSoc} wh={800} />
          <BatBar label="250" pct={subSoc} wh={250} />
        </>
      ) : (
        <BatBar label="Bike" pct={soc} wh={0} />
      )}

      {/* Di2 battery */}
      {di2Bat > 0 && <BatBar label="Di2" pct={di2Bat} wh={0} />}

      {/* Total SOC + Range */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span className="font-headline font-bold tabular-nums" style={{ fontSize: '16px', color: barTextColor(soc) }}>{soc}%</span>
        {rangeKm > 0 && (
          <span className="font-label tabular-nums" style={{ fontSize: '10px', color: '#777575' }}>{Math.round(rangeKm)}km</span>
        )}
      </div>
    </div>
  );
}

function BatBar({ label, pct, wh }: { label: string; pct: number; wh: number }) {
  const color = pct > 50 ? '#3fff8b' : pct > 30 ? '#fbbf24' : pct > 15 ? '#fbbf24' : '#ff716c';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="font-label" style={{ fontSize: '8px', color: '#777575' }}>{label}</span>
        <span className="font-label tabular-nums" style={{ fontSize: '8px', color }}>{pct}%</span>
      </div>
      <div style={{ height: '4px', backgroundColor: '#262626', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '2px', backgroundColor: color, width: `${Math.max(pct, 1)}%`, transition: 'width 700ms' }} />
      </div>
      {wh > 0 && (
        <span className="font-label tabular-nums" style={{ fontSize: '7px', color: '#555', textAlign: 'center' }}>{Math.round(wh * pct / 100)}Wh</span>
      )}
    </div>
  );
}

function barTextColor(pct: number): string {
  return pct > 50 ? '#3fff8b' : pct > 30 ? '#fbbf24' : pct > 15 ? '#fbbf24' : '#ff716c';
}
