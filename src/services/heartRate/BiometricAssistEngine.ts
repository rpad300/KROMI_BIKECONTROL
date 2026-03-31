import { AssistMode } from '../../types/bike.types';
import { HRZoneEngine } from './HRZoneEngine';
import { autoAssistEngine } from '../autoAssist/AutoAssistEngine';

/**
 * Combines HR + Elevation for optimal assist decision.
 * HR has 15-30s physiological lag → combining with anticipative elevation solves it.
 */
export class BiometricAssistEngine {
  private hrEngine: HRZoneEngine;

  constructor(hrEngine: HRZoneEngine) {
    this.hrEngine = hrEngine;
  }

  async tick(
    lat: number,
    lng: number,
    heading: number,
    speed_kmh: number,
    currentMode: AssistMode
  ): Promise<{ mode: AssistMode; reason: string; hrZone: number; hrBpm: number }> {
    const hr = this.hrEngine.getSmoothedHR();
    const hrZone = this.hrEngine.getCurrentZone();
    const hrTrend = this.hrEngine.getTrend();
    // 1. Base decision from elevation (anticipative)
    const terrainDecision = await autoAssistEngine.tick(lat, lng, heading, speed_kmh, currentMode);

    // 2. If no HR data, use terrain only
    if (hr === 0) {
      return {
        mode: terrainDecision.action === 'change_mode' ? (terrainDecision.new_mode as AssistMode) : currentMode,
        reason: terrainDecision.reason + ' (sem FC)',
        hrZone: 0,
        hrBpm: 0,
      };
    }

    // 3. HR zone 5 → POWER immediately regardless of terrain
    if (hrZone.zone === 5) {
      return {
        mode: AssistMode.POWER,
        reason: `FC zona 5 (${hr}bpm) - esforco maximo`,
        hrZone: 5,
        hrBpm: hr,
      };
    }

    // 4. HR zone 4 + rising → anticipate, don't wait for zone 5
    if (hrZone.zone === 4 && hrTrend === 'rising') {
      const elevMode = terrainDecision.action === 'change_mode'
        ? (terrainDecision.new_mode as number)
        : (currentMode as number);
      const targetMode = Math.max(elevMode, AssistMode.SPORT as number) as AssistMode;
      return {
        mode: targetMode,
        reason: `FC zona 4 subindo (${hr}bpm) - antecipar apoio`,
        hrZone: 4,
        hrBpm: hr,
      };
    }

    // 5. HR low (zone 1-2) + no pre-emptive terrain → reduce motor, save battery
    if (hrZone.zone <= 2 && !terrainDecision.is_preemptive) {
      const reduced = this.reduceMode(currentMode);
      if (reduced !== currentMode) {
        return {
          mode: reduced,
          reason: `FC zona ${hrZone.zone} (${hr}bpm) - poupar bateria`,
          hrZone: hrZone.zone,
          hrBpm: hr,
        };
      }
    }

    // 6. HR zone 3 (target) → let terrain decide if pre-emptive, otherwise stable
    if (hrZone.zone === 3) {
      if (terrainDecision.action === 'change_mode' && terrainDecision.is_preemptive) {
        return {
          mode: terrainDecision.new_mode as AssistMode,
          reason: `${terrainDecision.reason} (FC ok ${hr}bpm)`,
          hrZone: 3,
          hrBpm: hr,
        };
      }
      return {
        mode: currentMode,
        reason: `FC zona alvo (${hr}bpm) - estavel`,
        hrZone: 3,
        hrBpm: hr,
      };
    }

    // 7. Default: use terrain decision
    return {
      mode: terrainDecision.action === 'change_mode' ? (terrainDecision.new_mode as AssistMode) : currentMode,
      reason: terrainDecision.reason,
      hrZone: hrZone.zone,
      hrBpm: hr,
    };
  }

  private reduceMode(mode: AssistMode): AssistMode {
    const order = [AssistMode.OFF, AssistMode.ECO, AssistMode.TOUR, AssistMode.SPORT, AssistMode.POWER];
    const idx = order.indexOf(mode);
    return idx > 0 ? order[idx - 1]! : mode;
  }
}
