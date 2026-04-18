import { useState, useEffect, useRef } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { AssistMode } from '../../types/bike.types';
import { MiniMap } from './MiniMap';
import { ElevationProfile } from './ElevationProfile';
import { WeatherWidget } from './WeatherWidget';
import { TrailWidget } from './TrailWidget';
import { IntelligenceWidget } from './IntelligenceWidget';
import { AutoAssistWidget } from './AutoAssistWidget';
import { BatteryWidget } from './BatteryWidget';
import { HRWidget } from './HRWidget';
import { RideSessionWidget } from './RideSessionWidget';
import { NutritionWidget } from './NutritionWidget';
import { WPrimeWidget } from './WPrimeWidget';
import { LightRadarWidget } from './LightRadarWidget';
import { DeviceBatteryPanel } from './DeviceBatteryPanel';
import { RadarPanel } from './RadarPanel';
import { LightsPanel } from './LightsPanel';
import { useNutritionStore } from '../../store/nutritionStore';
import { kromiEngine } from '../../services/intelligence/KromiEngine';
import { usePermission } from '../../hooks/usePermission';
import { GearSuggestionOverlay } from './GearSuggestionOverlay';
import { TerrainBadge } from './TerrainBadge';
import { MotorTempGauge } from './MotorTempGauge';
import { NutritionQuickTap } from './NutritionQuickTap';
import { ClimbLearningIndicator } from './ClimbLearningIndicator';
import { IntelligenceStatusBar } from './IntelligenceStatusBar';

/**
 * STEALTH-EV Dashboard v2 (Refined)
 *
 * Changes from v1:
 * - Speed hero: JetBrains Mono 82px + delta pill + trip distance
 * - Map chips: chip-map class (hairline, no backdrop-blur)
 * - Metrics: font-mono tabular-nums + text-eyebrow labels
 * - Assist bar: outlined style (not filled green) + range per mode + pulse dot
 * - Info strip: 4 cells (Time, Altitude, Gradient, Range) + MotorTempGauge
 * - Range: -1/overflow shown as "255+"
 * - IntelligenceStatusBar above elevation
 * - Design tokens: var(--ev-*) from design-tokens.css
 */
export function DashboardRefined() {
  const [expanded, setExpanded] = useState(false);
  const autoAssistEnabled = useAutoAssistStore((s) => s.enabled);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--ev-bg)' }}>
      <TopBar />

      {/* Floating overlays (auto-show/hide) */}
      <GearSuggestionOverlay />
      <ClimbLearningIndicator />

      {!expanded ? (
        /* === RIDE VIEW (default, no scroll) === */
        <main className="flex-1 flex flex-col min-h-0">
          <SpeedSection />
          <MapSection />
          <MetricsRow />
          <AssistBar />
          <InfoStrip />
          <IntelligenceStatusBar />
          <NutritionAlertStrip />
          <ElevationSection />
          {/* Expand button */}
          <button
            onClick={() => setExpanded(true)}
            className="flex-none h-8 flex items-center justify-center gap-1"
            style={{
              backgroundColor: 'var(--ev-surface-container)',
              borderTop: '1px solid var(--ev-outline-subtle)',
            }}
          >
            <span className="material-symbols-outlined text-sm" style={{ color: 'var(--ev-on-surface-muted)' }}>expand_less</span>
            <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-muted)' }}>More</span>
          </button>
        </main>
      ) : (
        /* === EXPANDED VIEW (tabbed panels) === */
        <ExpandedView onCollapse={() => setExpanded(false)} autoAssistEnabled={autoAssistEnabled} />
      )}
    </div>
  );
}

