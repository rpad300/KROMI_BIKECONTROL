import { useEffect, useRef } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { useMapStore } from '../../store/mapStore';
import { ASSIST_MODE_LABELS } from '../../types/bike.types';
import { CompactIntelligence } from './widgets/CompactIntelligence';

/** DATA Dashboard — all metrics in a dense grid, no maps, no charts */
export function DataDashboard() {
  // Use refs for ALL cells to avoid flicker
  const cells = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const update = () => {
      const b = useBikeStore.getState();
      const a = useAutoAssistStore.getState();
      const m = useMapStore.getState();
      const grad = a.terrain?.current_gradient_pct ?? 0;
      const mode = ASSIST_MODE_LABELS[b.assist_mode] ?? '?';

      const values = [
        // Row 1: Speed + Power
        b.speed_kmh > 0 ? b.speed_kmh.toFixed(1) : '0', String(b.power_watts), b.torque_nm > 0 ? b.torque_nm.toFixed(1) : '0', String(b.cadence_rpm),
        // Row 2: Motor
        mode, String(b.assist_current_a > 0 ? b.assist_current_a.toFixed(1) : '0'), String(b.rear_gear || '--'), b.front_gear > 0 ? `${b.front_gear}x` : '--',
        // Row 3: Battery
        String(b.battery_percent), String(b.battery_main_pct || b.battery_percent), String(b.battery_sub_pct || '--'), b.range_km > 0 ? Math.round(b.range_km).toString() : '--',
        // Row 4: HR
        b.hr_bpm > 0 ? String(b.hr_bpm) : '--', b.hr_bpm > 0 ? `Z${b.hr_zone}` : '--', String(b.calories || '--'), '--', // HRmax%
        // Row 5: Terrain
        `${grad > 0 ? '+' : ''}${grad.toFixed(0)}%`, `${Math.round(m.altitude ?? 0)}m`, `${b.elevation_gain_m}m`, '--', // climb type
        // Row 6: Trip
        b.trip_distance_km > 0 ? b.trip_distance_km.toFixed(1) : b.distance_km.toFixed(1),
        b.trip_time_s > 0 ? `${Math.floor(b.trip_time_s/3600)}:${String(Math.floor((b.trip_time_s%3600)/60)).padStart(2,'0')}` : '0:00',
        b.speed_kmh > 0 && b.trip_time_s > 0 ? ((b.trip_distance_km || b.distance_km) / (b.trip_time_s / 3600)).toFixed(1) : '--',
        String(b.speed_max > 0 ? b.speed_max.toFixed(0) : '--'),
        // Row 7: System
        String(b.motor_odo_km || '--'), String(b.motor_total_hours || '--'), b.tpms_front_psi > 0 ? String(b.tpms_front_psi) : '--', b.temperature_c > 0 ? `${b.temperature_c.toFixed(0)}°` : '--',
      ];

      values.forEach((v, i) => {
        if (cells.current[i]) cells.current[i]!.textContent = v;
      });
    };
    update();
    const u1 = useBikeStore.subscribe(update);
    const u2 = useAutoAssistStore.subscribe(update);
    return () => { u1(); u2(); };
  }, []);

  const rows = [
    { label: 'SPEED/POWER', fields: ['Speed', 'Power', 'Torque', 'Cadence'], units: ['km/h', 'W', 'Nm', 'RPM'], color: '#3fff8b' },
    { label: 'MOTOR', fields: ['Mode', 'Current', 'Rear Gr', 'Front Gr'], units: ['', 'A', '', ''], color: '#6e9bff' },
    { label: 'BATTERY', fields: ['SOC', 'Main', 'Sub', 'Range'], units: ['%', '%', '%', 'km'], color: '#3fff8b' },
    { label: 'HEART RATE', fields: ['BPM', 'Zone', 'Calories', 'HR%'], units: ['bpm', '', 'kcal', '%'], color: '#ff716c' },
    { label: 'TERRAIN', fields: ['Grade', 'Alt', 'D+', 'Type'], units: ['', '', '', ''], color: '#e966ff' },
    { label: 'TRIP', fields: ['Dist', 'Time', 'Avg Spd', 'Max Spd'], units: ['km', '', 'km/h', 'km/h'], color: '#fbbf24' },
    { label: 'SYSTEM', fields: ['ODO', 'Hours', 'TPMS F', 'Temp'], units: ['km', 'h', 'PSI', ''], color: '#adaaaa' },
  ];

  let cellIdx = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ flex: 1, display: 'flex', flexDirection: 'column', borderBottom: '1px solid rgba(73,72,71,0.1)' }}>
          {/* Row label */}
          <div style={{ height: '14px', display: 'flex', alignItems: 'center', paddingLeft: '8px', backgroundColor: '#0e0e0e' }}>
            <span className="font-label" style={{ fontSize: '7px', color: row.color, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{row.label}</span>
          </div>
          {/* 4 cells */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', backgroundColor: '#131313' }}>
            {row.fields.map((field, fi) => {
              const idx = cellIdx++;
              return (
                <div key={fi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: fi < 3 ? '1px solid rgba(73,72,71,0.05)' : 'none' }}>
                  <span ref={(el) => { cells.current[idx] = el; }} className="font-headline font-bold tabular-nums" style={{ fontSize: '15px', lineHeight: 1.1 }}>--</span>
                  <span className="font-label" style={{ fontSize: '7px', color: '#777575' }}>{field} {row.units[fi]}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {/* KROMI status bar */}
      <div style={{ height: '28px', flexShrink: 0 }}><CompactIntelligence /></div>
    </div>
  );
}
