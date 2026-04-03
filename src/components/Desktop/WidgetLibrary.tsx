import { useState, type ComponentType } from 'react';
import { SpeedHero } from '../DashboardSystem/widgets/SpeedHero';
import { GradientHero } from '../DashboardSystem/widgets/GradientHero';
import { CompactIntelligence } from '../DashboardSystem/widgets/CompactIntelligence';
import { TripControl } from '../DashboardSystem/widgets/TripControl';
import { PersistentBar } from '../DashboardSystem/PersistentBar';
import { HRWidget } from '../Dashboard/HRWidget';
import { BatteryWidget } from '../Dashboard/BatteryWidget';
import { IntelligenceWidget } from '../Dashboard/IntelligenceWidget';
import { WeatherWidget } from '../Dashboard/WeatherWidget';
import { TrailWidget } from '../Dashboard/TrailWidget';
import { MotorWidget } from '../Dashboard/MotorWidget';
import { GearWidget } from '../Dashboard/GearWidget';
import { TorqueWidget } from '../Dashboard/TorqueWidget';
import { TripStatsWidget } from '../Dashboard/TripStatsWidget';
import { ProfileInsightsWidget } from '../Dashboard/ProfileInsightsWidget';
import { AssistModeWidget } from '../Dashboard/AssistModeWidget';
import { RideSessionWidget } from '../Dashboard/RideSessionWidget';

interface WidgetDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: 'core' | 'motor' | 'health' | 'environment' | 'bike' | 'kromi';
  component: ComponentType;
  height?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  core: '#3fff8b',
  motor: '#fbbf24',
  health: '#ff716c',
  environment: '#6e9bff',
  bike: '#e966ff',
  kromi: '#e966ff',
};

const WIDGETS: WidgetDef[] = [
  { id: 'speed_hero', name: 'Speed Hero', icon: 'speed', description: 'Velocidade em destaque (7xl)', category: 'core', component: SpeedHero, height: 140 },
  { id: 'gradient_hero', name: 'Gradient Hero', icon: 'trending_up', description: 'Gradiente em destaque para subidas', category: 'core', component: GradientHero, height: 120 },
  { id: 'persistent_bar', name: 'Status Bar', icon: 'info', description: 'HR, bateria, modo, KROMI (sempre visível)', category: 'core', component: PersistentBar, height: 32 },
  { id: 'trip_control', name: 'Trip Control', icon: 'timer', description: 'Start/stop trip, autopause, tempo', category: 'core', component: TripControl, height: 40 },
  { id: 'trip_stats', name: 'Trip Stats', icon: 'insert_chart', description: 'Distância, tempo, calorias, D+, avg', category: 'core', component: TripStatsWidget, height: 60 },
  { id: 'compact_kromi', name: 'KROMI Compact', icon: 'psychology', description: 'Estado KROMI compacto (1 linha)', category: 'kromi', component: CompactIntelligence, height: 28 },
  { id: 'intelligence', name: 'KROMI Full', icon: 'psychology', description: 'Intelligence completo (3 barras + factores)', category: 'kromi', component: IntelligenceWidget, height: 200 },
  { id: 'hr', name: 'Heart Rate', icon: 'favorite', description: 'BPM, zona, barra de zonas', category: 'health', component: HRWidget, height: 80 },
  { id: 'profile', name: 'Athlete Profile', icon: 'person', description: 'Eficiência, forma, carga, FTP', category: 'health', component: ProfileInsightsWidget, height: 120 },
  { id: 'battery', name: 'Battery', icon: 'battery_full', description: 'SOC, range, dual bars, ranges por modo', category: 'bike', component: BatteryWidget, height: 100 },
  { id: 'motor', name: 'Motor Telemetry', icon: 'bolt', description: 'Power, Torque, Cadence, Current + gear', category: 'motor', component: MotorWidget, height: 80 },
  { id: 'torque', name: 'Torque', icon: 'electric_bolt', description: 'Climb type, Nm, Support%, Launch', category: 'motor', component: TorqueWidget, height: 100 },
  { id: 'gear', name: 'Gear', icon: 'settings', description: 'Mudança actual + barra cassette + advisory', category: 'bike', component: GearWidget, height: 60 },
  { id: 'assist_modes', name: 'Assist Modes', icon: 'tune', description: 'Botões ECO/TOUR/ACTV/SPRT/PWR/AUTO', category: 'bike', component: AssistModeWidget, height: 60 },
  { id: 'weather', name: 'Weather', icon: 'cloud', description: 'Temperatura, vento, humidade, condições', category: 'environment', component: WeatherWidget, height: 80 },
  { id: 'trail', name: 'Trail Info', icon: 'forest', description: 'Superfície, MTB scale, nome do trail', category: 'environment', component: TrailWidget, height: 60 },
  { id: 'ride_session', name: 'Ride Session', icon: 'directions_bike', description: 'Start/stop ride, snapshots, savings', category: 'core', component: RideSessionWidget, height: 80 },
];

