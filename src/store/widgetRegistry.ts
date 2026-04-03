

export interface WidgetDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: 'core' | 'motor' | 'health' | 'environment' | 'bike' | 'kromi';
  /** Suggested height percentage (of available dashboard area) */
  heightPct: number;
}

/** All available widgets — component lazy-loaded to avoid circular deps */
export const WIDGET_REGISTRY: WidgetDef[] = [
  { id: 'speed_hero', name: 'Speed Hero', icon: 'speed', description: 'Velocidade em destaque (7xl)', category: 'core', heightPct: 20 },
  { id: 'gradient_hero', name: 'Gradient Hero', icon: 'trending_up', description: 'Gradiente em destaque para subidas', category: 'core', heightPct: 15 },
  { id: 'persistent_bar', name: 'Status Bar', icon: 'info', description: 'HR, bateria, modo, KROMI', category: 'core', heightPct: 4 },
  { id: 'trip_control', name: 'Trip Control', icon: 'timer', description: 'Start/stop trip, autopause', category: 'core', heightPct: 5 },
  { id: 'trip_stats', name: 'Trip Stats', icon: 'insert_chart', description: 'Distância, tempo, calorias, D+, avg', category: 'core', heightPct: 8 },
  { id: 'metric_grid_4', name: 'Metrics (4 col)', icon: 'grid_view', description: '4 métricas: Range, Power, Bat%, Cadence', category: 'core', heightPct: 12 },
  { id: 'metric_grid_2', name: 'Metrics (2 col)', icon: 'grid_view', description: '2 métricas grandes: Power + Torque', category: 'core', heightPct: 15 },
  { id: 'compact_kromi', name: 'KROMI Compact', icon: 'psychology', description: 'Estado KROMI (1 linha)', category: 'kromi', heightPct: 5 },
  { id: 'intelligence', name: 'KROMI Full', icon: 'psychology', description: 'Intelligence completo (3 barras)', category: 'kromi', heightPct: 25 },
  { id: 'hr', name: 'Heart Rate', icon: 'favorite', description: 'BPM, zona, barra de zonas', category: 'health', heightPct: 10 },
  { id: 'profile', name: 'Athlete Profile', icon: 'person', description: 'Eficiência, forma, carga', category: 'health', heightPct: 15 },
  { id: 'battery', name: 'Battery', icon: 'battery_full', description: 'SOC, range, dual bars, ranges/modo', category: 'bike', heightPct: 12 },
  { id: 'motor', name: 'Motor Telemetry', icon: 'bolt', description: 'Power, Torque, Cadence, Current + gear', category: 'motor', heightPct: 10 },
  { id: 'torque', name: 'Torque', icon: 'electric_bolt', description: 'Climb type, Nm, Support%, Launch', category: 'motor', heightPct: 12 },
  { id: 'gear', name: 'Gear', icon: 'settings', description: 'Mudança actual + barra cassette', category: 'bike', heightPct: 8 },
  { id: 'assist_modes', name: 'Assist Modes', icon: 'tune', description: 'ECO/TOUR/ACTV/SPRT/PWR/AUTO com km', category: 'bike', heightPct: 10 },
  { id: 'weather', name: 'Weather', icon: 'cloud', description: 'Temperatura, vento, humidade', category: 'environment', heightPct: 10 },
  { id: 'trail', name: 'Trail Info', icon: 'forest', description: 'Superfície, MTB scale', category: 'environment', heightPct: 8 },
  { id: 'elevation', name: 'Elevation Profile', icon: 'terrain', description: 'Gráfico de elevação', category: 'environment', heightPct: 18 },
  { id: 'minimap', name: 'Mini Map', icon: 'map', description: 'Mapa com localização', category: 'environment', heightPct: 25 },
  { id: 'ride_session', name: 'Ride Session', icon: 'directions_bike', description: 'Start/stop ride, savings', category: 'core', heightPct: 10 },
];

export const CATEGORY_COLORS: Record<string, string> = {
  core: '#3fff8b', motor: '#fbbf24', health: '#ff716c',
  environment: '#6e9bff', bike: '#e966ff', kromi: '#e966ff',
};

/** Default layouts for each dashboard context */
export const DEFAULT_LAYOUTS: Record<string, string[]> = {
  cruise: ['speed_hero', 'metric_grid_4', 'compact_kromi', 'elevation', 'assist_modes', 'minimap'],
  climb: ['gradient_hero', 'metric_grid_2', 'hr', 'elevation', 'compact_kromi', 'assist_modes'],
  descent: ['speed_hero', 'metric_grid_4', 'elevation', 'trip_stats', 'assist_modes'],
  data: ['metric_grid_4', 'motor', 'battery', 'hr', 'trail', 'trip_stats', 'compact_kromi'],
  map: ['minimap', 'elevation', 'metric_grid_4', 'assist_modes', 'weather'],
};
