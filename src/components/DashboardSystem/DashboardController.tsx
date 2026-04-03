import { useEffect } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { PersistentBar } from './PersistentBar';
import { DashboardDots } from './DashboardDots';
import { DashboardSwipeContainer } from './DashboardSwipeContainer';
import { CruiseDashboard } from './CruiseDashboard';
import { ClimbDashboard } from './ClimbDashboard';
import { DescentDashboard } from './DescentDashboard';
import { DataDashboard } from './DataDashboard';
import { MapDashboard } from './MapDashboard';

/**
 * DashboardController — orchestrates 5 context-aware dashboards.
 * PersistentBar + Dots always visible. Active dashboard fills remaining space.
 * Auto-switches based on terrain gradient. Manual override via swipe (30s timeout).
 */
export function DashboardController() {
  const active = useDashboardStore((s) => s.active);

  // Wire terrain updates to dashboard store
  useEffect(() => {
    const unsub = useAutoAssistStore.subscribe((s) => {
      const gradient = s.terrain?.current_gradient_pct ?? 0;
      useDashboardStore.getState().processGradient(gradient);
    });
    return unsub;
  }, []);

  // Manual override timeout tick (1s interval)
  useEffect(() => {
    const interval = setInterval(() => {
      useDashboardStore.getState().tick();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#0e0e0e' }}>
      <PersistentBar />
      <DashboardDots />
      <DashboardSwipeContainer>
        {active === 'cruise' && <CruiseDashboard />}
        {active === 'climb' && <ClimbDashboard />}
        {active === 'descent' && <DescentDashboard />}
        {active === 'data' && <DataDashboard />}
        {active === 'map' && <MapDashboard />}
      </DashboardSwipeContainer>
    </div>
  );
}
