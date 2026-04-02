import { useState } from 'react';
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

/**
 * STEALTH-EV Dashboard — Fullscreen, no-scroll, fixed height sections.
 * Design from Stitch project 1881497936854696524 (Fullscreen Ride Dashboard).
 */
export function Dashboard() {
  const [expanded, setExpanded] = useState(false);
  const autoAssistEnabled = useAutoAssistStore((s) => s.enabled);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0e0e0e]">
      <TopBar />

      {!expanded ? (
        /* === RIDE VIEW (default, no scroll) === */
        <main className="flex-1 flex flex-col min-h-0">
          <SpeedSection />
          <MapSection />
          <MetricsRow />
          <AssistBar />
          <InfoStrip />
          <ElevationSection />
          {/* Expand button */}
          <button
            onClick={() => setExpanded(true)}
            className="flex-none h-8 bg-[#1a1919] flex items-center justify-center gap-1 border-t border-[#494847]/10"
          >
            <span className="material-symbols-outlined text-[#777575] text-sm">expand_less</span>
            <span className="text-[9px] text-[#777575] font-label uppercase tracking-widest">More</span>
          </button>
        </main>
      ) : (
        /* === EXPANDED VIEW (scrollable, all widgets) === */
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-2 p-3 pb-4">
            {/* Collapse button */}
            <button
              onClick={() => setExpanded(false)}
              className="h-8 bg-[#1a1919] flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-[#777575] text-sm">expand_more</span>
              <span className="text-[9px] text-[#777575] font-label uppercase tracking-widest">Ride View</span>
            </button>

            {/* Compact speed + metrics */}
            <CompactHeader />

            {/* All widgets from old layout */}
            <IntelligenceWidget />

            <div className="flex gap-2">
              <BatteryWidget />
              <HRWidget />
            </div>

            <WeatherWidget />
            <TrailWidget />

            <MiniMap />
            <ElevationProfile />

            {autoAssistEnabled && <AutoAssistWidget />}

            <RideSessionWidget />
          </div>
        </main>
      )}
    </div>
  );
}

/** Compact header for expanded view */
function CompactHeader() {
  const speed = useBikeStore((s) => s.speed_kmh);
  const power = useBikeStore((s) => s.power_watts);
  const battery = useBikeStore((s) => s.battery_percent);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const modeLabels: Record<number, string> = { 0: 'OFF', 1: 'ECO', 2: 'TOUR', 3: 'ACTV', 4: 'SPRT', 5: 'PWR', 6: 'SMART' };

  return (
    <div className="flex items-center justify-between bg-black px-4 py-2">
      <div className="flex items-baseline gap-1">
        <span className="font-headline font-black text-3xl tabular-nums">{speed > 0 ? speed.toFixed(1) : '0.0'}</span>
        <span className="font-headline text-sm text-[#3fff8b]">km/h</span>
      </div>
      <div className="flex items-center gap-3 text-sm font-headline">
        <span>{power}W</span>
        <span className="text-[#3fff8b]">{battery}%</span>
        <span className="bg-[#3fff8b] text-black px-2 py-0.5 font-black text-xs">{modeLabels[assistMode] ?? '?'}</span>
      </div>
    </div>
  );
}

/** Top status bar — BLE, GPS, Battery, Time */
function TopBar() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const battery = useBikeStore((s) => s.battery_percent);
  const gpsActive = useMapStore((s) => s.gpsActive);

  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const bleColor = bleStatus === 'connected' ? 'text-[#3fff8b]' : bleStatus === 'connecting' ? 'text-yellow-400' : 'text-[#adaaaa]';

  return (
    <header className="h-10 flex-none flex justify-between items-center px-6 bg-black z-50">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[#3fff8b] text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>electric_bike</span>
        <h1 className="font-headline font-black text-xs text-[#3fff8b] uppercase tracking-widest">STEALTH-EV</h1>
      </div>
      <div className="flex items-center gap-4 text-xs font-bold text-[#adaaaa]">
        <span className={`flex items-center gap-1 ${bleColor}`}>
          <span className="material-symbols-outlined text-[14px]">bluetooth</span>BLE
        </span>
        <span className={`flex items-center gap-1 ${gpsActive ? 'text-[#3fff8b]' : 'text-[#adaaaa]'}`}>
          <span className="material-symbols-outlined text-[14px]">location_on</span>GPS
        </span>
        {battery > 0 && (
          <span className="flex items-center gap-1 text-[#3fff8b]">
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>battery_full</span>
            {battery}%
          </span>
        )}
        <span className="font-headline tracking-tighter text-white">{time}</span>
      </div>
    </header>
  );
}

