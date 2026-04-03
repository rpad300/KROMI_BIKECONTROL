import { useEffect, useState } from 'react';
import {
  fetchRideHistoryStats,
  calculateHistoricalRange,
  type RideHistoryStats,
  type RangeEstimate,
} from '../../services/battery/HistoricalRangeEstimator';
import { useBikeStore } from '../../store/bikeStore';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * HistoricalRangeWidget — desktop-only, shows range estimate based on ride history.
 * Queries Supabase for past rides and calculates real-world consumption.
 */
export function HistoricalRangeWidget() {
  const [stats, setStats] = useState<RideHistoryStats | null>(null);
  const [estimate, setEstimate] = useState<RangeEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [socInput, setSocInput] = useState(100);

  const bat1 = useBikeStore((s) => s.battery_main_pct);
  const bike = useSettingsStore((s) => s.bikeConfig);
  const isEBike = bike.bike_type === 'ebike';

  // Fetch on mount
  useEffect(() => {
    if (!isEBike) { setLoading(false); return; }
    fetchRideHistoryStats().then((s) => {
      setStats(s);
      if (s) {
        const soc = bat1 > 0 ? bat1 : socInput;
        setEstimate(calculateHistoricalRange(s, soc));
      }
      setLoading(false);
    });
  }, [isEBike, bat1, socInput]);

  // Recalculate when SOC input changes
  useEffect(() => {
    if (stats) setEstimate(calculateHistoricalRange(stats, socInput));
  }, [socInput, stats]);

  if (!isEBike) return null;

  const confColors = { high: '#3fff8b', medium: '#fbbf24', low: '#ff716c', none: '#777575' };
  const confLabels = { high: 'Alta', medium: 'Média', low: 'Baixa', none: 'Sem dados' };

  return (
    <div style={{ backgroundColor: '#1a1919', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#3fff8b' }}>battery_charging_full</span>
        <span className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b' }}>Estimativa de Autonomia</span>
        <span style={{ fontSize: '9px', color: '#777575', marginLeft: 'auto', textTransform: 'uppercase' }}>Baseada em histórico</span>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: '#3fff8b', borderTopColor: 'transparent' }} />
          <span style={{ fontSize: '11px', color: '#777575', marginTop: '6px', display: 'block' }}>A carregar histórico...</span>
        </div>
      )}

      {!loading && estimate && (
        <>
          {/* Main estimate */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <div className="font-headline font-black tabular-nums" style={{ fontSize: '48px', lineHeight: 1, color: confColors[estimate.confidence] }}>
                {estimate.estimatedKm}
              </div>
              <span className="font-headline" style={{ fontSize: '16px', color: '#adaaaa' }}>km estimados</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: confColors[estimate.confidence], fontWeight: 700, textTransform: 'uppercase' }}>
                Confiança: {confLabels[estimate.confidence]}
              </div>
              <div style={{ fontSize: '10px', color: '#777575' }}>{estimate.basedOnRides} voltas analisadas</div>
              <div style={{ fontSize: '10px', color: '#777575' }}>{estimate.whPerKm} Wh/km médio</div>
            </div>
          </div>

          {/* SOC slider */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: '#adaaaa' }}>Bateria actual</span>
              <span className="font-headline font-bold tabular-nums" style={{ fontSize: '12px', color: '#3fff8b' }}>{socInput}% ({estimate.availableWh}Wh)</span>
            </div>
            <input
              type="range" min={5} max={100} value={socInput}
              onChange={(e) => setSocInput(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#3fff8b' }}
            />
          </div>

          {/* Factors */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '12px' }}>
            {estimate.factors.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '8px', color: '#3fff8b' }}>●</span>
                <span style={{ fontSize: '10px', color: '#adaaaa' }}>{f}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recent rides table */}
      {stats && stats.recentRides.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid rgba(73,72,71,0.2)', paddingTop: '12px', marginTop: '8px' }}>
            <span className="font-label" style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Últimas voltas ({stats.totalKm}km total · {stats.totalHours}h)
            </span>
          </div>

          <div style={{ marginTop: '6px' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 50px 50px 50px 50px', gap: '4px', marginBottom: '4px' }}>
              <span style={{ fontSize: '8px', color: '#494847' }}>Data</span>
              <span style={{ fontSize: '8px', color: '#494847', textAlign: 'right' }}>km</span>
              <span style={{ fontSize: '8px', color: '#494847', textAlign: 'right' }}>min</span>
              <span style={{ fontSize: '8px', color: '#494847', textAlign: 'right' }}>Bat%</span>
              <span style={{ fontSize: '8px', color: '#494847', textAlign: 'right' }}>Wh/km</span>
            </div>
            {/* Rows */}
            {stats.recentRides.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 50px 50px 50px 50px', gap: '4px', padding: '3px 0', borderTop: '1px solid rgba(73,72,71,0.05)' }}>
                <span className="tabular-nums" style={{ fontSize: '10px', color: '#adaaaa' }}>{r.date}</span>
                <span className="tabular-nums" style={{ fontSize: '10px', color: 'white', textAlign: 'right' }}>{r.km}</span>
                <span className="tabular-nums" style={{ fontSize: '10px', color: '#adaaaa', textAlign: 'right' }}>{r.durationMin}</span>
                <span className="tabular-nums" style={{ fontSize: '10px', color: r.batteryUsedPct > 50 ? '#ff716c' : '#fbbf24', textAlign: 'right' }}>{r.batteryUsedPct}%</span>
                <span className="tabular-nums" style={{ fontSize: '10px', color: 'white', textAlign: 'right' }}>{r.whPerKm}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {stats && stats.totalRides === 0 && (
        <div style={{ textAlign: 'center', padding: '16px', color: '#777575', fontSize: '12px' }}>
          Sem voltas registadas. Faz a primeira volta com a app para começar a estimar autonomia baseada no teu histórico real.
        </div>
      )}
    </div>
  );
}
