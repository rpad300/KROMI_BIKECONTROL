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
import { usePermission } from '../../hooks/usePermission';

/** CRUISE Dashboard — flat terrain, efficiency focused */
export function CruiseDashboard() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);
  const gear = useBikeStore((s) => s.gear || s.rear_gear);
  const temp = useBikeStore((s) => s.temperature_c);
  const tripTime = useBikeStore((s) => s.trip_time_s);
  const isEBike = useIsEBike();
  const isPowerMode = assistMode === AssistMode.POWER;
  const canSeeIntelligence = usePermission('features.intelligence_v2');

  const formatTime = (s: number) => s > 0 ? `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}` : '0:00';

  const modes = [
    { mode: AssistMode.ECO, label: 'ECO', key: 'eco' },
    { mode: AssistMode.TOUR, label: 'TOUR', key: 'tour' },
    { mode: AssistMode.ACTIVE, label: 'ACTV', key: 'active' },
    { mode: AssistMode.SPORT, label: 'SPRT', key: 'sport' },
    { mode: AssistMode.POWER, label: 'KROMI', key: 'power' },
    { mode: AssistMode.SMART, label: 'AUTO', key: 'smart' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Speed Hero — 18% */}
      <div style={{ height: '18%', flexShrink: 0 }}><SpeedHero /></div>

      {/* Key metrics — 10% */}
      <div style={{ height: '10%', flexShrink: 0 }}>
        <MetricGrid cols={5} metrics={[METRIC.power, METRIC.cadence, METRIC.gradient, METRIC.gear, METRIC.terrain]} />
      </div>

      {/* Battery strip — 5% */}
      <div style={{ height: '5%', flexShrink: 0 }}>
        <BatteryStrip />
      </div>

      {/* KROMI Intelligence — 4% (gated by features.intelligence_v2) */}
      {canSeeIntelligence && <div style={{ height: '4%', flexShrink: 0 }}><CompactIntelligence /></div>}

      {/* Elevation profile — 7% (was 12% — too large, map needs more space) */}
      <div style={{ height: '7%', flexShrink: 0, padding: '2px 4px', backgroundColor: '#131313' }}>
        <ElevationProfile />
      </div>

      {/* Clock + Temp + Trip + Gear strip — 4% */}
      <div style={{ height: '4%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#1a1919', borderTop: '1px solid rgba(73,72,71,0.1)', borderBottom: '1px solid rgba(73,72,71,0.1)' }}>
        <ClockDisplay />
        {temp > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '10px', color: '#6e9bff' }}>thermostat</span>
            <span className="font-headline tabular-nums" style={{ fontSize: '10px' }}>{temp.toFixed(0)}°C</span>
          </div>
        )}
        <span className="font-headline tabular-nums" style={{ fontSize: '10px', color: '#adaaaa' }}>{formatTime(tripTime)}</span>
        {gear > 0 && <span className="font-headline font-bold" style={{ fontSize: '10px' }}>G{gear}</span>}
      </div>

      {/* Assist mode buttons — 9% (e-bike only) */}
      {isEBike && <div style={{ height: '9%', flexShrink: 0, display: 'flex', gap: '2px', padding: '3px 4px', backgroundColor: 'black', alignItems: 'stretch' }}>
        {modes.map(({ mode, label, key }) => {
          const active = assistMode === mode;
          const range = rangePerMode ? (rangePerMode as Record<string, number>)[key] : undefined;
          return (
            <button key={mode} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              backgroundColor: active ? 'var(--ev-primary-glow)' : 'transparent',
              border: `1px solid ${active ? 'var(--ev-primary)' : 'var(--ev-outline-variant)'}`,
              color: active ? 'var(--ev-primary)' : 'var(--ev-on-surface-variant)',
              cursor: 'default', fontFamily: "'Space Grotesk'", fontWeight: 900,
              fontSize: '8px', letterSpacing: '0.08em', textTransform: 'uppercase',
              boxShadow: active ? '0 0 20px var(--ev-primary-shadow)' : 'none',
            }}>
              <span>{label}</span>
              {(range ?? 0) > 0 && <span style={{ fontSize: '7px', fontWeight: 700, color: active ? 'var(--ev-primary)' : 'var(--ev-on-surface-muted)' }}>{range! < 0 ? '255+' : range}km</span>}
            </button>
          );
        })}
      </div>}

      {/* Bottom: KROMI Intelligence in POWER mode, Map otherwise */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {isPowerMode && canSeeIntelligence ? (
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

/** Compact battery strip */
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
      {hasDual ? (
        <>
          <BatBar label="800" pct={mainSoc} wh={800} />
          <BatBar label="250" pct={subSoc} wh={250} />
        </>
      ) : (
        <BatBar label="Bike" pct={soc} wh={0} />
      )}
      {di2Bat > 0 && <BatBar label="Di2" pct={di2Bat} wh={0} />}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span className="font-headline font-bold tabular-nums" style={{ fontSize: '14px', color: barColor(soc) }}>{soc}%</span>
        {rangeKm > 0 && (
          <span className="font-label tabular-nums" style={{ fontSize: '9px', color: '#777575' }}>{Math.round(rangeKm)}km</span>
        )}
      </div>
    </div>
  );
}

function BatBar({ label, pct, wh }: { label: string; pct: number; wh: number }) {
  const color = pct > 50 ? '#3fff8b' : pct > 30 ? '#fbbf24' : pct > 15 ? '#fbbf24' : '#ff716c';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="font-label" style={{ fontSize: '7px', color: '#777575' }}>{label}</span>
        <span className="font-label tabular-nums" style={{ fontSize: '7px', color }}>{pct}%</span>
      </div>
      <div style={{ height: '3px', backgroundColor: '#262626', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '2px', backgroundColor: color, width: `${Math.max(pct, 1)}%`, transition: 'width 700ms' }} />
      </div>
      {wh > 0 && <span className="font-label tabular-nums" style={{ fontSize: '6px', color: '#555', textAlign: 'center' }}>{Math.round(wh * pct / 100)}Wh</span>}
    </div>
  );
}

function barColor(pct: number): string {
  return pct > 50 ? '#3fff8b' : pct > 30 ? '#fbbf24' : pct > 15 ? '#fbbf24' : '#ff716c';
}