/** Expanded view with tabbed panels */
function ExpandedView({ onCollapse, autoAssistEnabled }: { onCollapse: () => void; autoAssistEnabled: boolean }) {
  const canSeeIntelligence = usePermission('features.intelligence_v2');
  const canSeeNutrition = usePermission('features.nutrition_tracking');
  const [activeTab, setActiveTab] = useState<'ride' | 'lights' | 'radar' | 'battery'>('ride');
  const radarConnected = useBikeStore((s) => s.ble_services.radar);
  const lightConnected = useBikeStore((s) => s.ble_services.light);

  const tabs = [
    { id: 'ride' as const, label: 'Ride', icon: 'pedal_bike' },
    ...(lightConnected ? [{ id: 'lights' as const, label: 'Luzes', icon: 'flashlight_on' }] : []),
    ...(radarConnected ? [{ id: 'radar' as const, label: 'Radar', icon: 'radar' }] : []),
    { id: 'battery' as const, label: 'Baterias', icon: 'battery_full' },
  ];

  return (
    <main className="flex-1 min-h-0 flex flex-col">
      {/* Tab bar + collapse */}
      <div className="flex-none flex items-center" style={{
        backgroundColor: 'var(--ev-surface-low)',
        borderBottom: '1px solid var(--ev-outline-subtle)',
      }}>
        <button onClick={onCollapse} className="h-10 px-3 flex items-center gap-1">
          <span className="material-symbols-outlined text-sm" style={{ color: 'var(--ev-on-surface-muted)' }}>expand_more</span>
        </button>

        <div className="flex-1 flex items-center justify-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-2 text-eyebrow transition-colors"
              style={{
                color: activeTab === tab.id ? 'var(--ev-primary)' : 'var(--ev-on-surface-muted)',
                borderBottom: activeTab === tab.id ? '2px solid var(--ev-primary)' : '2px solid transparent',
              }}
            >
              <span className="material-symbols-outlined text-sm">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="w-10" /> {/* Balance spacing */}
      </div>

      {/* Panel content (scrollable) */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 p-3 pb-4">
          {activeTab === 'ride' && (
            <>
              <CompactHeader />
              {canSeeIntelligence && <IntelligenceWidget />}
              <div className="flex gap-2">
                <BatteryWidget />
                <HRWidget />
              </div>
              {(canSeeIntelligence || canSeeNutrition) && (
                <div className="flex gap-2">
                  {canSeeIntelligence && <div className="flex-1"><WPrimeWidget /></div>}
                  {canSeeNutrition && <div className="flex-1"><NutritionWidget /></div>}
                </div>
              )}
              {canSeeNutrition && <NutritionQuickTap />}
              <LightRadarWidget />
              <WeatherWidget />
              <TrailWidget />
              <MiniMap />
              <ElevationProfile />
              {autoAssistEnabled && <AutoAssistWidget />}
              <RideSessionWidget />
            </>
          )}

          {activeTab === 'lights' && (
            <>
              <CompactHeader />
              <LightsPanel />
            </>
          )}

          {activeTab === 'radar' && (
            <>
              <CompactHeader />
              <RadarPanel />
              <LightRadarWidget />
              <MiniMap />
            </>
          )}

          {activeTab === 'battery' && (
            <>
              <CompactHeader />
              <DeviceBatteryPanel />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** Compact header for expanded view */
function CompactHeader() {
  const speed = useBikeStore((s) => s.speed_kmh);
  const power = useBikeStore((s) => s.power_watts);
  const battery = useBikeStore((s) => s.battery_percent);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const brand = useBikeStore((s) => s.bike_brand);
  const brandModeLabels: Record<string, Record<number, string>> = {
    giant: { 0: 'OFF', 1: 'ECO', 2: 'TOUR', 3: 'ACTV', 4: 'SPRT', 5: 'KROMI', 6: 'SMART' },
    bosch: { 0: 'OFF', 1: 'ECO', 2: 'TOUR', 3: 'SPORT', 4: 'TURBO' },
    shimano: { 0: 'OFF', 1: 'ECO', 2: 'TRAIL', 3: 'BOOST' },
    specialized: { 0: 'OFF', 1: 'ECO', 2: 'TRAIL', 3: 'TURBO' },
  };
  const modeLabels = brandModeLabels[brand] ?? brandModeLabels.giant!;

  return (
    <div className="flex items-center justify-between px-4 py-2" style={{ backgroundColor: 'var(--ev-bg-hero)' }}>
      <div className="flex items-baseline gap-1">
        <span className="font-mono font-bold text-3xl tabular-nums" style={{ color: 'var(--ev-on-surface)' }}>
          {speed > 0 ? speed.toFixed(2) : '0.00'}
        </span>
        <span className="font-display text-sm" style={{ color: 'var(--ev-primary)' }}>km/h</span>
      </div>
      <div className="flex items-center gap-3 text-sm font-display font-bold">
        <span>{power}W</span>
        <span style={{ color: 'var(--ev-primary)' }}>{battery}%</span>
        <span
          className="px-2 py-0.5 font-black text-xs"
          style={{ backgroundColor: 'var(--ev-primary)', color: 'var(--ev-bg-hero)' }}
        >
          {modeLabels[assistMode] ?? '?'}
        </span>
      </div>
    </div>
  );
}

/** Top status bar -- BLE, GPS, Battery, Time */
function TopBar() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const battery = useBikeStore((s) => s.battery_percent);
  const gpsActive = useMapStore((s) => s.gpsActive);

  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const bleColor = bleStatus === 'connected'
    ? 'var(--ev-primary)'
    : bleStatus === 'connecting'
      ? 'var(--ev-amber)'
      : 'var(--ev-on-surface-variant)';

  return (
    <header
      className="h-10 flex-none flex justify-between items-center px-6 z-50"
      style={{ backgroundColor: 'var(--ev-bg-hero)' }}
    >
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm" style={{ color: 'var(--ev-primary)', fontVariationSettings: "'FILL' 1" }}>electric_bike</span>
        <h1 className="font-display font-black text-xs uppercase tracking-widest" style={{ color: 'var(--ev-primary)' }}>STEALTH-EV</h1>
      </div>
      <div className="flex items-center gap-4 text-xs font-bold" style={{ color: 'var(--ev-on-surface-variant)' }}>
        <span className="flex items-center gap-1" style={{ color: bleColor }}>
          <span className="material-symbols-outlined text-[14px]">bluetooth</span>BLE
        </span>
        <span className="flex items-center gap-1" style={{ color: gpsActive ? 'var(--ev-primary)' : 'var(--ev-on-surface-variant)' }}>
          <span className="material-symbols-outlined text-[14px]">location_on</span>GPS
        </span>
        {battery > 0 && (
          <span className="flex items-center gap-1" style={{ color: 'var(--ev-primary)' }}>
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>battery_full</span>
            {battery}%
          </span>
        )}
        <span className="font-mono tracking-tighter" style={{ color: 'var(--ev-on-surface)' }}>{time}</span>
      </div>
    </header>
  );
}

/** Format range value: handle -1 overflow as "255+" */
function formatRange(range: number): string {
  if (range < 0) return '255+';
  return String(Math.round(range));
}

/** Speed -- hero element (~15%) with delta pill and trip distance */
function SpeedSection() {
  const speed = useBikeStore((s) => s.speed_kmh);
  const tripDist = useBikeStore((s) => s.trip_distance_km || s.distance_km);

  // Track previous speed for delta pill
  const prevSpeedRef = useRef(0);
  const speedDelta = speed - prevSpeedRef.current;
  useEffect(() => { prevSpeedRef.current = speed; }, [speed]);

  // Determine delta pill class
  const absDelta = Math.abs(speedDelta);
  const deltaClass = absDelta < 0.3
    ? 'delta-pill delta-pill-neutral'
    : speedDelta > 0
      ? 'delta-pill delta-pill-up'
      : 'delta-pill delta-pill-down';
  const deltaText = absDelta < 0.3
    ? '0.0'
    : `${speedDelta > 0 ? '+' : ''}${speedDelta.toFixed(1)}`;

  return (
    <section
      className="h-[15%] flex-none flex flex-col items-center justify-center"
      style={{ backgroundColor: 'var(--ev-bg-hero)' }}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-hero text-white leading-none tabular-nums">
          {speed > 0 ? speed.toFixed(2) : '0.00'}
        </span>
        <div className="flex flex-col items-start gap-1">
          <span className="font-display font-bold text-2xl" style={{ color: 'var(--ev-primary)' }}>KM/H</span>
          <span className={deltaClass}>{deltaText}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1" style={{ opacity: 0.8 }}>
        <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-variant)' }}>Trip</span>
        <span className="font-mono font-bold text-xl tabular-nums" style={{ color: 'var(--ev-on-surface)' }}>
          {tripDist.toFixed(2)} KM
        </span>
      </div>
    </section>
  );
}

/** Map overlay chip -- uses chip-map class (hairline border, not backdrop-blur) */
function MapChip({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: string }) {
  return (
    <div className="chip-map" style={accent ? { borderLeftWidth: '2px', borderLeftColor: accent } : undefined}>
      <p className="text-eyebrow leading-none" style={{ color: 'var(--ev-on-surface-variant)' }}>{label}</p>
      <p className="font-mono font-bold text-xl leading-tight tabular-nums mt-0.5" style={{ color: 'var(--ev-on-surface)' }}>
        {value}
        <span className="text-unit ml-1" style={{ color: 'var(--ev-on-surface-muted)' }}>{unit}</span>
      </p>
    </div>
  );
}

/** Map section (~30%) */
function MapSection() {
  const altitude = useMapStore((s) => s.altitude) ?? 0;
  const gradient = useAutoAssistStore((s) => s.terrain?.current_gradient_pct ?? 0);
  const motorRange = useBikeStore((s) => s.range_km);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);

  // Smart range display:
  // - When KROMI Intelligence is active (mode 5), the motor reports POWER range
  //   but KROMI dynamically shifts between modes, so POWER range is misleading.
  //   Show weighted average of ACTIVE/SPORT/POWER ranges as "KROMI range".
  // - When in other modes, show the motor's direct range for that mode.
  let displayRange = motorRange;
  let rangeLabel = 'Range';
  if (assistMode === AssistMode.POWER && rangePerMode) {
    // KROMI Intelligence active — estimate from mix of modes it uses
    const rpm = rangePerMode as Record<string, number>;
    const a = rpm.active ?? 0;
    const s = rpm.sport ?? 0;
    const p = rpm.power ?? 0;
    if (a > 0 && s > 0 && p > 0) {
      // Weighted: KROMI spends ~30% in active, ~40% sport, ~30% power
      displayRange = Math.round(a * 0.3 + s * 0.4 + p * 0.3);
    }
    rangeLabel = 'KROMI Range';
  }

  return (
    <section className="h-[30%] flex-none relative overflow-hidden">
      {/* Map background */}
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--ev-surface-low)' }}>
        <MiniMap />
      </div>
      {/* Overlay chips -- using chip-map style */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
        <MapChip label="Elevation" value={`${Math.round(altitude)}`} unit="m" accent="var(--ev-tertiary)" />
        {gradient !== 0 && (
          <MapChip label="Grade" value={`${gradient > 0 ? '+' : ''}${gradient.toFixed(0)}`} unit="%" accent="var(--ev-error)" />
        )}
        <TerrainBadge />
      </div>
      {displayRange !== 0 && (
        <div className="absolute top-3 right-3 chip-map z-10" style={{ borderLeftWidth: '2px', borderLeftColor: 'var(--ev-primary)' }}>
          <p className="text-eyebrow leading-none" style={{ color: 'var(--ev-on-surface-variant)' }}>{rangeLabel}</p>
          <p className="font-mono font-bold text-2xl tabular-nums mt-0.5" style={{ color: 'var(--ev-on-surface)' }}>
            ~{formatRange(displayRange)}
            <span className="text-unit ml-1" style={{ color: 'var(--ev-on-surface-muted)' }}>km</span>
          </p>
        </div>
      )}
    </section>
  );
}

/** Metrics row -- Power, Battery, Cadence, Torque (~12%) */
function MetricsRow() {
  const power = useBikeStore((s) => s.power_watts);
  const battery = useBikeStore((s) => s.battery_percent);
  const cadence = useBikeStore((s) => s.cadence_rpm);
  const torque = useBikeStore((s) => s.torque_nm);

  return (
    <section
      className="h-[12%] flex-none grid grid-cols-4 gap-0"
      style={{ borderTop: '1px solid var(--ev-outline-subtle)', borderBottom: '1px solid var(--ev-outline-subtle)' }}
    >
      <MetricCell icon="bolt" accentColor="var(--ev-secondary)" label="Power" value={String(power)} unit="W" />
      <MetricCell icon="battery_5_bar" accentColor="var(--ev-primary)" label="Battery" value={String(battery)} unit="%" fill />
      <MetricCell icon="speed" accentColor="var(--ev-tertiary)" label="Cadence" value={String(cadence)} unit="RPM" />
      <MetricCell icon="electric_bolt" accentColor="var(--ev-amber)" label="Torque" value={torque > 0 ? torque.toFixed(1) : '0'} unit="Nm" />
    </section>
  );
}

function MetricCell({ icon, accentColor, label, value, unit, fill }: {
  icon: string; accentColor: string; label: string; value: string; unit: string; fill?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        backgroundColor: fill ? 'var(--ev-surface-container)' : 'var(--ev-surface-low)',
        borderRight: '1px solid var(--ev-outline-subtle)',
      }}
    >
      <span
        className="material-symbols-outlined text-lg mb-0.5"
        style={{ color: accentColor, ...(fill ? { fontVariationSettings: "'FILL' 1" } : {}) }}
      >
        {icon}
      </span>
      <p className="text-eyebrow" style={{ color: 'var(--ev-on-surface-variant)' }}>{label}</p>
      <p className="font-mono font-bold text-xl leading-tight tabular-nums" style={{ color: 'var(--ev-on-surface)' }}>
        {value}
        <span className="text-unit ml-0.5" style={{ color: 'var(--ev-on-surface-muted)', opacity: 0.6 }}>{unit}</span>
      </p>
    </div>
  );
}

