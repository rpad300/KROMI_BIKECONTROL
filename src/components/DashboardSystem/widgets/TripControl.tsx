import { useEffect, useRef, useState } from 'react';
import { useTripStore } from '../../../store/tripStore';
import { TripSummaryModal } from './TripSummaryModal';
import { subscribeRideTick } from '../../../services/RideTickService';

/** Trip control bar — start/stop + live stats (DOM refs for zero flicker) */
export function TripControl() {
  const state = useTripStore((s) => s.state);
  const startTrip = useTripStore((s) => s.startTrip);
  const stopTrip = useTripStore((s) => s.stopTrip);
  const [showSummary, setShowSummary] = useState(false);

  const timeRef = useRef<HTMLSpanElement>(null);
  const distRef = useRef<HTMLSpanElement>(null);
  const pauseRef = useRef<HTMLSpanElement>(null);
  const avgRef = useRef<HTMLSpanElement>(null);

  // Tick every second (via master RideTickService)
  useEffect(() => {
    return subscribeRideTick(() => useTripStore.getState().tick());
  }, []);

  // Show summary modal when trip finishes
  useEffect(() => {
    if (state === 'finished') {
      setShowSummary(true);
    }
  }, [state]);

  // Update display via refs
  useEffect(() => {
    const unsub = useTripStore.subscribe((s) => {
      const fmt = (secs: number) => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const ss = secs % 60;
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
      };
      if (timeRef.current) timeRef.current.textContent = fmt(s.movingTime);
      if (distRef.current) distRef.current.textContent = `${s.tripKm.toFixed(1)} km`;
      if (pauseRef.current) {
        pauseRef.current.textContent = s.autoPaused ? '⏸ PAUSED' : '';
        pauseRef.current.style.color = '#fbbf24';
      }
      if (avgRef.current) avgRef.current.textContent = s.avgSpeed > 0 ? `${s.avgSpeed.toFixed(1)} avg` : '';
    });
    return unsub;
  }, []);

  // Trip summary modal
  if (showSummary) {
    return <TripSummaryModal onClose={() => setShowSummary(false)} />;
  }

  if (state === 'idle' || state === 'finished') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', backgroundColor: '#131313' }}>
        <button
          onClick={startTrip}
          style={{
            padding: '8px 24px', backgroundColor: '#3fff8b', color: 'black', border: 'none',
            fontFamily: "'Space Grotesk'", fontWeight: 900, fontSize: '13px', textTransform: 'uppercase',
            letterSpacing: '0.05em', cursor: 'pointer',
          }}
        >
          START TRIP
        </button>
      </div>
    );
  }

  // state === 'running'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%', padding: '0 12px', backgroundColor: '#131313', borderTop: '1px solid rgba(63,255,139,0.15)' }}>
      {/* Trip stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#3fff8b' }}>timer</span>
          <span ref={timeRef} className="font-headline font-bold tabular-nums" style={{ fontSize: '16px', color: '#3fff8b' }}>0:00</span>
        </div>
        <span ref={distRef} className="font-headline tabular-nums" style={{ fontSize: '13px', color: '#adaaaa' }}>0.0 km</span>
        <span ref={avgRef} className="font-headline tabular-nums" style={{ fontSize: '11px', color: '#777575' }} />
      </div>

      {/* Pause indicator */}
      <span ref={pauseRef} className="font-label" style={{ fontSize: '10px' }} />

      {/* Stop button */}
      <button
        onClick={stopTrip}
        style={{
          padding: '6px 16px', backgroundColor: '#ff716c', color: 'black', border: 'none',
          fontFamily: "'Space Grotesk'", fontWeight: 900, fontSize: '11px', textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        FINISH
      </button>
    </div>
  );
}
