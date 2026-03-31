/**
 * BLE Bridge — auto-detects Capacitor native vs browser and routes BLE calls.
 *
 * - Capacitor native app: uses @capacitor-community/bluetooth-le (supports bonding)
 * - Browser PWA: uses Web Bluetooth (standard services only)
 *
 * Components should import from here instead of directly using GiantBLEService.
 */

import { isCapacitorNative, capacitorBLEService } from './CapacitorBLEService';
import { giantBLEService } from './GiantBLEService';

export const bleMode = isCapacitorNative() ? 'native' : 'web';

/** Initialize BLE subsystem (call once on app start) */
export async function initBLE(): Promise<void> {
  if (bleMode === 'native') {
    await capacitorBLEService.initialize();
    console.log('[BLE Bridge] Using Capacitor native BLE — bonding + motor control available');
  } else {
    console.log('[BLE Bridge] Using Web Bluetooth — standard services only');
  }
}

/** Connect to the Giant Smart Gateway */
export async function connectBike(): Promise<void> {
  if (bleMode === 'native') {
    await capacitorBLEService.connect();
  } else {
    await giantBLEService.connect();
  }
}

/** Disconnect from the bike */
export function disconnectBike(): void {
  if (bleMode === 'native') {
    capacitorBLEService.disconnect();
  } else {
    giantBLEService.disconnect();
  }
}

/** Send assist mode command to motor */
export async function sendAssistMode(mode: number): Promise<boolean> {
  if (bleMode === 'native') {
    return capacitorBLEService.sendAssistMode(mode);
  } else {
    // Web Bluetooth — local mode only (no GEV access)
    await giantBLEService.sendAssistMode(mode);
    return giantBLEService.isConnected() && giantBLEService.isProtoConnected();
  }
}

/** Check if motor control (GEV/Proto) is available */
export function isMotorControlAvailable(): boolean {
  if (bleMode === 'native') {
    return capacitorBLEService.isGEVAvailable() || capacitorBLEService.isProtoAvailable();
  }
  return false;
}

/** Check if connected to bike */
export function isBikeConnected(): boolean {
  if (bleMode === 'native') {
    return capacitorBLEService.isConnected();
  }
  return giantBLEService.isConnected();
}

/** Get connected device name */
export function getDeviceName(): string | null {
  if (bleMode === 'native') {
    return capacitorBLEService.getDeviceName();
  }
  return giantBLEService.getDeviceName();
}

/** Connect HR monitor (Web BLE only — Capacitor handles via main connection) */
export async function connectHR(): Promise<void> {
  if (bleMode === 'web') {
    await giantBLEService.connectHR();
  }
}

/** Connect Di2 (Web BLE only) */
export async function connectDi2(): Promise<void> {
  if (bleMode === 'web') {
    await giantBLEService.connectDi2();
  }
}

/** Disconnect HR */
export function disconnectHR(): void {
  if (bleMode === 'web') {
    giantBLEService.disconnectHR();
  }
}

/** Disconnect Di2 */
export function disconnectDi2(): void {
  if (bleMode === 'web') {
    giantBLEService.disconnectDi2();
  }
}

/** Get HR device name */
export function getHRDeviceName(): string | null {
  if (bleMode === 'web') {
    return giantBLEService.getHRDeviceName();
  }
  return null;
}

/** Get Di2 device name */
export function getDi2DeviceName(): string | null {
  if (bleMode === 'web') {
    return giantBLEService.getDi2DeviceName();
  }
  return null;
}