/** Assist mode bar (~10%) -- OUTLINED style (not filled green) */
function AssistBar() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const autoAssist = useAutoAssistStore((s) => s.enabled);
  const rearGear = useBikeStore((s) => s.rear_gear);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);
  const brand = useBikeStore((s) => s.bike_brand);

  // Brand-aware mode list
  const allModes = [
    { mode: AssistMode.ECO, key: 'eco' },
    { mode: AssistMode.TOUR, key: 'tour' },
    { mode: AssistMode.ACTIVE, key: 'active' },
    { mode: AssistMode.SPORT, key: 'sport' },
    { mode: AssistMode.POWER, key: 'power' },
    { mode: AssistMode.SMART, key: 'smart' },
  ];

  const brandLabels: Record<string, Record<number, string>> = {
    giant: { 1: 'ECO', 2: 'TOUR', 3: 'ACTV', 4: 'SPRT', 5: 'KROMI', 6: 'AUTO' },
    bosch: { 1: 'ECO', 2: 'TOUR', 3: 'SPORT', 4: 'TURBO' },
    shimano: { 1: 'ECO', 2: 'TRAIL', 4: 'BOOST' },
    specialized: { 1: 'ECO', 2: 'TRAIL', 4: 'TURBO' },
  };

  const maxMode = ({ giant: 6, bosch: 4, shimano: 4, specialized: 4 } as Record<string, number>)[brand] ?? 6;
  const labels = brandLabels[brand] ?? brandLabels.giant!;
  const modes = allModes.filter(m => m.mode <= maxMode && labels[m.mode]).map(m => ({
    ...m, label: labels[m.mode] ?? `M${m.mode}`,
  }));

  return (
    <section
      className="h-[10%] flex-none px-2 py-1 flex flex-col justify-center"
      style={{ backgroundColor: 'var(--ev-bg-hero)' }}
    >
      <div className="flex justify-between items-center gap-1 h-3/4">
        {modes.map(({ mode, label, key }) => {
          const active = assistMode === mode;
          const range = rangePerMode ? (rangePerMode as Record<string, number>)[key] : 0;
          const rangeDisplay = (range ?? 0) === -1 ? '255+' : (range ?? 0) > 0 ? `${range}km` : '';

          return (
            <button
              key={mode}
              className={`flex-1 h-full font-display font-black text-[9px] tracking-wider flex flex-col items-center justify-center uppercase active:scale-95 transition-all ${
                active ? 'shadow-glow' : ''
              }`}
              style={active
                ? {
                    border: '1px solid var(--ev-primary)',
                    color: 'var(--ev-primary)',
                    backgroundColor: 'var(--ev-primary-glow)',
                  }
                : {
                    border: '1px solid var(--ev-outline-variant)',
                    color: 'var(--ev-on-surface-variant)',
                    backgroundColor: 'transparent',
                  }
              }
            >
              <span>{label}</span>
              {rangeDisplay && (
                <span
                  className="text-[7px] font-bold"
                  style={{ color: active ? 'var(--ev-primary)' : 'var(--ev-on-surface-muted)', opacity: 0.7 }}
                >
                  {rangeDisplay}
                </span>
              )}
            </button>
          );
        })}
        {/* Gear indicator */}
        {rearGear > 0 && (
          <div
            className="w-10 h-full flex flex-col items-center justify-center"
            style={{
              backgroundColor: 'var(--ev-surface-container)',
              borderLeft: '1px solid var(--ev-outline-subtle)',
            }}
          >
            <span className="text-eyebrow" style={{ color: 'var(--ev-on-surface-variant)' }}>GR</span>
            <span className="font-mono font-black text-lg leading-none" style={{ color: 'var(--ev-on-surface)' }}>{rearGear}</span>
          </div>
        )}
      </div>
      {/* KROMI Auto chip -- outlined style with pulse dot */}
      {autoAssist && (
        <div className="flex justify-center mt-0.5">
          <div
            className="flex items-center gap-1.5 px-3 py-0.5"
            style={{
              border: '1px solid var(--ev-primary)',
              backgroundColor: 'var(--ev-primary-glow)',
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--ev-primary)' }}
            />
            <span className="text-eyebrow font-bold tracking-widest" style={{ color: 'var(--ev-primary)' }}>KROMI Auto</span>
          </div>
        </div>
      )}
    </section>
  );
}

