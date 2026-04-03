import { useAthleteStore } from '../../store/athleteStore';
import { batteryEfficiencyTracker } from '../../services/learning/BatteryEfficiencyTracker';
import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';

export function ProfileInsightsWidget() {
  const athleteProfile = useAthleteStore((s) => s.profile);
  const lastUpdate = useAthleteStore((s) => s.lastUpdate);
  const battery = useBikeStore((s) => s.battery_percent);

  // Source of truth: RiderProfile from settingsStore (user-edited)
  const rider = useSettingsStore((s) => s.riderProfile);

  const saving = batteryEfficiencyTracker.getSavingPercent();
  const extraKm = batteryEfficiencyTracker.getExtraRangeKm(battery);
  const accuracy = Math.round((1 - athleteProfile.stats.avg_override_rate) * 100);
  const formScore = athleteProfile.fatigue.form_score;
  const hasRides = athleteProfile.stats.total_rides > 0;

  // Use rider profile values (user-edited), fall back to athlete profile (learned/default)
  const hrMax = rider.hr_max || athleteProfile.physiology.hr_max_observed;
  const ftp = rider.ftp_watts || athleteProfile.physiology.ftp_estimate_watts;
  const weight = rider.weight_kg || athleteProfile.physiology.weight_kg;
  const vo2max = rider.vo2max ?? 0;
  const spo2 = rider.spo2_rest ?? 97;
  const hrMaxSource = rider.zones_source === 'manual' ? 'manual' :
    (athleteProfile.physiology.hr_max_observed !== athleteProfile.physiology.hr_max_theoretical) ? 'observada' : 'estimada';
  const ftpSource = (rider.ftp_watts ?? 0) > 0 ? 'manual' :
    hasRides ? 'estimado' : 'default';

  return (
    <div className="space-y-3">
      {/* Status banner */}
      {!hasRides && (
        <div style={{ padding: '10px 12px', backgroundColor: 'rgba(251,191,36,0.1)', borderLeft: '3px solid #fbbf24' }}>
          <span style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 700 }}>Sem dados de voltas</span>
          <p style={{ fontSize: '10px', color: '#adaaaa', marginTop: '4px' }}>
            O perfil actualiza automaticamente após cada volta. Faz a primeira volta para começar.
          </p>
        </div>
      )}

      {/* Form score */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Forma</span>
          <span style={{ fontWeight: 700, color: formScore > 10 ? '#3fff8b' : formScore < -10 ? '#ff716c' : '#fbbf24' }}>
            {hasRides ? (formScore > 10 ? 'Fresco' : formScore < -10 ? 'Fatigado' : 'Neutro') : 'Sem dados'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#777575', marginTop: '4px' }}>
          <span>Carga aguda (7d): {Math.round(athleteProfile.fatigue.acute_load_7d)}</span>
          <span>Carga crónica (42d): {Math.round(athleteProfile.fatigue.chronic_load_42d)}</span>
        </div>
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px' }}>
          Forma = crónica − aguda. Positivo = recuperado. Negativo = acumulação de carga.
        </div>
      </div>

      {/* Key metrics — from rider profile (user-edited, not defaults) */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <MetricBox value={String(hrMax)} unit="bpm" label={`FC Max (${hrMaxSource})`} color="#ff716c" />
          <MetricBox value={`${ftp}`} unit="W" label={`FTP (${ftpSource})`} color="#6e9bff" />
          <MetricBox value={`${weight}`} unit="kg" label="Peso" color="#adaaaa" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '8px' }}>
          <MetricBox value={`${spo2}`} unit="%" label="SpO2 repouso" color="#3fff8b" />
          {vo2max > 0 && <MetricBox value={`${vo2max}`} unit="ml/kg" label="VO2max" color="#e966ff" />}
          {rider.goal && <MetricBox value={goalLabel(rider.goal)} unit="" label="Objectivo" color="#fbbf24" />}
        </div>
      </div>

      {/* Stats */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Precisão auto-assist</span>
          <span style={{ fontWeight: 700, color: 'white' }}>{hasRides ? `${accuracy}%` : '--'}</span>
        </div>
        {hasRides && (
          <div style={{ marginTop: '4px', height: '6px', backgroundColor: '#262626', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${accuracy}%`, backgroundColor: '#24f07e' }} />
          </div>
        )}
        <div style={{ fontSize: '10px', color: '#777575', marginTop: '4px' }}>
          {athleteProfile.stats.total_rides} voltas · {Math.round(athleteProfile.stats.total_km)} km · {Math.round(athleteProfile.stats.total_elevation_m)} D+
        </div>
      </div>

      {/* Battery efficiency */}
      {saving > 0 && (
        <div style={{ backgroundColor: '#1a1919', padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#adaaaa', fontSize: '13px' }}>Poupança vs SPORT fixo</span>
            <span style={{ fontWeight: 700, color: '#3fff8b' }}>{saving}%</span>
          </div>
          {extraKm > 0 && (
            <div style={{ fontSize: '10px', color: 'rgba(63,255,139,0.7)', marginTop: '4px' }}>+{extraKm} km extra de autonomia</div>
          )}
        </div>
      )}

      {/* Medical alert if conditions set */}
      {(rider.medical_conditions ?? []).length > 0 && (
        <div style={{ backgroundColor: '#1a1919', padding: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#ff716c' }}>health_and_safety</span>
            <span style={{ color: '#ff716c', fontSize: '11px', fontWeight: 700 }}>Condições médicas activas</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '6px' }}>
            {rider.medical_conditions!.map((c) => (
              <span key={c} style={{ fontSize: '9px', padding: '2px 6px', backgroundColor: 'rgba(255,113,108,0.15)', color: '#ff716c' }}>{c}</span>
            ))}
          </div>
          <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px' }}>Thresholds de segurança ajustados pelo KROMI.</div>
        </div>
      )}

      {/* Last learnings */}
      {lastUpdate && lastUpdate.changes.length > 0 && (
        <div style={{ backgroundColor: '#1a1919', padding: '12px' }}>
          <div style={{ color: '#adaaaa', fontSize: '12px', marginBottom: '6px' }}>Última aprendizagem</div>
          {lastUpdate.changes.slice(0, 3).map((c, i) => (
            <div key={i} style={{ fontSize: '10px', color: '#adaaaa', marginBottom: '3px' }}>
              <span style={{ color: '#6e9bff' }}>{c.field}</span>: {c.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricBox({ value, unit, label, color }: { value: string; unit: string; label: string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="font-headline font-bold tabular-nums" style={{ fontSize: '18px', color }}>
        {value}<span style={{ fontSize: '10px', fontWeight: 400, marginLeft: '2px' }}>{unit}</span>
      </div>
      <div style={{ fontSize: '8px', color: '#777575' }}>{label}</div>
    </div>
  );
}

function goalLabel(goal: string): string {
  const map: Record<string, string> = {
    weight_loss: '⚖️ Peso', endurance: '🏔 Endur.', performance: '🏆 Perf.',
    event_prep: '📅 Evento', fun: '🎉 Fun', rehab: '🏥 Rehab',
  };
  return map[goal] ?? goal;
}
