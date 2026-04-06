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
import { iGPSportLightService, NUS_SERVICE_UUID } from './iGPSportLightService';
import { VARIA_RTL_SERVICE, VARIA_HL_SERVICE } from './GarminVariaService';
import { BOSCH_MCSP_SERVICE } from './BoschEBikeService';
import { SPEC_MCSP_SERVICE, BES3_SERVICE } from './SpecializedFlowService';
import { TURBO_SERVICE_1 } from './SpecializedTurboService';
import { SBI_SERVICE } from './ShimanoMotorService';
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

  // Wait for bridge — try twice with increasing timeout
  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (wsClient.isConnected) {
    bleMode = 'websocket';
    console.log('[BLE Bridge] Mode: WebSocket Bridge — full BLE via middleware');
    // Auto-connect to saved bike device
    const savedBike = getSavedDevice();
    if (savedBike && wsClient.isConnected) {
      console.log(`[BLE Bridge] Auto-connecting to saved bike: ${savedBike.name} (${savedBike.address})`);
      wsClient.connectToDevice(savedBike.address);
    }
    setTimeout(() => autoConnectSensors(), 2000);
  } else {
    // Default to web but keep trying WS in background
    bleMode = 'web';
    console.log('[BLE Bridge] Mode: Web Bluetooth — WS bridge not yet available');
    console.log('[BLE Bridge] Will auto-switch to WebSocket when bridge connects');

    // Listen for WS connection and auto-switch mode
    const checkInterval = setInterval(() => {
      if (wsClient.isConnected && bleMode === 'web') {
        bleMode = 'websocket';
        console.log('[BLE Bridge] Mode switched: WebSocket Bridge now available!');
        // Auto-connect bike + sensors
        const savedBike = getSavedDevice();
        if (savedBike) {
          console.log(`[BLE Bridge] Auto-connecting to saved bike: ${savedBike.name} (${savedBike.address})`);
          wsClient.connectToDevice(savedBike.address);
        }
        setTimeout(() => autoConnectSensors(), 1000);
        clearInterval(checkInterval);
      }
    }, 2000);

    // Stop checking after 2 minutes
    setTimeout(() => clearInterval(checkInterval), 120_000);
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
      // Multi-brand: Web BLE picker shows all supported e-bike services
      try {
        const device = await navigator.bluetooth.requestDevice({
          filters: [
            { services: ['0000fc23-0000-1000-8000-00805f9b34fb'] }, // Giant GEV
            { services: [BOSCH_MCSP_SERVICE] },                     // Bosch
            { services: [SPEC_MCSP_SERVICE] },                      // Specialized Flow
            { services: [BES3_SERVICE] },                            // Specialized BES3
            { services: [TURBO_SERVICE_1] },                         // Specialized Turbo
            { services: [SBI_SERVICE] },                              // Shimano STEPS
          ],
          optionalServices: [0x180f, 0x180a, 0x1816, 0x1818],
        });
        // Route to correct service based on device
        const { isBoschEBike } = await import('./BoschEBikeService');
        const { isSpecializedBike } = await import('./SpecializedFlowService');
        const { isSpecializedTurbo } = await import('./SpecializedTurboService');
        const { isShimanoMotor } = await import('./ShimanoMotorService');
        const name = device.name ?? '';
        const uuids = ''; // Web BLE doesn't expose ad UUIDs pre-connect

        if (isBoschEBike(name, uuids)) {
          const { boschEBikeService } = await import('./BoschEBikeService');
          await boschEBikeService.connectToDevice(device);
        } else if (isSpecializedBike(name, uuids)) {
          const { specializedFlowService } = await import('./SpecializedFlowService');
          await specializedFlowService.connectToDevice(device);
        } else if (isSpecializedTurbo(name, uuids)) {
          const { specializedTurboService } = await import('./SpecializedTurboService');
          await specializedTurboService.connectToDevice(device);
        } else if (isShimanoMotor(name, uuids)) {
          const { shimanoMotorService } = await import('./ShimanoMotorService');
          await shimanoMotorService.connectToDevice(device);
        } else {
          // Default: Giant (uses its own scanner)
          await giantBLEService.connect();
        }
      } catch {
        // Fallback: Giant-only picker
        await giantBLEService.connect();
      }
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

/** Send assist mode command (brand-aware routing) */
export async function sendAssistMode(mode: number): Promise<boolean> {
  switch (bleMode) {
    case 'websocket': {
      // Route to correct brand's command via bridge
      const { useBikeStore } = await import('../../store/bikeStore');
      const brand = useBikeStore.getState().bike_brand;
      const { mapAssistToNative } = await import('../../types/bike.types');
      const nativeMode = mapAssistToNative(brand, mode);
      switch (brand) {
        case 'bosch': wsClient.send({ type: 'boschAssist', mode: nativeMode }); break;
        case 'shimano': wsClient.send({ type: 'shimanoMotorAssist', mode: nativeMode }); break;
        case 'specialized': wsClient.send({ type: 'specializedAssist', mode: nativeMode }); break;
        default: wsClient.sendAssistMode(mode); // Giant (native values match)
      }
      return true;
    }
    case 'native':
      return capacitorBLEService.sendAssistMode(mode);
    case 'web':
      await giantBLEService.sendAssistMode(mode);
      return false;
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

/** Connect external sensor (scan + auto-connect first found) */
function connectSensor(sensor: string, webFallback: () => Promise<void>): Promise<void> {
  if (bleMode === 'websocket') {
    const saved = getSavedSensorDevice(sensor as SensorType);
    if (saved) {
      wsClient.send({ type: 'connectSensor', sensor, address: saved.address });
    } else {
      wsClient.send({ type: 'scanSensor', sensor });
    }
    return Promise.resolve();
  }
  return webFallback();
}

/** Disconnect external sensor */
function disconnectSensorBridge(sensor: string, webFallback: () => void): void {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'disconnectSensor', sensor });
  } else {
    webFallback();
  }
}

