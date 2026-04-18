import { useBikeStore } from '../../store/bikeStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { AssistMode } from '../../types/bike.types';
import { MetricGrid, METRIC } from './widgets/MetricGrid';
import { MiniMap } from '../Dashboard/MiniMap';
import { ElevationProfile } from '../Dashboard/ElevationProfile';

/** MAP Dashboard — navigation focus with key metrics */
export function MapDashboard() {
  const assistMode = useBikeStore((s) => s.assist_mode);
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
      {/* Map — fills most of the screen with elevation overlay */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <MiniMap />
        {/* Terrain badge overlay — top left */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(14,14,14,0.85)', border: '1px solid var(--ev-outline-variant)', padding: '4px 10px', zIndex: 5 }}>
          <span className="font-display" style={{ fontSize: '9px', fontWeight: 700, color: gradient > 8 ? 'var(--ev-error)' : gradient > 3 ? 'var(--ev-amber)' : gradient < -3 ? 'var(--ev-secondary)' : 'var(--ev-on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{terrainType}</span>
          <span className="font-mono tabular-nums" style={{ fontSize: '10px', color: 'var(--ev-on-surface-variant)' }}>{gradient > 0 ? '+' : ''}{gradient.toFixed(1)}%</span>
        </div>
        {/* Elevation profile overlay — bottom of map */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '25%', backgroundColor: 'rgba(14,14,14,0.7)', zIndex: 5 }}>
          <ElevationProfile />
        </div>
      </div>

      {/* Key metrics — 10% */}
      <div style={{ height: '10%', flexShrink: 0 }}>
        <MetricGrid cols={5} metrics={[METRIC.speed, METRIC.power, METRIC.cadence, METRIC.range, METRIC.gear]} />
      </div>

      {/* Assist buttons — 8% */}
      <div style={{ height: '8%', flexShrink: 0, display: 'flex', gap: '3px', padding: '3px 4px', backgroundColor: 'black', alignItems: 'stretch' }}>
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
    </div>
  );
}
