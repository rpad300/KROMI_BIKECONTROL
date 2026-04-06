/**
 * AccessoriesManager — orchestrates SmartLight + Radar services.
 *
 * Runs on a 1-second tick loop when accessories are connected.
 * Reads state from bikeStore + settingsStore, sends commands to light/radar.
 * Integrates with KromiEngine via the tick() call.
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
    this.sendLightMode(mode);
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
        this.sendLightMode(output.targetMode);
        store.setLightMode(output.targetMode);
      }
    }
  }

  /** Send light mode command via BLE bridge or direct */
  private sendLightMode(mode: LightMode): void {
    // Dynamic import to avoid circular dependency
    import('../bluetooth/BLEBridge').then(({ bleMode }) => {
      if (bleMode === 'websocket') {
        import('../bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
          wsClient.send({ type: 'lightSetMode', mode });
        });
      } else {
        import('../bluetooth/iGPSportLightService').then(({ iGPSportLightService }) => {
          iGPSportLightService.setMode(mode);
        });
      }
    });
  }
}

/** Singleton */
export const accessoriesManager = new AccessoriesManager();
