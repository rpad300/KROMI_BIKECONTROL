import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { AssistMode, ASSIST_MODE_LABELS } from '../../types/bike.types';
import type { ElevationPoint } from '../../types/elevation.types';

/** Grade thresholds and their visual config */
const GRADE_BANDS = [
  { max: 4, color: '#00E676', label: 'Easy', mode: AssistMode.TOUR },
  { max: 8, color: '#FFD600', label: 'Moderate', mode: AssistMode.SPORT },
  { max: 12, color: '#FF9100', label: 'Hard', mode: AssistMode.POWER },
  { max: Infinity, color: '#FF1744', label: 'Steep', mode: AssistMode.POWER },
] as const;

function gradeColor(pct: number): string {
  const abs = Math.abs(pct);
  return GRADE_BANDS.find((b) => abs < b.max)?.color ?? '#FF1744';
}

function gradeMode(pct: number): AssistMode {
  const abs = Math.abs(pct);
  return GRADE_BANDS.find((b) => abs < b.max)?.mode ?? AssistMode.POWER;
}

/** Group consecutive elevation points into intervals by grade band */
function buildIntervals(profile: ElevationPoint[]) {
  if (profile.length < 2) return [];

  const intervals: Array<{
    startM: number;
    endM: number;
    avgGrade: number;
    color: string;
    mode: AssistMode;
  }> = [];

  let segStart = 0;
  let segGrades: number[] = [profile[0]!.gradient_pct];
  let segColor = gradeColor(profile[0]!.gradient_pct);

  for (let i = 1; i < profile.length; i++) {
    const pt = profile[i]!;
    const c = gradeColor(pt.gradient_pct);

    if (c !== segColor) {
      const avgGrade = segGrades.reduce((a, b) => a + b, 0) / segGrades.length;
      intervals.push({
        startM: Math.round(profile[segStart]!.distance_from_current),
        endM: Math.round(profile[i - 1]!.distance_from_current),
        avgGrade,
        color: segColor,
        mode: gradeMode(avgGrade),
      });
      segStart = i;
      segGrades = [];
      segColor = c;
    }
    segGrades.push(pt.gradient_pct);
  }

  // Last interval
  const avgGrade = segGrades.reduce((a, b) => a + b, 0) / segGrades.length;
  intervals.push({
    startM: Math.round(profile[segStart]!.distance_from_current),
    endM: Math.round(profile[profile.length - 1]!.distance_from_current),
    avgGrade,
    color: segColor,
    mode: gradeMode(avgGrade),
  });

  return intervals;
}

export function ClimbApproach() {
  const profile = useAutoAssistStore((s) => s.elevationProfile);
  const terrain = useAutoAssistStore((s) => s.terrain);
  if (profile.length < 3) {
    return <ClimbEmpty />;
  }

  const intervals = buildIntervals(profile);
  const totalDistM = profile[profile.length - 1]!.distance_from_current;
  const elevGain = Math.max(0, ...profile.map((p) => p.elevation)) - Math.min(...profile.map((p) => p.elevation));
  const avgGrade = terrain?.avg_upcoming_gradient_pct ?? 0;
  const nextTransition = terrain?.next_transition;

  // Build strategy: first mode that differs from current
  const strategy = intervals.map((iv) => ({
    range: `${iv.startM}–${iv.endM}m`,
    grade: `${iv.avgGrade > 0 ? '+' : ''}${iv.avgGrade.toFixed(0)}%`,
    mode: ASSIST_MODE_LABELS[iv.mode],
    color: iv.color,
  }));

  // Estimate battery impact (~0.5% per 100m of climb at POWER, less at lower modes)
  const estBattery = intervals.reduce((sum, iv) => {
    const distKm = (iv.endM - iv.startM) / 1000;
    const modeFactor = iv.mode === AssistMode.POWER ? 5 : iv.mode === AssistMode.SPORT ? 3.5 : 2;
    return sum + distKm * modeFactor * Math.max(1, iv.avgGrade / 5);
  }, 0);

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-emerald-400">Climb Ahead</h1>
        {nextTransition && (
          <span className="bg-emerald-500/20 text-emerald-400 text-sm font-bold px-3 py-1 rounded-full">
            in {nextTransition.distance_m}m
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex gap-2">
        <StatPill label="Dist" value={`${(totalDistM / 1000).toFixed(1)} km`} />
        <StatPill label="Elev" value={`${Math.round(elevGain)}m`} />
        <StatPill label="Avg" value={`${avgGrade > 0 ? '+' : ''}${avgGrade.toFixed(1)}%`} />
      </div>

      {/* Elevation chart — hero */}
      <div className="flex-1 min-h-0 bg-gray-800 rounded-xl overflow-hidden relative">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={profile} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="climbGrad" x1="0" y1="0" x2="1" y2="0">
                {profile.map((pt, i) => (
                  <stop
                    key={i}
                    offset={`${(pt.distance_from_current / totalDistM) * 100}%`}
                    stopColor={gradeColor(pt.gradient_pct)}
                    stopOpacity={0.6}
                  />
                ))}
              </linearGradient>
            </defs>
            <XAxis dataKey="distance_from_current" hide />
            <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
            <Area
              type="monotone"
              dataKey="elevation"
              fill="url(#climbGrad)"
              stroke="#00E676"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <ReferenceLine x={0} stroke="white" strokeWidth={2} strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>

        {/* Grade labels on chart */}
        <div className="absolute bottom-1 left-2 right-2 flex justify-between">
          <span className="text-xs text-gray-400">0m</span>
          <span className="text-xs text-gray-400">{(totalDistM / 1000).toFixed(1)}km</span>
        </div>
      </div>

      {/* Gradient bar */}
      <div className="flex h-3 rounded-full overflow-hidden">
        {intervals.map((iv, i) => (
          <div
            key={i}
            style={{
              width: `${((iv.endM - iv.startM) / totalDistM) * 100}%`,
              backgroundColor: iv.color,
            }}
          />
        ))}
      </div>

      {/* Intervals breakdown */}
      <div className="space-y-1.5 max-h-[25vh] overflow-y-auto">
        {strategy.map((s, i) => (
          <div key={i} className="flex items-center justify-between bg-gray-800/60 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-sm text-gray-300">{s.range}: {s.grade}</span>
            </div>
            <span className="text-sm font-bold text-emerald-400">→ {s.mode}</span>
          </div>
        ))}
      </div>

      {/* Strategy card */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-emerald-400">Recommended Strategy</span>
          <span className="text-xs text-gray-400">Est. battery: {Math.round(estBattery)}%</span>
        </div>
        <button className="w-full h-12 bg-emerald-500 text-black font-bold rounded-xl text-base active:scale-95 transition-transform">
          Apply Strategy
        </button>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-center">
      <div className="text-xs text-gray-500 uppercase">{label}</div>
      <div className="text-sm font-bold text-white">{value}</div>
    </div>
  );
}

function ClimbEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
      <span className="material-symbols-outlined text-6xl">terrain</span>
      <div className="text-center">
        <p className="text-lg font-bold text-gray-400">Sem dados de subida</p>
        <p className="text-sm mt-1">Ativa o GPS e inicia uma rota para ver as subidas no percurso</p>
      </div>
    </div>
  );
}
