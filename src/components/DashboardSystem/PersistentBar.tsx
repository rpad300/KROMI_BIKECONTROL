import { useEffect, useRef, useState, useCallback } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { ASSIST_MODE_LABELS } from '../../types/bike.types';
import { getShareUrl } from '../../services/tracking/LiveTrackingService';

const ZONE_COLORS = ['#777575', '#adaaaa', '#6e9bff', '#3fff8b', '#fbbf24', '#ff716c'];

/**
 * PersistentBar — always visible on ALL dashboards.
 * HR | Dual Battery | Assist Mode | KROMI status
 * Uses DOM refs for zero-flicker real-time updates.
 */
export function PersistentBar() {
  const hrRef = useRef<HTMLSpanElement>(null);
  const hrIconRef = useRef<HTMLSpanElement>(null);
  const zoneRef = useRef<HTMLSpanElement>(null);
  const bat1Ref = useRef<HTMLDivElement>(null);
  const bat1PctRef = useRef<HTMLSpanElement>(null);
  const bat2Ref = useRef<HTMLDivElement>(null);
  const bat2PctRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef<HTMLSpanElement>(null);
  const kromiRef = useRef<HTMLSpanElement>(null);
  const kromiDotRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Check for share URL periodically
  useEffect(() => {
    const check = () => setShareUrl(getShareUrl());
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);

  const handleShareLive = useCallback(() => {
    const url = getShareUrl();
    if (url && navigator.share) {
      navigator.share({ title: 'KROMI Live', url }).catch(() => {});
    } else if (url) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  }, []);

  // Clock tick — update every 30s
  useEffect(() => {
    const updateClock = () => {
      if (clockRef.current) {
        clockRef.current.textContent = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      }
    };
    updateClock();
    const id = setInterval(updateClock, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const update = (s: ReturnType<typeof useBikeStore.getState>) => {
      const zoneColor = ZONE_COLORS[s.hr_zone] ?? '#777575';
      const batColor = (v: number) => v > 30 ? '#3fff8b' : v > 15 ? '#fbbf24' : '#ff716c';

      if (hrRef.current) { hrRef.current.textContent = s.hr_bpm > 0 ? String(s.hr_bpm) : '--'; hrRef.current.style.color = zoneColor; }
      if (hrIconRef.current) hrIconRef.current.style.color = s.hr_bpm > 0 ? '#ff716c' : '#494847';
      if (zoneRef.current) { zoneRef.current.textContent = s.hr_bpm > 0 ? `Z${s.hr_zone}` : ''; zoneRef.current.style.backgroundColor = s.hr_bpm > 0 ? zoneColor : 'transparent'; }
      if (bat1Ref.current) { bat1Ref.current.style.width = `${s.battery_main_pct}%`; bat1Ref.current.style.backgroundColor = batColor(s.battery_main_pct); }
      if (bat1PctRef.current) bat1PctRef.current.textContent = `${s.battery_main_pct || s.battery_percent}%`;
      if (bat2Ref.current) { bat2Ref.current.style.width = `${s.battery_sub_pct}%`; bat2Ref.current.style.backgroundColor = batColor(s.battery_sub_pct); }
      if (bat2PctRef.current) bat2PctRef.current.textContent = s.battery_sub_pct > 0 ? `${s.battery_sub_pct}%` : '';
      if (modeRef.current) { const label = ASSIST_MODE_LABELS[s.assist_mode] ?? '?'; modeRef.current.textContent = label; }
    };

    update(useBikeStore.getState());
    const unsub = useBikeStore.subscribe(update);
    return unsub;
  }, []);

  // KROMI status from auto-assist store
  useEffect(() => {
    const unsub = useAutoAssistStore.subscribe((s) => {
      if (kromiRef.current) {
        kromiRef.current.textContent = s.enabled ? (s.lastDecision?.reason?.slice(0, 12) ?? 'ON') : 'OFF';
        kromiRef.current.style.color = s.enabled ? '#3fff8b' : '#777575';
      }
      if (kromiDotRef.current) {
        kromiDotRef.current.style.backgroundColor = s.enabled ? '#3fff8b' : '#494847';
      }
    });
    return unsub;
  }, []);

  return (
    <div className="persistent-bar" style={{ height: '32px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', backgroundColor: 'var(--ev-surface-low)', borderBottom: '1px solid var(--ev-outline-subtle)', gap: '6px' }}>
      {/* Clock — replaces Android status bar time */}
      <span ref={clockRef} className="font-mono tabular-nums" style={{ fontSize: '11px', color: 'var(--ev-on-surface-variant)', letterSpacing: '-0.02em' }}>
        --:--
      </span>
      {/* HR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span ref={hrIconRef} className="material-symbols-outlined" style={{ fontSize: '12px', color: 'var(--ev-outline-variant)', fontVariationSettings: "'FILL' 1" }}>favorite</span>
        <span ref={hrRef} className="font-mono font-bold tabular-nums" style={{ fontSize: '13px', color: 'var(--ev-on-surface-muted)' }}>--</span>
        <span ref={zoneRef} className="font-headline font-bold" style={{ fontSize: '9px', color: 'black', padding: '0 3px', borderRadius: '2px' }} />
      </div>

      {/* Dual battery */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, maxWidth: '120px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ height: '4px', backgroundColor: 'var(--ev-surface-highest)', overflow: 'hidden' }}>
            <div ref={bat1Ref} style={{ height: '100%', width: '0%', backgroundColor: 'var(--ev-primary)' }} />
          </div>
          <div style={{ height: '4px', backgroundColor: 'var(--ev-surface-highest)', overflow: 'hidden' }}>
            <div ref={bat2Ref} style={{ height: '100%', width: '0%', backgroundColor: 'var(--ev-primary)' }} />
          </div>
        </div>
        <span ref={bat1PctRef} className="font-mono tabular-nums" style={{ fontSize: '9px', color: 'var(--ev-on-surface-variant)' }}>--%</span>
        <span ref={bat2PctRef} className="font-mono tabular-nums" style={{ fontSize: '9px', color: 'var(--ev-on-surface-muted)' }} />
      </div>

      {/* Assist mode pill */}
      <div style={{ backgroundColor: 'var(--ev-primary)', padding: '2px 8px', borderRadius: '2px' }}>
        <span ref={modeRef} className="font-display font-black" style={{ fontSize: '10px', color: 'black', letterSpacing: '0.05em' }}>--</span>
      </div>

      {/* KROMI status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <div ref={kromiDotRef} style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--ev-outline-variant)' }} />
        <span ref={kromiRef} className="text-label-sm" style={{ color: 'var(--ev-on-surface-muted)' }}>OFF</span>
      </div>

      {/* Live share button */}
      {shareUrl && (
        <button
          onClick={handleShareLive}
          style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          title="Partilhar live tracking"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#555' }}>share</span>
        </button>
      )}
    </div>
  );
}
