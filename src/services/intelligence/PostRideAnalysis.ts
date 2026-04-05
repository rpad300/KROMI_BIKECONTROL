/**
 * PostRideAnalysis — generates ride summary comparing predicted vs actual.
 *
 * Called when ride ends. Produces:
 *   - Actual vs predicted consumption per segment
 *   - HR zone adherence with critical segment identification
 *   - W' balance curve across full ride
 *   - Updated CP, W', Crr_effective, EF baseline for next session
 *   - Nutrition summary (glycogen used, hydration deficit)
 */

import type { NutritionState } from './NutritionEngine';

// ── Types ──────────────────────────────────────────────────────

export interface RideSegmentAnalysis {
  start_km: number;
  end_km: number;
  duration_s: number;
  avg_gradient_pct: number;
  avg_speed_kmh: number;
  /** Predicted Wh for this segment (from Layer 4 at time of riding) */
  predicted_wh: number;
  /** Actual Wh consumed (from battery telemetry) */
  actual_wh: number;
  /** Ratio: actual/predicted. >1 = consumed more than expected */
  consumption_ratio: number;
  /** Dominant HR zone in this segment */
  dominant_hr_zone: number;
  /** W' balance at end of segment (0-1) */
  w_prime_end: number;
  /** Surface type from OSM */
  surface: string;
}

export interface HRZoneAdherence {
  /** Target zone (from rider profile) */
  target_zone: number;
  /** Time in each zone (seconds) */
  time_in_zone: number[];
  /** % of ride time in target zone */
  target_adherence_pct: number;
  /** % of ride time above target */
  time_above_pct: number;
  /** Segments where zone was exceeded significantly (>2 zones above target) */
  critical_segments: { km: number; duration_s: number; max_zone: number }[];
}

export interface WPrimeCurve {
  /** Timestamp-balance pairs for charting */
  points: { elapsed_s: number; balance_pct: number }[];
  /** Minimum W' reached */
  min_balance_pct: number;
  /** Number of times W' dropped below 30% */
  critical_events: number;
  /** Total time in critical state (seconds) */
  time_critical_s: number;
}

export interface CalibratedUpdates {
  cp_watts: { before: number; after: number; delta: number };
  w_prime_joules: { before: number; after: number; delta: number };
  tau_seconds: { before: number; after: number; delta: number };
  crr_adjustments: Record<string, number>;
  ef_baseline: { before: number; after: number };
  form_multiplier: number;
}

export interface NutritionSummary {
  glycogen_start_g: number;
  glycogen_end_g: number;
  glycogen_consumed_g: number;
  carbs_ingested_g: number;
  /** Net glycogen balance: ingested - consumed. Negative = deficit */
  net_glycogen_g: number;
  fluid_deficit_ml: number;
  fluid_ingested_ml: number;
  sodium_lost_mg: number;
  avg_burn_rate_g_min: number;
  /** Did glycogen reach amber or critical? */
  low_glycogen_event: boolean;
  /** Time spent in glycogen amber/critical (minutes) */
  time_low_glycogen_min: number;
}

export interface PostRideReport {
  // Summary
  total_km: number;
  total_duration_min: number;
  total_elevation_m: number;
  avg_speed_kmh: number;
  avg_power_watts: number;

  // Consumption
  total_wh_predicted: number;
  total_wh_actual: number;
  consumption_accuracy_pct: number;
  segments: RideSegmentAnalysis[];

  // Physiology
  hr_adherence: HRZoneAdherence;
  w_prime_curve: WPrimeCurve;

  // Nutrition
  nutrition: NutritionSummary;

  // Calibration updates for next ride
  calibration: CalibratedUpdates;

  // Ride rating
  efficiency_score: number;  // 0-100
  summary_text: string;      // Portuguese
}

// ── Snapshot Recording (during ride) ──────────────────────────

export interface RideSnapshot {
  elapsed_s: number;
  km: number;
  speed_kmh: number;
  gradient_pct: number;
  power_watts: number;
  hr_bpm: number;
  hr_zone: number;
  w_prime_pct: number;
  support_pct: number;
  torque_nm: number;
  battery_soc: number;
  wh_consumed: number;
  predicted_wh_segment: number;
  surface: string;
  glycogen_pct: number;
}

