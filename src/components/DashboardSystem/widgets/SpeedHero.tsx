import { useEffect, useRef } from 'react';
import { useBikeStore } from '../../../store/bikeStore';

/** Giant speed display — DOM ref based, zero flicker */
export function SpeedHero({ dangerThreshold }: { dangerThreshold?: number }) {
  const spdRef = useRef<HTMLSpanElement>(null);
  const distRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = (s: ReturnType<typeof useBikeStore.getState>) => {
      if (spdRef.current) {
        spdRef.current.textContent = s.speed_kmh > 0 ? s.speed_kmh.toFixed(1) : '0.0';
        spdRef.current.style.color = (dangerThreshold && s.speed_kmh > dangerThreshold) ? '#ff716c' : '#ffffff';
      }
      if (distRef.current) {
        const dist = s.trip_distance_km || s.distance_km;
        distRef.current.textContent = `${dist.toFixed(1)} KM`;
      }
    };
    update(useBikeStore.getState());
    return useBikeStore.subscribe(update);
  }, [dangerThreshold]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: 'black' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span ref={spdRef} className="font-headline font-black tabular-nums" style={{ fontSize: '72px', lineHeight: 1, letterSpacing: '-0.03em', color: 'white' }}>0.0</span>
        <span className="font-headline font-bold" style={{ fontSize: '24px', color: '#3fff8b' }}>KM/H</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.8 }}>
        <span className="font-label" style={{ fontSize: '11px', color: '#adaaaa', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Trip</span>
        <span ref={distRef} className="font-headline font-bold tabular-nums" style={{ fontSize: '18px', color: 'white' }}>0.0 KM</span>
      </div>
    </div>
  );
}