/** Info strip (~8%) -- 4 cells + MotorTempGauge via info-cell tokens */
function InfoStrip() {
  const tripTime = useBikeStore((s) => s.trip_time_s);
  const altitude = useMapStore((s) => s.altitude) ?? 0;
  const gradient = useAutoAssistStore((s) => s.terrain?.current_gradient_pct ?? 0);
  const range = useBikeStore((s) => s.range_km);

  const formatTime = (s: number) => {
    if (s <= 0) return '0:00';
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  };

  return (
    <section
      className="flex-none grid gap-0"
      style={{
        height: '8%',
        gridTemplateColumns: '1fr 1fr 1fr 1fr 0.7fr',
        backgroundColor: 'var(--ev-surface-container)',
        borderTop: '1px solid var(--ev-outline-subtle)',
        borderBottom: '1px solid var(--ev-outline-subtle)',
      }}
    >
      {/* Time */}
      <div className="info-cell justify-center" style={{ borderRight: '1px solid var(--ev-outline-subtle)' }}>
        <span className="material-symbols-outlined text-[14px]" style={{ color: 'var(--ev-secondary)' }}>timer</span>
        <span className="info-cell-value">{formatTime(tripTime)}</span>
        <span className="info-cell-label">Time</span>
      </div>

      {/* Altitude */}
      <div className="info-cell justify-center" style={{ borderRight: '1px solid var(--ev-outline-subtle)' }}>
        <span className="material-symbols-outlined text-[14px]" style={{ color: 'var(--ev-tertiary)' }}>landscape</span>
        <span className="info-cell-value">{Math.round(altitude)}<span className="text-unit ml-0.5">m</span></span>
        <span className="info-cell-label">Alt</span>
      </div>

      {/* Gradient */}
      <div className="info-cell justify-center" style={{ borderRight: '1px solid var(--ev-outline-subtle)' }}>
        <span className="material-symbols-outlined text-[14px]" style={{ color: 'var(--ev-error)' }}>trending_up</span>
        <span className="info-cell-value">
          {gradient > 0 ? '+' : ''}{gradient.toFixed(0)}
          <span className="text-unit ml-0.5">%</span>
        </span>
        <span className="info-cell-label">Grade</span>
      </div>

      {/* Range */}
      <div className="info-cell justify-center" style={{ borderRight: '1px solid var(--ev-outline-subtle)' }}>
        <span className="material-symbols-outlined text-[14px]" style={{ color: 'var(--ev-primary)' }}>battery_charging_full</span>
        <span className="info-cell-value">
          {formatRange(range)}
          <span className="text-unit ml-0.5">km</span>
        </span>
        <span className="info-cell-label">Range</span>
      </div>

      {/* Motor Temp (5th cell) */}
      <MotorTempGauge />
    </section>
  );
}

