/**
 * TuningIntelligence — HR Zone Regulator.
 *
 * Architecture:
 *   HR defines the TARGET intensity (what the motor should do)
 *   Terrain defines ANTICIPATION bias (when to pre-adjust)
 *   Battery is a HARD CONSTRAINT (caps the output)
 *
 * These are NOT additive to the same score. They are layered:
 *   intensity = clamp(hrTarget + anticipationBias, 0, 100) × batteryConstraint
 *
 * Smoothing is ASYMMETRIC:
 *   Ramp up: 3 samples (cautious — avoid oscillation)
 *   Ramp down: 1 sample (immediate — protect the rider)
 */

import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { getTargetZone } from '../../types/athlete.types';
import { type AsmoCalibration, type AsmoWire, DU7_TABLES, resolveCalibration } from '../../types/tuning.types';

export interface TuningInput {
  gradient: number;
  speed: number;
  cadence: number;
  riderPower: number;
  batterySoc: number;
  hr: number;
  altitude: number;
  upcomingGradient: number | null;
  distanceToChange: number | null;
}

export interface TuningFactor {
  name: string;
  value: number;
  detail: string;
}

export interface TuningDecision {
  intensity: number;
  supportIntensity: number;
  torqueIntensity: number;
  launchIntensity: number;
  calibration: AsmoCalibration;
  actual: { support: number; torque: number; midTorque: number; lowTorque: number; launch: number };
  factors: TuningFactor[];
  preemptive: string | null;
}

function intensityToWire(intensity: number): AsmoWire {
  return intensity > 65 ? 0 : intensity > 35 ? 1 : 2;
}

class TuningIntelligence {
  private static instance: TuningIntelligence;
  private current: AsmoCalibration = { support: 1, torque: 1, midTorque: 1, lowTorque: 1, launch: 1 };
  private lastDecision: TuningDecision | null = null;

  // Asymmetric smoothing: per-ASMO counters
  private rampUpCount = 0;
  private rampDownCount = 0;

  static getInstance(): TuningIntelligence {
    if (!TuningIntelligence.instance) {
      TuningIntelligence.instance = new TuningIntelligence();
    }
    return TuningIntelligence.instance;
  }

  evaluate(input: TuningInput): TuningDecision {
    const rider = useSettingsStore.getState().riderProfile;
    const bike = safeBikeConfig(useSettingsStore.getState().bikeConfig);
    const factors: TuningFactor[] = [];
    const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);
    const targetZone = getTargetZone(rider);

    // ═══════════════════════════════════════════════
    // LAYER 1: HR defines TARGET intensity (0-100)
    // This is the PRIMARY driver — not terrain
    // ═══════════════════════════════════════════════
    let hrTarget = 50; // neutral when no HR data
    let hrDetail = 'Sem sensor HR — terreno como fallback';
    let hasHR = false;

    if (input.hr > 0 && rider.hr_max > 0) {
      hasHR = true;

      if (input.hr > targetZone.max_bpm) {
        // HR TOO HIGH — rider is over-exerting
        // Motor must help MORE to bring HR down
        // +8 per bpm above (strong response — this is the regulator)
        const above = input.hr - targetZone.max_bpm;
        hrTarget = Math.min(100, 55 + above * 8);
        hrDetail = `${input.hr}bpm — ${above}bpm acima de ${targetZone.name}, aumentar assist`;
      } else if (input.hr < targetZone.min_bpm) {
        // HR TOO LOW — rider can do more
        // Motor should help LESS to let HR rise
        const below = targetZone.min_bpm - input.hr;
        hrTarget = Math.max(0, 45 - below * 5);
        hrDetail = `${input.hr}bpm — ${below}bpm abaixo de ${targetZone.name}, reduzir assist`;
      } else {
        // IN TARGET ZONE — fine-tune based on position
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const posInZone = zoneRange > 0 ? (input.hr - targetZone.min_bpm) / zoneRange : 0.5;
        // Lower half of zone → slight reduce, upper half → slight increase
        hrTarget = 35 + Math.round(posInZone * 30); // 35-65
        hrDetail = `${input.hr}bpm — dentro de ${targetZone.name} ✓`;
      }
    }