let snapshots: RideSnapshot[] = [];
let segmentWhPredictions: { km_start: number; predicted_wh: number }[] = [];

/** Record a snapshot during ride (call every 5-10s) */
export function recordSnapshot(snap: RideSnapshot): void {
  snapshots.push(snap);
}

/** Record predicted Wh from lookahead for a segment */
export function recordPrediction(km_start: number, predicted_wh: number): void {
  segmentWhPredictions.push({ km_start, predicted_wh });
}

/** Clear all snapshots (new ride) */
export function resetSnapshots(): void {
  snapshots = [];
  segmentWhPredictions = [];
}

// ── Analysis ──────────────────────────────────────────────────

/**
 * Generate post-ride report from recorded snapshots.
 *
 * @param targetZone - Rider's target HR zone
 * @param nutritionFinal - Final nutrition state from NutritionEngine
 * @param calibBefore - Calibrated params before this ride
 * @param calibAfter - Calibrated params after learning updates
 */
export function generateReport(
  targetZone: number,
  nutritionFinal: NutritionState | null,
  calibBefore: { cp: number; w_prime: number; tau: number; ef: number },
  calibAfter: { cp: number; w_prime: number; tau: number; ef: number },
): PostRideReport | null {
  if (snapshots.length < 10) return null;

  const first = snapshots[0]!;
  const last = snapshots[snapshots.length - 1]!;
  const totalKm = last.km - first.km;
  const totalDurationMin = last.elapsed_s / 60;
  const totalElevation = snapshots.reduce((sum, s, i) => {
    if (i === 0) return 0;
    const prev = snapshots[i - 1]!;
    const dGrad = s.gradient_pct > 0 ? (s.km - prev.km) * 1000 * (s.gradient_pct / 100) : 0;
    return sum + dGrad;
  }, 0);

  // Segment analysis (1km segments)
  const segments = buildSegmentAnalysis();

  // HR adherence
  const hr_adherence = buildHRAdherence(targetZone);

  // W' curve
  const w_prime_curve = buildWPrimeCurve();

  // Consumption comparison
  const totalWhActual = last.wh_consumed - first.wh_consumed;
  const totalWhPredicted = segments.reduce((s, seg) => s + seg.predicted_wh, 0);
  const consumptionAccuracy = totalWhPredicted > 0
    ? Math.round((1 - Math.abs(totalWhActual - totalWhPredicted) / totalWhPredicted) * 100)
    : 0;

  // Nutrition
  const nutrition = buildNutritionSummary(nutritionFinal);

  // Calibration
  const calibration: CalibratedUpdates = {
    cp_watts: { before: calibBefore.cp, after: calibAfter.cp, delta: calibAfter.cp - calibBefore.cp },
    w_prime_joules: { before: calibBefore.w_prime, after: calibAfter.w_prime, delta: calibAfter.w_prime - calibBefore.w_prime },
    tau_seconds: { before: calibBefore.tau, after: calibAfter.tau, delta: calibAfter.tau - calibBefore.tau },
    crr_adjustments: {},
    ef_baseline: { before: calibBefore.ef, after: calibAfter.ef },
    form_multiplier: 1.0,
  };

  // Efficiency score
  const avgPower = snapshots.reduce((s, snap) => s + snap.power_watts, 0) / snapshots.length;
  const avgSpeed = totalKm / (totalDurationMin / 60);
  const effScore = Math.round(
    Math.min(100,
      (hr_adherence.target_adherence_pct * 0.3) +
      (consumptionAccuracy * 0.3) +
      ((1 - w_prime_curve.time_critical_s / (totalDurationMin * 60)) * 100 * 0.2) +
      (nutrition.net_glycogen_g > -100 ? 20 : Math.max(0, 20 + nutrition.net_glycogen_g / 10))
    )
  );

  // Summary text
  const summaryParts: string[] = [];
  summaryParts.push(`${totalKm.toFixed(1)}km em ${Math.round(totalDurationMin)}min, ${Math.round(totalElevation)}m D+.`);
  summaryParts.push(`Consumo bateria: ${totalWhActual.toFixed(0)}Wh (previsto ${totalWhPredicted.toFixed(0)}Wh, ${consumptionAccuracy}% preciso).`);
  summaryParts.push(`Zona HR: ${hr_adherence.target_adherence_pct}% do tempo na Z${targetZone} alvo.`);
  if (w_prime_curve.critical_events > 0) {
    summaryParts.push(`W' critico ${w_prime_curve.critical_events}× (min ${w_prime_curve.min_balance_pct.toFixed(0)}%).`);
  }
  if (calibAfter.cp !== calibBefore.cp) {
    summaryParts.push(`CP actualizado: ${calibBefore.cp}→${calibAfter.cp}W.`);
  }

  return {
    total_km: Math.round(totalKm * 10) / 10,
    total_duration_min: Math.round(totalDurationMin),
    total_elevation_m: Math.round(totalElevation),
    avg_speed_kmh: Math.round(avgSpeed * 10) / 10,
    avg_power_watts: Math.round(avgPower),
    total_wh_predicted: Math.round(totalWhPredicted),
    total_wh_actual: Math.round(totalWhActual),
    consumption_accuracy_pct: consumptionAccuracy,
    segments, hr_adherence, w_prime_curve, nutrition, calibration,
    efficiency_score: effScore,
    summary_text: summaryParts.join(' '),
  };
}

