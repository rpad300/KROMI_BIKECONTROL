import { useSettingsStore } from '../../store/settingsStore';
import type { ComplianceRegion } from '../../services/intelligence/KromiEngine';

const REGIONS: { id: ComplianceRegion; label: string; desc: string }[] = [
  { id: 'eu', label: 'Europa (25 km/h)',    desc: 'Fade 22-25, max 250W' },
  { id: 'us', label: 'USA (32 km/h)',       desc: 'Fade 28-32, max 750W' },
  { id: 'au', label: 'Australia (25 km/h)', desc: 'Hard cutoff, max 250W' },
  { id: 'jp', label: 'Japão (24 km/h)',     desc: 'Hard cutoff, max 250W' },
];

export function ComplianceSettings() {
  const region = useSettingsStore((s) => s.compliance_region);
  const setRegion = useSettingsStore((s) => s.setComplianceRegion);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div className="font-label" style={{
        fontSize: '9px', color: '#777575', textTransform: 'uppercase',
        letterSpacing: '0.12em', paddingLeft: '4px',
      }}>
        REGULAMENTAÇÃO
      </div>
      {REGIONS.map((r) => (
        <button
          key={r.id}
          onClick={() => setRegion(r.id)}
          style={{
            width: '100%', padding: '12px', textAlign: 'left',
            backgroundColor: '#131313', cursor: 'pointer',
            border: region === r.id
              ? '1px solid #3fff8b'
              : '1px solid rgba(73,72,71,0.2)',
            color: region === r.id ? '#3fff8b' : 'white',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '13px' }}>{r.label}</div>
          <div style={{ fontSize: '11px', color: '#a0a0a0', marginTop: '2px' }}>{r.desc}</div>
        </button>
      ))}
    </div>
  );
}
