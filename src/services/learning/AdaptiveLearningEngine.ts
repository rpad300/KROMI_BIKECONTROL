import { ClimbType } from '../torque/TorqueEngine';
import type { RideSummary, RideSnapshot } from './RideDataCollector';

export interface AthleteProfile {
  id: string;
  created_at: string;
  updated_at: string;

  physiology: {
    hr_max_observed: number;
    hr_max_theoretical: number;
    hr_aerobic_threshold: number;
    hr_anaerobic_threshold: number;
    hr_recovery_rate: number;
    hr_drift_rate: number;
    ftp_estimate_watts: number;
    weight_kg: number;
    age: number;
  };

  torque_preferences: {
    preferred_torque: Record<string, {
      torque_nm: number;
      support_pct: number;
      launch_value: number;
      confidence: number;
      sample_count: number;
    }>;
    learning_rate: number;
  };

  fatigue: {
    power_decay_per_hour: number;
    hr_drift_per_hour: number;
    acute_load_7d: number;
    chronic_load_42d: number;
    form_score: number;
  };

  stats: {
    total_rides: number;
    total_km: number;
    total_elevation_m: number;
    avg_override_rate: number;
    best_efficiency_score: number;
  };
}

export interface ProfileChange {
  field: string;
  old_value: string | number;
  new_value: string | number;
  reason: string;
}

export interface ProfileUpdate {
  changes: ProfileChange[];
}

const LEARNING_RATE = 0.1;

export function createDefaultProfile(age: number, weight: number): AthleteProfile {
  const hrMax = 220 - age;
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    physiology: {
      hr_max_observed: hrMax,
      hr_max_theoretical: hrMax,
      hr_aerobic_threshold: Math.round(hrMax * 0.7),
      hr_anaerobic_threshold: Math.round(hrMax * 0.85),
      hr_recovery_rate: 20,
      hr_drift_rate: 5,
      ftp_estimate_watts: 150,
      weight_kg: weight,
      age,
    },
    torque_preferences: {
      preferred_torque: Object.fromEntries(
        Object.values(ClimbType).map((ct) => [ct, {
          torque_nm: 55, support_pct: 200, launch_value: 5,
          confidence: 0, sample_count: 0,
        }])
      ),
      learning_rate: LEARNING_RATE,
    },
    fatigue: {
      power_decay_per_hour: 5,
      hr_drift_per_hour: 5,
      acute_load_7d: 0,
      chronic_load_42d: 0,
      form_score: 0,
    },
    stats: {
      total_rides: 0, total_km: 0, total_elevation_m: 0,
      avg_override_rate: 0, best_efficiency_score: 0,
    },
  };
}

export class AdaptiveLearningEngine {
  private profile: AthleteProfile;

  constructor(profile: AthleteProfile) {
    this.profile = profile;
  }

  // ── Gap #25: CP Detection Cross-Validation ──────────────────

  /**
   * Validate a detected CP value using cadence, speed, and W/kg sanity checks.
   * Returns true if CP is plausible, false if it should be rejected.
   * When CP changes >15%, returns true but caller should apply 50% blend.
   */
  validateCPDetection(
    detectedCP: number,
    avgCadence: number,
    avgSpeed: number,
  ): { valid: boolean; blend: boolean; reason?: string } {
    const riderWeightKg = this.profile.physiology.weight_kg || 135;

    // 1. CP should be plausible for rider weight (0.5-6.0 W/kg)
    const wpkg = detectedCP / riderWeightKg;
    if (wpkg < 0.5 || wpkg > 6.0) {
      console.warn(`[Learning] CP ${detectedCP}W rejected: ${wpkg.toFixed(1)} W/kg outside plausible range`);
      return { valid: false, blend: false, reason: `${wpkg.toFixed(1)} W/kg outside 0.5-6.0 range` };
    }

    // 2. Cadence during effort should be reasonable (40-120 rpm)
    if (avgCadence > 0 && (avgCadence < 40 || avgCadence > 120)) {
      console.warn(`[Learning] CP ${detectedCP}W rejected: cadence ${avgCadence} rpm abnormal`);
      return { valid: false, blend: false, reason: `cadence ${avgCadence} rpm abnormal` };
    }

    // 3. Speed during effort should be > 3 km/h (not stopped/walking)
    if (avgSpeed < 3) {
      console.warn(`[Learning] CP ${detectedCP}W rejected: speed ${avgSpeed} km/h too low`);
      return { valid: false, blend: false, reason: `speed ${avgSpeed} km/h too low` };
    }

    // 4. CP shouldn't change by >15% in a single ride
    const currentCP = this.profile.physiology.ftp_estimate_watts;
    if (currentCP > 0 && Math.abs(detectedCP - currentCP) / currentCP > 0.15) {
      console.warn(`[Learning] CP ${detectedCP}W flagged: >15% change from current ${currentCP}W — applying 50% blend`);
      return { valid: true, blend: true, reason: `>15% change, blending` };
    }

    return { valid: true, blend: false };
  }

  /** Get current CP estimate */
  getCurrentCP(): number {
    return this.profile.physiology.ftp_estimate_watts;
  }

  getProfile(): AthleteProfile {
    return this.profile;
  }

  /** Update profile after each ride */
  updateFromRide(ride: RideSummary): ProfileUpdate {
    const updates: ProfileUpdate = { changes: [] };

    this.updatePhysiology(ride, updates);
    this.learnFromOverrides(ride, updates);
    this.updateTrainingLoad(ride, updates);
    this.updateStats(ride, updates);

    this.profile.updated_at = new Date().toISOString();
    return updates;
  }

