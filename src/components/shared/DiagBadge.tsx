import { useState, useEffect, useCallback } from 'react';
import { localRideStore } from '../../services/storage/LocalRideStore';
import { isKromiWebView, getKromiAppVersion } from '../../utils/platform';
import { useAuthStore } from '../../store/authStore';
import { useMapStore } from '../../store/mapStore';
import { useBikeStore } from '../../store/bikeStore';
import { rideSessionManager } from '../../services/storage/RideHistory';
import { wsClient } from '../../services/bluetooth/WebSocketBLEClient';
import { supaFetch } from '../../lib/supaFetch';

function dlog(msg: string, data?: Record<string, unknown>) {
  supaFetch('/rest/v1/debug_logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ level: 'info', message: msg, data: { ...data, ts: new Date().toISOString() } }),
  }).catch(() => {});
}

export function DiagBadge() {
  const [expanded, setExpanded] = useState(false);
  const [idbOk, setIdbOk] = useState<boolean | null>(null);
  const [supOk, setSupOk] = useState<boolean | null>(null);
  const [unsynced, setUnsynced] = useState({ sessions: 0, snapshots: 0 });
  const [lastCheck, setLastCheck] = useState('');
  const [sendStatus, setSendStatus] = useState('');
  const userId = useAuthStore((s) => s.getUserId());
  const isWebView = isKromiWebView();
  const appVer = getKromiAppVersion();

  // Live sensor values from bikeStore
  const hr = useBikeStore((s) => s.hr_bpm);
  const speed = useBikeStore((s) => s.speed_kmh);
  const power = useBikeStore((s) => s.power_watts);
  const cadence = useBikeStore((s) => s.cadence_rpm);
  const battery = useBikeStore((s) => s.battery_percent);
  const torque = useBikeStore((s) => s.torque_nm);
  const pressure = useBikeStore((s) => s.pressure_hpa);
  const temp = useBikeStore((s) => s.temperature_c);
  const lean = useBikeStore((s) => s.lean_angle_deg);
  const lux = useBikeStore((s) => s.light_lux);
  const magHeading = useBikeStore((s) => s.mag_heading_deg);
  const gyroX = useBikeStore((s) => s.gyro_x);
  const crashMag = useBikeStore((s) => s.crash_magnitude);
  const assist = useBikeStore((s) => s.assist_mode);
  const bleStatus = useBikeStore((s) => s.ble_status);

  useEffect(() => {
    let mounted = true;
    async function check() {
      try { await localRideStore.init(); if (mounted) setIdbOk(true); } catch { if (mounted) setIdbOk(false); }
      try {
        await supaFetch('/rest/v1/debug_logs?limit=1', { signal: AbortSignal.timeout(5000) });
        if (mounted) setSupOk(true);
      } catch { if (mounted) setSupOk(false); }
      try { const c = await localRideStore.getUnsyncedCount(); if (mounted) setUnsynced(c); } catch {}
      if (mounted) setLastCheck(new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    check();
    const id = setInterval(check, 10000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Send live sensor snapshot to Supabase debug_logs (no ride needed)
  const sendSensorLog = useCallback(() => {
    const bike = useBikeStore.getState();
    const map = useMapStore.getState();
    setSendStatus('sending...');
    dlog('SENSOR_SNAPSHOT', {
      hr: bike.hr_bpm, hr_zone: bike.hr_zone,
      speed: bike.speed_kmh, power: bike.power_watts, cadence: bike.cadence_rpm,
      battery: bike.battery_percent, assist: bike.assist_mode, torque: bike.torque_nm,
      gear: bike.gear, front_gear: bike.front_gear, rear_gear: bike.rear_gear,
      pressure: bike.pressure_hpa, temp: bike.temperature_c, lean: bike.lean_angle_deg,
      lux: bike.light_lux, mag_heading: bike.mag_heading_deg,
      gyro_x: bike.gyro_x, gyro_y: bike.gyro_y, gyro_z: bike.gyro_z,
      crash_mag: bike.crash_magnitude,
      baro_alt: bike.barometric_altitude_m, spo2: bike.spo2_pct,
      lat: map.latitude, lng: map.longitude, alt: map.altitude, gps_acc: map.accuracy,
      ble: bike.ble_status, range: bike.range_km, assist_current: bike.assist_current_a,
    });
    setTimeout(() => setSendStatus('sent!'), 300);
    setTimeout(() => setSendStatus(''), 2000);
  }, []);

  const rideState = rideSessionManager.getState();
  const idbColor = idbOk === null ? '#888' : idbOk ? '#3fff8b' : '#ef4444';
  const supColor = supOk === null ? '#888' : supOk ? '#3fff8b' : '#ef4444';
  const platform = isWebView ? `WV${appVer ? ' ' + appVer : ''}` : 'CHR';

  const val = (v: number, color: string) => <span style={{ color: v > 0 ? color : '#555' }}>{v || 0}</span>;

  return (
    <div
      onClick={() => !expanded && setExpanded(true)}
      style={{
        position: 'fixed', bottom: 4, right: 4, zIndex: 99999,
        fontFamily: 'monospace', fontSize: '9px', lineHeight: 1.4, cursor: 'pointer',
        background: 'rgba(0,0,0,0.9)', border: '1px solid #333', borderRadius: 4,
        padding: expanded ? '6px 8px' : '2px 6px', color: '#888',
        maxWidth: expanded ? 250 : 'auto', userSelect: 'none',
      }}
    >
      {!expanded ? (
        <span>
          <span style={{ color: idbColor }}>IDB</span>{' '}
          <span style={{ color: supColor }}>SUP</span>{' '}
          <span style={{ color: '#6e9bff' }}>{platform}</span>
          {hr > 0 && <span style={{ color: '#ef4444' }}> {hr}bpm</span>}
          {unsynced.snapshots > 0 && <span style={{ color: '#fbbf24' }}> {unsynced.snapshots}q</span>}
        </span>
      ) : (
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: 3 }} onClick={() => setExpanded(false)}>KROMI Diag ✕</div>

          {/* System */}
          <div style={{ borderBottom: '1px solid #262626', paddingBottom: 3, marginBottom: 3 }}>
            <div>{platform} | Bridge: <BridgeStatus /> | Bike: <span style={{ color: bleStatus === 'connected' ? '#3fff8b' : '#888' }}>{bleStatus}</span></div>
            <div>IDB: <span style={{ color: idbColor }}>{idbOk ? 'OK' : 'FAIL'}</span> | SUP: <span style={{ color: supColor }}>{supOk ? 'OK' : 'FAIL'}</span> | Auth: <span style={{ color: userId ? '#3fff8b' : '#ef4444' }}>{userId ? 'OK' : 'NULL'}</span></div>
            <div>GPS: <GpsStatus /></div>
          </div>

          {/* Live Sensors */}
          <div style={{ borderBottom: '1px solid #262626', paddingBottom: 3, marginBottom: 3 }}>
            <div style={{ color: '#adaaaa', fontSize: 8, marginBottom: 2 }}>LIVE SENSORS</div>
            <div>HR: {val(hr, '#ef4444')} | Spd: {val(speed, '#3fff8b')} | Pwr: {val(power, '#6e9bff')}</div>
            <div>Cad: {val(cadence, '#fbbf24')} | Trq: {val(torque, '#f59e0b')} | Bat: {val(battery, '#3fff8b')}</div>
            <div>Assist: {val(assist, '#6e9bff')}</div>
            <div style={{ color: '#adaaaa', fontSize: 8, marginTop: 2, marginBottom: 2 }}>PHONE SENSORS</div>
            <div>Lean: {val(lean, '#6e9bff')}° | Lux: {val(lux, '#fbbf24')} | Compass: {val(magHeading, '#22c55e')}°</div>
            <div>Baro: {val(pressure, '#22c55e')}hPa | Temp: {val(temp, '#f59e0b')}°C</div>
            <div>Gyro: {val(gyroX, '#6e9bff')} | Crash: {val(crashMag, '#ef4444')}g</div>
          </div>

          {/* Ride */}
          <div style={{ borderBottom: '1px solid #262626', paddingBottom: 3, marginBottom: 3 }}>
            <div>Ride: <span style={{ color: rideState.active ? '#3fff8b' : '#888' }}>{rideState.active ? `ACTIVE (${rideState.snapshotCount} snaps)` : 'none'}</span></div>
            <div>Unsynced: <span style={{ color: unsynced.sessions > 0 ? '#fbbf24' : '#888' }}>{unsynced.sessions}s {unsynced.snapshots}snap</span></div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button onClick={() => { window.KromiBridge?.reload?.() || window.location.reload(); }} style={btnStyle('#3fff8b')}>REFRESH</button>
            <button onClick={() => localRideStore.syncToSupabase()} style={btnStyle('#6e9bff')}>SYNC</button>
            <button onClick={sendSensorLog} style={btnStyle('#f59e0b')}>SEND LOG</button>
          </div>
          {sendStatus && <div style={{ color: '#3fff8b', marginTop: 2 }}>{sendStatus}</div>}
          <div style={{ color: '#555', marginTop: 3 }}>Updated: {lastCheck}</div>
        </div>
      )}
    </div>
  );
}

const btnStyle = (color: string): React.CSSProperties => ({
  background: '#262626', color, border: 'none', padding: '4px 8px',
  fontSize: 9, fontFamily: 'monospace', cursor: 'pointer', borderRadius: 2, fontWeight: 'bold',
});

function BridgeStatus() {
  const [connected, setConnected] = useState(wsClient.isConnected);
  useEffect(() => {
    const id = setInterval(() => setConnected(wsClient.isConnected), 2000);
    return () => clearInterval(id);
  }, []);
  return <span style={{ color: connected ? '#3fff8b' : '#ef4444' }}>{connected ? 'OK' : 'OFF'}</span>;
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
