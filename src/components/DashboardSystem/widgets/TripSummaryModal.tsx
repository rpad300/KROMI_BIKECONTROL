import { useMemo } from 'react';
import { useTripStore } from '../../../store/tripStore';
import { useBikeStore } from '../../../store/bikeStore';
import { useMapStore } from '../../../store/mapStore';
import { di2Service } from '../../../services/di2/Di2Service';

/** Full-screen trip summary shown after FINISH */
export function TripSummaryModal({ onClose }: { onClose: () => void }) {
  const trip = useTripStore();
  const battery = useBikeStore((s) => s.battery_percent);
  const di2Battery = useBikeStore((s) => s.di2_battery);
  const altitude = useMapStore((s) => s.altitude);

  const gearStats = useMemo(() => di2Service.getRideGearStats(), []);

  const fmt = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  };

  // Gear usage chart data
  const gearEntries = Object.entries(gearStats.gearUsageMs)
    .map(([g, ms]) => ({ gear: Number(g), ms: ms as number }))
    .sort((a, b) => a.gear - b.gear);
  const maxGearMs = Math.max(...gearEntries.map((e) => e.ms), 1);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      backgroundColor: '#0e0e0e', display: 'flex', flexDirection: 'column',
      overflow: 'auto',
    }}>
      {/* Header */}
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #262626' }}>
        <div>
          <h1 className="font-headline" style={{ fontSize: '20px', fontWeight: 900, color: '#3fff8b' }}>RIDE COMPLETE</h1>
          <span className="font-label" style={{ fontSize: '10px', color: '#777575' }}>
            {new Date().toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ padding: '8px 20px', backgroundColor: '#262626', color: '#adaaaa', border: 'none', fontWeight: 900, fontSize: '12px', cursor: 'pointer' }}
        >
          FECHAR
        </button>
      </div>

      {/* Main stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', backgroundColor: '#262626', margin: '0' }}>
        <StatCell label="Distancia" value={`${trip.tripKm.toFixed(1)}`} unit="km" color="#3fff8b" big />
        <StatCell label="Tempo" value={fmt(trip.movingTime)} unit="" color="#3fff8b" big />
        <StatCell label="Vel. Media" value={`${trip.avgSpeed.toFixed(1)}`} unit="km/h" color="#adaaaa" big />

        <StatCell label="Vel. Max" value={`${trip.maxSpeed.toFixed(1)}`} unit="km/h" color="#6e9bff" />
        <StatCell label="Bateria" value={`${battery}`} unit="%" color={battery > 30 ? '#3fff8b' : '#fbbf24'} />
        <StatCell label="Altitude" value={`${Math.round(altitude || 0)}`} unit="m" color="#e966ff" />
      </div>

      {/* Gear Usage (if Di2 connected) */}
      {gearEntries.length > 0 && (
        <Section title="Mudancas" subtitle={`${gearStats.shiftCount} shifts`}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '60px', padding: '0 4px' }}>
            {gearEntries.map(({ gear, ms }) => {
              const pct = (ms / maxGearMs) * 100;
              const mins = (ms / 60000).toFixed(1);
              return (
                <div key={gear} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <span className="font-label tabular-nums" style={{ fontSize: '7px', color: '#777575' }}>{mins}m</span>
                  <div style={{ width: '100%', backgroundColor: '#6e9bff', borderRadius: '2px 2px 0 0', height: `${Math.max(pct, 4)}%`, transition: 'height 500ms' }} />
                  <span className="font-headline font-bold tabular-nums" style={{ fontSize: '9px', color: '#adaaaa' }}>{gear}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Battery breakdown */}
      <Section title="Bateria" subtitle="">
        <div style={{ display: 'flex', gap: '12px', padding: '0 4px' }}>
          <BatteryBlock label="Bike" pct={battery} />
          {di2Battery > 0 && <BatteryBlock label="Di2" pct={di2Battery} />}
        </div>
      </Section>

      {/* Shift history timeline */}
      {gearStats.shiftHistory.length > 0 && (
        <Section title="Timeline de Mudancas" subtitle={`${gearStats.shiftHistory.length} eventos`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '0 4px' }}>
            {gearStats.shiftHistory.slice(-30).map((e, i) => (
              <span key={i} className="font-label tabular-nums" style={{
                fontSize: '9px', padding: '2px 6px', borderRadius: '4px',
                backgroundColor: e.direction === 'up' ? 'rgba(110,155,255,0.15)' : 'rgba(255,113,108,0.15)',
                color: e.direction === 'up' ? '#6e9bff' : '#ff716c',
              }}>
                {e.gear_from}→{e.gear_to}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Spacer for scroll */}
      <div style={{ height: '80px' }} />
    </div>
  );
}

function StatCell({ label, value, unit, color, big }: {
  label: string; value: string; unit: string; color: string; big?: boolean;
}) {
  return (
    <div style={{ backgroundColor: '#131313', padding: big ? '14px 12px' : '10px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
      <span className="font-label" style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
        <span className="font-headline font-bold tabular-nums" style={{ fontSize: big ? '24px' : '18px', color, lineHeight: 1 }}>{value}</span>
        {unit && <span className="font-label" style={{ fontSize: '10px', color: '#777575' }}>{unit}</span>}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px', borderBottom: '1px solid #262626' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span className="font-headline" style={{ fontSize: '13px', fontWeight: 900, color: '#adaaaa', textTransform: 'uppercase' }}>{title}</span>
        <span className="font-label" style={{ fontSize: '10px', color: '#777575' }}>{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function BatteryBlock({ label, pct }: { label: string; pct: number }) {
  const color = pct > 50 ? '#3fff8b' : pct > 30 ? '#fbbf24' : pct > 15 ? '#fbbf24' : '#ff716c';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="font-label" style={{ fontSize: '10px', color: '#777575' }}>{label}</span>
        <span className="font-headline font-bold tabular-nums" style={{ fontSize: '14px', color }}>{pct}%</span>
      </div>
      <div style={{ height: '6px', backgroundColor: '#262626', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '3px', backgroundColor: color, width: `${Math.max(pct, 1)}%` }} />
      </div>
    </div>
  );
}
