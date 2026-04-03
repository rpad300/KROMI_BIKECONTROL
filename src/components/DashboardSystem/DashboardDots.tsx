import { useDashboardStore, type DashboardId } from '../../store/dashboardStore';

const SLOTS: { id: DashboardId; label: string }[] = [
  { id: 'cruise', label: 'AUTO' },
  { id: 'data', label: 'DATA' },
  { id: 'map', label: 'MAP' },
];

/** Navigation dots — 3 slots: AUTO (cruise/climb/descent), DATA, MAP */
export function DashboardDots() {
  const active = useDashboardStore((s) => s.active);
  const manualSwitch = useDashboardStore((s) => s.manualSwitch);
  const autoContext = useDashboardStore((s) => s.autoContext);

  // AUTO slot covers cruise/climb/descent
  const activeSlot = (active === 'cruise' || active === 'climb' || active === 'descent') ? 'cruise' : active;

  return (
    <div style={{ height: '20px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', backgroundColor: '#0e0e0e' }}>
      {SLOTS.map(({ id, label }) => {
        const isActive = (id === 'cruise' && activeSlot === 'cruise') || id === active;
        const displayLabel = id === 'cruise'
          ? (active === 'climb' ? 'CLIMB' : active === 'descent' ? 'DESC' : 'CRUISE')
          : label;

        return (
          <button
            key={id}
            onClick={() => {
              if (id === 'cruise') manualSwitch(autoContext);
              else manualSwitch(id);
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '2px 8px', border: 'none', background: 'none', cursor: 'pointer',
            }}
          >
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              backgroundColor: isActive ? '#3fff8b' : '#494847',
              boxShadow: isActive ? '0 0 6px rgba(63,255,139,0.5)' : 'none',
            }} />
            <span className="font-label" style={{
              fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.1em',
              color: isActive ? '#3fff8b' : '#777575',
            }}>{displayLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
