import { useDashboardStore, type DashboardId } from '../../store/dashboardStore';

const SLOTS: { id: DashboardId; label: string }[] = [
  { id: 'cruise', label: 'CRUISE' },
  { id: 'climb', label: 'CLIMB' },
  { id: 'descent', label: 'DESC' },
  { id: 'data', label: 'DATA' },
  { id: 'map', label: 'MAP' },
];

/** Navigation dots — 5 dashboards: CRUISE, CLIMB, DESC, DATA, MAP */
export function DashboardDots() {
  const active = useDashboardStore((s) => s.active);
  const manualSwitch = useDashboardStore((s) => s.manualSwitch);

  return (
    <div style={{ height: '22px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', backgroundColor: '#0e0e0e' }}>
      {SLOTS.map(({ id, label }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            onClick={() => manualSwitch(id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '3px',
              padding: '2px 6px', border: 'none', background: 'none', cursor: 'pointer',
            }}
          >
            <div style={{
              width: isActive ? '8px' : '5px', height: isActive ? '8px' : '5px', borderRadius: '50%',
              backgroundColor: isActive ? '#3fff8b' : '#494847',
              boxShadow: isActive ? '0 0 6px rgba(63,255,139,0.5)' : 'none',
              transition: 'all 0.2s',
            }} />
            <span className="font-label" style={{
              fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.08em',
              color: isActive ? '#3fff8b' : '#777575',
              fontWeight: isActive ? 700 : 400,
            }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
