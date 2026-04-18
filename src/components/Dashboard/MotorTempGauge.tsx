import { useEffect, useRef } from 'react';
import { useBikeStore } from '../../store/bikeStore';

/**
 * MotorTempGauge — compact temperature indicator.
 * Green <60C, Amber 60-70C, Red >70C.
 * Shows throttle factor if <1.0 (thermal limiting).
 * Uses DOM refs for zero-flicker updates matching InfoStrip pattern.
 */
export function MotorTempGauge() {
  const tempRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = (s: ReturnType<typeof useBikeStore.getState>) => {
      const temp = s.temperature_c;
      if (temp <= 0) {
        if (tempRef.current) { tempRef.current.textContent = '--'; tempRef.current.style.color = '#777575'; }
        if (iconRef.current) iconRef.current.style.color = '#494847';
        if (labelRef.current) labelRef.current.textContent = 'TEMP';
        return;
      }

      const color = temp > 70 ? '#ff716c' : temp > 60 ? '#fbbf24' : '#3fff8b';
      if (tempRef.current) { tempRef.current.textContent = `${temp.toFixed(0)}`; tempRef.current.style.color = color; }
      if (iconRef.current) iconRef.current.style.color = color;
      if (labelRef.current) {
        labelRef.current.textContent = temp > 70 ? 'HOT' : temp > 60 ? 'WARM' : '\u00B0C';
      }
    };

    update(useBikeStore.getState());
    const unsub = useBikeStore.subscribe(update);
    return unsub;
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <span
        ref={iconRef}
        className="material-symbols-outlined"
        style={{ fontSize: '14px', color: '#494847' }}
      >
        thermostat
      </span>
      <span
        ref={tempRef}
        className="font-headline font-bold tabular-nums"
        style={{ fontSize: '16px', color: '#777575' }}
      >
        --
      </span>
      <span
        ref={labelRef}
        style={{ fontSize: '8px', color: '#777575' }}
      >
        TEMP
      </span>
    </div>
  );
}
