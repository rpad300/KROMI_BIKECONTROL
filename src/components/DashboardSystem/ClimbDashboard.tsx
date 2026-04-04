import { useBikeStore } from '../../store/bikeStore';
import { AssistMode } from '../../types/bike.types';
import { GradientHero } from './widgets/GradientHero';
import { MetricGrid, METRIC } from './widgets/MetricGrid';
import { CompactIntelligence } from './widgets/CompactIntelligence';
import { ElevationProfile } from '../Dashboard/ElevationProfile';
import { ClockDisplay } from '../shared/ClockDisplay';

/** CLIMB Dashboard — gradient hero, power/torque/cadence/HR emphasized */
export function ClimbDashboard() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const rearGear = useBikeStore((s) => s.rear_gear);
  const speed = useBikeStore((s) => s.speed_kmh);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Clock — top right */}
      <div style={{ position: 'absolute', top: 4, right: 8, zIndex: 10 }}>
        <ClockDisplay />
      </div>
      {/* Gradient Hero — 15% */}
      <div style={{ height: '15%', flexShrink: 0 }}><GradientHero /></div>

      {/* Power + Torque row — 15% */}
      <div style={{ height: '15%', flexShrink: 0 }}>
        <MetricGrid cols={2} metrics={[METRIC.power, METRIC.torque]} />
      </div>

      {/* Cadence + HR row — 12% */}
      <div style={{ height: '12%', flexShrink: 0 }}>
        <MetricGrid cols={2} metrics={[METRIC.cadence, METRIC.hr]} />
      </div>

      {/* Elevation Profile — 22% */}
      <div style={{ height: '22%', flexShrink: 0, padding: '4px', backgroundColor: '#131313' }}>
        <ElevationProfile />
      </div>

      {/* KROMI Intelligence — 5% */}
      <div style={{ height: '5%', flexShrink: 0 }}><CompactIntelligence /></div>

      {/* Speed + Gear + Current strip — 8% */}
      <div style={{ height: '8%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#1a1919', borderTop: '1px solid rgba(73,72,71,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span className="font-headline font-bold tabular-nums" style={{ fontSize: '18px' }}>{speed > 0 ? speed.toFixed(1) : '0'}</span>
          <span style={{ fontSize: '10px', color: '#777575' }}>km/h</span>
        </div>
        {rearGear > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#adaaaa' }}>settings</span>
            <span className="font-headline font-black" style={{ fontSize: '18px' }}>{rearGear}</span>
          </div>
        )}
        <MetricCell icon="electric_bolt" value={useBikeStore.getState().assist_current_a.toFixed(1)} unit="A" color="#fbbf24" />
      </div>

      {/* Assist mode buttons — 10% */}
      <div style={{ height: '10%', flexShrink: 0 }}>
        <AssistBar assistMode={assistMode} />
      </div>

      {/* Remaining fills with battery info */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#131313' }}>
        <MetricGrid cols={3} metrics={[METRIC.battery, METRIC.range, METRIC.current]} />
      </div>
    </div>
  );
}

function MetricCell({ icon, value, unit, color }: { icon: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
      <span className="material-symbols-outlined" style={{ fontSize: '14px', color }}>{icon}</span>
      <span className="font-headline font-bold tabular-nums" style={{ fontSize: '14px' }}>{value}</span>
      <span style={{ fontSize: '9px', color: '#777575' }}>{unit}</span>
    </div>
  );
}

function AssistBar({ assistMode }: { assistMode: number }) {
  const modes = [
    { mode: AssistMode.ECO, label: 'ECO' }, { mode: AssistMode.TOUR, label: 'TOUR' },
    { mode: AssistMode.ACTIVE, label: 'ACTV' }, { mode: AssistMode.SPORT, label: 'SPRT' },
    { mode: AssistMode.POWER, label: 'PWR' }, { mode: AssistMode.SMART, label: 'AUTO' },
  ];
  return (
    <div style={{ display: 'flex', gap: '3px', padding: '4px 6px', backgroundColor: 'black', height: '100%', alignItems: 'stretch' }}>
      {modes.map(({ mode, label }) => (
        <button key={mode} style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: assistMode === mode ? '#3fff8b' : '#262626',
          color: assistMode === mode ? 'black' : '#adaaaa',
          border: 'none', fontFamily: "'Space Grotesk'", fontWeight: 900,
          fontSize: '9px', textTransform: 'uppercase',
          boxShadow: assistMode === mode ? '0 0 16px rgba(63,255,139,0.3)' : 'none',
        }}>{label}</button>
      ))}
    </div>
  );
}
