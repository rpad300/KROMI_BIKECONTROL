import { useEffect, useRef } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { kromiEngine } from '../../services/intelligence/KromiEngine';

/**
 * IntelligenceStatusBar — compact status bar showing engine state.
 * Mode (GPX/DISCOVERY/HYBRID), lookahead distance, battery budget, motor connection.
 * Single line, 12px text. Positioned in the info strip area.
 * Uses DOM refs for zero-flicker updates.
 */
export function IntelligenceStatusBar() {
  const modeRef = useRef<HTMLSpanElement>(null);
  const lookaheadRef = useRef<HTMLSpanElement>(null);
  const batteryRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = () => {
      const lookahead = kromiEngine.getCachedLookahead();
      const battery = kromiEngine.getCachedBattery();
      const ble = useBikeStore.getState().ble_status;

      // Mode
      if (modeRef.current) {
        const mode = lookahead?.mode?.toUpperCase() ?? 'STANDBY';
        modeRef.current.textContent = mode;
      }

      // Lookahead distance
      if (lookaheadRef.current) {
        if (lookahead?.route_remaining_km != null && lookahead.route_remaining_km > 0) {
          const km = lookahead.route_remaining_km;
          lookaheadRef.current.textContent = km >= 1 ? `${km.toFixed(1)}km` : `${(km * 1000).toFixed(0)}m`;
        } else {
          lookaheadRef.current.textContent = '--';
        }
      }

      // Battery budget
      if (batteryRef.current) {
        if (!battery) {
          batteryRef.current.textContent = '--';
          batteryRef.current.style.color = '#777575';
        } else if (battery.is_emergency) {
          batteryRef.current.textContent = 'LIMP';
          batteryRef.current.style.color = '#ff716c';
        } else if (battery.constraint_factor < 0.8) {
          batteryRef.current.textContent = 'LIMIT';
          batteryRef.current.style.color = '#fbbf24';
        } else {
          batteryRef.current.textContent = 'OK';
          batteryRef.current.style.color = '#3fff8b';
        }
      }

      // Motor dot
      if (dotRef.current) {
        dotRef.current.style.backgroundColor = ble === 'connected' ? '#3fff8b' : '#ff716c';
      }
    };

    update();
    // Poll every 2s (engine ticks at ~1s, this is cheap)
    const interval = setInterval(update, 2000);
    const unsub = useBikeStore.subscribe(update);
    return () => { clearInterval(interval); unsub(); };
  }, []);

  return (
    <div className="flex items-center justify-between px-3 py-1 bg-[#0e0e0e] border-t border-[#494847]/10">
      {/* Mode */}
      <div className="flex items-center gap-1">
        <span className="material-symbols-outlined text-[#6e9bff]" style={{ fontSize: '10px' }}>
          auto_awesome
        </span>
        <span ref={modeRef} className="text-[10px] font-label font-bold text-[#6e9bff] uppercase tracking-wider">
          STANDBY
        </span>
      </div>

      {/* Lookahead */}
      <div className="flex items-center gap-1">
        <span className="material-symbols-outlined text-[#e966ff]" style={{ fontSize: '10px' }}>
          north_east
        </span>
        <span ref={lookaheadRef} className="text-[10px] font-headline font-bold tabular-nums text-[#adaaaa]">
          --
        </span>
      </div>

      {/* Battery budget */}
      <div className="flex items-center gap-1">
        <span className="material-symbols-outlined text-[#3fff8b]" style={{ fontSize: '10px', fontVariationSettings: "'FILL' 1" }}>
          battery_horiz_075
        </span>
        <span ref={batteryRef} className="text-[10px] font-label font-bold tabular-nums text-[#777575]">
          --
        </span>
      </div>

      {/* Motor connection dot */}
      <div className="flex items-center gap-1">
        <span
          ref={dotRef}
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: '#ff716c' }}
        />
        <span className="text-[10px] font-label text-[#777575]">MTR</span>
      </div>
    </div>
  );
}
