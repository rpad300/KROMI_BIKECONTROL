import { useAthleteStore } from '../../store/athleteStore';
import { batteryEfficiencyTracker } from '../../services/learning/BatteryEfficiencyTracker';
import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';

export function ProfileInsightsWidget() {
  const profile = useAthleteStore((s) => s.profile);
  const lastUpdate = useAthleteStore((s) => s.lastUpdate);
  const battery = useBikeStore((s) => s.battery_percent);
  const riderProfile = useSettingsStore((s) => s.riderProfile);

  const saving = batteryEfficiencyTracker.getSavingPercent();
  const extraKm = batteryEfficiencyTracker.getExtraRangeKm(battery);
  const accuracy = Math.round((1 - profile.stats.avg_override_rate) * 100);
  const formScore = profile.fatigue.form_score;
  const hasRides = profile.stats.total_rides > 0;

  return (
    <div className="space-y-3">
      {/* Status banner — explains what's happening */}
      {!hasRides && (
        <div style={{ padding: '10px 12px', backgroundColor: 'rgba(251,191,36,0.1)', borderLeft: '3px solid #fbbf24' }}>
          <span style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 700 }}>Sem dados de voltas</span>
          <p style={{ fontSize: '10px', color: '#adaaaa', marginTop: '4px' }}>
            O perfil atleta actualiza automaticamente após cada volta. O KROMI aprende com os teus dados de HR, potência, cadência e overrides.
            Faz a primeira volta para começar a construir o teu perfil.
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
          <span>Carga aguda (7d): {Math.round(profile.fatigue.acute_load_7d)}</span>
          <span>Carga crónica (42d): {Math.round(profile.fatigue.chronic_load_42d)}</span>
        </div>
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px' }}>
          Forma = crónica − aguda. Positivo = recuperado. Negativo = acumulação de carga.
        </div>
      </div>

      {/* Physiology — from rider profile + observed */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="font-headline font-bold tabular-nums" style={{ fontSize: '22px', color: '#ff716c' }}>
              {profile.physiology.hr_max_observed || riderProfile.hr_max}
            </div>
            <div style={{ fontSize: '9px', color: '#adaaaa' }}>FC Max {profile.physiology.hr_max_observed !== profile.physiology.hr_max_theoretical ? '(observada)' : '(estimada)'}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="font-headline font-bold tabular-nums" style={{ fontSize: '22px', color: '#6e9bff' }}>
              {profile.physiology.ftp_estimate_watts}W
            </div>
            <div style={{ fontSize: '9px', color: '#adaaaa' }}>FTP {hasRides ? '(estimado)' : '(default)'}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="font-headline font-bold tabular-nums" style={{ fontSize: '16px', color: '#adaaaa' }}>
              {profile.physiology.weight_kg}kg
            </div>
            <div style={{ fontSize: '9px', color: '#777575' }}>Peso</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="font-headline font-bold tabular-nums" style={{ fontSize: '16px', color: '#adaaaa' }}>
              {riderProfile.spo2_rest ?? 97}%
            </div>
            <div style={{ fontSize: '9px', color: '#777575' }}>SpO2 repouso</div>
          </div>
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
          {profile.stats.total_rides} voltas · {Math.round(profile.stats.total_km)} km · {Math.round(profile.stats.total_elevation_m)} D+
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
