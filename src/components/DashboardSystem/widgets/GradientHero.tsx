import { useEffect, useRef } from 'react';
import { useAutoAssistStore } from '../../../store/autoAssistStore';
import { useBikeStore } from '../../../store/bikeStore';


/** Giant gradient display for CLIMB dashboard */
export function GradientHero() {
  const gradRef = useRef<HTMLSpanElement>(null);
  const typeRef = useRef<HTMLSpanElement>(null);
  const elevRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const unsub = useAutoAssistStore.subscribe((s) => {
      const grad = s.terrain?.current_gradient_pct ?? 0;
      if (gradRef.current) {
        gradRef.current.textContent = `${grad > 0 ? '+' : ''}${grad.toFixed(0)}`;
        gradRef.current.style.color = grad > 12 ? '#ff716c' : grad > 8 ? '#fbbf24' : '#3fff8b';
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = useBikeStore.subscribe((s) => {
      if (elevRef.current) elevRef.current.textContent = `D+ ${s.elevation_gain_m}m`;
    });
    return unsub;
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: 'black' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span ref={gradRef} className="font-headline font-black tabular-nums" style={{ fontSize: '64px', lineHeight: 1, letterSpacing: '-0.03em', color: '#3fff8b' }}>0</span>
        <span className="font-headline font-bold" style={{ fontSize: '24px', color: '#adaaaa' }}>%</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span ref={typeRef} className="font-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#fbbf24' }}>Climb</span>
        <span ref={elevRef} className="font-headline tabular-nums" style={{ fontSize: '14px', color: '#adaaaa' }}>D+ 0m</span>
      </div>
    </div>
  );
}
