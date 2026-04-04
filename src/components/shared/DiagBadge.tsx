import { useState, useEffect } from 'react';
import { localRideStore } from '../../services/storage/LocalRideStore';
import { isKromiWebView, getKromiAppVersion } from '../../utils/platform';
import { useAuthStore } from '../../store/authStore';
import { useMapStore } from '../../store/mapStore';
import { rideSessionManager } from '../../services/storage/RideHistory';

/**
 * DiagBadge — small diagnostic overlay showing system status.
 * Visible in both WebView and Chrome. Tap to expand details.
 * Helps debug data flow: IDB → Supabase sync status.
 */
export function DiagBadge() {
  const [expanded, setExpanded] = useState(false);
  const [idbOk, setIdbOk] = useState<boolean | null>(null);
  const [supOk, setSupOk] = useState<boolean | null>(null);
  const [unsynced, setUnsynced] = useState({ sessions: 0, snapshots: 0 });
  const [lastCheck, setLastCheck] = useState('');
  const userId = useAuthStore((s) => s.getUserId());
  const isWebView = isKromiWebView();
  const appVer = getKromiAppVersion();

  useEffect(() => {
    let mounted = true;

    async function check() {
      // Test IndexedDB
      try {
        await localRideStore.init();
        if (mounted) setIdbOk(true);
      } catch {
        if (mounted) setIdbOk(false);
      }

      // Test Supabase connectivity
      try {
        const url = import.meta.env.VITE_SUPABASE_URL;
        const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (url && key) {
          const res = await fetch(`${url}/rest/v1/debug_logs?limit=1`, {
            headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
            signal: AbortSignal.timeout(5000),
          });
          if (mounted) setSupOk(res.ok);
        }
      } catch {
        if (mounted) setSupOk(false);
      }

      // Get unsynced counts
      try {
        const counts = await localRideStore.getUnsyncedCount();
        if (mounted) setUnsynced(counts);
      } catch { /* ignore */ }

      if (mounted) setLastCheck(new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }

    check();
    const id = setInterval(check, 10000); // refresh every 10s
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const rideState = rideSessionManager.getState();

  // Compact badge
  const idbColor = idbOk === null ? '#888' : idbOk ? '#3fff8b' : '#ef4444';
  const supColor = supOk === null ? '#888' : supOk ? '#3fff8b' : '#ef4444';
  const platform = isWebView ? `WV${appVer ? ' ' + appVer : ''}` : 'CHR';

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        position: 'fixed',
        bottom: 4,
        right: 4,
        zIndex: 99999,
        fontFamily: 'monospace',
        fontSize: '9px',
        lineHeight: 1.3,
        cursor: 'pointer',
        background: 'rgba(0,0,0,0.85)',
        border: '1px solid #333',
        borderRadius: 4,
        padding: expanded ? '6px 8px' : '2px 6px',
        color: '#888',
        maxWidth: expanded ? 220 : 'auto',
        userSelect: 'none',
      }}
    >
      {!expanded ? (
        // Compact: one line
        <span>
          <span style={{ color: idbColor }}>IDB</span>
          {' '}
          <span style={{ color: supColor }}>SUP</span>
          {' '}
          <span style={{ color: '#6e9bff' }}>{platform}</span>
          {unsynced.snapshots > 0 && (
            <span style={{ color: '#fbbf24' }}> {unsynced.snapshots}q</span>
          )}
        </span>
      ) : (
        // Expanded: full diagnostics
        <div>
          <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: 2 }}>KROMI Diag</div>
          <div>Platform: <span style={{ color: '#6e9bff' }}>{platform}</span></div>
          <div>IndexedDB: <span style={{ color: idbColor }}>{idbOk === null ? '...' : idbOk ? 'OK' : 'FAIL'}</span></div>
          <div>Supabase: <span style={{ color: supColor }}>{supOk === null ? '...' : supOk ? 'OK' : 'FAIL'}</span></div>
          <div>Auth: <span style={{ color: userId ? '#3fff8b' : '#ef4444' }}>{userId ? userId.slice(0, 8) + '...' : 'NULL'}</span></div>
          <div>Online: <span style={{ color: navigator.onLine ? '#3fff8b' : '#ef4444' }}>{navigator.onLine ? 'yes' : 'no'}</span></div>
          <div>GPS: <GpsStatus /></div>
          <div style={{ borderTop: '1px solid #333', marginTop: 3, paddingTop: 3 }}>
            <div>Ride: <span style={{ color: rideState.active ? '#3fff8b' : '#888' }}>{rideState.active ? `ACTIVE (${rideState.snapshotCount} snaps)` : 'none'}</span></div>
            <div>Unsynced: <span style={{ color: unsynced.sessions > 0 ? '#fbbf24' : '#888' }}>{unsynced.sessions}s {unsynced.snapshots}snap</span></div>
          </div>
          <div style={{ color: '#555', marginTop: 3 }}>Updated: {lastCheck}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={(e) => { e.stopPropagation(); window.KromiBridge?.reload?.() || window.location.reload(); }} style={{ background: '#333', color: '#3fff8b', border: 'none', padding: '3px 8px', fontSize: 9, fontFamily: 'monospace', cursor: 'pointer', borderRadius: 2 }}>REFRESH</button>
            <button onClick={(e) => { e.stopPropagation(); localRideStore.syncToSupabase(); }} style={{ background: '#333', color: '#6e9bff', border: 'none', padding: '3px 8px', fontSize: 9, fontFamily: 'monospace', cursor: 'pointer', borderRadius: 2 }}>FORCE SYNC</button>
          </div>
        </div>
      )}
    </div>
  );
}

function GpsStatus() {
  const active = useMapStore((s) => s.gpsActive);
  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const err = useMapStore((s) => s.gpsError);

  if (err) return <span style={{ color: '#ef4444' }}>ERR: {err}</span>;
  if (!active) return <span style={{ color: '#fbbf24' }}>waiting...</span>;
  if (lat === 0 && lng === 0) return <span style={{ color: '#fbbf24' }}>fixing...</span>;
  return <span style={{ color: '#3fff8b' }}>{lat.toFixed(4)},{lng.toFixed(4)}</span>;
}
