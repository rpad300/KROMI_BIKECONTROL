import { useEffect, useRef } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { calculateZones } from '../../types/athlete.types';
import { getSavedSensorDevice } from '../../services/bluetooth/BLEBridge';

const ZONE_COLORS = ['#777575', '#adaaaa', '#6e9bff', '#3fff8b', '#fbbf24', '#ff716c'];
const ZONE_BG = ['#494847', '#777575', '#0058ca', '#24f07e', '#d97706', '#d7383b'];

/**
 * HRWidget — updates via direct DOM refs (no React re-render flicker).
 * Subscribes to store outside React cycle for zero-flicker real-time updates.
 */
export function HRWidget() {
  const bpmRef = useRef<HTMLSpanElement>(null);
  const zoneRef = useRef<HTMLSpanElement>(null);
  const pctRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);

  const savedHR = getSavedSensorDevice('hr');
  const hrMax = useSettingsStore((s) => s.riderProfile.hr_max) || 185;
  const zones = calculateZones(hrMax);

  // Direct DOM updates — bypasses React reconciliation entirely
  useEffect(() => {
    const unsub = useBikeStore.subscribe((state) => {
      const bpm = state.hr_bpm;
      const zone = state.hr_zone;
      const color = ZONE_COLORS[zone] ?? '#777575';
      const pct = bpm > 0 ? Math.round((bpm / hrMax) * 100) : 0;

      if (bpmRef.current) {
        bpmRef.current.textContent = bpm > 0 ? String(bpm) : '--';
        bpmRef.current.style.color = color;
      }
      if (zoneRef.current) {
        zoneRef.current.textContent = bpm > 0 ? `Z${zone}` : '--';
        zoneRef.current.style.color = color;
      }
      if (pctRef.current) {
        pctRef.current.textContent = pct > 0 ? `${pct}%` : '';
      }
      if (iconRef.current) {
        iconRef.current.style.color = bpm > 0 ? '#ff716c' : '#494847';
      }
      // Update zone bars
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const zNum = i + 1;
        const active = zone === zNum;
        const past = zone > zNum;
        bar.style.backgroundColor = (active || past) ? (ZONE_BG[zNum] ?? '#494847') : '#262626';
        bar.style.opacity = active ? '1' : past ? '0.3' : '1';
      });
    });
    return unsub;
  }, [hrMax]);

  return (
    <div style={{ backgroundColor: '#201f1f', padding: '10px', borderRadius: '2px', flex: 1, minWidth: 0 }}>
      {/* Header — static, no re-render */}
      <div className="flex items-center gap-1 mb-1">
        <span
          ref={iconRef}
          className="material-symbols-outlined text-xs"
          style={{ color: '#494847', fontVariationSettings: "'FILL' 1" }}
        >favorite</span>
        <span style={{ fontSize: '8px', color: '#777575' }} className="truncate">{savedHR?.name ?? 'Heart Rate'}</span>
      </div>

      {/* BPM + Zone — updated via refs, zero flicker */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-0.5">
          <span ref={bpmRef} className="text-2xl font-black tabular-nums leading-none" style={{ color: '#777575' }}>--</span>
          <span style={{ fontSize: '9px', color: '#777575' }}>bpm</span>
        </div>
        <div className="text-right">
          <span ref={zoneRef} className="text-sm font-black font-headline" style={{ color: '#777575' }}>--</span>
          <div ref={pctRef} style={{ fontSize: '8px', color: '#777575' }} />
        </div>
      </div>

      {/* Zone bar */}
      <div className="flex gap-px h-1.5 mt-1.5">
        {zones.map((_z, i) => (
          <div
            key={i}
            ref={(el) => { barsRef.current[i] = el; }}
            style={{ flex: 1, borderRadius: '1px', backgroundColor: '#262626' }}
          />
        ))}
      </div>
    </div>
  );
}
