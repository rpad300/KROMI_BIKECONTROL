/**
 * AccessoriesManager — orchestrates SmartLight + Radar services.
 *
 * Runs on a 1-second tick loop when accessories are connected.
 * Reads state from bikeStore + settingsStore, sends commands to light/radar.
 * Multi-light aware: routes brake flash to rear, headlight to front, turn signals to all.
 */

import { useBikeStore } from '../../store/bikeStore';
import { SmartLightService, type SmartLightConfig, type SmartLightOutput } from './SmartLightService';
import { radarService, type RadarConfig } from './RadarService';
import { LightMode } from '../bluetooth/iGPSportLightService';

class AccessoriesManager {
  private smartLight = new SmartLightService();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private lastLightOutput: SmartLightOutput | null = null;

  get isRunning(): boolean { return this._running; }
  get lightOutput(): SmartLightOutput | null { return this.lastLightOutput; }
  get radarState() { return radarService.state; }

  /** Start the accessories tick loop */
  start(): void {
    if (this._running) return;
    this._running = true;

    // Wire radar state changes to bikeStore
    radarService.onStateChange = (state) => {
      const store = useBikeStore.getState();
      store.setRadarTarget(state.max_threat, state.closest_distance_m, state.closest_speed_kmh);
    };

    // Tick every 1 second
    this.tickTimer = setInterval(() => this.tick(), 1000);
    console.log('[Accessories] Manager started');
  }

  /** Stop the tick loop */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this._running = false;
    radarService.onStateChange = null;
    console.log('[Accessories] Manager stopped');
  }

  /** Update SmartLight config */
  updateSmartLightConfig(config: Partial<SmartLightConfig>): void {
    this.smartLight.updateConfig(config);
  }

  /** Update Radar config */
  updateRadarConfig(config: Partial<RadarConfig>): void {
    radarService.updateConfig(config);
  }

  /** User manually changed light mode — pause auto-control */
  notifyManualLightChange(): void {
    this.smartLight.notifyManualOverride();
  }

  /** Trigger turn signal */
  triggerTurnSignal(direction: 'left' | 'right'): void {
    const mode = this.smartLight.triggerTurnSignal(direction);
    this.sendLightMode(mode, 'all'); // Turn signals go to ALL lights
  }

  /** Cancel turn signal */
  cancelTurnSignal(): void {
    this.smartLight.cancelTurnSignal();
  }

  /** Get the SmartLightService (for KromiEngine direct access) */
  getSmartLight(): SmartLightService { return this.smartLight; }

  /** Get the RadarService */
  getRadar() { return radarService; }

  // ── Internal tick ─────────────────────────────────────────────

  private tick(): void {
    const store = useBikeStore.getState();

    // Tick radar (cleanup stale targets)
    radarService.tick();

    // Tick smart light
    const lightConnected = store.ble_services.light;
    if (lightConnected) {
      const output = this.smartLight.tick(
        store.speed_kmh,
        store.light_lux,
        store.radar_threat_level,
        store.light_mode as LightMode,
        true,
      );

      this.lastLightOutput = output;

      // Send mode change to light if needed
      if (output.targetMode !== null && output.targetMode !== store.light_mode) {
        // Route by reason: brake/radar → rear, headlight → front, else → all
        const target = this.routeTarget(output.reason);
        this.sendLightMode(output.targetMode, target);
        store.setLightMode(output.targetMode);
      }
    }
  }

  /** Determine which light(s) should receive the command based on reason */
  private routeTarget(reason: string): 'front' | 'rear' | 'all' {
    if (reason === 'braking' || reason === 'brake_end') return 'rear';
    if (reason.startsWith('radar_')) return 'rear';
    if (reason.startsWith('turn_')) return 'all';
    if (reason === 'speed_adaptive' || reason === 'auto_on_dark' || reason === 'auto_off_bright') return 'all';
    return 'all';
  }

  /** Send light mode command via BLE bridge or direct — multi-light aware */
  private sendLightMode(mode: LightMode, target: 'front' | 'rear' | 'all'): void {
    import('../bluetooth/BLEBridge').then(({ bleMode }) => {
      if (bleMode === 'websocket') {
        import('../bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
          wsClient.send({ type: 'lightSetMode', mode, target });
        });
      } else {
        import('../bluetooth/LightRegistry').then(({ lightRegistry }) => {
          if (target === 'all') {
            lightRegistry.setModeAll(mode);
          } else {
            lightRegistry.setMode(target, mode);
          }
        });
      }
    });
  }
}

/** Singleton */
export const accessoriesManager = new AccessoriesManager();