  private updatePhysiology(ride: RideSummary, updates: ProfileUpdate): void {
    // HRmax: update if we observed a new maximum
    if (ride.max_hr > this.profile.physiology.hr_max_observed && ride.max_hr > 0) {
      const prev = this.profile.physiology.hr_max_observed;
      this.profile.physiology.hr_max_observed = ride.max_hr;
      updates.changes.push({
        field: 'hr_max_observed',
        old_value: prev,
        new_value: ride.max_hr,
        reason: 'Novo maximo de FC observado',
      });
    }

    // FTP: exponential moving average — Gap #25: with cross-validation
    if (ride.ftp_estimate > 0) {
      const validation = this.validateCPDetection(
        ride.ftp_estimate,
        ride.avg_cadence,
        ride.avg_speed_kmh,
      );

      if (validation.valid) {
        const prev = this.profile.physiology.ftp_estimate_watts;
        const effectiveLR = validation.blend ? LEARNING_RATE * 0.5 : LEARNING_RATE;
        this.profile.physiology.ftp_estimate_watts =
          Math.round(prev * (1 - effectiveLR) + ride.ftp_estimate * effectiveLR);

        if (Math.abs(this.profile.physiology.ftp_estimate_watts - prev) > 5) {
          updates.changes.push({
            field: 'ftp_estimate',
            old_value: Math.round(prev),
            new_value: this.profile.physiology.ftp_estimate_watts,
            reason: validation.blend
              ? `FTP recalibrado (blend 50%: ${validation.reason})`
              : 'FTP recalibrado',
          });
        }
      } else {
        updates.changes.push({
          field: 'ftp_estimate',
          old_value: this.profile.physiology.ftp_estimate_watts,
          new_value: this.profile.physiology.ftp_estimate_watts,
          reason: `FTP rejeitado: ${validation.reason}`,
        });
      }
    }
  }

  private learnFromOverrides(ride: RideSummary, updates: ProfileUpdate): void {
    for (const event of ride.override_events) {
      const climbType = event.climb_type;
      const pref = this.profile.torque_preferences.preferred_torque[climbType];
      if (!pref) continue;

      const dir = this.getOverrideDirection(event);
      if (dir === 'more') {
        pref.torque_nm = Math.min(pref.torque_nm + LEARNING_RATE * 5, 85);
        pref.support_pct = Math.min(pref.support_pct + LEARNING_RATE * 20, 360);
      } else if (dir === 'less') {
        pref.torque_nm = Math.max(pref.torque_nm - LEARNING_RATE * 5, 10);
        pref.support_pct = Math.max(pref.support_pct - LEARNING_RATE * 20, 30);
      }

      pref.sample_count++;
      pref.confidence = Math.min(1.0, pref.sample_count / 10);
    }

    if (ride.override_events.length > 0) {
      updates.changes.push({
        field: 'torque_preferences',
        old_value: '',
        new_value: `${ride.override_events.length} overrides processados`,
        reason: ride.override_rate > 0.3
          ? 'Override rate alto — a aprender mais rapido'
          : 'Ajuste fino de preferencias',
      });
    }

    // Adjust learning rate based on override rate
    if (ride.override_rate > 0.3) {
      this.profile.torque_preferences.learning_rate = Math.min(0.25, LEARNING_RATE * 1.5);
    } else if (ride.override_rate < 0.05) {
      this.profile.torque_preferences.learning_rate = Math.max(0.05, LEARNING_RATE * 0.8);
    }
  }

  private updateTrainingLoad(ride: RideSummary, updates: ProfileUpdate): void {
    const tss = ride.tss_score;

    this.profile.fatigue.acute_load_7d =
      this.profile.fatigue.acute_load_7d * (1 - 1 / 7) + tss * (1 / 7);

    this.profile.fatigue.chronic_load_42d =
      this.profile.fatigue.chronic_load_42d * (1 - 1 / 42) + tss * (1 / 42);

    this.profile.fatigue.form_score =
      this.profile.fatigue.chronic_load_42d - this.profile.fatigue.acute_load_7d;

    updates.changes.push({
      field: 'form_score',
      old_value: Math.round(this.profile.fatigue.form_score),
      new_value: Math.round(this.profile.fatigue.form_score),
      reason: `TSS: ${Math.round(tss)}, Forma: ${this.profile.fatigue.form_score > 0 ? 'Fresco' : 'Fatigado'}`,
    });
  }

  private updateStats(ride: RideSummary, _updates: ProfileUpdate): void {
    this.profile.stats.total_rides++;
    this.profile.stats.total_km += ride.total_km;
    this.profile.stats.total_elevation_m += ride.total_elevation_m;
    this.profile.stats.avg_override_rate =
      this.profile.stats.avg_override_rate * 0.9 + ride.override_rate * 0.1;
  }

  /** Form-based motor multiplier. Fresh = less motor, fatigued = more motor */
  getFormMultiplier(): number {
    const form = this.profile.fatigue.form_score;
    if (form > 20) return 0.85;
    if (form > 10) return 0.92;
    if (form > -10) return 1.0;
    if (form > -20) return 1.10;
    return 1.20;
  }

  private getOverrideDirection(snap: RideSnapshot): 'more' | 'less' | 'neutral' {
    // If override happened: compare torque before/after
    // Higher assist_mode after = wanted more
    // Heuristic: if torque was low and they overrode, they wanted more
    if (snap.torque_nm < 40) return 'more';
    if (snap.torque_nm > 70) return 'less';
    return 'neutral';
  }
}
