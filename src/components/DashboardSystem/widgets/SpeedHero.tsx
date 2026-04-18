import { useEffect, useRef } from 'react';
import { useBikeStore } from '../../../store/bikeStore';
import { useTripStore } from '../../../store/tripStore';

/** Giant speed display — DOM ref based, zero flicker */
export function SpeedHero({ dangerThreshold }: { dangerThreshold?: number }) {
  const spdRef = useRef<HTMLSpanElement>(null);
  const distRef = useRef<HTMLSpanElement>(null);
  const deltaRef = useRef<HTMLSpanElement>(null);
  const prevSpeed = useRef(0);

  useEffect(() => {
    const update = (s: ReturnType<typeof useBikeStore.getState>) => {
      if (spdRef.current) {
        spdRef.current.textContent = s.speed_kmh > 0 ? s.speed_kmh.toFixed(1) : '0.0';
        spdRef.current.style.color = (dangerThreshold && s.speed_kmh > dangerThreshold) ? 'var(--ev-error)' : '#ffffff';
      }
      if (distRef.current) {
        const trip = useTripStore.getState();
        const dist = trip.state === 'running' ? trip.tripKm : (s.trip_distance_km ?? 0);
        distRef.current.textContent = `${dist.toFixed(1)} KM`;
      }
      // Delta pill
      if (deltaRef.current) {
        const delta = s.speed_kmh - prevSpeed.current;
        if (Math.abs(delta) >= 0.5 && s.speed_kmh > 0) {
          const up = delta > 0;
          deltaRef.current.textContent = `${up ? '\u25B2' : '\u25BC'} ${Math.abs(delta).toFixed(1)}`;
          deltaRef.current.className = `delta-pill ${up ? 'delta-pill-up' : 'delta-pill-down'}`;
          deltaRef.current.style.display = 'inline-flex';
        } else {
          deltaRef.current.style.display = 'none';
        }
        prevSpeed.current = s.speed_kmh;
      }
    };
    update(useBikeStore.getState());
    return useBikeStore.subscribe(update);
  }, [dangerThreshold]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: 'var(--ev-bg-hero)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span ref={spdRef} className="font-mono font-black tabular-nums" style={{ fontSize: '82px', lineHeight: 1, letterSpacing: '-0.06em', color: 'white' }}>0.0</span>
        <span className="font-display font-bold" style={{ fontSize: '24px', color: 'var(--ev-primary)' }}>KM/H</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.8 }}>
        <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-variant)' }}>Trip</span>
        <span ref={distRef} className="font-mono font-bold tabular-nums" style={{ fontSize: '18px', color: 'white' }}>0.0 KM</span>
        <span ref={deltaRef} className="delta-pill delta-pill-neutral" style={{ display: 'none' }} />
      </div>
    </div>
  );
}