export const connectHR = () => connectSensor('hr', () => giantBLEService.connectHR());
export const connectDi2 = () => {
  // Use ShimanoProtocol (with auth) instead of generic SensorManager
  if (bleMode === 'websocket') {
    const saved = getSavedSensorDevice('di2' as SensorType);
    if (saved) {
      wsClient.send({ type: 'shimanoConnect', address: saved.address });
    } else {
      wsClient.send({ type: 'shimanoScan' });
    }
    return Promise.resolve();
  }
  return giantBLEService.connectDi2();
};
export const connectSRAM = () => connectSensor('sram', () => giantBLEService.connectSRAM());
export const connectExtPower = () => connectSensor('power', () => giantBLEService.connectExtPower());
export const connectExtCadence = () => connectSensor('cadence', () => Promise.resolve()); // external cadence — APK only

export const disconnectHR = () => disconnectSensorBridge('hr', () => giantBLEService.disconnectHR());
export const disconnectDi2 = () => {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'shimanoDisconnect' });
  } else {
    giantBLEService.disconnectDi2();
  }
};
export const disconnectSRAM = () => disconnectSensorBridge('sram', () => giantBLEService.disconnectSRAM());
export const disconnectExtPower = () => disconnectSensorBridge('power', () => giantBLEService.disconnectExtPower());
export const disconnectExtCadence = () => disconnectSensorBridge('cadence', () => {});

// === Light Accessory (iGPSPORT NUS + Garmin Varia) ===
export const connectLight = () => connectSensor('light', async () => {
  // Web BLE: try to show picker with both iGPSPORT and Garmin filters
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [NUS_SERVICE_UUID] },
        { services: [VARIA_RTL_SERVICE] },
        { services: [VARIA_HL_SERVICE] },
      ],
      optionalServices: [0x180f, 0x180a], // Battery + Device Info
    });
    // Detect which protocol to use based on device name/services
    const { isGarminVaria } = await import('./GarminVariaService');
    if (isGarminVaria(device.name ?? '', '')) {
      const { garminVariaService } = await import('./GarminVariaService');
      await garminVariaService.connectToDevice(device);
    } else {
      await iGPSportLightService.connectToDevice(device);
    }
  } catch { /* user cancelled */ }
});
export const disconnectLight = () => {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'disconnectSensor', sensor: 'light' });
  } else {
    iGPSportLightService.disconnect();
    import('./GarminVariaService').then(({ garminVariaService }) => garminVariaService.disconnect());
  }
};
export function getLightDeviceName(): string | null {
  return iGPSportLightService.getDeviceName(); // Garmin name comes via bikeStore.light_device_name
}

// === Radar Accessory (Garmin Varia RTL via Web BLE or bridge) ===
export const connectRadar = () => connectSensor('radar', async () => {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [VARIA_RTL_SERVICE] }],
      optionalServices: [0x180f],
    });
    const { garminVariaService } = await import('./GarminVariaService');
    await garminVariaService.connectToDevice(device);
  } catch { /* user cancelled */ }
});
export const disconnectRadar = () => disconnectSensorBridge('radar', () => {});
export function getRadarDeviceName(): string | null {
  return null; // radar device name comes via WS messages
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

/** Advanced tuning: 16 levels (0-15) per support/torque/launch per mode */
export function setAdvancedTuning(params: {
  powerSupport: number; powerTorque: number; powerLaunch: number;
  sportSupport?: number; sportTorque?: number; sportLaunch?: number;
}): void {
  if (bleMode === 'websocket') wsClient.setAdvancedTuning(params);
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

// === Saved sensors (generic) ===

const SENSOR_TYPES = ['hr', 'di2', 'sram', 'power', 'light', 'radar'] as const;
type SensorType = typeof SENSOR_TYPES[number];

/** Save sensor device for auto-connect */
export function saveSensorDevice(sensor: SensorType, device: SavedDevice): void {
  localStorage.setItem(`kromi_saved_${sensor}`, JSON.stringify(device));
}

/** Get saved sensor device */
export function getSavedSensorDevice(sensor: SensorType): SavedDevice | null {
  const raw = localStorage.getItem(`kromi_saved_${sensor}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Clear saved sensor device */
export function clearSensorDevice(sensor: SensorType): void {
  localStorage.removeItem(`kromi_saved_${sensor}`);
}

// Legacy aliases
export const saveHRDevice = (d: SavedDevice) => saveSensorDevice('hr', d);
export const getSavedHRDevice = () => getSavedSensorDevice('hr');
export const clearHRDevice = () => clearSensorDevice('hr');

/** Auto-connect all saved sensors via bridge */
export function autoConnectSensors(): void {
  if (bleMode !== 'websocket') return;
  for (const sensor of SENSOR_TYPES) {
    const saved = getSavedSensorDevice(sensor);
    if (saved) {
      console.log(`[BLE Bridge] Auto-connecting ${sensor}: ${saved.name} (${saved.address})`);
      wsClient.send({ type: 'connectSensor', sensor, address: saved.address });
    }
  }
}

/** Get current BLE mode description */
export function getBLEModeDescription(): string {
  switch (bleMode) {
    case 'websocket': return 'Bridge (full control)';
    case 'native': return 'Native (full control)';
    case 'web': return 'Web BLE (read only)';
  }
}
