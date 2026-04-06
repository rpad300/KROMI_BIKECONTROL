/**
 * LightRegistry — manages multiple light instances (front + rear).
 *
 * Each connected light gets its own IGPSportLightService (or Garmin) instance.
 * Registry handles routing commands to specific lights by position.
 */

import { IGPSportLightService, LightMode } from './iGPSportLightService';
import { useBikeStore, type LightInfo } from '../../store/bikeStore';

interface LightEntry {
  id: string;
  position: 'front' | 'rear';
  brand: 'igpsport' | 'garmin' | 'unknown';
  service: IGPSportLightService;
}

export class LightRegistry {
  private lights: Map<string, LightEntry> = new Map();

  /** Register a new light connection */
  register(
    id: string,
    position: 'front' | 'rear',
    brand: 'igpsport' | 'garmin' | 'unknown',
    service: IGPSportLightService,
  ): void {
    // If position already occupied, disconnect old light
    for (const [existingId, entry] of this.lights) {
      if (entry.position === position && existingId !== id) {
        entry.service.disconnect();
        this.lights.delete(existingId);
        useBikeStore.getState().removeLight(existingId);
      }
    }

    this.lights.set(id, { id, position, brand, service });

    // Wire state change callback
    service.onStateChange = (state) => {
      useBikeStore.getState().updateLight(id, {
        battery_pct: state.batteryPct,
        mode: state.currentMode,
        connected: state.connected,
      });
      if (!state.connected) {
        this.lights.delete(id);
      }
    };

    // Add to bikeStore
    const info: LightInfo = {
      id,
      name: service.state.deviceName,
      position,
      brand,
      battery_pct: service.state.batteryPct,
      mode: service.state.currentMode,
      connected: true,
    };
    useBikeStore.getState().addLight(info);
    useBikeStore.getState().setServiceConnected('light', true);

    console.log(`[LightRegistry] Registered ${position} light: ${service.state.deviceName} (${brand})`);
  }

  /** Disconnect and remove a light */
  unregister(id: string): void {
    const entry = this.lights.get(id);
    if (entry) {
      entry.service.disconnect();
      this.lights.delete(id);
      useBikeStore.getState().removeLight(id);
    }
    // Update service status
    if (this.lights.size === 0) {
      useBikeStore.getState().setServiceConnected('light', false);
    }
  }

  /** Disconnect all lights */
  disconnectAll(): void {
    for (const [id, entry] of this.lights) {
      entry.service.disconnect();
      useBikeStore.getState().removeLight(id);
    }
    this.lights.clear();
    useBikeStore.getState().setServiceConnected('light', false);
  }

  /** Get light by position */
  getByPosition(position: 'front' | 'rear'): LightEntry | undefined {
    for (const entry of this.lights.values()) {
      if (entry.position === position) return entry;
    }
    return undefined;
  }

  /** Get all connected lights */
  getAll(): LightEntry[] {
    return Array.from(this.lights.values());
  }

  /** Send mode to specific position */
  async setMode(position: 'front' | 'rear', mode: LightMode): Promise<void> {
    const entry = this.getByPosition(position);
    if (entry) {
      await entry.service.setMode(mode);
      useBikeStore.getState().updateLight(entry.id, { mode });
    }
  }

  /** Send mode to ALL connected lights */
  async setModeAll(mode: LightMode): Promise<void> {
    for (const entry of this.lights.values()) {
      await entry.service.setMode(mode);
      useBikeStore.getState().updateLight(entry.id, { mode });
    }
  }

  /** Send mode to rear light only (for brake flash) */
  async setModeRear(mode: LightMode): Promise<void> {
    await this.setMode('rear', mode);
  }

  /** Send mode to front light only (for headlight) */
  async setModeFront(mode: LightMode): Promise<void> {
    await this.setMode('front', mode);
  }

  /** Whether any light is connected */
  get hasLights(): boolean {
    return this.lights.size > 0;
  }

  /** Number of connected lights */
  get count(): number {
    return this.lights.size;
  }

  /** Get any connected light's device name (for compat) */
  getAnyDeviceName(): string | null {
    for (const entry of this.lights.values()) {
      return entry.service.state.deviceName;
    }
    return null;
  }

  /** Detect position from device name */
  static detectPosition(name: string): 'front' | 'rear' {
    if (/^VS\d/i.test(name) || /front/i.test(name) || /headlight/i.test(name)) return 'front';
    if (/^LR\d/i.test(name) || /rear/i.test(name) || /tail/i.test(name)) return 'rear';
    // Default: first light is rear (most common use case for safety)
    return 'rear';
  }
}

/** Singleton registry */
export const lightRegistry = new LightRegistry();
