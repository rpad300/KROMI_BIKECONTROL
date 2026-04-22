import { useEffect } from 'react';
import { subscribeRideTick } from '../../services/RideTickService';
import { useDashboardStore } from '../../store/dashboardStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { useLayoutStore } from '../../store/layoutStore';
import { startNavigationEngine, stopNavigationEngine } from '../../services/routes/NavigationEngine';
import { startPacing, stopPacing } from '../../services/routes/RoutePacingService';
import { useRouteStore } from '../../store/routeStore';
import { PersistentBar } from './PersistentBar';
import { DashboardDots } from './DashboardDots';
import { DashboardSwipeContainer } from './DashboardSwipeContainer';
import { TripControl } from './widgets/TripControl';
import { CustomDashboard } from './CustomDashboard';
import { CruiseDashboard } from './CruiseDashboard';
import { ClimbDashboard } from './ClimbDashboard';
import { DescentDashboard } from './DescentDashboard';
import { DataDashboard } from './DataDashboard';
import { MapDashboard } from './MapDashboard';
import { NavDashboard } from './NavDashboard';

/**
 * DashboardController — orchestrates 5 context-aware dashboards.
 * PersistentBar + Dots always visible. Active dashboard fills remaining space.
 * Auto-switches based on terrain gradient. Manual override via swipe (30s timeout).
 */
export function DashboardController() {
  const active = useDashboardStore((s) => s.active);
  const isCustomized = useLayoutStore((s) => s.isCustomized(active));

  // Wire terrain updates to dashboard store
  useEffect(() => {
    const unsub = useAutoAssistStore.subscribe((s) => {
      const gradient = s.terrain?.current_gradient_pct ?? 0;
      useDashboardStore.getState().processGradient(gradient);
    });
    return unsub;
  }, []);

  // Manual override timeout tick (via master RideTickService)
  useEffect(() => {
    return subscribeRideTick(() => useDashboardStore.getState().tick());
  }, []);

  // Start/stop NavigationEngine + RoutePacingService when route navigation changes
  const navActive = useRouteStore((s) => s.navigation.active);
  useEffect(() => {
    if (navActive) {
      startNavigationEngine();
      startPacing();
    } else {
      stopNavigationEngine();
      stopPacing();
    }
    return () => { stopNavigationEngine(); stopPacing(); };
  }, [navActive]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#0e0e0e' }}>
      <PersistentBar />
      <DashboardDots />
      {/* Trip control — start/stop/autopause */}
      <div style={{ height: '40px', flexShrink: 0 }}><TripControl /></div>
      <DashboardSwipeContainer>
        {isCustomized ? (
          /* User has a custom layout for this dashboard */
          <CustomDashboard dashboardId={active} />
        ) : (
          /* Default built-in layouts */
          <>
            {active === 'cruise' && <CruiseDashboard />}
            {active === 'climb' && <ClimbDashboard />}
            {active === 'descent' && <DescentDashboard />}
            {active === 'data' && <DataDashboard />}
            {active === 'map' && <MapDashboard />}
            {active === 'nav' && <NavDashboard />}
          </>
        )}
      </DashboardSwipeContainer>
    </div>
  );
}
