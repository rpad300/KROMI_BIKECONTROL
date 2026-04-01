/**
 * BLE Bridge — three-tier connection strategy:
 *
 * 1. WebSocket Bridge (highest priority)
 *    → Android middleware app running BLE Bridge on ws://localhost:8765
 *    → Full BLE access: bonding, GEV motor control, Proto, all sensors
 *    → Best option: PWA updates instantly, middleware is stable
 *
 * 2. Capacitor Native (when running as native app)
 *    → Direct BLE via @capacitor-community/bluetooth-le
 *    → Full access with bonding
 *
 * 3. Web Bluetooth (fallback for browser PWA)
 *    → Standard BLE services only (Battery, CSC, Power)
 *    → No motor control (GEV/Proto require bonding)
 */

import { wsClient } from './WebSocketBLEClient';
import { isCapacitorNative, capacitorBLEService } from './CapacitorBLEService';
import { giantBLEService } from './GiantBLEService';
import { tpmsService } from './TPMSService';
import type { TuningLevels, TuningMode } from '../../store/tuningStore';

export type BLEMode = 'websocket' | 'native' | 'web';

/** Current active BLE mode */
export let bleMode: BLEMode = 'web';

/** Initialize BLE subsystem — tries WebSocket bridge first */
export async function initBLE(): Promise<void> {
  if (isCapacitorNative()) {
    bleMode = 'native';
    await capacitorBLEService.initialize();
    console.log('[BLE Bridge] Mode: Capacitor Native — full BLE with bonding');
    return;
  }

  // Try connecting to WebSocket bridge (middleware app)
  wsClient.connect();

  // Wait briefly to see if bridge is available
  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (wsClient.isConnected) {
    bleMode = 'websocket';
    console.log('[BLE Bridge] Mode: WebSocket Bridge — full BLE via middleware');
    // Auto-connect saved HR sensor when bridge is available
    setTimeout(() => autoConnectHR(), 2000);
  } else {
    bleMode = 'web';
    console.log('[BLE Bridge] Mode: Web Bluetooth — standard services only');
    console.log('[BLE Bridge] Install the BLE Bridge app for motor control');
  }
}

/** Connect to the Giant Smart Gateway */
export async function connectBike(): Promise<void> {
  switch (bleMode) {
    case 'websocket':
      wsClient.connectBike();
      break;
    case 'native':
      await capacitorBLEService.connect();
      break;
    case 'web':
      // Check if bridge became available since init
      if (wsClient.isConnected) {
        bleMode = 'websocket';
        wsClient.connectBike();
        return;
      }
      await giantBLEService.connect();
      break;
  }
}

/** Disconnect from the bike */
export function disconnectBike(): void {
  switch (bleMode) {
    case 'websocket':
      wsClient.disconnectBike();
      break;
    case 'native':
      capacitorBLEService.disconnect();
      break;
    case 'web':
      giantBLEService.disconnect();
      break;
  }
}

/** Send assist mode command */
export async function sendAssistMode(mode: number): Promise<boolean> {
  switch (bleMode) {
    case 'websocket':
      wsClient.sendAssistMode(mode);
      return true;
    case 'native':
      return capacitorBLEService.sendAssistMode(mode);
    case 'web':
      await giantBLEService.sendAssistMode(mode);
      return false; // Web BLE can't control motor
  }
}

/** Check if motor control is available */
export function isMotorControlAvailable(): boolean {
  switch (bleMode) {
    case 'websocket':
      return wsClient.isConnected;
    case 'native':
      return capacitorBLEService.isGEVAvailable() || capacitorBLEService.isProtoAvailable();
    case 'web':
      return false;
  }
}

/** Check if connected to bike */
export function isBikeConnected(): boolean {
  switch (bleMode) {
    case 'websocket':
      return wsClient.isBikeConnected;
    case 'native':
      return capacitorBLEService.isConnected();
    case 'web':
      return giantBLEService.isConnected();
  }
}

/** Get connected device name */
export function getDeviceName(): string | null {
  switch (bleMode) {
    case 'websocket':
      return null; // Device name comes via WS messages
    case 'native':
      return capacitorBLEService.getDeviceName();
    case 'web':
      return giantBLEService.getDeviceName();
  }
}

/** Connect HR */
export async function connectHR(): Promise<void> {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'scanSensor', sensor: 'hr' });
  } else {
    await giantBLEService.connectHR();
  }
}

/** Connect Di2 */
export async function connectDi2(): Promise<void> {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'scanSensor', sensor: 'di2' });
  } else {
    await giantBLEService.connectDi2();
  }
}

/** Connect SRAM AXS */
export async function connectSRAM(): Promise<void> {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'scanSensor', sensor: 'sram' });
  } else {
    await giantBLEService.connectSRAM();
  }
}

/** Connect external Power Meter */
export async function connectExtPower(): Promise<void> {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'scanSensor', sensor: 'power' });
  } else {
    await giantBLEService.connectExtPower();
  }
}

/** Disconnect HR */
export function disconnectHR(): void {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'disconnectSensor', sensor: 'hr' });
  } else {
    giantBLEService.disconnectHR();
  }
}

/** Disconnect Di2 */
export function disconnectDi2(): void {
  if (bleMode === 'web') giantBLEService.disconnectDi2();
}

