/**
 * Refined v2 Desktop Live View — Hero Dashboard
 *
 * Replaces the mini phone preview with a full-width hero dashboard:
 * - Speed 120px JetBrains Mono
 * - Power + Battery cards with progress bars
 * - 6-metric grid (cadence, torque, HR, elev, grade, kcal)
 * - Assist mode strip (outlined)
 * - Full-width elevation profile
 *
 * All data from Zustand stores — no fake data.
 */
import { useRef, useEffect } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { AssistMode } from '../../types/bike.types';
import { ElevationProfile } from '../Dashboard/ElevationProfile';
import { DashboardBuilder } from './DashboardBuilder';
import { WidgetLibrary } from './WidgetLibrary';
import { HistoricalRangeWidget } from './HistoricalRangeWidget';

export function DesktopLiveViewRefined({ activeTab }: { activeTab?: string }) {
  const tab = activeTab ?? 'preview';

  return (
    <div>
      {tab === 'preview' && <HeroDashboard />}
      {tab === 'builder' && <DashboardBuilder />}
      {tab === 'range' && <HistoricalRangeWidget />}
      {tab === 'widgets' && <WidgetLibrary />}
    </div>
  );
}

function HeroDashboard() {
  const speed = useBikeStore((s) => s.speed_kmh);
  const power = useBikeStore((s) => s.power_watts);
  const battery = useBikeStore((s) => s.battery_percent);
  const cadence = useBikeStore((s) => s.cadence_rpm);
  const torque = useBikeStore((s) => s.torque_nm);
  const hrBpm = useBikeStore((s) => s.hr_bpm);
  const altitude = useMapStore((s) => s.altitude) ?? 0;
  const gradient = useAutoAssistStore((s) => s.terrain?.current_gradient_pct ?? 0);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const rearGear = useBikeStore((s) => s.rear_gear);
  const range = useBikeStore((s) => s.range_km);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);
  const tripDist = useBikeStore((s) => s.trip_distance_km || s.distance_km);
  const tripTime = useBikeStore((s) => s.trip_time_s || 0);
  const bleStatus = useBikeStore((s) => s.ble_status);

  // Speed delta
  const prevSpeedRef = useRef(0);
  const delta = speed - prevSpeedRef.current;
  useEffect(() => { prevSpeedRef.current = speed; }, [speed]);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };

  // KROMI range fix (same as mobile dashboard)
  let displayRange = range;
  if (assistMode === AssistMode.POWER && rangePerMode) {
    const rpm = rangePerMode as Record<string, number>;
    const a = rpm.active ?? 0;
    const s = rpm.sport ?? 0;
    const p = rpm.power ?? 0;
    if (a > 0 && s > 0 && p > 0) {
      displayRange = Math.round(a * 0.3 + s * 0.4 + p * 0.3);
    }
  }
  const formatRange = (r: number) => r < 0 ? '255+' : String(Math.round(r));

  const connected = bleStatus === 'connected';

  return (
    <div className="space-y-4">
      {/* ── Connection status ── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: connected ? 'var(--ev-primary)' : 'var(--ev-error)' }} />
          <span className="font-display text-xs font-bold uppercase" style={{ color: connected ? 'var(--ev-primary)' : 'var(--ev-error)' }}>
            {connected ? 'Bike ligada' : 'Desligada'}
          </span>
        </div>
        <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-muted)' }}>
          VOLTA LIVE
        </span>
      </div>

      {/* ── Speed Hero + Power/Battery cards ── */}
      <div className="flex gap-4 items-stretch">
        {/* Speed — hero */}
        <div className="flex-1 flex flex-col items-center justify-center py-6"
             style={{ backgroundColor: 'var(--ev-bg-hero)' }}>
          <div className="flex items-baseline gap-3">
            <span className="font-mono font-bold tabular-nums" style={{ fontSize: '120px', lineHeight: 1, letterSpacing: '-0.06em', color: 'var(--ev-on-surface)' }}>
              {speed > 0 ? speed.toFixed(1) : '0.0'}
            </span>
            <span className="font-display font-bold text-3xl" style={{ color: 'var(--ev-primary)' }}>KM/H</span>
          </div>
          {/* Delta pill */}
          <div className="flex items-center gap-4 mt-2">
            {Math.abs(delta) > 0.3 && (
              <span className={delta > 0 ? 'delta-pill delta-pill-up' : 'delta-pill delta-pill-down'}>
                {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
              </span>
            )}
            <span className="font-mono text-sm tabular-nums" style={{ color: 'var(--ev-on-surface-variant)' }}>
              {tripDist.toFixed(2)} km · {formatTime(tripTime)}
            </span>
          </div>
        </div>

        {/* Power + Battery cards */}
        <div className="flex flex-col gap-3" style={{ width: '200px' }}>
          {/* Power card */}
          <div className="flex-1 p-4" style={{ backgroundColor: 'var(--ev-surface-low)', borderLeft: '3px solid var(--ev-secondary)' }}>
            <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-muted)' }}>POWER</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-mono font-bold text-4xl tabular-nums" style={{ color: 'var(--ev-on-surface)' }}>{power}</span>
              <span className="text-unit" style={{ color: 'var(--ev-on-surface-muted)' }}>W</span>
            </div>
            {/* Power bar */}
            <div className="h-1.5 mt-3 rounded-full" style={{ backgroundColor: 'var(--ev-surface-bright)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, power / 5)}%`, backgroundColor: 'var(--ev-secondary)' }} />
            </div>
          </div>

          {/* Battery card */}
          <div className="flex-1 p-4" style={{ backgroundColor: 'var(--ev-surface-low)', borderLeft: `3px solid ${battery > 30 ? 'var(--ev-primary)' : battery > 15 ? 'var(--ev-amber)' : 'var(--ev-error)'}` }}>
            <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-muted)' }}>BATTERY</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-mono font-bold text-4xl tabular-nums" style={{ color: 'var(--ev-on-surface)' }}>{battery}</span>
              <span className="text-unit" style={{ color: 'var(--ev-on-surface-muted)' }}>%</span>
            </div>
            {/* Battery bar */}
            <div className="h-1.5 mt-3 rounded-full" style={{ backgroundColor: 'var(--ev-surface-bright)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${battery}%`, backgroundColor: battery > 30 ? 'var(--ev-primary)' : battery > 15 ? 'var(--ev-amber)' : 'var(--ev-error)' }} />
            </div>
            {displayRange > 0 && (
              <p className="text-xs mt-2 font-mono tabular-nums" style={{ color: 'var(--ev-on-surface-muted)' }}>
                ~{formatRange(displayRange)} km
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── 6-Metric Grid ── */}
      <div className="grid grid-cols-6 gap-px" style={{ backgroundColor: 'var(--ev-outline-subtle)' }}>
        <MetricCell label="CADENCE" value={String(cadence)} unit="RPM" color="var(--ev-tertiary)" />
        <MetricCell label="TORQUE" value={torque > 0 ? torque.toFixed(1) : '0'} unit="Nm" color="var(--ev-amber)" />
        <MetricCell label="HR" value={hrBpm > 0 ? String(hrBpm) : '--'} unit="BPM" color="var(--ev-error)" />
        <MetricCell label="ELEVATION" value={String(Math.round(altitude))} unit="m" color="var(--ev-tertiary)" />
        <MetricCell label="GRADE" value={`${gradient > 0 ? '+' : ''}${gradient.toFixed(0)}`} unit="%" color={gradient > 8 ? 'var(--ev-error)' : gradient > 3 ? 'var(--ev-amber)' : 'var(--ev-primary)'} />
        <MetricCell label="GEAR" value={rearGear > 0 ? String(rearGear) : '--'} unit="" color="var(--ev-on-surface-variant)" />
      </div>

      {/* ── Assist Mode Strip (outlined) ── */}
      <AssistStrip assistMode={assistMode} rangePerMode={rangePerMode} />

      {/* ── Elevation Profile (full width) ── */}
      <div className="h-32" style={{ backgroundColor: 'var(--ev-surface-low)' }}>
        <ElevationProfile />
      </div>
    </div>
  );
}

function MetricCell({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-4 gap-1" style={{ backgroundColor: 'var(--ev-surface-low)' }}>
      <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-muted)' }}>{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="font-mono font-bold text-2xl tabular-nums" style={{ color }}>{value}</span>
        {unit && <span className="text-unit" style={{ color: 'var(--ev-on-surface-muted)' }}>{unit}</span>}
      </div>
    </div>
  );
}

function AssistStrip({ assistMode, rangePerMode }: { assistMode: number; rangePerMode: any }) {
  const modes = [
    { mode: AssistMode.ECO, label: 'ECO', key: 'eco' },
    { mode: AssistMode.TOUR, label: 'TOUR', key: 'tour' },
    { mode: AssistMode.ACTIVE, label: 'ACTV', key: 'active' },
    { mode: AssistMode.SPORT, label: 'SPRT', key: 'sport' },
    { mode: AssistMode.POWER, label: 'KROMI', key: 'power' },
    { mode: AssistMode.SMART, label: 'AUTO', key: 'smart' },
  ];

  return (
    <div className="flex gap-2">
      {modes.map(({ mode, label, key }) => {
        const active = assistMode === mode;
        const range = rangePerMode ? (rangePerMode as Record<string, number>)[key] : 0;
        return (
          <button
            key={mode}
            className="flex-1 py-3 flex flex-col items-center gap-1 font-display font-bold text-xs uppercase tracking-wider transition-all active:scale-95"
            style={{
              border: `1px solid ${active ? 'var(--ev-primary)' : 'var(--ev-outline-variant)'}`,
              color: active ? 'var(--ev-primary)' : 'var(--ev-on-surface-variant)',
              backgroundColor: active ? 'var(--ev-primary-glow)' : 'transparent',
              boxShadow: active ? '0 0 20px var(--ev-primary-shadow)' : 'none',
            }}
          >
            <span>{label}</span>
            {(range ?? 0) > 0 && (
              <span className="font-mono text-[10px] tabular-nums" style={{ color: active ? 'var(--ev-primary)' : 'var(--ev-on-surface-muted)', opacity: 0.7 }}>
                {(range ?? 0) < 0 ? '255+' : range}km
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
