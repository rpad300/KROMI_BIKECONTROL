import { useDashboardStore } from '../../store/dashboardStore';
import type { DashboardId } from '../../store/dashboardStore';

const SLOTS: { id: DashboardId; label: string }[] = [
  { id: 'cruise', label: 'CRUISE' },
  { id: 'climb', label: 'CLIMB' },
  { id: 'descent', label: 'DESC' },
  { id: 'data', label: 'DATA' },
  { id: 'map', label: 'MAP' },
];

/** Navigation dots — visual indicator only, swipe to navigate */
export function DashboardDots() {
  const active = useDashboardStore((s) => s.active);

  return (
    <div style={{ height: '18px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', backgroundColor: '#0e0e0e' }}>
      {SLOTS.map(({ id, label }) => {
        const isActive = id === active;
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <div style={{
              width: isActive ? '10px' : '5px', height: '5px', borderRadius: '3px',
              backgroundColor: isActive ? '#3fff8b' : '#494847',
              boxShadow: isActive ? '0 0 6px rgba(63,255,139,0.5)' : 'none',
              transition: 'all 0.2s',
            }} />
            {isActive && (
              <span className="font-label" style={{ fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3fff8b', fontWeight: 700 }}>{label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
