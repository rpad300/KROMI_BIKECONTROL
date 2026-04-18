/**
 * Post-Ride Analysis Service
 *
 * Calculates comprehensive metrics from ride snapshots:
 * NP, IF, TSS, climb detection, HR zone distribution, W' balance, energy.
 */

// ── Interfaces ─────────────────────────────────────────────────

export interface ClimbSummary {
  start_km: number;
  end_km: number;
  elevation_gain_m: number;
  avg_gradient_pct: number;
  max_gradient_pct: number;
  duration_s: number;
  avg_power_w: number | null;
  avg_hr_bpm: number | null;
  motor_support_avg_pct: number;
}

export interface RideAnalysis {
  // Duration & distance
  duration_s: number;
  distance_km: number;
  moving_time_s: number;

  // Speed
  speed_avg_kmh: number;
  speed_max_kmh: number;

  // Power
  power_avg_w: number | null;
  power_max_w: number | null;
  power_normalized_w: number | null;
  intensity_factor: number | null;
  tss: number | null;

  // Heart Rate
  hr_avg_bpm: number | null;
  hr_max_bpm: number | null;
  hr_zones_time_s: number[]; // seconds in each zone (Z1-Z5)

  // Elevation
  elevation_gain_m: number;
  elevation_loss_m: number;
  max_altitude_m: number;
  min_altitude_m: number;

  // Climbs
  climbs: ClimbSummary[];

  // Energy
  calories_estimated: number;
  motor_energy_wh: number;
  battery_used_pct: number;

  // W' Balance
  w_prime_min_pct: number;
  w_prime_critical_count: number;

  // Intelligence
  auto_assist_mode_changes: number;
  manual_overrides: number;
  terrain_types: Record<string, number>;
  compliance_speed_events: number;
}

/**
 * Snapshot shape from the ride_snapshots table (Supabase).
 * Matches the Snapshot interface in RideHistory.tsx.
 */
export interface AnalysisSnapshot {
  elapsed_s: number;
  lat: number;
  lng: number;
  altitude_m: number | null;
  speed_kmh: number;
  power_watts: number;
  hr_bpm: number;
  cadence_rpm: number;
  distance_km: number;
  gradient_pct: number;
  // Optional extended fields (present in live rides)
  battery_pct?: number;
  assist_mode?: number;
  torque_nm?: number;
  support_pct?: number;
  was_overridden?: boolean;
  climb_type?: string;
}

// ── HR Zone helpers ────────────────────────────────────────────

/** Standard 5-zone model based on observed HRmax */
function hrZoneIndex(bpm: number, hrMax: number): number {
  if (hrMax <= 0) return -1;
  const pct = bpm / hrMax;
  if (pct < 0.60) return 0; // Z1 Recovery
  if (pct < 0.70) return 1; // Z2 Endurance
  if (pct < 0.80) return 2; // Z3 Tempo
  if (pct < 0.90) return 3; // Z4 Threshold
  return 4;                  // Z5 VO2max
}

// ── NP calculation ─────────────────────────────────────────────

function computeNormalizedPower(powerSamples: number[], sampleIntervalS: number): number | null {
  if (powerSamples.length === 0) return null;

  const windowSize = Math.max(1, Math.round(30 / sampleIntervalS));
  if (powerSamples.length < windowSize) return null;

  // 1. 30-second rolling average
  const rollingAvg: number[] = [];
  let runningSum = 0;
  for (let i = 0; i < powerSamples.length; i++) {
    runningSum += powerSamples[i]!;
    if (i >= windowSize) {
      runningSum -= powerSamples[i - windowSize]!;
    }
    if (i >= windowSize - 1) {
      rollingAvg.push(runningSum / windowSize);
    }
  }

  if (rollingAvg.length === 0) return null;

  // 2. Raise each to the 4th power, average, 4th root
  const sum4 = rollingAvg.reduce((acc, v) => acc + Math.pow(v, 4), 0);
  return Math.round(Math.pow(sum4 / rollingAvg.length, 0.25));
}

// ── Climb detection ────────────────────────────────────────────