    // Fallback when no HR: use terrain as proxy (less accurate)
    if (!hasHR) {
      hrTarget = this.terrainAsProxy(input.gradient, rider.weight_kg);
      hrDetail = `Sem HR — estimativa por terreno (${input.gradient > 0 ? '+' : ''}${input.gradient.toFixed(0)}%)`;
    }

    factors.push({ name: 'FC Zona', value: Math.round(hrTarget - 50), detail: hrDetail });

    // ═══════════════════════════════════════════════
    // LAYER 2: Terrain defines ANTICIPATION bias (-20 to +25)
    // Does NOT set magnitude — only adjusts timing
    // ═══════════════════════════════════════════════
    let anticipation = 0;
    let preemptive: string | null = null;

    // Pre-emptive: terrain change ahead (within lookahead distance)
    if (input.upcomingGradient !== null && input.distanceToChange !== null) {
      // Dynamic lookahead: shorter at low speed / technical terrain
      const safeLookahead = Math.min(100, input.speed > 10 ? 100 : input.speed > 5 ? 60 : 30);

      if (input.distanceToChange < safeLookahead) {
        if (input.gradient < 3 && input.upcomingGradient > 5) {
          // Flat → climb: pre-boost to prevent HR spike
          anticipation = 25;
          const t = input.speed > 2 ? Math.round(input.distanceToChange / (input.speed / 3.6)) : 999;
          preemptive = `Subida ${input.upcomingGradient.toFixed(0)}% em ${Math.round(input.distanceToChange)}m (~${t}s)`;
        } else if (input.gradient > 3 && input.upcomingGradient < -2) {
          // Climb → descent: pre-reduce
          anticipation = -15;
          preemptive = `Descida em ${Math.round(input.distanceToChange)}m`;
        }
      }
    }

    // Current gradient: small bias for weight on steep climbs
    if (hasHR && input.gradient > 8 && rider.weight_kg > 75) {
      const weightBias = Math.round((rider.weight_kg - 75) / 10 * 3); // +3 per 10kg above 75
      anticipation += Math.min(10, weightBias);
    }

    if (anticipation !== 0) {
      factors.push({ name: 'Antecipação', value: anticipation, detail: preemptive ?? this.descGradient(input.gradient) });
    }

    // ═══════════════════════════════════════════════
    // LAYER 3: Battery as HARD CONSTRAINT (0.4-1.0)
    // Caps the output, doesn't contribute to score
    // ═══════════════════════════════════════════════
    const batteryConstraint = this.getBatteryConstraint(input.batterySoc, totalWh);
    if (batteryConstraint < 1) {
      factors.push({ name: 'Bateria', value: Math.round((batteryConstraint - 1) * 100), detail: `${input.batterySoc}% — limite ×${batteryConstraint.toFixed(2)}` });
    }

    // ═══════════════════════════════════════════════
    // COMBINE: HR target + anticipation, constrained by battery
    // ═══════════════════════════════════════════════
    let auxMod = 0;
    if (input.speed > bike.speed_limit_kmh - 2) auxMod = -25;
    else if (input.speed < 2) auxMod = -20;
    if (input.altitude > 1500) auxMod += Math.min(10, Math.round((input.altitude - 1500) / 250));

    const rawIntensity = Math.max(0, Math.min(100, hrTarget + anticipation + auxMod));
    const overallIntensity = Math.round(rawIntensity * batteryConstraint);

    // Per-parameter intensities
    const supportI = overallIntensity;
    let torqueI = overallIntensity;
    // Technical terrain: cap torque to prevent wheel spin
    if (input.cadence > 0 && input.cadence < 50 && input.gradient > 8) {
      torqueI = Math.min(torqueI, 55);
    }
    let launchI = Math.round(overallIntensity * 0.7);
    if (input.speed < 5 && input.gradient > 3) launchI += 25;
    if (input.speed > 20) launchI -= 15;
    launchI = Math.max(0, Math.min(100, launchI));

    // Map to wire values
    const target: AsmoCalibration = {
      support: intensityToWire(supportI),
      torque: intensityToWire(torqueI),
      midTorque: intensityToWire(Math.max(0, torqueI - 10)),
      lowTorque: intensityToWire(Math.max(0, torqueI - 20)),
      launch: intensityToWire(launchI),
    };

