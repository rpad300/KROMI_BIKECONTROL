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
import { useNutritionStore } from '../../store/nutritionStore';
import { kromiEngine } from '../../services/intelligence/KromiEngine';

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
          <NutritionAlertStrip />
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

            <div className="flex gap-2">
              <div className="flex-1"><WPrimeWidget /></div>
              <div className="flex-1"><NutritionWidget /></div>
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
        <span className="font-headline font-black text-3xl tabular-nums">{speed > 0 ? speed.toFixed(2) : '0.00'}</span>
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

  const bleColor = bleStatus === 'connected' ? 'text-[#3fff8b]' : bleStatus === 'connecting' ? 'text-[#fbbf24]' : 'text-[#adaaaa]';

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
          {speed > 0 ? speed.toFixed(2) : '0.00'}
        </span>
        <span className="font-headline font-bold text-2xl text-[#3fff8b]">KM/H</span>
      </div>
      <div className="flex items-center gap-2 opacity-80">
        <span className="text-xs font-label uppercase text-[#adaaaa] tracking-widest">Trip</span>
        <span className="font-headline font-bold text-xl text-white">{tripDist.toFixed(2)} KM</span>
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
      <MetricCell icon="electric_bolt" iconColor="text-[#fbbf24]" label="Torque" value={torque > 0 ? torque.toFixed(1) : '0'} unit="Nm" />
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
  const rangePerMode = useBikeStore((s) => s.range_per_mode);

  const modes = [
    { mode: AssistMode.ECO, label: 'ECO', key: 'eco' },
    { mode: AssistMode.TOUR, label: 'TOUR', key: 'tour' },
    { mode: AssistMode.ACTIVE, label: 'ACTV', key: 'active' },
    { mode: AssistMode.SPORT, label: 'SPRT', key: 'sport' },
    { mode: AssistMode.POWER, label: 'PWR', key: 'power' },
    { mode: AssistMode.SMART, label: 'AUTO', key: 'smart' },
  ];

  return (
    <section className="h-[10%] flex-none bg-black px-2 py-1 flex flex-col justify-center">
      <div className="flex justify-between items-center gap-1 h-3/4">
        {modes.map(({ mode, label, key }) => {
          const active = assistMode === mode;
          const range = rangePerMode ? (rangePerMode as Record<string, number>)[key] : 0;
          return (
            <button
              key={mode}
              className={`flex-1 h-full font-headline font-black text-[9px] tracking-tighter flex flex-col items-center justify-center uppercase active:scale-95 transition-transform ${
                active
                  ? 'bg-[#3fff8b] text-black shadow-[0_0_20px_rgba(63,255,139,0.3)]'
                  : 'bg-[#262626] text-[#adaaaa]'
              }`}
            >
              <span>{label}</span>
              {(range ?? 0) > 0 && <span className={`text-[7px] font-bold ${active ? 'text-black/70' : 'text-[#777575]'}`}>{range}km</span>}
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

/** Info strip — updates via DOM refs (zero React re-renders = zero flicker) */
function InfoStrip() {
  const hrValRef = useRef<HTMLSpanElement>(null);
  const hrIconRef = useRef<HTMLSpanElement>(null);
  const hrLabelRef = useRef<HTMLSpanElement>(null);
  const bat1BarRef = useRef<HTMLDivElement>(null);
  const bat1PctRef = useRef<HTMLSpanElement>(null);
  const bat2BarRef = useRef<HTMLDivElement>(null);
  const bat2PctRef = useRef<HTMLSpanElement>(null);
  const curValRef = useRef<HTMLSpanElement>(null);
  const curLabelRef = useRef<HTMLSpanElement>(null);
  const wPrimeValRef = useRef<HTMLSpanElement>(null);
  const wPrimeBarRef = useRef<HTMLDivElement>(null);
  const wPrimeLabelRef = useRef<HTMLSpanElement>(null);
  const timeValRef = useRef<HTMLSpanElement>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);

  // Subscribe to physiology for W' balance
  useEffect(() => {
    const unsub2 = useNutritionStore.subscribe((s) => {
      const pct = s.physiology ? Math.round(s.physiology.w_prime_balance * 100) : -1;
      const color = pct < 30 ? '#ff716c' : pct < 70 ? '#fbbf24' : '#3fff8b';
      if (wPrimeValRef.current) { wPrimeValRef.current.textContent = pct >= 0 ? `${pct}%` : '--'; wPrimeValRef.current.style.color = color; }
      if (wPrimeBarRef.current) { wPrimeBarRef.current.style.width = `${Math.max(0, pct)}%`; wPrimeBarRef.current.style.backgroundColor = color; }
      if (wPrimeLabelRef.current) wPrimeLabelRef.current.textContent = pct >= 0 ? (pct < 30 ? 'CRITICAL' : "W'") : "W'";
    });
    return unsub2;
  }, []);

  useEffect(() => {
    const update = (s: ReturnType<typeof useBikeStore.getState>) => {
      const hrColor = s.hr_zone >= 4 ? '#ff716c' : s.hr_zone >= 3 ? '#fbbf24' : s.hr_bpm > 0 ? '#3fff8b' : '#777575';

      if (hrValRef.current) {
        hrValRef.current.textContent = s.hr_bpm > 0 ? String(s.hr_bpm) : '--';
        hrValRef.current.style.color = hrColor;
      }
      if (hrIconRef.current) hrIconRef.current.style.color = s.hr_bpm > 0 ? '#ff716c' : '#494847';
      if (hrLabelRef.current) hrLabelRef.current.textContent = s.hr_bpm > 0 ? `Zone ${s.hr_zone}` : 'No HR';

      const batColor = (v: number) => v > 30 ? '#3fff8b' : v > 15 ? '#fbbf24' : '#ff716c';
      if (bat1BarRef.current) { bat1BarRef.current.style.width = `${s.battery_main_pct}%`; bat1BarRef.current.style.backgroundColor = batColor(s.battery_main_pct); }
      if (bat1PctRef.current) bat1PctRef.current.textContent = `${s.battery_main_pct}%`;
      if (bat2BarRef.current) { bat2BarRef.current.style.width = `${s.battery_sub_pct}%`; bat2BarRef.current.style.backgroundColor = batColor(s.battery_sub_pct); }
      if (bat2PctRef.current) bat2PctRef.current.textContent = `${s.battery_sub_pct}%`;

      if (curValRef.current) curValRef.current.textContent = s.assist_current_a > 0 ? s.assist_current_a.toFixed(1) : '0';
      if (curLabelRef.current) curLabelRef.current.textContent = s.temperature_c > 0 ? `${s.temperature_c.toFixed(0)}°C` : 'AMP';

      const t = s.trip_time_s;
      if (timeValRef.current) timeValRef.current.textContent = t > 0 ? `${Math.floor(t/3600)}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}` : '0:00';
      if (timeLabelRef.current) timeLabelRef.current.textContent = s.motor_odo_km > 0 ? `${s.motor_odo_km.toLocaleString()}km` : 'TIME';
    };
    // Fire immediately with current state (subscribe only fires on CHANGES)
    update(useBikeStore.getState());
    const unsub = useBikeStore.subscribe(update);
    return unsub;
  }, []);

  return (
    <section style={{ height: '8%', flexShrink: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', backgroundColor: '#1a1919', borderTop: '1px solid rgba(73,72,71,0.2)', borderBottom: '1px solid rgba(73,72,71,0.2)' }}>
      {/* HR */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(73,72,71,0.1)' }}>
        <span ref={hrIconRef} className="material-symbols-outlined" style={{ fontSize: '14px', color: '#494847', fontVariationSettings: "'FILL' 1" }}>favorite</span>
        <span ref={hrValRef} className="font-headline font-bold tabular-nums" style={{ fontSize: '16px', color: '#777575' }}>--</span>
        <span ref={hrLabelRef} style={{ fontSize: '8px', color: '#adaaaa' }}>No HR</span>
      </div>

      {/* Battery dual */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(73,72,71,0.1)', padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', width: '100%' }}>
          <span style={{ fontSize: '7px', color: '#777575' }}>800</span>
          <div style={{ flex: 1, height: '5px', backgroundColor: '#262626', overflow: 'hidden' }}>
            <div ref={bat1BarRef} style={{ height: '100%', width: '0%', backgroundColor: '#3fff8b' }} />
          </div>
          <span ref={bat1PctRef} className="tabular-nums" style={{ fontSize: '7px', color: '#adaaaa' }}>0%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', width: '100%', marginTop: '2px' }}>
          <span style={{ fontSize: '7px', color: '#777575' }}>250</span>
          <div style={{ flex: 1, height: '5px', backgroundColor: '#262626', overflow: 'hidden' }}>
            <div ref={bat2BarRef} style={{ height: '100%', width: '0%', backgroundColor: '#3fff8b' }} />
          </div>
          <span ref={bat2PctRef} className="tabular-nums" style={{ fontSize: '7px', color: '#adaaaa' }}>0%</span>
        </div>
      </div>

      {/* Current */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(73,72,71,0.1)' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#fbbf24' }}>electric_bolt</span>
        <span ref={curValRef} className="font-headline font-bold tabular-nums" style={{ fontSize: '16px' }}>0</span>
        <span ref={curLabelRef} style={{ fontSize: '8px', color: '#777575' }}>AMP</span>
      </div>

      {/* W' Balance */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(73,72,71,0.1)' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#e966ff', fontVariationSettings: "'FILL' 1" }}>bolt</span>
        <span ref={wPrimeValRef} className="font-headline font-bold tabular-nums" style={{ fontSize: '16px', color: '#777575' }}>--</span>
        <div style={{ width: '80%', height: '3px', backgroundColor: '#262626', marginTop: '1px', overflow: 'hidden' }}>
          <div ref={wPrimeBarRef} style={{ height: '100%', width: '0%', backgroundColor: '#3fff8b' }} />
        </div>
      </div>

      {/* Time */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#6e9bff' }}>timer</span>
        <span ref={timeValRef} className="font-headline font-bold tabular-nums" style={{ fontSize: '16px' }}>0:00</span>
        <span ref={timeLabelRef} style={{ fontSize: '8px', color: '#777575' }}>TIME</span>
      </div>
    </section>
  );
}

/** Compact nutrition alert for ride view — only shows when alert is active */
function NutritionAlertStrip() {
  const nutrition = useNutritionStore((s) => s.state);
  const alertVisible = useNutritionStore((s) => s.alertVisible);

  if (!nutrition || !alertVisible || nutrition.alerts.length === 0) return null;

  const worstStatus = nutrition.glycogen_status === 'critical' || nutrition.hydration_status === 'critical'
    ? 'critical' : 'amber';
  const borderColor = worstStatus === 'critical' ? 'border-[#ff716c]' : 'border-[#fbbf24]';
  const textColor = worstStatus === 'critical' ? 'text-[#ff716c]' : 'text-[#fbbf24]';

  const handleEat = () => {
    kromiEngine.getNutrition().recordEat();
    useNutritionStore.getState().setAlertVisible(false);
  };
  const handleDrink = () => {
    kromiEngine.getNutrition().recordDrink();
    useNutritionStore.getState().setAlertVisible(false);
  };

  return (
    <section className={`flex-none h-16 ${borderColor} border-y flex items-center gap-2 px-3 bg-black/80`}>
      <p className={`flex-1 text-xs font-bold ${textColor} line-clamp-2`}>{nutrition.alerts[0]}</p>
      <button onClick={handleEat} className="h-12 px-4 rounded bg-[#3fff8b]/20 border border-[#3fff8b]/30 active:bg-[#3fff8b]/40">
        <span className="text-[#3fff8b] font-headline font-black text-sm">COMI</span>
      </button>
      <button onClick={handleDrink} className="h-12 px-4 rounded bg-[#60a5fa]/20 border border-[#60a5fa]/30 active:bg-[#60a5fa]/40">
        <span className="text-[#60a5fa] font-headline font-black text-sm">BEBI</span>
      </button>
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
