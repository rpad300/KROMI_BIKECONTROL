/**
 * NAV Dashboard — fullscreen navigation with route tracking.
 *
 * Purpose: Ride navigation with minimal distractions.
 * - Map fills ~80% of screen
 * - Route line showing path taken (GPS track)
 * - Current position with direction marker
 * - Minimal info strip: speed, distance, direction, battery
 * - No heavy overlays, no widgets
 *
 * Designed for handlebar mount: large touch targets, high contrast,
 * minimal eye movement required.
 */
import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { useRouteStore } from '../../store/routeStore';
import { MiniMap } from '../Dashboard/MiniMap';

export function NavDashboard() {
  const speed = useBikeStore((s) => s.speed_kmh);
  const battery = useBikeStore((s) => s.battery_percent);
  const tripDist = useBikeStore((s) => s.trip_distance_km || s.distance_km);
  const heading = useMapStore((s) => s.heading);
  const gpsActive = useMapStore((s) => s.gpsActive);
  const nav = useRouteStore((s) => s.navigation);
  const routeActive = nav?.active ?? false;
  const distRemaining = nav?.distanceRemaining_m ?? 0;
  const nextEvent = nav?.distanceToNextEvent_m ?? 0;

  // Compass direction from heading
  const compassDir = (deg: number | null): string => {
    if (deg == null) return '--';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8] ?? 'N';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Map Fullscreen (~82%) ── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <MiniMap />

        {/* GPS status badge — top left */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 px-2 py-1"
             style={{ backgroundColor: 'rgba(14,14,14,0.85)', border: '1px solid var(--ev-outline-variant)' }}>
          <span className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: gpsActive ? 'var(--ev-primary)' : 'var(--ev-error)' }} />
          <span className="text-[9px] font-display font-bold uppercase" style={{ color: gpsActive ? 'var(--ev-primary)' : 'var(--ev-error)' }}>
            {gpsActive ? 'GPS' : 'NO GPS'}
          </span>
        </div>

        {/* Speed overlay — top right, large for quick glance */}
        <div className="absolute top-2 right-2 z-10 px-3 py-1.5"
             style={{ backgroundColor: 'rgba(14,14,14,0.85)', border: '1px solid var(--ev-outline-variant)' }}>
          <div className="flex items-baseline gap-1">
            <span className="font-mono font-bold text-3xl tabular-nums" style={{ color: 'var(--ev-on-surface)' }}>
              {speed > 0 ? speed.toFixed(0) : '0'}
            </span>
            <span className="text-unit" style={{ color: 'var(--ev-on-surface-muted)' }}>KM/H</span>
          </div>
        </div>

        {/* Route info — bottom left (only when navigating) */}
        {routeActive && distRemaining > 0 && (
          <div className="absolute bottom-2 left-2 z-10 px-3 py-2"
               style={{ backgroundColor: 'rgba(14,14,14,0.85)', border: '1px solid var(--ev-outline-variant)', borderLeft: '2px solid var(--ev-primary)' }}>
            <p className="text-eyebrow" style={{ color: 'var(--ev-on-surface-muted)' }}>RESTANTE</p>
            <p className="font-mono font-bold text-lg tabular-nums" style={{ color: 'var(--ev-on-surface)' }}>
              {distRemaining > 1000
                ? `${(distRemaining / 1000).toFixed(1)} km`
                : `${Math.round(distRemaining)} m`}
            </p>
            {nextEvent > 0 && nextEvent < 500 && (
              <p className="text-[9px] mt-1" style={{ color: 'var(--ev-amber)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '10px', verticalAlign: 'middle' }}>turn_right</span>
                {' '}{Math.round(nextEvent)}m
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Info Strip (~18%) — essential navigation data ── */}
      <div style={{
        height: '18%',
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr 1fr',
        gap: '1px',
        backgroundColor: 'var(--ev-outline-subtle)',
      }}>
        {/* Speed */}
        <NavCell label="SPEED" value={speed > 0 ? speed.toFixed(1) : '0'} unit="km/h" color="var(--ev-on-surface)" />

        {/* Distance */}
        <NavCell label="TRIP" value={tripDist.toFixed(1)} unit="km" color="var(--ev-secondary)" />

        {/* Direction */}
        <NavCell label="DIR" value={compassDir(heading)} unit={heading != null ? `${Math.round(heading)}°` : ''} color="var(--ev-tertiary)" />

        {/* Battery */}
        <NavCell
          label="BAT"
          value={String(battery)}
          unit="%"
          color={battery > 30 ? 'var(--ev-primary)' : battery > 15 ? 'var(--ev-amber)' : 'var(--ev-error)'}
        />
      </div>
    </div>
  );
}

function NavCell({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1"
         style={{ backgroundColor: 'var(--ev-surface-low)' }}>
      <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-muted)' }}>{label}</span>
      <div className="flex items-baseline gap-0.5">
        <span className="font-mono font-bold text-xl tabular-nums" style={{ color }}>{value}</span>
        <span className="text-[8px]" style={{ color: 'var(--ev-on-surface-muted)' }}>{unit}</span>
      </div>
    </div>
  );
}