/** Speed — hero element (~15%) */
function SpeedSection() {
  const speed = useBikeStore((s) => s.speed_kmh);
  const tripDist = useBikeStore((s) => s.trip_distance_km || s.distance_km);

  return (
    <section className="h-[15%] flex-none flex flex-col items-center justify-center bg-black">
      <div className="flex items-baseline gap-2">
        <span className="font-headline font-black text-7xl tracking-tighter text-white leading-none tabular-nums">
          {speed > 0 ? speed.toFixed(1) : '0.0'}
        </span>
        <span className="font-headline font-bold text-2xl text-[#3fff8b]">KM/H</span>
      </div>
      <div className="flex items-center gap-2 opacity-80">
        <span className="text-xs font-label uppercase text-[#adaaaa] tracking-widest">Trip</span>
        <span className="font-headline font-bold text-xl text-white">{tripDist.toFixed(1)} KM</span>
      </div>
    </section>
  );
}

/** Map section (~30%) */
function MapSection() {
  const altitude = useMapStore((s) => s.altitude) ?? 0;
  const gradient = useAutoAssistStore((s) => s.terrain?.current_gradient_pct ?? 0);
  const range = useBikeStore((s) => s.range_km);

  return (
    <section className="h-[30%] flex-none relative overflow-hidden">
      {/* Map background */}
      <div className="absolute inset-0 bg-[#131313]">
        <MiniMap />
      </div>
      {/* Overlay cards */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
        <OverlayCard label="Elevation" value={`${Math.round(altitude)}`} unit="m" color="border-[#e966ff]" />
        {gradient !== 0 && (
          <OverlayCard label="Grade" value={`${gradient > 0 ? '+' : ''}${gradient.toFixed(0)}`} unit="%" color="border-[#ff716c]" />
        )}
      </div>
      {range > 0 && (
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-4 py-2 border-l-2 border-[#3fff8b] z-10">
          <p className="text-[10px] font-label uppercase text-[#adaaaa] leading-none">Range</p>
          <p className="font-headline font-black text-2xl text-white">{Math.round(range)}<span className="text-sm font-normal ml-1">km</span></p>
        </div>
      )}
    </section>
  );
}

function OverlayCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className={`bg-black/60 backdrop-blur-md px-4 py-2 border-l-2 ${color}`}>
      <p className="text-[10px] font-label uppercase text-[#adaaaa] leading-none">{label}</p>
      <p className="font-headline font-black text-2xl text-white">{value}<span className="text-sm font-normal ml-1">{unit}</span></p>
    </div>
  );
}

/** Metrics row — Power, Battery, Cadence (~12%) */
function MetricsRow() {
  const power = useBikeStore((s) => s.power_watts);
  const battery = useBikeStore((s) => s.battery_percent);
  const cadence = useBikeStore((s) => s.cadence_rpm);
  const torque = useBikeStore((s) => s.torque_nm);

  return (
    <section className="h-[12%] flex-none grid grid-cols-4 gap-0 border-y border-[#494847]/20">
      <MetricCell icon="bolt" iconColor="text-[#6e9bff]" label="Power" value={String(power)} unit="W" />
      <MetricCell icon="battery_5_bar" iconColor="text-[#3fff8b]" label="Battery" value={String(battery)} unit="%" fill />
      <MetricCell icon="speed" iconColor="text-[#e966ff]" label="Cadence" value={String(cadence)} unit="RPM" />
      <MetricCell icon="electric_bolt" iconColor="text-yellow-400" label="Torque" value={torque > 0 ? torque.toFixed(1) : '0'} unit="Nm" />
    </section>
  );
}

