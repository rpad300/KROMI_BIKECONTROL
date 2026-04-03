import { DashboardPreview } from './DashboardPreview';
import { WidgetLibrary } from './WidgetLibrary';
import { DashboardBuilder } from './DashboardBuilder';
import { HistoricalRangeWidget } from './HistoricalRangeWidget';

/**
 * DesktopLiveView — main desktop screen.
 * Tab controlled by sidebar submenu.
 */
export function DesktopLiveView({ activeTab }: { activeTab?: string }) {
  const tab = activeTab ?? 'preview';

  return (
    <div>
      {/* Content — tab selected from sidebar */}
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

      {tab === 'range' && <HistoricalRangeWidget />}

      {tab === 'widgets' && <WidgetLibrary />}
    </div>
  );
}