/** Disconnect SRAM */
export function disconnectSRAM(): void {
  if (bleMode === 'web') giantBLEService.disconnectSRAM();
}

/** Disconnect external Power Meter */
export function disconnectExtPower(): void {
  if (bleMode === 'web') giantBLEService.disconnectExtPower();
}

/** Get HR device name */
export function getHRDeviceName(): string | null {
  return giantBLEService.getHRDeviceName();
}

/** Get Di2 device name */
export function getDi2DeviceName(): string | null {
  return giantBLEService.getDi2DeviceName();
}

/** Get SRAM device name */
export function getSRAMDeviceName(): string | null {
  return giantBLEService.getSRAMDeviceName();
}

/** Get external power meter device name */
export function getExtPowerDeviceName(): string | null {
  return giantBLEService.getExtPowerDeviceName();
}

/** Connect front TPMS sensor */
export async function connectFrontTPMS(): Promise<void> {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'scanSensor', sensor: 'tpmsFront' });
  } else {
    await tpmsService.connectFront();
  }
}

/** Connect rear TPMS sensor */
export async function connectRearTPMS(): Promise<void> {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'scanSensor', sensor: 'tpmsRear' });
  } else {
    await tpmsService.connectRear();
  }
}

/** Disconnect front TPMS */
export function disconnectFrontTPMS(): void {
  if (bleMode === 'web') tpmsService.disconnectFront();
}

/** Disconnect rear TPMS */
export function disconnectRearTPMS(): void {
  if (bleMode === 'web') tpmsService.disconnectRear();
}

/** Get front TPMS device name */
export function getFrontTPMSDeviceName(): string | null {
  return tpmsService.getFrontDeviceName();
}

/** Get rear TPMS device name */
export function getRearTPMSDeviceName(): string | null {
  return tpmsService.getRearDeviceName();
}

// === Tuning API (WebSocket bridge only) ===

/** Read current tuning from motor */
export function readTuning(): void {
  if (bleMode === 'websocket') wsClient.readTuning();
}

/** Write tuning levels to motor */
export function setTuning(levels: TuningLevels): void {
  if (bleMode === 'websocket') wsClient.setTuning(levels);
}

/** Set a single mode's tuning level */
export function setTuningMode(mode: TuningMode, level: number): void {
  if (bleMode === 'websocket') wsClient.setTuningMode(mode, level);
}

/** Preset: all modes MAX */
export function tuneMax(): void {
  if (bleMode === 'websocket') wsClient.tuneMax();
}

/** Preset: all modes MIN */
export function tuneMin(): void {
  if (bleMode === 'websocket') wsClient.tuneMin();
}

/** Restore original tuning */
export function tuneRestore(): void {
  if (bleMode === 'websocket') wsClient.tuneRestore();
}

/** Whether tuning control is available */
export function isTuningAvailable(): boolean {
  return bleMode === 'websocket' && wsClient.isBikeConnected;
}

// === Scan API (PWA-driven device picker, WebSocket only) ===

/** Start BLE scan — results via wsClient.onScanResult */
export function startScan(): void {
  if (bleMode === 'websocket') wsClient.startScan();
}

/** Stop ongoing scan */
export function stopScan(): void {
  if (bleMode === 'websocket') wsClient.stopScan();
}

/** Connect to a specific device by MAC address */
export function connectDevice(address: string): void {
  if (bleMode === 'websocket') wsClient.connectToDevice(address);
}

// === Saved devices (remember last connected bike + sensors) ===

const SAVED_DEVICE_KEY = 'kromi_saved_device';
const SAVED_HR_KEY = 'kromi_saved_hr';

export interface SavedDevice {
  name: string;
  address: string;
}

/** Save connected device for auto-connect */
export function saveDevice(device: SavedDevice): void {
  localStorage.setItem(SAVED_DEVICE_KEY, JSON.stringify(device));
}

/** Get saved device (null if none) */
export function getSavedDevice(): SavedDevice | null {
  const raw = localStorage.getItem(SAVED_DEVICE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Clear saved device (forget bike) */
export function clearSavedDevice(): void {
  localStorage.removeItem(SAVED_DEVICE_KEY);
}

// === Saved HR sensor ===

/** Save HR device for auto-connect */
export function saveHRDevice(device: SavedDevice): void {
  localStorage.setItem(SAVED_HR_KEY, JSON.stringify(device));
}

/** Get saved HR device */
export function getSavedHRDevice(): SavedDevice | null {
  const raw = localStorage.getItem(SAVED_HR_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Clear saved HR device */
export function clearHRDevice(): void {
  localStorage.removeItem(SAVED_HR_KEY);
}

/** Auto-connect saved HR sensor via bridge */
export function autoConnectHR(): void {
  if (bleMode !== 'websocket') return;
  const saved = getSavedHRDevice();
  if (!saved) return;
  console.log(`[BLE Bridge] Auto-connecting HR: ${saved.name} (${saved.address})`);
  wsClient.send({ type: 'connectSensor', sensor: 'hr', address: saved.address });
}

/** Get current BLE mode description */
export function getBLEModeDescription(): string {
  switch (bleMode) {
    case 'websocket': return 'Bridge (full control)';
    case 'native': return 'Native (full control)';
    case 'web': return 'Web BLE (read only)';
  }
}
