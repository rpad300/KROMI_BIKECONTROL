import { useAutoAssistStore } from '../../../store/autoAssistStore';

/** Single-line KROMI intelligence status — shows reason + intensity */
export function CompactIntelligence() {
  const enabled = useAutoAssistStore((s) => s.enabled);
  const reason = useAutoAssistStore((s) => s.lastDecision?.reason ?? '');
  const newMode = useAutoAssistStore((s) => s.lastDecision?.new_mode ?? 0);
  const intensity = Math.round((newMode / 5) * 100); // mode 0-5 mapped to 0-100%

  if (!enabled) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: '100%', backgroundColor: '#131313' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3fff8b', boxShadow: '0 0 6px rgba(63,255,139,0.5)' }} />
        <span className="font-label" style={{ fontSize: '10px', color: '#3fff8b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>KROMI</span>
        <span style={{ fontSize: '10px', color: '#adaaaa' }}>{reason || 'Active'}</span>
      </div>
      {/* Intensity bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <div style={{ width: '40px', height: '4px', backgroundColor: '#262626', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(intensity, 100)}%`, height: '100%', backgroundColor: intensity > 70 ? '#ff716c' : intensity > 40 ? '#fbbf24' : '#3fff8b' }} />
        </div>
        <span className="font-headline font-bold tabular-nums" style={{ fontSize: '10px', color: '#adaaaa' }}>{Math.round(intensity)}%</span>
      </div>
    </div>
  );
}
