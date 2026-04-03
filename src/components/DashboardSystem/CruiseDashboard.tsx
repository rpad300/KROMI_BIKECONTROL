import { useBikeStore } from '../../store/bikeStore';

import { AssistMode } from '../../types/bike.types';
import { SpeedHero } from './widgets/SpeedHero';
import { MetricGrid, METRIC } from './widgets/MetricGrid';
import { CompactIntelligence } from './widgets/CompactIntelligence';
import { MiniMap } from '../Dashboard/MiniMap';
import { ElevationProfile } from '../Dashboard/ElevationProfile';

/** CRUISE Dashboard — flat terrain, efficiency focused */
export function CruiseDashboard() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);
  const rearGear = useBikeStore((s) => s.rear_gear);
  const temp = useBikeStore((s) => s.temperature_c);
  const tripTime = useBikeStore((s) => s.trip_time_s);

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

      {/* Efficiency metrics — 12% */}
      <div style={{ height: '12%', flexShrink: 0 }}>
        <MetricGrid cols={4} metrics={[METRIC.range, METRIC.power, METRIC.battery, METRIC.cadence]} />
      </div>

      {/* KROMI Intelligence — 5% */}
      <div style={{ height: '5%', flexShrink: 0 }}><CompactIntelligence /></div>

      {/* Elevation profile — 15% */}
      <div style={{ height: '15%', flexShrink: 0, padding: '4px', backgroundColor: '#131313' }}>
        <ElevationProfile />
      </div>

      {/* Weather + Trip strip — 6% */}
      <div style={{ height: '6%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#1a1919', borderTop: '1px solid rgba(73,72,71,0.1)', borderBottom: '1px solid rgba(73,72,71,0.1)' }}>
        {temp > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '12px', color: '#6e9bff' }}>thermostat</span>
            <span className="font-headline tabular-nums" style={{ fontSize: '11px' }}>{temp.toFixed(0)}°C</span>
          </div>
        )}
        <span className="font-headline tabular-nums" style={{ fontSize: '11px', color: '#adaaaa' }}>{formatTime(tripTime)}</span>
        {rearGear > 0 && <span className="font-headline font-bold" style={{ fontSize: '11px' }}>G{rearGear}</span>}
      </div>

      {/* Assist mode buttons — 10% */}
      <div style={{ height: '10%', flexShrink: 0, display: 'flex', gap: '3px', padding: '4px 6px', backgroundColor: 'black', alignItems: 'stretch' }}>
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
      </div>

      {/* Map strip — remaining */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <MiniMap />
      </div>
    </div>
  );
}