export function WidgetLibrary() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);

  const categories = [...new Set(WIDGETS.map((w) => w.category))];
  const filtered = filterCat ? WIDGETS.filter((w) => w.category === filterCat) : WIDGETS;
  const selectedWidget = WIDGETS.find((w) => w.id === selected);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b' }}>Widget Library</h2>
        <span style={{ fontSize: '10px', color: '#777575' }}>{WIDGETS.length} widgets disponíveis</span>
      </div>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button onClick={() => setFilterCat(null)}
          style={{ padding: '4px 10px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', border: 'none', cursor: 'pointer', backgroundColor: !filterCat ? '#3fff8b' : '#262626', color: !filterCat ? 'black' : '#adaaaa' }}>
          Todos
        </button>
        {categories.map((cat) => (
          <button key={cat} onClick={() => setFilterCat(cat === filterCat ? null : cat)}
            style={{ padding: '4px 10px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', border: 'none', cursor: 'pointer', backgroundColor: cat === filterCat ? (CATEGORY_COLORS[cat] ?? '#3fff8b') : '#262626', color: cat === filterCat ? 'black' : '#adaaaa' }}>
            {cat}
          </button>
        ))}
      </div>

      {/* Widget grid + preview */}
      <div style={{ display: 'flex', gap: '12px' }}>
        {/* Grid */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
          {filtered.map((w) => (
            <button key={w.id} onClick={() => setSelected(w.id === selected ? null : w.id)}
              style={{
                padding: '10px 8px', backgroundColor: w.id === selected ? '#262626' : '#1a1919', border: w.id === selected ? `1px solid ${CATEGORY_COLORS[w.category]}` : '1px solid transparent',
                cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: CATEGORY_COLORS[w.category] }}>{w.icon}</span>
                <span className="font-headline font-bold" style={{ fontSize: '11px', color: 'white' }}>{w.name}</span>
              </div>
              <span style={{ fontSize: '9px', color: '#777575' }}>{w.description}</span>
            </button>
          ))}
        </div>

        {/* Preview */}
        {selectedWidget && (
          <div style={{ width: '300px', flexShrink: 0, backgroundColor: '#131313', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: CATEGORY_COLORS[selectedWidget.category] }}>{selectedWidget.icon}</span>
              <span className="font-headline font-bold" style={{ fontSize: '14px', color: 'white' }}>{selectedWidget.name}</span>
            </div>
            <span style={{ fontSize: '10px', color: '#adaaaa' }}>{selectedWidget.description}</span>
            <div style={{ fontSize: '9px', color: '#494847' }}>Categoria: {selectedWidget.category} · Height: {selectedWidget.height}px</div>
            {/* Live preview */}
            <div style={{ backgroundColor: '#0e0e0e', padding: '4px', overflow: 'hidden', minHeight: selectedWidget.height ?? 60 }}>
              <selectedWidget.component />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
