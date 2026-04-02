import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { AssistMode } from '../../types/bike.types';
import { MiniMap } from './MiniMap';
import { ElevationProfile } from './ElevationProfile';

/**
 * STEALTH-EV Dashboard — Fullscreen, no-scroll, fixed height sections.
 * Design from Stitch project 1881497936854696524 (Fullscreen Ride Dashboard).
 */
export function Dashboard() {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-ev-bg">
      {/* Top Bar */}
      <TopBar />
      {/* Main sections — flex-1 fills remaining space */}
      <main className="flex-1 flex flex-col min-h-0">
        <SpeedSection />
        <MapSection />
        <MetricsRow />
        <AssistBar />
        <ElevationSection />
      </main>
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

  const bleColor = bleStatus === 'connected' ? 'text-ev-primary' : bleStatus === 'connecting' ? 'text-yellow-400' : 'text-ev-on-surface-variant';

  return (
    <header className="h-10 flex-none flex justify-between items-center px-6 bg-black z-50">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-ev-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>electric_bike</span>
        <h1 className="font-headline font-black text-xs text-ev-primary uppercase tracking-widest">STEALTH-EV</h1>
      </div>
      <div className="flex items-center gap-4 text-xs font-bold text-ev-on-surface-variant">
        <span className={`flex items-center gap-1 ${bleColor}`}>
          <span className="material-symbols-outlined text-[14px]">bluetooth</span>BLE
        </span>
        <span className={`flex items-center gap-1 ${gpsActive ? 'text-ev-primary' : 'text-ev-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-[14px]">location_on</span>GPS
        </span>
        {battery > 0 && (
          <span className="flex items-center gap-1 text-ev-primary">
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>battery_full</span>
            {battery}%
          </span>
        )}
        <span className="font-headline tracking-tighter text-ev-on-surface">{time}</span>
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
        <span className="font-headline font-black text-7xl tracking-tighter text-ev-on-surface leading-none tabular-nums">
          {speed > 0 ? speed.toFixed(1) : '0.0'}
        </span>
        <span className="font-headline font-bold text-2xl text-ev-primary">KM/H</span>
      </div>
      <div className="flex items-center gap-2 opacity-80">
        <span className="text-xs font-label uppercase text-ev-on-surface-variant tracking-widest">Trip</span>
        <span className="font-headline font-bold text-xl text-ev-on-surface">{tripDist.toFixed(1)} KM</span>
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
      <div className="absolute inset-0 bg-ev-surface-low">
        <MiniMap />
      </div>
      {/* Overlay cards */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
        <OverlayCard label="Elevation" value={`${Math.round(altitude)}`} unit="m" color="border-ev-tertiary" />
        {gradient !== 0 && (
          <OverlayCard label="Grade" value={`${gradient > 0 ? '+' : ''}${gradient.toFixed(0)}`} unit="%" color="border-ev-error" />
        )}
      </div>
      {range > 0 && (
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-4 py-2 border-l-2 border-ev-primary z-10">
          <p className="text-[10px] font-label uppercase text-ev-on-surface-variant leading-none">Range</p>
          <p className="font-headline font-black text-2xl text-ev-on-surface">{Math.round(range)}<span className="text-sm font-normal ml-1">km</span></p>
        </div>
      )}
    </section>
  );
}

function OverlayCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className={`bg-black/60 backdrop-blur-md px-4 py-2 border-l-2 ${color}`}>
      <p className="text-[10px] font-label uppercase text-ev-on-surface-variant leading-none">{label}</p>
      <p className="font-headline font-black text-2xl text-ev-on-surface">{value}<span className="text-sm font-normal ml-1">{unit}</span></p>
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
    <section className="h-[12%] flex-none grid grid-cols-4 gap-0 border-y border-ev-outline-variant/20">
      <MetricCell icon="bolt" iconColor="text-ev-secondary" label="Power" value={String(power)} unit="W" />
      <MetricCell icon="battery_5_bar" iconColor="text-ev-primary" label="Battery" value={String(battery)} unit="%" fill />
      <MetricCell icon="speed" iconColor="text-ev-tertiary" label="Cadence" value={String(cadence)} unit="RPM" />
      <MetricCell icon="electric_bolt" iconColor="text-yellow-400" label="Torque" value={torque > 0 ? torque.toFixed(1) : '0'} unit="Nm" />
    </section>
  );
}

function MetricCell({ icon, iconColor, label, value, unit, fill }: {
  icon: string; iconColor: string; label: string; value: string; unit: string; fill?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center ${fill ? 'bg-ev-surface-container' : 'bg-ev-surface-low'} border-r border-ev-outline-variant/10 last:border-r-0`}>
      <span className={`material-symbols-outlined ${iconColor} text-lg mb-0.5`} style={fill ? { fontVariationSettings: "'FILL' 1" } : undefined}>{icon}</span>
      <p className="text-[9px] font-label uppercase text-ev-on-surface-variant">{label}</p>
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
                  ? 'bg-ev-primary text-black shadow-[0_0_20px_rgba(63,255,139,0.3)]'
                  : 'bg-ev-surface-highest text-ev-on-surface-variant'
              }`}
            >
              {label}
            </button>
          );
        })}
        {/* Gear indicator */}
        {rearGear > 0 && (
          <div className="w-10 h-full bg-ev-surface-container flex flex-col items-center justify-center border-l border-ev-outline-variant/20">
            <span className="text-[8px] font-label text-ev-on-surface-variant">GR</span>
            <span className="font-headline font-black text-lg leading-none text-ev-on-surface">{rearGear}</span>
          </div>
        )}
      </div>
      {/* Auto-assist indicator */}
      {autoAssist && (
        <div className="flex justify-center mt-0.5">
          <div className="flex items-center gap-1.5 px-3 py-0.5 bg-ev-primary/10 border border-ev-primary/20">
            <div className="w-1.5 h-1.5 rounded-full bg-ev-primary animate-pulse" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-ev-primary">KROMI Auto</span>
          </div>
        </div>
      )}
    </section>
  );
}

/** Elevation mini-chart (~18%) */
function ElevationSection() {
  const gpsActive = useMapStore((s) => s.gpsActive);
  const hrBpm = useBikeStore((s) => s.hr_bpm);
  const hrZone = useBikeStore((s) => s.hr_zone);
  const tripTime = useBikeStore((s) => s.trip_time_s);
  const motorOdo = useBikeStore((s) => s.motor_odo_km);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  return (
    <section className="flex-1 min-h-0 bg-ev-surface-low relative flex flex-col">
      {/* Elevation chart takes most space */}
      <div className="flex-1 min-h-0 p-2">
        {gpsActive ? (
          <ElevationProfile />
        ) : (
          <div className="h-full flex items-center justify-center text-ev-outline text-xs font-label uppercase tracking-widest">
            GPS needed for elevation
          </div>
        )}
      </div>
      {/* Bottom stats bar */}
      <div className="flex-none flex justify-between items-center px-4 py-1.5 bg-black/40 border-t border-ev-outline-variant/10">
        {hrBpm > 0 && (
          <div className="flex items-center gap-1">
            <span className="material-symbols-outlined text-ev-error text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
            <span className="font-headline font-bold text-sm">{hrBpm}</span>
            <span className="text-[9px] text-ev-on-surface-variant">Z{hrZone}</span>
          </div>
        )}
        {tripTime > 0 && (
          <span className="font-headline text-sm text-ev-on-surface-variant">{formatTime(tripTime)}</span>
        )}
        {motorOdo > 0 && (
          <span className="text-[9px] text-ev-outline font-label uppercase tracking-widest">ODO {motorOdo.toLocaleString()}km</span>
        )}
      </div>
    </section>
  );
}