/** Compact nutrition alert for ride view -- only shows when alert is active */
function NutritionAlertStrip() {
  const nutrition = useNutritionStore((s) => s.state);
  const alertVisible = useNutritionStore((s) => s.alertVisible);

  if (!nutrition || !alertVisible || nutrition.alerts.length === 0) return null;

  const worstStatus = nutrition.glycogen_status === 'critical' || nutrition.hydration_status === 'critical'
    ? 'critical' : 'amber';
  const borderColor = worstStatus === 'critical' ? 'var(--ev-error)' : 'var(--ev-amber)';
  const textColor = worstStatus === 'critical' ? 'var(--ev-error)' : 'var(--ev-amber)';

  const handleEat = () => {
    kromiEngine.getNutrition().recordEat();
    useNutritionStore.getState().setAlertVisible(false);
  };
  const handleDrink = () => {
    kromiEngine.getNutrition().recordDrink();
    useNutritionStore.getState().setAlertVisible(false);
  };

  return (
    <section
      className="flex-none h-16 flex items-center gap-2 px-3"
      style={{
        borderTop: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
      }}
    >
      <p className="flex-1 text-xs font-bold line-clamp-2" style={{ color: textColor }}>{nutrition.alerts[0]}</p>
      <button
        onClick={handleEat}
        className="h-12 px-4 active:opacity-80"
        style={{
          backgroundColor: 'var(--ev-primary-glow)',
          border: '1px solid rgba(63, 255, 139, 0.3)',
        }}
      >
        <span className="font-display font-black text-sm" style={{ color: 'var(--ev-primary)' }}>COMI</span>
      </button>
      <button
        onClick={handleDrink}
        className="h-12 px-4 active:opacity-80"
        style={{
          backgroundColor: 'rgba(96, 165, 250, 0.2)',
          border: '1px solid rgba(96, 165, 250, 0.3)',
        }}
      >
        <span className="font-display font-black text-sm" style={{ color: '#60a5fa' }}>BEBI</span>
      </button>
    </section>
  );
}

/** Elevation mini-chart (flex remaining) -- always visible */
function ElevationSection() {
  const gpsActive = useMapStore((s) => s.gpsActive);

  return (
    <section className="flex-1 min-h-0 relative" style={{ backgroundColor: 'var(--ev-surface-low)' }}>
      <div className="h-full p-2">
        <ElevationProfile />
      </div>
      {/* Flat line overlay when no GPS */}
      {!gpsActive && (
        <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
          <div className="w-[90%] h-px" style={{ backgroundColor: 'var(--ev-outline-variant)' }} />
        </div>
      )}
    </section>
  );
}
