import { useBikeStore } from '../../store/bikeStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { useMapStore } from '../../store/mapStore';
import { SpeedHero } from './widgets/SpeedHero';
import { ElevationProfile } from '../Dashboard/ElevationProfile';
import { ClockDisplay } from '../shared/ClockDisplay';

/** DESCENT Dashboard — speed hero (red above 40), safety focused */
export function DescentDashboard() {
  const gradient = useAutoAssistStore((s) => s.terrain?.current_gradient_pct ?? 0);
  const altitude = useMapStore((s) => s.altitude) ?? 0;
  const leanAngle = useBikeStore((s) => s.lean_angle_deg);
  const tpmsFront = useBikeStore((s) => s.tpms_front_psi);
  const tpmsRear = useBikeStore((s) => s.tpms_rear_psi);
  const tripDist = useBikeStore((s) => s.trip_distance_km ?? 0);
  const tripTime = useBikeStore((s) => s.trip_time_s);
  const speedMax = useBikeStore((s) => s.speed_max);

  const formatTime = (s: number) => s > 0 ? `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}` : '0:00';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Clock — top right */}
      <div style={{ position: 'absolute', top: 4, right: 8, zIndex: 10 }}>
        <ClockDisplay />
      </div>
      {/* Speed Hero — 28% (red above 40km/h) */}
      <div style={{ height: '28%', flexShrink: 0 }}><SpeedHero dangerThreshold={40} /></div>

      {/* Descent info row — 12% */}
      <div style={{ height: '12%', flexShrink: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', backgroundColor: '#131313', borderTop: '1px solid rgba(73,72,71,0.2)', borderBottom: '1px solid rgba(73,72,71,0.2)' }}>
        <DescentCell icon="trending_down" label="Grade" value={`${gradient.toFixed(0)}%`} color="#6e9bff" />
        <DescentCell icon="straighten" label="Alt" value={`${Math.round(altitude)}m`} color="#e966ff" />
        <DescentCell icon="speed" label="Max" value={`${speedMax > 0 ? speedMax.toFixed(0) : '--'}km/h`} color="#ff716c" />
      </div>

      {/* Elevation Profile — 25% */}
      <div style={{ height: '25%', flexShrink: 0, padding: '4px', backgroundColor: '#131313' }}>
        <ElevationProfile />
      </div>

      {/* Safety row (TPMS + lean) — 10% */}
      <div style={{ height: '10%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#1a1919', borderTop: '1px solid rgba(73,72,71,0.1)' }}>
        {tpmsFront > 0 ? (
          <>
            <SafetyItem label="Front PSI" value={String(tpmsFront)} />
            <SafetyItem label="Rear PSI" value={String(tpmsRear)} />
          </>
        ) : (
          <>
            <SafetyItem label="Lean" value={leanAngle !== 0 ? `${leanAngle.toFixed(0)}°` : '--'} />
            <SafetyItem label="Battery" value={`${useBikeStore.getState().battery_percent}%`} />
          </>
        )}
        <SafetyItem label="Range" value={`${Math.round(useBikeStore.getState().range_km)}km`} />
      </div>

      {/* Trip strip — 8% */}
      <div style={{ height: '8%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#131313' }}>
        <span className="font-headline tabular-nums" style={{ fontSize: '13px' }}>{tripDist.toFixed(1)} km</span>
        <span className="font-headline tabular-nums" style={{ fontSize: '13px', color: '#adaaaa' }}>{formatTime(tripTime)}</span>
        <span className="font-headline tabular-nums" style={{ fontSize: '13px', color: '#777575' }}>D+ {useBikeStore.getState().elevation_gain_m}m</span>
      </div>

      {/* Assist bar dimmed — remaining */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'black', opacity: 0.4 }}>
        <span className="font-label" style={{ fontSize: '11px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Motor off — descent</span>
      </div>
    </div>
  );
}

function DescentCell({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <span className="material-symbols-outlined" style={{ fontSize: '16px', color }}>{icon}</span>
      <span className="font-headline font-bold tabular-nums" style={{ fontSize: '18px' }}>{value}</span>
      <span className="font-label" style={{ fontSize: '8px', color: '#777575', textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}

function SafetyItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="font-headline font-bold tabular-nums" style={{ fontSize: '14px' }}>{value}</div>
      <div className="font-label" style={{ fontSize: '8px', color: '#777575', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}