// ── Private builders ──────────────────────────────────────────

function buildSegmentAnalysis(): RideSegmentAnalysis[] {
  const segments: RideSegmentAnalysis[] = [];
  const SEGMENT_KM = 1;
  let segStart = 0;

  for (let i = 1; i < snapshots.length; i++) {
    const kmDelta = snapshots[i]!.km - snapshots[segStart]!.km;
    if (kmDelta >= SEGMENT_KM || i === snapshots.length - 1) {
      const segSnaps = snapshots.slice(segStart, i + 1);
      const s0 = segSnaps[0]!;
      const sN = segSnaps[segSnaps.length - 1]!;

      const avgGrad = segSnaps.reduce((s, snap) => s + snap.gradient_pct, 0) / segSnaps.length;
      const avgSpeed = segSnaps.reduce((s, snap) => s + snap.speed_kmh, 0) / segSnaps.length;
      const actualWh = sN.wh_consumed - s0.wh_consumed;

      // Find matching prediction
      const pred = segmentWhPredictions.find(p =>
        Math.abs(p.km_start - s0.km) < 0.5
      );
      const predictedWh = pred?.predicted_wh ?? actualWh;

      // Dominant HR zone
      const zoneCounts = [0, 0, 0, 0, 0, 0];
      segSnaps.forEach(snap => { if (snap.hr_zone >= 0 && snap.hr_zone <= 5) zoneCounts[snap.hr_zone] = (zoneCounts[snap.hr_zone] ?? 0) + 1; });
      const dominantZone = zoneCounts.indexOf(Math.max(...zoneCounts));

      segments.push({
        start_km: Math.round(s0.km * 10) / 10,
        end_km: Math.round(sN.km * 10) / 10,
        duration_s: sN.elapsed_s - s0.elapsed_s,
        avg_gradient_pct: Math.round(avgGrad * 10) / 10,
        avg_speed_kmh: Math.round(avgSpeed * 10) / 10,
        predicted_wh: Math.round(predictedWh * 10) / 10,
        actual_wh: Math.round(actualWh * 10) / 10,
        consumption_ratio: predictedWh > 0 ? Math.round((actualWh / predictedWh) * 100) / 100 : 1,
        dominant_hr_zone: dominantZone,
        w_prime_end: sN.w_prime_pct / 100,
        surface: sN.surface || 'unknown',
      });

      segStart = i;
    }
  }
  return segments;
}

