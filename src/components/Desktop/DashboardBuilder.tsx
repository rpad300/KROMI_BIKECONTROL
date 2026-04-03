import { useState, useCallback } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { WIDGET_REGISTRY, CATEGORY_COLORS } from '../../store/widgetRegistry';
import type { DashboardId } from '../../store/dashboardStore';

const DASHBOARDS: { id: DashboardId; label: string; color: string }[] = [
  { id: 'cruise', label: 'CRUISE', color: '#3fff8b' },
  { id: 'climb', label: 'CLIMB', color: '#fbbf24' },
  { id: 'descent', label: 'DESC', color: '#6e9bff' },
  { id: 'data', label: 'DATA', color: '#adaaaa' },
  { id: 'map', label: 'MAP', color: '#e966ff' },
];

export function DashboardBuilder() {
  const [activeDash, setActiveDash] = useState<DashboardId>('cruise');
  const layout = useLayoutStore((s) => s.getLayout(activeDash));
  const setLayout = useLayoutStore((s) => s.setLayout);
  const resetLayout = useLayoutStore((s) => s.resetLayout);
  const isCustomized = useLayoutStore((s) => s.isCustomized(activeDash));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);

  const categories = [...new Set(WIDGET_REGISTRY.map((w) => w.category))];
  const availableWidgets = WIDGET_REGISTRY.filter((w) =>
    !layout.includes(w.id) && (!filterCat || w.category === filterCat)
  );

  const addWidget = useCallback((widgetId: string) => {
    setLayout(activeDash, [...layout, widgetId]);
  }, [activeDash, layout, setLayout]);

  const removeWidget = useCallback((idx: number) => {
    setLayout(activeDash, layout.filter((_, i) => i !== idx));
  }, [activeDash, layout, setLayout]);

  const moveWidget = useCallback((from: number, to: number) => {
    const next = [...layout];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setLayout(activeDash, next);
  }, [activeDash, layout, setLayout]);

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDrop = (idx: number) => {
    if (dragIdx !== null && dragIdx !== idx) moveWidget(dragIdx, idx);
    setDragIdx(null); setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  const totalPct = layout.reduce((sum, id) => {
    const w = WIDGET_REGISTRY.find((r) => r.id === id);
    return sum + (w?.heightPct ?? 10);
  }, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#e966ff' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '6px' }}>construction</span>
          Custom Dashboard Builder
        </h2>
        {isCustomized && (
          <button onClick={() => resetLayout(activeDash)} style={{ padding: '4px 10px', backgroundColor: '#262626', border: '1px solid rgba(255,113,108,0.3)', color: '#ff716c', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}>
            RESET TO DEFAULT
          </button>
        )}
      </div>

      {/* Dashboard tabs */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {DASHBOARDS.map(({ id, label, color }) => (
          <button key={id} onClick={() => setActiveDash(id)} style={{
            flex: 1, padding: '8px', border: 'none', cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontWeight: 900, fontSize: '11px', textTransform: 'uppercase',
            backgroundColor: activeDash === id ? color : '#262626',
            color: activeDash === id ? 'black' : '#adaaaa',
          }}>{label}</button>
        ))}
      </div>

      {/* Two columns: current layout + widget palette */}
      <div style={{ display: 'flex', gap: '16px' }}>

        {/* LEFT: Current layout (drop zone) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span className="font-label" style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Layout ({layout.length} widgets · {totalPct}% height)
            </span>
            {totalPct > 100 && <span style={{ fontSize: '9px', color: '#ff716c', fontWeight: 700 }}>⚠ Over 100%!</span>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minHeight: '200px', backgroundColor: '#131313', padding: '4px' }}>
            {layout.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#494847', fontSize: '12px' }}>
                Arrasta widgets aqui ou clica no + na paleta
              </div>
            )}

            {layout.map((widgetId, idx) => {
              const w = WIDGET_REGISTRY.find((r) => r.id === widgetId);
              if (!w) return null;
              const isDragOver = dragOverIdx === idx;
              return (
                <div
                  key={`${widgetId}-${idx}`}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                    backgroundColor: isDragOver ? '#262626' : '#1a1919',
                    borderLeft: `3px solid ${CATEGORY_COLORS[w.category]}`,
                    borderTop: isDragOver ? '2px solid #3fff8b' : '2px solid transparent',
                    cursor: 'grab', opacity: dragIdx === idx ? 0.4 : 1,
                  }}
                >
                  {/* Drag handle */}
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#494847' }}>drag_indicator</span>
                  {/* Widget info */}
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', color: CATEGORY_COLORS[w.category] }}>{w.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div className="font-headline font-bold" style={{ fontSize: '12px', color: 'white' }}>{w.name}</div>
                    <div style={{ fontSize: '9px', color: '#777575' }}>{w.heightPct}% height</div>
                  </div>
                  {/* Move buttons */}
                  <button onClick={() => idx > 0 && moveWidget(idx, idx - 1)} disabled={idx === 0}
                    style={{ background: 'none', border: 'none', cursor: idx > 0 ? 'pointer' : 'default', padding: '2px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: idx > 0 ? '#adaaaa' : '#494847' }}>arrow_upward</span>
                  </button>
                  <button onClick={() => idx < layout.length - 1 && moveWidget(idx, idx + 1)} disabled={idx === layout.length - 1}
                    style={{ background: 'none', border: 'none', cursor: idx < layout.length - 1 ? 'pointer' : 'default', padding: '2px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: idx < layout.length - 1 ? '#adaaaa' : '#494847' }}>arrow_downward</span>
                  </button>
                  {/* Remove */}
                  <button onClick={() => removeWidget(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#ff716c' }}>close</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Widget palette */}
        <div style={{ width: '280px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span className="font-label" style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Widgets ({availableWidgets.length})
            </span>
          </div>

          {/* Category filter */}
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <FilterBtn label="All" active={!filterCat} onClick={() => setFilterCat(null)} />
            {categories.map((c) => (
              <FilterBtn key={c} label={c} active={filterCat === c} color={CATEGORY_COLORS[c]} onClick={() => setFilterCat(c === filterCat ? null : c)} />
            ))}
          </div>

          {/* Available widgets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '400px', overflow: 'auto' }}>
            {availableWidgets.map((w) => (
              <button key={w.id} onClick={() => addWidget(w.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px',
                  backgroundColor: '#1a1919', border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderLeft: `2px solid ${CATEGORY_COLORS[w.category]}`,
                }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: CATEGORY_COLORS[w.category] }}>{w.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', color: 'white', fontWeight: 600 }}>{w.name}</div>
                  <div style={{ fontSize: '8px', color: '#777575' }}>{w.description}</div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#3fff8b' }}>add</span>
              </button>
            ))}
            {availableWidgets.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#494847', fontSize: '10px' }}>
                Todos os widgets estão no layout
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterBtn({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '2px 8px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
      border: 'none', cursor: 'pointer',
      backgroundColor: active ? (color ?? '#3fff8b') : '#262626',
      color: active ? 'black' : '#adaaaa',
    }}>{label}</button>
  );
}