function detectClimbs(snapshots: AnalysisSnapshot[], minDurationS: number = 30, minGradient: number = 3): ClimbSummary[] {
  const climbs: ClimbSummary[] = [];
  let climbStart: number | null = null;
  let maxGrad = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i]!;
    const isClimbing = s.gradient_pct >= minGradient;

    if (isClimbing && climbStart === null) {
      climbStart = i;
      maxGrad = s.gradient_pct;
    } else if (isClimbing && climbStart !== null) {
      maxGrad = Math.max(maxGrad, s.gradient_pct);
    } else if (!isClimbing && climbStart !== null) {
      const startSnap = snapshots[climbStart]!;
      const endSnap = snapshots[i - 1]!;
      const durationS = endSnap.elapsed_s - startSnap.elapsed_s;

      if (durationS >= minDurationS) {
        const climbSnaps = snapshots.slice(climbStart, i);
        const powerSnaps = climbSnaps.filter((c) => c.power_watts > 0);
        const hrSnaps = climbSnaps.filter((c) => c.hr_bpm > 0);
        const supportSnaps = climbSnaps.filter((c) => c.support_pct != null && c.support_pct > 0);

        // Elevation gain within this climb segment
        let gain = 0;
        for (let j = 1; j < climbSnaps.length; j++) {
          const diff = (climbSnaps[j]!.altitude_m ?? 0) - (climbSnaps[j - 1]!.altitude_m ?? 0);
          if (diff > 0) gain += diff;
        }

        climbs.push({
          start_km: startSnap.distance_km,
          end_km: endSnap.distance_km,
          elevation_gain_m: Math.round(gain),
          avg_gradient_pct: Math.round(
            climbSnaps.reduce((s, c) => s + c.gradient_pct, 0) / climbSnaps.length * 10
          ) / 10,
          max_gradient_pct: Math.round(maxGrad * 10) / 10,
          duration_s: Math.round(durationS),
          avg_power_w: powerSnaps.length > 0
            ? Math.round(powerSnaps.reduce((s, c) => s + c.power_watts, 0) / powerSnaps.length)
            : null,
          avg_hr_bpm: hrSnaps.length > 0
            ? Math.round(hrSnaps.reduce((s, c) => s + c.hr_bpm, 0) / hrSnaps.length)
            : null,
          motor_support_avg_pct: supportSnaps.length > 0
            ? Math.round(supportSnaps.reduce((s, c) => s + (c.support_pct ?? 0), 0) / supportSnaps.length)
            : 0,
        });
      }

      climbStart = null;
      maxGrad = 0;
    }
  }

  // Close an open climb at the end of the ride
  if (climbStart !== null && snapshots.length > climbStart + 1) {
    const startSnap = snapshots[climbStart]!;
    const endSnap = snapshots[snapshots.length - 1]!;
    const durationS = endSnap.elapsed_s - startSnap.elapsed_s;

    if (durationS >= minDurationS) {
      const climbSnaps = snapshots.slice(climbStart);
      const powerSnaps = climbSnaps.filter((c) => c.power_watts > 0);
      const hrSnaps = climbSnaps.filter((c) => c.hr_bpm > 0);
      let gain = 0;
      for (let j = 1; j < climbSnaps.length; j++) {
        const diff = (climbSnaps[j]!.altitude_m ?? 0) - (climbSnaps[j - 1]!.altitude_m ?? 0);
        if (diff > 0) gain += diff;
      }
      climbs.push({
        start_km: startSnap.distance_km,
        end_km: endSnap.distance_km,
        elevation_gain_m: Math.round(gain),
        avg_gradient_pct: Math.round(
          climbSnaps.reduce((s, c) => s + c.gradient_pct, 0) / climbSnaps.length * 10
        ) / 10,
        max_gradient_pct: Math.round(maxGrad * 10) / 10,
        duration_s: Math.round(durationS),
        avg_power_w: powerSnaps.length > 0
          ? Math.round(powerSnaps.reduce((s, c) => s + c.power_watts, 0) / powerSnaps.length)
          : null,
        avg_hr_bpm: hrSnaps.length > 0
          ? Math.round(hrSnaps.reduce((s, c) => s + c.hr_bpm, 0) / hrSnaps.length)
          : null,
        motor_support_avg_pct: 0,
      });
    }
  }

  // Sort by elevation gain descending
  return climbs.sort((a, b) => b.elevation_gain_m - a.elevation_gain_m);
}

// ── Main analysis function ─────────────────────────────────────