function buildHRAdherence(targetZone: number): HRZoneAdherence {
  const timeInZone = [0, 0, 0, 0, 0, 0]; // Z0-Z5
  const criticalSegments: { km: number; duration_s: number; max_zone: number }[] = [];
  let critStart = -1;
  let critMaxZone = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]!;
    const dt = i > 0 ? snap.elapsed_s - snapshots[i - 1]!.elapsed_s : 0;
    if (snap.hr_zone >= 0 && snap.hr_zone <= 5) {
      timeInZone[snap.hr_zone] = (timeInZone[snap.hr_zone] ?? 0) + dt;
    }

    // Track critical segments (>2 zones above target)
    if (snap.hr_zone > targetZone + 1) {
      if (critStart < 0) critStart = i;
      critMaxZone = Math.max(critMaxZone, snap.hr_zone);
    } else if (critStart >= 0) {
      const dur = snap.elapsed_s - snapshots[critStart]!.elapsed_s;
      if (dur > 30) { // only record if >30s
        criticalSegments.push({
          km: snapshots[critStart]!.km,
          duration_s: dur,
          max_zone: critMaxZone,
        });
      }
      critStart = -1;
      critMaxZone = 0;
    }
  }

  const totalTime = timeInZone.reduce((a, b) => a + b, 0);
  const targetTime = timeInZone[targetZone] ?? 0;
  const aboveTime = timeInZone.slice(targetZone + 1).reduce((a, b) => a + b, 0);

  return {
    target_zone: targetZone,
    time_in_zone: timeInZone,
    target_adherence_pct: totalTime > 0 ? Math.round((targetTime / totalTime) * 100) : 0,
    time_above_pct: totalTime > 0 ? Math.round((aboveTime / totalTime) * 100) : 0,
    critical_segments: criticalSegments,
  };
}

function buildWPrimeCurve(): WPrimeCurve {
  const points: { elapsed_s: number; balance_pct: number }[] = [];
  let minBalance = 100;
  let critEvents = 0;
  let timeCritical = 0;
  let wasCritical = false;

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]!;
    const dt = i > 0 ? snap.elapsed_s - snapshots[i - 1]!.elapsed_s : 0;

    // Sample every 30s for charting
    if (i % 6 === 0 || i === snapshots.length - 1) {
      points.push({ elapsed_s: snap.elapsed_s, balance_pct: snap.w_prime_pct });
    }

    minBalance = Math.min(minBalance, snap.w_prime_pct);

    if (snap.w_prime_pct < 30) {
      if (!wasCritical) { critEvents++; wasCritical = true; }
      timeCritical += dt;
    } else {
      wasCritical = false;
    }
  }

  return {
    points,
    min_balance_pct: Math.round(minBalance),
    critical_events: critEvents,
    time_critical_s: Math.round(timeCritical),
  };
}

function buildNutritionSummary(nutritionFinal: NutritionState | null): NutritionSummary {
  if (!nutritionFinal) {
    return {
      glycogen_start_g: 0, glycogen_end_g: 0, glycogen_consumed_g: 0,
      carbs_ingested_g: 0, net_glycogen_g: 0,
      fluid_deficit_ml: 0, fluid_ingested_ml: 0, sodium_lost_mg: 0,
      avg_burn_rate_g_min: 0, low_glycogen_event: false, time_low_glycogen_min: 0,
    };
  }

  const glycogenStart = 600; // approximate, from NutritionEngine initial
  const glycogenConsumed = glycogenStart - nutritionFinal.glycogen_g + nutritionFinal.carbs_ingested_g;

  // Time at low glycogen from snapshots
  let timeLowGlycogenS = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const dt = snapshots[i]!.elapsed_s - snapshots[i - 1]!.elapsed_s;
    if (snapshots[i]!.glycogen_pct < 35) timeLowGlycogenS += dt;
  }

  return {
    glycogen_start_g: glycogenStart,
    glycogen_end_g: nutritionFinal.glycogen_g,
    glycogen_consumed_g: Math.round(glycogenConsumed),
    carbs_ingested_g: nutritionFinal.carbs_ingested_g,
    net_glycogen_g: Math.round(nutritionFinal.carbs_ingested_g - glycogenConsumed),
    fluid_deficit_ml: nutritionFinal.fluid_deficit_ml,
    fluid_ingested_ml: nutritionFinal.fluid_ingested_ml,
    sodium_lost_mg: nutritionFinal.sodium_lost_mg,
    avg_burn_rate_g_min: nutritionFinal.glycogen_burn_rate_g_min,
    low_glycogen_event: nutritionFinal.glycogen_pct < 35,
    time_low_glycogen_min: Math.round(timeLowGlycogenS / 60),
  };
}
