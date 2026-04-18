import { useEffect, useRef } from 'react';
import { useBikeStore } from '../../../store/bikeStore';
import { useAutoAssistStore } from '../../../store/autoAssistStore';

type MetricDef = {
  icon: string;
  iconColor: string;
  label: string;
  unit: string;
  getValue: (s: ReturnType<typeof useBikeStore.getState>) => string;
  getColor?: (s: ReturnType<typeof useBikeStore.getState>) => string;
};

/** Flexible n-column metric grid with DOM ref updates */
export function MetricGrid({ metrics, cols }: { metrics: MetricDef[]; cols: number }) {
  const refs = useRef<{ val: HTMLSpanElement | null; col: HTMLSpanElement | null }[]>([]);

  useEffect(() => {
    const update = (s: ReturnType<typeof useBikeStore.getState>) => {
      metrics.forEach((m, i) => {
        const r = refs.current[i];
        if (r?.val) {
          r.val.textContent = m.getValue(s);
          if (m.getColor) r.val.style.color = m.getColor(s);
        }
      });
    };
    update(useBikeStore.getState());
    const unsub1 = useBikeStore.subscribe(update);
    // Also subscribe to autoAssistStore for gradient/terrain updates
    const unsub2 = useAutoAssistStore.subscribe(() => update(useBikeStore.getState()));
    return () => { unsub1(); unsub2(); };
  }, [metrics]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, height: '100%', borderTop: '1px solid rgba(73,72,71,0.2)', borderBottom: '1px solid rgba(73,72,71,0.2)' }}>
      {metrics.map((m, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: i % 2 === 0 ? '#131313' : '#1a1919', borderRight: i < metrics.length - 1 ? '1px solid rgba(73,72,71,0.1)' : 'none' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: m.iconColor, marginBottom: '2px' }}>{m.icon}</span>
          <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-variant)' }}>{m.label}</span>
          <span
            ref={(el) => { if (!refs.current[i]) refs.current[i] = { val: null, col: null }; refs.current[i]!.val = el; }}
            className="font-mono font-bold tabular-nums"
            style={{ fontSize: '18px', lineHeight: 1.1 }}
          >--</span>
          <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-muted)' }}>{m.unit}</span>
        </div>
      ))}
    </div>
  );
}

// Pre-defined metric configs for reuse
export const METRIC = {
  speed: { icon: 'speed', iconColor: '#3fff8b', label: 'Speed', unit: 'km/h', getValue: (s: ReturnType<typeof useBikeStore.getState>) => s.speed_kmh > 0 ? s.speed_kmh.toFixed(1) : '0' },
  power: { icon: 'bolt', iconColor: '#6e9bff', label: 'Power', unit: 'W', getValue: (s: ReturnType<typeof useBikeStore.getState>) => String(s.power_watts) },
  battery: { icon: 'battery_5_bar', iconColor: '#3fff8b', label: 'Battery', unit: '%', getValue: (s: ReturnType<typeof useBikeStore.getState>) => String(s.battery_percent) },
  cadence: { icon: 'speed', iconColor: '#e966ff', label: 'Cadence', unit: 'RPM', getValue: (s: ReturnType<typeof useBikeStore.getState>) => String(s.cadence_rpm) },
  torque: { icon: 'electric_bolt', iconColor: '#fbbf24', label: 'Torque', unit: 'Nm', getValue: (s: ReturnType<typeof useBikeStore.getState>) => s.torque_nm > 0 ? s.torque_nm.toFixed(1) : '0' },
  range: {
    icon: 'route', iconColor: '#3fff8b', label: 'Range', unit: 'km',
    getValue: (s: ReturnType<typeof useBikeStore.getState>) => {
      // When KROMI Intelligence active (mode 5), motor reports POWER range
      // which is misleadingly low. Use weighted average of mode ranges instead.
      if (s.assist_mode === 5 && s.range_per_mode) {
        const rpm = s.range_per_mode as Record<string, number>;
        const a = rpm.active ?? 0, sp = rpm.sport ?? 0, p = rpm.power ?? 0;
        if (a > 0 && sp > 0 && p > 0) {
          return `~${Math.round(a * 0.3 + sp * 0.4 + p * 0.3)}`;
        }
      }
      if (s.range_km < 0) return '255+';
      return s.range_km > 0 ? `~${Math.round(s.range_km)}` : '--';
    },
  },
  current: { icon: 'electric_bolt', iconColor: '#fbbf24', label: 'Current', unit: 'A', getValue: (s: ReturnType<typeof useBikeStore.getState>) => s.assist_current_a > 0 ? s.assist_current_a.toFixed(1) : '0' },
  whkm: { icon: 'ev_station', iconColor: '#6e9bff', label: 'Wh/km', unit: '', getValue: () => '--' }, // placeholder, needs calibration data
  hr: { icon: 'favorite', iconColor: '#ff716c', label: 'HR', unit: 'bpm', getValue: (s: ReturnType<typeof useBikeStore.getState>) => s.hr_bpm > 0 ? String(s.hr_bpm) : '--' },
  gradient: {
    icon: 'landscape', iconColor: '#e966ff', label: 'Grade', unit: '',
    getValue: () => {
      const terrain = useAutoAssistStore.getState().terrain;
      const g = terrain?.current_gradient_pct ?? 0;
      return g === 0 ? '0%' : `${g > 0 ? '+' : ''}${g.toFixed(1)}%`;
    },
    getColor: () => {
      const terrain = useAutoAssistStore.getState().terrain;
      const g = terrain?.current_gradient_pct ?? 0;
      if (g > 10) return '#ff716c';
      if (g > 5) return '#fbbf24';
      if (g > 0) return '#3fff8b';
      if (g < -5) return '#6e9bff';
      return '#adaaaa';
    },
  },
  altitude: { icon: 'landscape', iconColor: '#6e9bff', label: 'Alt', unit: 'm', getValue: () => '--' }, // needs mapStore
  gear: {
    icon: 'settings', iconColor: '#6e9bff', label: 'Gear', unit: '',
    getValue: (s: ReturnType<typeof useBikeStore.getState>) => {
      const g = s.gear || s.rear_gear;
      return g > 0 ? `${g}/${s.total_gears}` : '--';
    },
  },
  terrain: {
    icon: 'terrain', iconColor: '#fbbf24', label: 'Terrain', unit: '',
    getValue: () => {
      const t = useAutoAssistStore.getState().autoDetectedTerrain;
      return t ? t.toUpperCase() : '--';
    },
    getColor: () => {
      const t = useAutoAssistStore.getState().autoDetectedTerrain;
      if (t === 'paved') return '#ffffff';
      if (t === 'gravel') return '#adaaaa';
      if (t === 'dirt') return '#fbbf24';
      if (t === 'technical') return '#ff716c';
      return '#adaaaa';
    },
  },
} as const;