export function analyzeRide(
  snapshots: AnalysisSnapshot[],
  options: {
    ftp?: number;
    hrMax?: number;
    riderWeightKg?: number;
    wPrimeJoules?: number;
    batteryStart?: number;
    batteryEnd?: number;
  } = {},
): RideAnalysis {
  if (snapshots.length < 2) {
    return emptyAnalysis();
  }

  const ftp = options.ftp ?? 200;
  const hrMax = options.hrMax ?? 190;
  const riderWeightKg = options.riderWeightKg ?? 80;
  const wPrime = options.wPrimeJoules ?? 15000;

  // Sample interval (median gap between consecutive snapshots)
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(snapshots.length, 50); i++) {
    gaps.push(snapshots[i]!.elapsed_s - snapshots[i - 1]!.elapsed_s);
  }
  gaps.sort((a, b) => a - b);
  const sampleIntervalS = gaps[Math.floor(gaps.length / 2)] ?? 5;

  const last = snapshots[snapshots.length - 1]!;
  const durationS = last.elapsed_s;
  const distanceKm = last.distance_km;

  // Moving time: count samples where speed > 1 km/h
  const movingSamples = snapshots.filter((s) => s.speed_kmh > 1);
  const movingTimeS = movingSamples.length * sampleIntervalS;

  // Speed
  const speedAvg = movingSamples.length > 0
    ? movingSamples.reduce((s, r) => s + r.speed_kmh, 0) / movingSamples.length
    : 0;
  const speedMax = Math.max(...snapshots.map((s) => s.speed_kmh), 0);

  // Power
  const powerSamples = snapshots.filter((s) => s.power_watts > 0);
  const hasPower = powerSamples.length > 10;
  const powerAvg = hasPower
    ? Math.round(powerSamples.reduce((s, r) => s + r.power_watts, 0) / powerSamples.length)
    : null;
  const powerMax = hasPower ? Math.max(...powerSamples.map((s) => s.power_watts)) : null;

  // Normalized Power
  const allPower = snapshots.map((s) => s.power_watts);
  const np = hasPower ? computeNormalizedPower(allPower, sampleIntervalS) : null;
  const intensityFactor = np != null && ftp > 0 ? Math.round((np / ftp) * 100) / 100 : null;
  const tss = np != null && intensityFactor != null && ftp > 0
    ? Math.round((durationS * np * intensityFactor) / (ftp * 3600) * 100)
    : null;

  // Heart Rate
  const hrSamples = snapshots.filter((s) => s.hr_bpm > 0);
  const hasHR = hrSamples.length > 10;
  const hrAvg = hasHR
    ? Math.round(hrSamples.reduce((s, r) => s + r.hr_bpm, 0) / hrSamples.length)
    : null;
  const hrMaxBpm = hasHR ? Math.max(...hrSamples.map((s) => s.hr_bpm)) : null;

  // HR zone distribution (5 zones)
  const hrZonesTimeS = [0, 0, 0, 0, 0];
  for (const s of hrSamples) {
    const z = hrZoneIndex(s.hr_bpm, hrMax);
    if (z >= 0 && z < 5) {
      hrZonesTimeS[z] = (hrZonesTimeS[z] ?? 0) + sampleIntervalS;
    }
  }

  // Elevation
  let elevGain = 0;
  let elevLoss = 0;
  let maxAlt = -Infinity;
  let minAlt = Infinity;
  const altSamples = snapshots.filter((s) => s.altitude_m != null);
  for (let i = 0; i < altSamples.length; i++) {
    const alt = altSamples[i]!.altitude_m!;
    maxAlt = Math.max(maxAlt, alt);
    minAlt = Math.min(minAlt, alt);
    if (i > 0) {
      const diff = alt - altSamples[i - 1]!.altitude_m!;
      if (diff > 0) elevGain += diff;
      else elevLoss += Math.abs(diff);
    }
  }
  if (!isFinite(maxAlt)) maxAlt = 0;
  if (!isFinite(minAlt)) minAlt = 0;

  // Climbs
  const climbs = detectClimbs(snapshots);

  // Calories (rough estimate: power-based if available, otherwise MET-based)
  let calories: number;
  if (hasPower && powerAvg != null) {
    // kJ = avg_watts * duration_s / 1000 ; kcal ~ kJ / 4.184 * efficiency(~0.25)
    calories = Math.round((powerAvg * durationS / 1000) / 0.25);
  } else {
    // Rough MET-based: cycling ~6-8 MET
    const met = 7;
    calories = Math.round(met * riderWeightKg * (durationS / 3600));
  }

  // Motor energy (very rough: assume avg ~250W motor at avg support %)
  const supportSnaps = snapshots.filter((s) => s.support_pct != null && s.support_pct > 0);
  const avgSupport = supportSnaps.length > 0
    ? supportSnaps.reduce((s, c) => s + (c.support_pct ?? 0), 0) / supportSnaps.length
    : 150; // default 150% support assumption
  const motorEnergy = Math.round((avgSupport / 100) * 250 * (durationS / 3600) * 0.5); // 0.5 = duty cycle

  // Battery
  const batteryUsed = options.batteryStart != null && options.batteryEnd != null
    ? options.batteryStart - options.batteryEnd
    : 0;

  // W' Balance simulation (simplified Skiba model)
  let wBal = wPrime;
  let wBalMin = wPrime;
  let criticalCount = 0;
  let wasCritical = false;
  for (const s of snapshots) {
    const p = s.power_watts;
    if (p > ftp) {
      wBal -= (p - ftp) * sampleIntervalS;
    } else {
      wBal += (wPrime - wBal) * (1 - Math.exp(-(ftp - p) * sampleIntervalS / (wPrime * 0.5)));
    }
    wBal = Math.max(0, Math.min(wPrime, wBal));
    wBalMin = Math.min(wBalMin, wBal);

    const pct = (wBal / wPrime) * 100;
    if (pct < 30 && !wasCritical) {
      criticalCount++;
      wasCritical = true;
    } else if (pct >= 30) {
      wasCritical = false;
    }
  }

  // Intelligence: mode changes & overrides
  let modeChanges = 0;
  let overrides = 0;
  for (let i = 1; i < snapshots.length; i++) {
    if (snapshots[i]!.assist_mode !== snapshots[i - 1]!.assist_mode && snapshots[i]!.assist_mode != null) {
      modeChanges++;
    }
    if (snapshots[i]!.was_overridden) {
      overrides++;
    }
  }

  // Terrain types (from climb_type field)
  const terrainTypes: Record<string, number> = {};
  for (const s of snapshots) {
    const t = s.climb_type ?? 'flat';
    terrainTypes[t] = (terrainTypes[t] ?? 0) + sampleIntervalS;
  }

  // Speed limit compliance (assume 25 km/h EU pedelec limit)
  const complianceEvents = snapshots.filter((s) => s.speed_kmh > 25.5).length;

  return {
    duration_s: Math.round(durationS),
    distance_km: Math.round(distanceKm * 100) / 100,
    moving_time_s: Math.round(movingTimeS),
    speed_avg_kmh: Math.round(speedAvg * 10) / 10,
    speed_max_kmh: Math.round(speedMax * 10) / 10,
    power_avg_w: powerAvg,
    power_max_w: powerMax,
    power_normalized_w: np,
    intensity_factor: intensityFactor,
    tss,
    hr_avg_bpm: hrAvg,
    hr_max_bpm: hrMaxBpm,
    hr_zones_time_s: hrZonesTimeS,
    elevation_gain_m: Math.round(elevGain),
    elevation_loss_m: Math.round(elevLoss),
    max_altitude_m: Math.round(maxAlt),
    min_altitude_m: Math.round(minAlt),
    climbs,
    calories_estimated: calories,
    motor_energy_wh: motorEnergy,
    battery_used_pct: batteryUsed,
    w_prime_min_pct: Math.round((wBalMin / wPrime) * 100),
    w_prime_critical_count: criticalCount,
    auto_assist_mode_changes: modeChanges,
    manual_overrides: overrides,
    terrain_types: terrainTypes,
    compliance_speed_events: complianceEvents,
  };
}

function emptyAnalysis(): RideAnalysis {
  return {
    duration_s: 0,
    distance_km: 0,
    moving_time_s: 0,
    speed_avg_kmh: 0,
    speed_max_kmh: 0,
    power_avg_w: null,
    power_max_w: null,
    power_normalized_w: null,
    intensity_factor: null,
    tss: null,
    hr_avg_bpm: null,
    hr_max_bpm: null,
    hr_zones_time_s: [0, 0, 0, 0, 0],
    elevation_gain_m: 0,
    elevation_loss_m: 0,
    max_altitude_m: 0,
    min_altitude_m: 0,
    climbs: [],
    calories_estimated: 0,
    motor_energy_wh: 0,
    battery_used_pct: 0,
    w_prime_min_pct: 100,
    w_prime_critical_count: 0,
    auto_assist_mode_changes: 0,
    manual_overrides: 0,
    terrain_types: {},
    compliance_speed_events: 0,
  };
}
