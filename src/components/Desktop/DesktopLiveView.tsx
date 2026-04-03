import { DashboardPreview } from './DashboardPreview';
import { WidgetLibrary } from './WidgetLibrary';

/**
 * DesktopLiveView — main desktop screen replacing LiveRideView.
 * Shows phone dashboard preview + widget library catalog.
 */
export function DesktopLiveView() {
  return (
    <div style={{ padding: '16px 24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Two-column layout: preview + library */}
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        {/* Left: Phone preview (fixed width) */}
        <div style={{ width: '320px', flexShrink: 0 }}>
          <DashboardPreview />
        </div>

        {/* Right: Widget library (flex) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <WidgetLibrary />

          {/* Coming soon: custom builder */}
          <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#1a1919', borderLeft: '3px solid #e966ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#e966ff' }}>construction</span>
              <span className="font-headline font-bold" style={{ fontSize: '14px', color: '#e966ff' }}>Custom Dashboard Builder</span>
            </div>
            <p style={{ fontSize: '11px', color: '#777575', marginTop: '6px' }}>
              Em breve: arrasta widgets para criar dashboards personalizados. Os layouts são guardados no Supabase e sincronizados com o telemóvel.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