    // ═══════════════════════════════════════════════
    // ASYMMETRIC SMOOTHING
    // Ramp down: 1 sample (immediate — protect rider)
    // Ramp up: 3 samples (cautious — avoid oscillation)
    // ═══════════════════════════════════════════════
    const isRampDown = this.isLowerIntensity(target, this.current);
    const isRampUp = this.isHigherIntensity(target, this.current);

    if (isRampDown) {
      // Immediate: rider is over-exerting, reduce NOW
      this.current = target;
      this.rampUpCount = 0;
      this.rampDownCount++;
    } else if (isRampUp) {
      this.rampUpCount++;
      this.rampDownCount = 0;
      if (this.rampUpCount >= 3) {
        // Stable request for 3 samples: allow increase
        this.current = target;
        this.rampUpCount = 0;
      }
    } else {
      // Same: reset counters
      this.rampUpCount = 0;
      this.rampDownCount = 0;
    }

    const actual = resolveCalibration(this.current, DU7_TABLES);

    // Info factors
    factors.push({ name: 'Alvo', value: 0, detail: `${targetZone.name} (${targetZone.min_bpm}-${targetZone.max_bpm}bpm)` });
    factors.push({ name: 'Motor', value: 0, detail: `S${actual.support}% T${actual.torque} M${actual.midTorque} L${actual.lowTorque} R${actual.launch}` });

    this.lastDecision = {
      intensity: overallIntensity,
      supportIntensity: supportI,
      torqueIntensity: torqueI,
      launchIntensity: launchI,
      calibration: { ...this.current },
      actual,
      factors,
      preemptive,
    };
    return this.lastDecision;
  }

  getLastDecision(): TuningDecision | null { return this.lastDecision; }
  getCurrentCalibration(): AsmoCalibration { return { ...this.current }; }
  reset(): void {
    this.current = { support: 1, torque: 1, midTorque: 1, lowTorque: 1, launch: 1 };
    this.lastDecision = null;
    this.rampUpCount = 0;
    this.rampDownCount = 0;
  }

  // ── Terrain as HR proxy (no HR sensor) ────────
  private terrainAsProxy(gradient: number, weight: number): number {
    // Without HR, terrain is the best guess for effort
    let base = gradient > 12 ? 85 : gradient > 8 ? 72 : gradient > 5 ? 60 :
      gradient > 3 ? 48 : gradient > 1 ? 38 : gradient > -2 ? 25 : 10;
    if (gradient > 2 && weight > 0) base = Math.min(100, Math.round(base * (0.8 + 0.2 * (weight / 75))));
    return base;
  }

  // ── Battery constraint ────────────────────────
  private getBatteryConstraint(soc: number, totalWh: number): number {
    const f = Math.min(totalWh / 1050, 1.2);
    if (soc > 60) return 1.0;
    if (soc > 30 * f) return 0.7 + (soc - 30 * f) / (60 - 30 * f) * 0.3;
    if (soc > 15 * f) return 0.5 + (soc - 15 * f) / (15 * f) * 0.2;
    return 0.4;
  }

  // ── Gradient description ──────────────────────
  private descGradient(g: number): string {
    return g > 12 ? `Forte ${g.toFixed(0)}%` : g > 8 ? `Dura ${g.toFixed(0)}%` :
      g > 5 ? `Moderada ${g.toFixed(0)}%` : g > 3 ? `Suave ${g.toFixed(0)}%` :
      g > -2 ? 'Plano' : `Descida ${g.toFixed(0)}%`;
  }

  // ── Asymmetric smoothing helpers ──────────────
  private isLowerIntensity(a: AsmoCalibration, b: AsmoCalibration): boolean {
    // "Lower intensity" means higher wire values (2=min > 0=max)
    return a.support > b.support || a.torque > b.torque;
  }

  private isHigherIntensity(a: AsmoCalibration, b: AsmoCalibration): boolean {
    return a.support < b.support || a.torque < b.torque;
  }
}

export const tuningIntelligence = TuningIntelligence.getInstance();
