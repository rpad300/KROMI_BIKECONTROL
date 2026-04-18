/**
 * Post-Ride Analysis Dashboard
 *
 * Full-screen analysis view with:
 * - Key metrics (distance, time, speed, elevation)
 * - Power analysis (NP, IF, TSS)
 * - HR zone distribution bar chart
 * - Energy & W' balance
 * - Climb breakdown
 * - Intelligence summary
 * - Export GPX / Delete actions
 */

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from 'recharts';
import { analyzeRide, type RideAnalysis, type AnalysisSnapshot } from '../../services/export/RideAnalysis';
import { useAthleteStore } from '../../store/athleteStore';

// ── Design tokens ──────────────────────────────────────────────
const BG = '#0e0e0e';
const CARD_BG = '#131313';
const CARD_BORDER = 'rgba(73,72,71,0.15)';
const MINT = '#3fff8b';
const MUTED = '#777575';
const DIM = '#494847';
const WHITE = '#ffffff';

const ZONE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];
const ZONE_LABELS = ['Z1 Recuperacao', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Limiar', 'Z5 VO2max'];

// ── Helpers ────────────────────────────────────────────────────

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function fmtShort(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}h` : `${m}min`;
}

// ── Section Card ───────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ backgroundColor: CARD_BG, border: `1px solid ${CARD_BORDER}` }}
    >
      <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: MINT }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  large,
}: {
  label: string;
  value: string | number;
  unit?: string;
  large?: boolean;
}) {
  return (
    <div>
      <div
        className={`font-bold tabular-nums ${large ? 'text-2xl' : 'text-lg'}`}
        style={{ color: WHITE, fontFamily: "'Space Grotesk', sans-serif" }}
      >
        {value}
        {unit && <span className="text-xs ml-0.5" style={{ color: MUTED }}>{unit}</span>}
      </div>
      <div className="text-[10px]" style={{ color: MUTED }}>{label}</div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────

interface RideSummaryProps {
  snapshots: AnalysisSnapshot[];
  rideDate: string;
  batteryStart?: number;
  batteryEnd?: number;
  onBack: () => void;
  onExportGPX: () => void;
  onDelete: () => void;
}

export function RideSummary({
  snapshots,
  rideDate,
  batteryStart,
  batteryEnd,
  onBack,
  onExportGPX,
  onDelete,
}: RideSummaryProps) {
  const profile = useAthleteStore((s) => s.profile);

  const analysis: RideAnalysis = useMemo(() => {
    return analyzeRide(snapshots, {
      ftp: profile.physiology.ftp_estimate_watts,
      hrMax: profile.physiology.hr_max_observed,
      riderWeightKg: profile.physiology.weight_kg,
      wPrimeJoules: 15000,
      batteryStart,
      batteryEnd,
    });
  }, [snapshots, profile, batteryStart, batteryEnd]);

  const dateLabel = new Date(rideDate).toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const hrZoneData = ZONE_LABELS.map((label, i) => ({
    zone: label.split(' ')[0],
    label,
    seconds: analysis.hr_zones_time_s[i] ?? 0,
    minutes: Math.round((analysis.hr_zones_time_s[i] ?? 0) / 60),
  }));

  const hasPower = analysis.power_avg_w != null;
  const hasHR = analysis.hr_avg_bpm != null;
  const hasClimbs = analysis.climbs.length > 0;
  const hasEnergy = analysis.battery_used_pct > 0 || analysis.motor_energy_wh > 0;

  // Terrain type labels
  const terrainLabels: Record<string, string> = {
    flat: 'Plano',
    rolling: 'Ondulado',
    short_steep: 'Subida curta forte',
    short_mod: 'Subida curta',
    long_steep: 'Subida longa forte',
    long_mod: 'Subida longa',
    punchy: 'Punchy',
    descent: 'Descida',
  };

  const terrainEntries = Object.entries(analysis.terrain_types)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const terrainTotal = terrainEntries.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div className="space-y-3 pb-6" style={{ backgroundColor: BG }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm active:scale-95 transition-transform"
          style={{ color: MUTED, minHeight: 44 }}
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Voltar
        </button>
        <div className="text-right">
          <div className="text-xs font-bold" style={{ color: MINT }}>RIDE SUMMARY</div>
          <div className="text-[10px]" style={{ color: MUTED }}>{dateLabel}</div>
        </div>
      </div>

      {/* Key metrics */}
      <Section title="Resumo">
        <div className="grid grid-cols-3 gap-4">
          <Metric label="Distancia" value={analysis.distance_km.toFixed(1)} unit="km" large />
          <Metric label="Duracao" value={fmt(analysis.duration_s)} large />
          <Metric label="Vel. media" value={analysis.speed_avg_kmh.toFixed(1)} unit="km/h" large />
        </div>
        <div className="grid grid-cols-4 gap-3 pt-1" style={{ borderTop: `1px solid ${DIM}20` }}>
          <Metric label="D+ (subida)" value={analysis.elevation_gain_m} unit="m" />
          <Metric label="D- (descida)" value={analysis.elevation_loss_m} unit="m" />
          <Metric label="Vel. max" value={analysis.speed_max_kmh.toFixed(0)} unit="km/h" />
          <Metric label="Calorias" value={analysis.calories_estimated} unit="kcal" />
        </div>
        <div className="grid grid-cols-3 gap-3 pt-1" style={{ borderTop: `1px solid ${DIM}20` }}>
          <Metric label="Tempo em mov." value={fmtShort(analysis.moving_time_s)} />
          <Metric label="Alt. max" value={analysis.max_altitude_m} unit="m" />
          <Metric label="Alt. min" value={analysis.min_altitude_m} unit="m" />
        </div>
      </Section>

      {/* Power */}
      {hasPower && (
        <Section title="Potencia">
          <div className="grid grid-cols-3 gap-4">
            <Metric label="Media" value={analysis.power_avg_w!} unit="W" large />
            <Metric label="NP" value={analysis.power_normalized_w ?? '-'} unit="W" large />
            <Metric label="IF" value={analysis.intensity_factor?.toFixed(2) ?? '-'} large />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1" style={{ borderTop: `1px solid ${DIM}20` }}>
            <Metric label="TSS" value={analysis.tss ?? '-'} />
            <Metric label="Maxima" value={analysis.power_max_w ?? '-'} unit="W" />
          </div>
        </Section>
      )}

      {/* Heart Rate */}
      {hasHR && (
        <Section title="Frequencia Cardiaca">
          <div className="grid grid-cols-2 gap-4">
            <Metric label="Media" value={analysis.hr_avg_bpm!} unit="bpm" large />
            <Metric label="Maxima" value={analysis.hr_max_bpm!} unit="bpm" large />
          </div>

          {/* HR Zone bar chart */}
          <div className="pt-2" style={{ borderTop: `1px solid ${DIM}20` }}>
            <div className="text-[10px] mb-2" style={{ color: MUTED }}>
              Tempo por zona
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hrZoneData} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 9, fill: MUTED }} tickFormatter={(v: number) => `${v}min`} />
                  <YAxis type="category" dataKey="zone" tick={{ fontSize: 10, fill: MUTED }} width={28} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 11 }}
                    formatter={(value: number, _name: string, props: { payload?: { label?: string } }) => [
                      `${value} min`,
                      props.payload?.label ?? '',
                    ]}
                  />
                  <Bar dataKey="minutes" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {hrZoneData.map((_, i) => (
                      <Cell key={i} fill={ZONE_COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Section>
      )}

      {/* Energy & W' */}
      {(hasEnergy || hasPower) && (
        <Section title="Energia">
          <div className="grid grid-cols-3 gap-4">
            {analysis.motor_energy_wh > 0 && (
              <Metric label="Motor" value={analysis.motor_energy_wh} unit="Wh" />
            )}
            {analysis.battery_used_pct > 0 && (
              <Metric
                label="Bateria"
                value={`${batteryStart ?? '?'}% -> ${batteryEnd ?? '?'}%`}
              />
            )}
            <Metric label="Calorias" value={analysis.calories_estimated} unit="kcal" />
          </div>
          {hasPower && (
            <div className="grid grid-cols-2 gap-3 pt-2" style={{ borderTop: `1px solid ${DIM}20` }}>
              <Metric label="W' minimo" value={`${analysis.w_prime_min_pct}%`} />
              <div>
                <div
                  className="font-bold tabular-nums text-lg"
                  style={{
                    color: analysis.w_prime_critical_count > 0 ? '#ef4444' : WHITE,
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}
                >
                  {analysis.w_prime_critical_count}x
                </div>
                <div className="text-[10px]" style={{ color: MUTED }}>
                  W' critico ({'<'}30%)
                </div>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Climbs */}
      {hasClimbs && (
        <Section title={`Subidas (${analysis.climbs.length})`}>
          <div className="space-y-2">
            {analysis.climbs.map((climb, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg p-2.5"
                style={{ backgroundColor: `${DIM}15` }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ backgroundColor: `${MINT}20`, color: MINT }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <div className="text-sm font-bold tabular-nums" style={{ color: WHITE, fontFamily: "'Space Grotesk', sans-serif" }}>
                      {(climb.end_km - climb.start_km).toFixed(1)}km
                      <span className="mx-1.5" style={{ color: DIM }}>|</span>
                      <span style={{ color: MINT }}>+{climb.elevation_gain_m}m</span>
                      <span className="mx-1.5" style={{ color: DIM }}>|</span>
                      {climb.avg_gradient_pct}% avg
                    </div>
                    <div className="text-[10px]" style={{ color: MUTED }}>
                      {fmt(climb.duration_s)}
                      {climb.avg_power_w != null && ` · ${climb.avg_power_w}W`}
                      {climb.avg_hr_bpm != null && ` · ${climb.avg_hr_bpm}bpm`}
                      {climb.motor_support_avg_pct > 0 && ` · Motor ${climb.motor_support_avg_pct}%`}
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs tabular-nums" style={{ color: MUTED, fontFamily: "'Space Grotesk', sans-serif" }}>
                  max {climb.max_gradient_pct}%
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Intelligence */}
      <Section title="Inteligencia KROMI">
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Mudancas de modo" value={analysis.auto_assist_mode_changes} />
          <Metric label="Overrides manuais" value={analysis.manual_overrides} />
        </div>
        {terrainEntries.length > 0 && (
          <div className="pt-2 space-y-1.5" style={{ borderTop: `1px solid ${DIM}20` }}>
            <div className="text-[10px]" style={{ color: MUTED }}>Terreno</div>
            {terrainEntries.map(([type, seconds]) => {
              const pct = Math.round((seconds / terrainTotal) * 100);
              return (
                <div key={type} className="flex items-center gap-2">
                  <div className="text-[11px] w-28 truncate" style={{ color: WHITE }}>
                    {terrainLabels[type] ?? type}
                  </div>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: `${DIM}30` }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: MINT }}
                    />
                  </div>
                  <div className="text-[10px] w-10 text-right tabular-nums" style={{ color: MUTED }}>
                    {pct}%
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {analysis.compliance_speed_events > 0 && (
          <div className="pt-2 text-[10px]" style={{ color: '#ef4444', borderTop: `1px solid ${DIM}20` }}>
            {analysis.compliance_speed_events} amostras acima de 25 km/h (limite legal e-bike)
          </div>
        )}
      </Section>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-3 pt-2">
        <button
          onClick={onExportGPX}
          className="flex items-center justify-center gap-2 rounded-xl py-4 font-bold text-sm active:scale-95 transition-transform"
          style={{ backgroundColor: `${MINT}15`, color: MINT, border: `1px solid ${MINT}30`, minHeight: 56 }}
        >
          <span className="material-symbols-outlined text-lg">download</span>
          GPX
        </button>
        <button
          className="flex items-center justify-center gap-2 rounded-xl py-4 font-bold text-sm active:scale-95 transition-transform opacity-40 cursor-not-allowed"
          style={{ backgroundColor: `${DIM}15`, color: MUTED, border: `1px solid ${DIM}30`, minHeight: 56 }}
          disabled
        >
          <span className="material-symbols-outlined text-lg">share</span>
          Partilhar
        </button>
        <button
          onClick={onDelete}
          className="flex items-center justify-center gap-2 rounded-xl py-4 font-bold text-sm active:scale-95 transition-transform"
          style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', minHeight: 56 }}
        >
          <span className="material-symbols-outlined text-lg">delete</span>
          Apagar
        </button>
      </div>
    </div>
  );
}
