/**
 * Phone Sensor Panel — shows all phone sensors with live status.
 * Data comes from BLE Bridge (PhoneSensorService in APK) via WebSocket,
 * or from WebSensorService (web fallback) when APK is not available.
 *
 * Sensors are ALWAYS active by default — no toggle needed.
 */
import { useEffect, useState } from 'react';
import { useBikeStore } from '../../store/bikeStore';

interface SensorInfo {
  name: string;
  icon: string;
  getValue: () => string;
  getStatus: () => 'active' | 'unavailable' | 'idle';
  color: string;
}

export function PhoneSensorPanel() {
  const [, forceUpdate] = useState(0);

  // Force re-render every 2s to refresh sensor values
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const bike = useBikeStore.getState();

  const sensors: SensorInfo[] = [
    {
      name: 'Rotation Vector',
      icon: 'explore',
      getValue: () => bike.mag_heading_deg > 0 ? `${Math.round(bike.mag_heading_deg)}°` : '--',
      getStatus: () => bike.mag_heading_deg > 0 ? 'active' : 'idle',
      color: 'var(--ev-primary)',
    },
    {
      name: 'Acelerometro',
      icon: 'vibration',
      getValue: () => bike.lean_angle_deg !== 0 ? `${bike.lean_angle_deg.toFixed(0)}°` : '--',
      getStatus: () => bike.lean_angle_deg !== 0 ? 'active' : 'idle',
      color: 'var(--ev-secondary)',
    },
    {
      name: 'Barometro',
      icon: 'speed',
      getValue: () => bike.barometric_altitude_m > 0 ? `${Math.round(bike.barometric_altitude_m)}m` : 'N/D',
      getStatus: () => bike.barometric_altitude_m > 0 ? 'active' : 'unavailable',
      color: 'var(--ev-tertiary)',
    },
    {
      name: 'Luminosidade',
      icon: 'light_mode',
      getValue: () => bike.light_lux > 0 ? `${Math.round(bike.light_lux)} lux` : '--',
      getStatus: () => bike.light_lux > 0 ? 'active' : 'idle',
      color: 'var(--ev-secondary)',
    },
    {
      name: 'Temperatura',
      icon: 'thermostat',
      getValue: () => bike.temperature_c > 0 ? `${bike.temperature_c.toFixed(0)}°C` : 'N/D',
      getStatus: () => bike.temperature_c > 0 ? 'active' : 'unavailable',
      color: 'var(--ev-secondary)',
    },
    {
      name: 'Gravidade',
      icon: 'south',
      getValue: () => {
        // Gravity sensor used for gradient estimation
        const gradient = (bike as any).gradient_estimate_pct;
        return gradient !== undefined && gradient !== 0 ? `${gradient > 0 ? '+' : ''}${gradient.toFixed(1)}%` : '--';
      },
      getStatus: () => 'active', // gravity sensor always available on Android
      color: 'var(--ev-primary)',
    },
    {
      name: 'Proximidade',
      icon: 'phone_android',
      getValue: () => (bike as any).in_pocket ? 'Bolso' : 'Livre',
      getStatus: () => 'active',
      color: 'var(--ev-on-surface-variant)',
    },
    {
      name: 'Pedometro',
      icon: 'directions_walk',
      getValue: () => {
        const steps = (bike as any).step_count ?? 0;
        return steps > 0 ? `${steps} passos` : '--';
      },
      getStatus: () => ((bike as any).step_count ?? 0) > 0 ? 'active' : 'idle',
      color: 'var(--ev-primary)',
    },
    {
      name: 'Crash Detection',
      icon: 'warning',
      getValue: () => bike.crash_magnitude > 0 ? `${bike.crash_magnitude.toFixed(1)}g` : 'OK',
      getStatus: () => bike.last_crash_at > 0 && Date.now() - bike.last_crash_at < 60000 ? 'active' : 'idle',
      color: 'var(--ev-error)',
    },
    {
      name: 'Roughness',
      icon: 'landscape',
      getValue: () => {
        const roughness = (bike as any).terrain_roughness_g ?? 0;
        return roughness > 0 ? `${roughness.toFixed(2)}g` : '--';
      },
      getStatus: () => ((bike as any).terrain_roughness_g ?? 0) > 0 ? 'active' : 'idle',
      color: 'var(--ev-secondary)',
    },
  ];

  const activeCount = sensors.filter((s) => s.getStatus() === 'active').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm" style={{ color: 'var(--ev-secondary)' }}>smartphone</span>
          <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--ev-on-surface-muted)' }}>
            Sensores do Telemovel
          </span>
        </div>
        <span className="text-[10px] font-bold" style={{ color: 'var(--ev-primary)' }}>
          {activeCount}/{sensors.length} activos
        </span>
      </div>

      {/* Sensor grid */}
      <div className="grid grid-cols-2 gap-1">
        {sensors.map((sensor) => {
          const status = sensor.getStatus();
          const value = sensor.getValue();
          return (
            <div
              key={sensor.name}
              className="flex items-center gap-2 px-3 py-2"
              style={{
                backgroundColor: 'var(--ev-surface-low)',
                borderLeft: `2px solid ${status === 'active' ? sensor.color : status === 'unavailable' ? 'var(--ev-error)' : 'var(--ev-outline-variant)'}`,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: '16px',
                  color: status === 'active' ? sensor.color : 'var(--ev-on-surface-muted)',
                }}
              >
                {sensor.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] uppercase tracking-wider font-bold truncate" style={{ color: 'var(--ev-on-surface-muted)' }}>
                  {sensor.name}
                </p>
                <p className="font-mono text-xs font-bold tabular-nums" style={{
                  color: status === 'active' ? 'var(--ev-on-surface)' : status === 'unavailable' ? 'var(--ev-error)' : 'var(--ev-on-surface-muted)',
                }}>
                  {value}
                </p>
              </div>
              {/* Status dot */}
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: status === 'active' ? sensor.color : status === 'unavailable' ? 'var(--ev-error)' : 'var(--ev-outline-variant)',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Auto-active note */}
      <p className="text-[9px] mt-2 px-1" style={{ color: 'var(--ev-on-surface-muted)' }}>
        Sensores activam automaticamente via BLE Bridge. N/D = sensor nao disponivel neste dispositivo.
      </p>
    </div>
  );
}
