import { useLayoutStore } from '../../store/layoutStore';
import { WIDGET_REGISTRY } from '../../store/widgetRegistry';
import type { DashboardId } from '../../store/dashboardStore';

// Widget component map — lazy but explicit to avoid circular deps
import { SpeedHero } from './widgets/SpeedHero';
import { GradientHero } from './widgets/GradientHero';
import { CompactIntelligence } from './widgets/CompactIntelligence';
import { TripControl } from './widgets/TripControl';
import { MetricGrid, METRIC } from './widgets/MetricGrid';
import { PersistentBar } from './PersistentBar';
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
import { ElevationProfile } from '../Dashboard/ElevationProfile';
import { MiniMap } from '../Dashboard/MiniMap';

const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  speed_hero: SpeedHero,
  gradient_hero: GradientHero,
  persistent_bar: PersistentBar,
  trip_control: TripControl,
  trip_stats: TripStatsWidget,
  metric_grid_4: () => <MetricGrid cols={4} metrics={[METRIC.range, METRIC.power, METRIC.battery, METRIC.cadence]} />,
  metric_grid_2: () => <MetricGrid cols={2} metrics={[METRIC.power, METRIC.torque]} />,
  compact_kromi: CompactIntelligence,
  intelligence: IntelligenceWidget,
  hr: HRWidget,
  profile: ProfileInsightsWidget,
  battery: BatteryWidget,
  motor: MotorWidget,
  torque: TorqueWidget,
  gear: GearWidget,
  assist_modes: AssistModeWidget,
  weather: WeatherWidget,
  trail: TrailWidget,
  elevation: ElevationProfile,
  minimap: MiniMap,
  ride_session: RideSessionWidget,
};

/**
 * CustomDashboard — renders user-defined widget layout from layoutStore.
 * Each widget gets its defined height percentage of the available space.
 * Falls back to default layout if no custom layout exists.
 */
export function CustomDashboard({ dashboardId }: { dashboardId: DashboardId }) {
  const layout = useLayoutStore((s) => s.getLayout(dashboardId));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#0e0e0e' }}>
      {layout.map((widgetId, idx) => {
        const Component = WIDGET_COMPONENTS[widgetId];
        const def = WIDGET_REGISTRY.find((w) => w.id === widgetId);
        if (!Component) return null;

        return (
          <div key={`${widgetId}-${idx}`} style={{ height: `${def?.heightPct ?? 10}%`, flexShrink: 0, overflow: 'hidden' }}>
            <Component />
          </div>
        );
      })}
    </div>
  );
}
