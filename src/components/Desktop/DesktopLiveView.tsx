import { useState } from 'react';
import { DashboardPreview } from './DashboardPreview';
import { WidgetLibrary } from './WidgetLibrary';
import { DashboardBuilder } from './DashboardBuilder';

type DesktopTab = 'preview' | 'builder' | 'widgets';

/**
 * DesktopLiveView — main desktop screen.
 * Three tabs: Preview, Builder, Widget Library
 */
export function DesktopLiveView() {
  const [tab, setTab] = useState<DesktopTab>('preview');

  return (
    <div style={{ padding: '16px 24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
        {([
          { id: 'preview' as const, label: 'Dashboard Preview', icon: 'phone_iphone' },
          { id: 'builder' as const, label: 'Custom Builder', icon: 'construction' },
          { id: 'widgets' as const, label: 'Widget Library', icon: 'widgets' },
        ]).map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '10px', border: 'none', cursor: 'pointer',
            backgroundColor: tab === id ? '#3fff8b' : '#1a1919',
            color: tab === id ? 'black' : '#adaaaa',
            fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: '12px', textTransform: 'uppercase',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'preview' && (
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
          <div style={{ width: '320px', flexShrink: 0 }}><DashboardPreview /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ padding: '16px', backgroundColor: '#1a1919', borderLeft: '3px solid #3fff8b' }}>
              <p className="font-headline font-bold" style={{ fontSize: '14px', color: '#3fff8b' }}>Phone Preview</p>
              <p style={{ fontSize: '11px', color: '#777575', marginTop: '4px' }}>
                Visualiza os 5 dashboards como aparecem no telemóvel. Clica nos tabs para trocar.
                Se a bike estiver ligada via BLE Bridge, mostra dados em tempo real.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === 'builder' && <DashboardBuilder />}

      {tab === 'widgets' && <WidgetLibrary />}
    </div>
  );
}
