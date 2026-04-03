import { useState } from 'react';
import { useDashboardStore, type DashboardId } from '../../store/dashboardStore';
import { CruiseDashboard } from '../DashboardSystem/CruiseDashboard';
import { ClimbDashboard } from '../DashboardSystem/ClimbDashboard';
import { DescentDashboard } from '../DashboardSystem/DescentDashboard';
import { DataDashboard } from '../DashboardSystem/DataDashboard';
import { MapDashboard } from '../DashboardSystem/MapDashboard';
import { PersistentBar } from '../DashboardSystem/PersistentBar';
import { DashboardDots } from '../DashboardSystem/DashboardDots';
import { TripControl } from '../DashboardSystem/widgets/TripControl';

const TABS: { id: DashboardId; label: string }[] = [
  { id: 'cruise', label: 'CRUISE' },
  { id: 'climb', label: 'CLIMB' },
  { id: 'descent', label: 'DESCENT' },
  { id: 'data', label: 'DATA' },
  { id: 'map', label: 'MAP' },
];

/**
 * DashboardPreview — shows a phone-sized mockup with the actual dashboard
 * components rendered inside. Desktop users can preview what mobile sees.
 */
export function DashboardPreview() {
  const [previewTab, setPreviewTab] = useState<DashboardId>('cruise');
  const autoContext = useDashboardStore((s) => s.autoContext);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b' }}>Dashboard Preview</h2>
        <span style={{ fontSize: '10px', color: '#777575' }}>
          Auto: <span style={{ color: '#3fff8b', fontWeight: 700, textTransform: 'uppercase' }}>{autoContext}</span>
        </span>
      </div>

      {/* Tab buttons */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setPreviewTab(id)}
            style={{
              flex: 1, padding: '6px', border: 'none', cursor: 'pointer',
              fontFamily: "'Space Grotesk'", fontWeight: 900, fontSize: '11px',
              textTransform: 'uppercase', letterSpacing: '0.03em',
              backgroundColor: previewTab === id ? '#3fff8b' : '#262626',
              color: previewTab === id ? 'black' : '#adaaaa',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Phone mockup container */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative' }}>
          {/* Phone frame */}
          <div style={{
            width: '280px', height: '580px',
            border: '3px solid #494847', borderRadius: '28px',
            overflow: 'hidden', backgroundColor: '#0e0e0e',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            {/* Scaled content — actual mobile dashboard */}
            <div style={{
              width: '390px', height: '810px',
              transform: 'scale(0.718)', transformOrigin: 'top left',
              overflow: 'hidden',
            }}>
              {/* Replicate DashboardController layout */}
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#0e0e0e' }}>
                <PersistentBar />
                <DashboardDots />
                <div style={{ height: '40px', flexShrink: 0 }}><TripControl /></div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  {previewTab === 'cruise' && <CruiseDashboard />}
                  {previewTab === 'climb' && <ClimbDashboard />}
                  {previewTab === 'descent' && <DescentDashboard />}
                  {previewTab === 'data' && <DataDashboard />}
                  {previewTab === 'map' && <MapDashboard />}
                </div>
              </div>
            </div>
          </div>

          {/* Phone notch */}
          <div style={{ position: 'absolute', top: '0', left: '50%', transform: 'translateX(-50%)', width: '100px', height: '20px', backgroundColor: '#494847', borderRadius: '0 0 12px 12px' }} />
        </div>
      </div>
    </div>
  );
}