function MetricCell({ icon, iconColor, label, value, unit, fill }: {
  icon: string; iconColor: string; label: string; value: string; unit: string; fill?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center ${fill ? 'bg-[#1a1919]' : 'bg-[#131313]'} border-r border-[#494847]/10 last:border-r-0`}>
      <span className={`material-symbols-outlined ${iconColor} text-lg mb-0.5`} style={fill ? { fontVariationSettings: "'FILL' 1" } : undefined}>{icon}</span>
      <p className="text-[9px] font-label uppercase text-[#adaaaa]">{label}</p>
      <p className="font-headline font-bold text-xl leading-tight tabular-nums">{value}<span className="text-[10px] font-normal ml-0.5 opacity-60">{unit}</span></p>
    </div>
  );
}

/** Assist mode bar (~10%) */
function AssistBar() {
  const assistMode = useBikeStore((s) => s.assist_mode);
  const autoAssist = useAutoAssistStore((s) => s.enabled);
  const rearGear = useBikeStore((s) => s.rear_gear);

  const modes = [
    { mode: AssistMode.ECO, label: 'ECO' },
    { mode: AssistMode.TOUR, label: 'TOUR' },
    { mode: AssistMode.ACTIVE, label: 'ACTV' },
    { mode: AssistMode.SPORT, label: 'SPRT' },
    { mode: AssistMode.POWER, label: 'PWR' },
  ];

  return (
    <section className="h-[10%] flex-none bg-black px-2 py-1 flex flex-col justify-center">
      <div className="flex justify-between items-center gap-1 h-3/4">
        {modes.map(({ mode, label }) => {
          const active = assistMode === mode;
          return (
            <button
              key={mode}
              className={`flex-1 h-full font-headline font-black text-[10px] tracking-tighter flex items-center justify-center uppercase active:scale-95 transition-transform ${
                active
                  ? 'bg-[#3fff8b] text-black shadow-[0_0_20px_rgba(63,255,139,0.3)]'
                  : 'bg-[#262626] text-[#adaaaa]'
              }`}
            >
              {label}
            </button>
          );
        })}
        {/* Gear indicator */}
        {rearGear > 0 && (
          <div className="w-10 h-full bg-[#1a1919] flex flex-col items-center justify-center border-l border-[#494847]/20">
            <span className="text-[8px] font-label text-[#adaaaa]">GR</span>
            <span className="font-headline font-black text-lg leading-none text-white">{rearGear}</span>
          </div>
        )}
      </div>
      {/* Auto-assist indicator */}
      {autoAssist && (
        <div className="flex justify-center mt-0.5">
          <div className="flex items-center gap-1.5 px-3 py-0.5 bg-[#3fff8b]/10 border border-[#3fff8b]/20">
            <div className="w-1.5 h-1.5 rounded-full bg-[#3fff8b] animate-pulse" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#3fff8b]">KROMI Auto</span>
          </div>
        </div>
      )}
    </section>
  );
}

/** Info strip — HR, Battery dual, Current, Temp, Time, ODO (~8%) */
function InfoStrip() {
  const hrBpm = useBikeStore((s) => s.hr_bpm);
  const hrZone = useBikeStore((s) => s.hr_zone);
  const bat1 = useBikeStore((s) => s.battery_main_pct);
  const bat2 = useBikeStore((s) => s.battery_sub_pct);
  const battery = useBikeStore((s) => s.battery_percent);
  const current = useBikeStore((s) => s.assist_current_a);
  const temp = useBikeStore((s) => s.temperature_c);
  const tripTime = useBikeStore((s) => s.trip_time_s);
  const motorOdo = useBikeStore((s) => s.motor_odo_km);
  const range = useBikeStore((s) => s.range_km);

  const formatTime = (s: number) => {
    if (s <= 0) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  const hrColor = hrZone >= 4 ? '#ff716c' : hrZone >= 3 ? '#fbbf24' : hrBpm > 0 ? '#3fff8b' : '#777575';
  const hasDual = bat1 > 0 || bat2 > 0;

  return (
    <section className="h-[8%] flex-none grid grid-cols-4 gap-0 bg-[#1a1919] border-y border-[#494847]/20">
      {/* HR cell — transition prevents flicker on value changes */}
      <div className="flex flex-col items-center justify-center border-r border-[#494847]/10 transition-colors duration-500">
        <span className="material-symbols-outlined text-sm transition-colors duration-500" style={{ color: hrColor, fontVariationSettings: "'FILL' 1" }}>favorite</span>
        <span className="font-headline font-bold text-base tabular-nums transition-colors duration-500" style={{ color: hrColor }}>
          {hrBpm > 0 ? hrBpm : '--'}
        </span>
        <span className="text-[8px]" style={{ color: '#adaaaa' }}>{hrBpm > 0 ? `Zone ${hrZone}` : 'No HR'}</span>
      </div>

      {/* Battery cell */}
      <div className="flex flex-col items-center justify-center border-r border-[#494847]/10 px-1">
        {hasDual ? (
          <div className="flex flex-col gap-0.5 w-full px-1">
            <div className="flex items-center gap-1">
              <span className="text-[7px]" style={{ color: '#777575' }}>800</span>
              <div className="flex-1 h-1.5 bg-[#262626] overflow-hidden">
                <div style={{ width: `${bat1}%`, backgroundColor: bat1 > 30 ? '#3fff8b' : bat1 > 15 ? '#fbbf24' : '#ff716c', height: '100%' }} />
              </div>
              <span className="text-[7px] tabular-nums" style={{ color: '#adaaaa' }}>{bat1}%</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[7px]" style={{ color: '#777575' }}>250</span>
              <div className="flex-1 h-1.5 bg-[#262626] overflow-hidden">
                <div style={{ width: `${bat2}%`, backgroundColor: bat2 > 30 ? '#3fff8b' : bat2 > 15 ? '#fbbf24' : '#ff716c', height: '100%' }} />
              </div>
              <span className="text-[7px] tabular-nums" style={{ color: '#adaaaa' }}>{bat2}%</span>
            </div>
          </div>
        ) : (
          <>
            <span className="material-symbols-outlined text-sm" style={{ color: '#3fff8b', fontVariationSettings: "'FILL' 1" }}>battery_full</span>
            <span className="font-headline font-bold text-base tabular-nums">{battery}%</span>
            <span className="text-[8px]" style={{ color: '#777575' }}>{range > 0 ? `${Math.round(range)}km` : 'BAT'}</span>
          </>
        )}
      </div>

      {/* Current + Temp cell */}
      <div className="flex flex-col items-center justify-center border-r border-[#494847]/10">
        <span className="material-symbols-outlined text-sm" style={{ color: '#fbbf24' }}>electric_bolt</span>
        <span className="font-headline font-bold text-base tabular-nums">{current > 0 ? current.toFixed(1) : '0'}</span>
        <span className="text-[8px]" style={{ color: '#777575' }}>{temp > 0 ? `${temp.toFixed(0)}°C` : 'AMP'}</span>
      </div>

      {/* Time + ODO cell */}
      <div className="flex flex-col items-center justify-center">
        <span className="material-symbols-outlined text-sm" style={{ color: '#6e9bff' }}>timer</span>
        <span className="font-headline font-bold text-base tabular-nums">{formatTime(tripTime)}</span>
        <span className="text-[8px]" style={{ color: '#777575' }}>{motorOdo > 0 ? `${motorOdo.toLocaleString()}km` : 'TIME'}</span>
      </div>
    </section>
  );
}

/** Elevation mini-chart (flex remaining) — always visible */
function ElevationSection() {
  const gpsActive = useMapStore((s) => s.gpsActive);

  return (
    <section className="flex-1 min-h-0 bg-[#131313] relative">
      <div className="h-full p-2">
        <ElevationProfile />
      </div>
      {/* Flat line overlay when no GPS — elevation chart shows empty gracefully */}
      {!gpsActive && (
        <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
          {/* Flat horizon line */}
          <div className="w-[90%] h-px bg-[#494847]" />
        </div>
      )}
    </section>
  );
}
