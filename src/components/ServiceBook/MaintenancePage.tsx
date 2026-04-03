import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import {
  getSchedulesForBike, seedSchedulesForBike, resetScheduleAfterService,
} from '../../services/maintenance/MaintenanceService';
import { getDefaultSchedule, type MaintenanceSchedule } from '../../types/service.types';

export function MaintenancePage({ bikeId, onBack }: { bikeId: string; onBack: () => void }) {
  const userId = useAuthStore((s) => s.user?.id);
  const bike = safeBikeConfig(useSettingsStore((s) => s.bikes.find((b) => b.id === bikeId)));
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      let data = await getSchedulesForBike(bikeId, userId);
      // Auto-seed if empty
      if (data.length === 0) {
        const defaults = getDefaultSchedule(bike.bike_type, bike.suspension as 'rigid' | 'hardtail' | 'full');
        await seedSchedulesForBike(bikeId, userId, defaults);
        data = await getSchedulesForBike(bikeId, userId);
      }
      setSchedules(data);
      setLoading(false);
    })();
  }, [bikeId, userId, bike.bike_type, bike.suspension]);

  const handleReset = async (schedule: MaintenanceSchedule) => {
    if (!confirm(`Marcar "${schedule.component_name}" como feito agora?`)) return;
    await resetScheduleAfterService(schedule.id, '', 0, 0);
    if (userId) {
      const data = await getSchedulesForBike(bikeId, userId);
      setSchedules(data);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#adaaaa' }}>arrow_back</span>
        </button>
        <div>
          <div className="font-headline font-bold" style={{ fontSize: '16px', color: '#ff9f43' }}>Manutenção Programada</div>
          <div style={{ fontSize: '10px', color: '#777575' }}>{bike.name}</div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {schedules.map((s) => (
            <WearCard key={s.id} schedule={s} onReset={() => handleReset(s)} />
          ))}
        </div>
      )}

      <div style={{ fontSize: '9px', color: '#494847', textAlign: 'center', padding: '8px' }}>
        Intervalos ajustáveis. Desgaste calculado a partir do odómetro do motor BLE.
      </div>
    </div>
  );
}

function WearCard({ schedule, onReset }: { schedule: MaintenanceSchedule; onReset: () => void }) {
  const s = schedule;
  const wear = Math.min(100, s.wear_pct);
  const isOverdue = wear >= 100;
  const isWarning = wear >= 75;

  // Build interval description
  const intervals: string[] = [];
  if (s.interval_km) intervals.push(`${s.interval_km}km`);
  if (s.interval_hours) intervals.push(`${s.interval_hours}h`);
  if (s.interval_months) intervals.push(`${s.interval_months} meses`);

  // Progress description
  const progress: string[] = [];
  if (s.interval_km && s.current_km > 0) progress.push(`${s.current_km.toFixed(0)}/${s.interval_km}km`);
  if (s.interval_hours && s.current_hours > 0) progress.push(`${s.current_hours.toFixed(0)}/${s.interval_hours}h`);
  if (s.last_service_date) {
    const months = Math.round((Date.now() - new Date(s.last_service_date).getTime()) / (30 * 86400000));
    if (s.interval_months) progress.push(`${months}/${s.interval_months} meses`);
  }

  const barColor = isOverdue ? '#ff716c' : isWarning ? '#fbbf24' : '#3fff8b';

  return (
    <div style={{
      padding: '12px', backgroundColor: '#131313', borderRadius: '6px',
      borderLeft: `3px solid ${barColor}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px', color: barColor }}>
            {isOverdue ? 'warning' : 'build'}
          </span>
          <div>
            <div style={{ fontSize: '12px', color: 'white', fontWeight: 600 }}>{s.component_name ?? s.component_type}</div>
            <div style={{ fontSize: '9px', color: '#777575' }}>
              Intervalo: {intervals.join(' / ') || '—'}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '14px', color: barColor, fontWeight: 700 }}>{wear.toFixed(0)}%</div>
          {isOverdue && <div style={{ fontSize: '8px', color: '#ff716c', fontWeight: 700 }}>VENCIDO</div>}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: '8px', height: '4px', backgroundColor: 'rgba(73,72,71,0.2)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, wear)}%`, backgroundColor: barColor, borderRadius: '2px', transition: 'width 0.3s' }} />
      </div>

      {/* Progress text */}
      {progress.length > 0 && (
        <div style={{ fontSize: '9px', color: '#777575', marginTop: '4px' }}>
          {progress.join(' · ')}
        </div>
      )}

      {/* Last service */}
      {s.last_service_date && (
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '2px' }}>
          Último: {new Date(s.last_service_date).toLocaleDateString('pt-PT')}
        </div>
      )}

      {/* Reset button */}
      <button onClick={onReset} style={{
        marginTop: '6px', padding: '4px 10px', fontSize: '9px', fontWeight: 700,
        backgroundColor: 'rgba(63,255,139,0.1)', color: '#3fff8b', border: '1px solid rgba(63,255,139,0.2)',
        borderRadius: '3px', cursor: 'pointer',
      }}>
        Marcar como feito
      </button>
    </div>
  );
}
