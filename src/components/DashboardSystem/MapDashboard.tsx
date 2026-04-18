import { useBikeStore } from '../../store/bikeStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { AssistMode } from '../../types/bike.types';
import { MetricGrid, METRIC } from './widgets/MetricGrid';
import { MiniMap } from '../Dashboard/MiniMap';
import { ElevationProfile } from '../Dashboard/ElevationProfile';

/** MAP Dashboard — navigation focus with key metrics */
export function MapDashboard() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const temp = useBikeStore((s) => s.temperature_c);
  const terrain = useAutoAssistStore((s) => s.terrain);
  const gradient = terrain?.current_gradient_pct ?? 0;
  const terrainType = gradient > 8 ? 'STEEP' : gradient > 3 ? 'CLIMB' : gradient < -3 ? 'DESCENT' : 'FLAT';

  const modes = [
    { mode: AssistMode.ECO, label: 'ECO' }, { mode: AssistMode.TOUR, label: 'TOUR' },
    { mode: AssistMode.ACTIVE, label: 'ACTV' }, { mode: AssistMode.SPORT, label: 'SPRT' },
    { mode: AssistMode.POWER, label: 'KROMI' }, { mode: AssistMode.SMART, label: 'AUTO' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Map — 55% */}
      <div style={{ height: '55%', flexShrink: 0, position: 'relative' }}>
        <MiniMap />
        {/* Terrain badge overlay */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(14,14,14,0.85)', border: '1px solid var(--ev-outline-variant)', padding: '4px 10px' }}>
          <span className="font-display" style={{ fontSize: '9px', fontWeight: 700, color: gradient > 8 ? 'var(--ev-error)' : gradient > 3 ? 'var(--ev-amber)' : gradient < -3 ? 'var(--ev-secondary)' : 'var(--ev-on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{terrainType}</span>
          <span className="font-mono tabular-nums" style={{ fontSize: '10px', color: 'var(--ev-on-surface-variant)' }}>{gradient > 0 ? '+' : ''}{gradient.toFixed(1)}%</span>
        </div>
      </div>

      {/* Elevation profile — 15% */}
      <div style={{ height: '15%', flexShrink: 0, padding: '4px', backgroundColor: '#131313' }}>
        <ElevationProfile />
      </div>

      {/* Key metrics — 12% */}
      <div style={{ height: '12%', flexShrink: 0 }}>
        <MetricGrid cols={5} metrics={[METRIC.speed, METRIC.power, METRIC.cadence, METRIC.range, METRIC.gear]} />
      </div>

      {/* Assist buttons — 10% */}
      <div style={{ height: '10%', flexShrink: 0, display: 'flex', gap: '3px', padding: '4px 6px', backgroundColor: 'black', alignItems: 'stretch' }}>
        {modes.map(({ mode, label }) => {
          const active = assistMode === mode;
          return (
          <button key={mode} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: active ? 'var(--ev-primary-glow)' : 'transparent',
            border: `1px solid ${active ? 'var(--ev-primary)' : 'var(--ev-outline-variant)'}`,
            color: active ? 'var(--ev-primary)' : 'var(--ev-on-surface-variant)',
            fontFamily: "'Space Grotesk'", fontWeight: 900,
            fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em',
            boxShadow: active ? '0 0 20px var(--ev-primary-shadow)' : 'none',
          }}>{label}</button>
          );})}
      </div>

      {/* Weather strip — remaining */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1919', gap: '16px' }}>
        {temp > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#6e9bff' }}>thermostat</span>
            <span className="font-headline tabular-nums" style={{ fontSize: '13px' }}>{temp.toFixed(0)}°C</span>
          </div>
        )}
        <span className="font-label" style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.1em' }}>MAP VIEW</span>
      </div>
    </div>
  );
}
