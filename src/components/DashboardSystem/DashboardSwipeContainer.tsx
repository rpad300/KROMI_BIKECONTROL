import { useRef, type ReactNode } from 'react';
import { useDashboardStore, type DashboardId } from '../../store/dashboardStore';

const SWIPE_THRESHOLD = 50; // px
const SWIPE_MAX_TIME = 400; // ms

/** Wraps dashboard content with horizontal swipe gestures */
export function DashboardSwipeContainer({ children }: { children: ReactNode }) {
  const touchStart = useRef<{ x: number; t: number } | null>(null);
  const manualSwitch = useDashboardStore((s) => s.manualSwitch);
  const autoContext = useDashboardStore((s) => s.autoContext);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0]!.clientX, t: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0]!.clientX - touchStart.current.x;
    const dt = Date.now() - touchStart.current.t;
    touchStart.current = null;

    if (Math.abs(dx) < SWIPE_THRESHOLD || dt > SWIPE_MAX_TIME) return;

    const active = useDashboardStore.getState().active;
    const dir = dx < 0 ? 1 : -1; // left swipe = next, right swipe = prev

    // Context dashboards (cruise/climb/descent) act as one group at the start
    // Navigation: [context] ↔ data ↔ map
    const isContext = active === 'cruise' || active === 'climb' || active === 'descent';

    let target: DashboardId;

    if (isContext) {
      if (dir === 1) {
        // Swipe left from context → data
        target = 'data';
      } else {
        // Swipe right from context → cycle between cruise/climb/descent
        const contextOrder: DashboardId[] = ['cruise', 'climb', 'descent'];
        const idx = contextOrder.indexOf(active);
        const prevIdx = idx - 1;
        if (prevIdx >= 0) {
          target = contextOrder[prevIdx]!;
        } else {
          // Already at first context dashboard, wrap to last
          target = contextOrder[contextOrder.length - 1]!;
        }
      }
    } else if (active === 'data') {
      if (dir === 1) {
        target = 'map'; // data → map
      } else {
        target = autoContext; // data → back to context
      }
    } else if (active === 'map') {
      if (dir === 1) {
        target = 'nav'; // map → nav
      } else {
        target = 'data'; // map → data
      }
    } else if (active === 'nav') {
      if (dir === 1) {
        target = autoContext; // nav → wrap to context (circular)
      } else {
        target = 'map'; // nav → map
      }
    } else {
      return;
    }

    manualSwitch(target);
    try { navigator.vibrate?.(30); } catch { /* ignore */ }
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      {children}
    </div>
  );
}
