import { useRef, type ReactNode } from 'react';
import { useDashboardStore, type DashboardId } from '../../store/dashboardStore';

const SWIPE_ORDER: DashboardId[] = ['cruise', 'climb', 'descent', 'data', 'map'];
const SWIPE_THRESHOLD = 50; // px
const SWIPE_MAX_TIME = 400; // ms

/** Wraps dashboard content with horizontal swipe gestures */
export function DashboardSwipeContainer({ children }: { children: ReactNode }) {
  const touchStart = useRef<{ x: number; t: number } | null>(null);
  const manualSwitch = useDashboardStore((s) => s.manualSwitch);
  const autoContext = useDashboardStore((s) => s.autoContext);

  const getSlotIndex = (): number => {
    const active = useDashboardStore.getState().active;
    if (active === 'cruise' || active === 'climb' || active === 'descent') return 0;
    return SWIPE_ORDER.indexOf(active);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0]!.clientX, t: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0]!.clientX - touchStart.current.x;
    const dt = Date.now() - touchStart.current.t;
    touchStart.current = null;

    if (Math.abs(dx) < SWIPE_THRESHOLD || dt > SWIPE_MAX_TIME) return;

    const idx = getSlotIndex();
    const dir = dx < 0 ? 1 : -1; // left swipe = next, right swipe = prev
    const newIdx = Math.max(0, Math.min(SWIPE_ORDER.length - 1, idx + dir));

    if (newIdx !== idx) {
      const target = SWIPE_ORDER[newIdx]!;
      // Slot 0 = auto context (cruise/climb/descent)
      manualSwitch(target === 'cruise' ? autoContext : target);
      // Haptic feedback
      try { navigator.vibrate?.(30); } catch { /* ignore */ }
    }
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
