import { useBikeStore } from '../../../store/bikeStore';
import { useAutoAssistStore } from '../../../store/autoAssistStore';
import { useTorqueStore } from '../../../store/torqueStore';
import { ASSIST_MODE_LABELS } from '../../../types/bike.types';

/**
 * CompactIntelligence — shows KROMI motor intelligence status.
 * Always visible — shows motor state even when auto-assist is off.
 * When KROMI is active: shows reason, intensity, factors.
 * When off: shows current motor mode + support level.
 */
export function CompactIntelligence() {
  const enabled = useAutoAssistStore((s) => s.enabled);
  const reason = useAutoAssistStore((s) => s.lastDecision?.reason ?? '');
  const isPreemptive = useAutoAssistStore((s) => s.lastDecision?.is_preemptive ?? false);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const power = useBikeStore((s) => s.power_watts);
  const torqueSupport = useTorqueStore((s) => s.support_pct);
  const modeName = ASSIST_MODE_LABELS[assistMode] ?? '?';

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: '100%', backgroundColor: '#131313', borderTop: '1px solid rgba(73,72,71,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{
          width: '6px', height: '6px', borderRadius: '50%',
          backgroundColor: enabled ? '#3fff8b' : power > 0 ? '#6e9bff' : '#494847',
          boxShadow: enabled ? '0 0 6px rgba(63,255,139,0.5)' : 'none',
        }} />
        <span className="font-label" style={{
          fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
          color: enabled ? '#3fff8b' : '#6e9bff',
        }}>
          {enabled ? 'KROMI' : modeName}
        </span>
        <span style={{ fontSize: '10px', color: '#adaaaa' }}>
          {enabled
            ? (isPreemptive ? `⚡ ${reason}` : reason || 'Active')
            : (power > 0 ? `${power}W` : 'Motor idle')
          }
        </span>
      </div>

      {/* Support bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {torqueSupport > 0 && (
          <>
            <div style={{ width: '40px', height: '4px', backgroundColor: '#262626', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(torqueSupport, 100)}%`, height: '100%',
                backgroundColor: torqueSupport > 70 ? '#ff716c' : torqueSupport > 40 ? '#fbbf24' : '#3fff8b',
              }} />
            </div>
            <span className="font-headline font-bold tabular-nums" style={{ fontSize: '10px', color: '#adaaaa' }}>{torqueSupport}%</span>
          </>
        )}
        {enabled && (
          <span className="font-label" style={{ fontSize: '8px', color: '#3fff8b', padding: '1px 4px', backgroundColor: 'rgba(63,255,139,0.1)', border: '1px solid rgba(63,255,139,0.2)' }}>AUTO</span>
        )}
      </div>
    </div>
  );
}
