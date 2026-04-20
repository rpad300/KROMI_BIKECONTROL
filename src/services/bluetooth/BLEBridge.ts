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
import { IGPSportLightService, NUS_SERVICE_UUID } from './iGPSportLightService';
import { lightRegistry, LightRegistry } from './LightRegistry';
import { VARIA_RTL_SERVICE, VARIA_HL_SERVICE } from './GarminVariaService';
import { BOSCH_MCSP_SERVICE } from './BoschEBikeService';
import { SPEC_MCSP_SERVICE, BES3_SERVICE } from './SpecializedFlowService';
import { TURBO_SERVICE_1 } from './SpecializedTurboService';
import { SBI_SERVICE } from './ShimanoMotorService';
import type { TuningLevels, TuningMode } from '../../store/tuningStore';
import { useSettingsStore, type BikeSensors } from '../../store/settingsStore';

export type BLEMode = 'websocket' | 'native' | 'web';

/** Current active BLE mode.
 * TODO: Move bleMode to bikeStore for reactive UI updates — currently a
 * module-level `let` that React components cannot subscribe to. */
export let bleMode: BLEMode = 'web';

/** Interval reference for WebSocket reconnection watcher — cleaned up by cleanupBLE() */
let wsWatchInterval: ReturnType<typeof setInterval> | null = null;

/** Clean up BLE watchers (call on unmount to prevent memory leaks) */
export function cleanupBLE(): void {
  if (wsWatchInterval) {
    clearInterval(wsWatchInterval);
    wsWatchInterval = null;
  }
}

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

  // Wait up to 5s for WebSocket bridge, checking every 500ms
  for (let i = 0; i < 10; i++) {
    if (wsClient.isConnected) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (wsClient.isConnected) {
    bleMode = 'websocket';
    console.log('[BLE Bridge] Mode: WebSocket Bridge — full BLE via middleware');
    // Auto-connect to saved bike device (prefer bike config motor, fallback to localStorage)
    const bikeMotor = useSettingsStore.getState().bikeConfig?.sensors?.motor;
    const savedBike = (bikeMotor && bikeMotor.address) ? bikeMotor : getSavedDevice();
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
    if (wsWatchInterval) clearInterval(wsWatchInterval);
    wsWatchInterval = setInterval(() => {
      if (wsClient.isConnected && bleMode === 'web') {
        bleMode = 'websocket';
        console.log('[BLE Bridge] WebSocket bridge connected (late)');
        clearInterval(wsWatchInterval!);
        wsWatchInterval = null;
        // Auto-connect bike + sensors (prefer bike config, fallback localStorage)
        const bikeMotor2 = useSettingsStore.getState().bikeConfig?.sensors?.motor;
        const savedBike = (bikeMotor2 && bikeMotor2.address) ? bikeMotor2 : getSavedDevice();
        if (savedBike) {
          console.log(`[BLE Bridge] Auto-connecting to saved bike: ${savedBike.name} (${savedBike.address})`);
          wsClient.connectToDevice(savedBike.address);
        }
        autoConnectSensors();
      }
    }, 2000);

    // Auto-clear after 2 minutes to prevent memory leak
    setTimeout(() => {
      if (wsWatchInterval) {
        clearInterval(wsWatchInterval);
        wsWatchInterval = null;
      }
    }, 120_000);
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
      } catch (err) {
        // Fallback: Giant-only picker
        console.debug('[BLE Bridge] Multi-brand picker failed, falling back to Giant:', (err as Error)?.message ?? err);
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

// === Light Accessory (iGPSPORT NUS + Garmin Varia) — multi-light ===
export const connectLight = () => connectSensor('light', async () => {
  // Web BLE: show picker with both iGPSPORT and Garmin filters
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [NUS_SERVICE_UUID] },
        { services: [VARIA_RTL_SERVICE] },
        { services: [VARIA_HL_SERVICE] },
      ],
      optionalServices: [0x180f, 0x180a], // Battery + Device Info
    });
    const name = device.name ?? 'Light';
    const id = device.id ?? crypto.randomUUID();
    const position = LightRegistry.detectPosition(name);

    // Detect which protocol to use
    const { isGarminVaria } = await import('./GarminVariaService');
    if (isGarminVaria(name, '')) {
      // Garmin lights use their own service but we wrap in a compatible instance
      const { garminVariaService } = await import('./GarminVariaService');
      await garminVariaService.connectToDevice(device);
      // Garmin updates bikeStore directly via its own callbacks
    } else {
      // iGPSPORT — create NEW instance for each light (not singleton)
      const service = new IGPSportLightService();
      await service.connectToDevice(device);
      lightRegistry.register(id, position, 'igpsport', service);
    }
  } catch { /* user cancelled */ }
});
export const disconnectLight = (lightId?: string) => {
  if (bleMode === 'websocket') {
    wsClient.send({ type: 'disconnectSensor', sensor: 'light' });
  } else if (lightId) {
    lightRegistry.unregister(lightId);
  } else {
    lightRegistry.disconnectAll();
    import('./GarminVariaService').then(({ garminVariaService }) => garminVariaService.disconnect());
  }
};
export function getLightDeviceName(): string | null {
  return lightRegistry.getAnyDeviceName();
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
  // Also persist to active bike config as motor
  useSettingsStore.getState().setBikeSensor('motor', {
    name: device.name,
    address: device.address,
  });
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
  // Also persist to active bike config
  const sensorKey = sensor as keyof BikeSensors;
  useSettingsStore.getState().setBikeSensor(sensorKey, {
    name: device.name,
    address: device.address,
  });
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

/** Auto-connect all saved sensors via bridge.
 *  Prefers bike-scoped sensor config from settingsStore; falls back to
 *  legacy localStorage entries for backward compatibility.
 *  Debounced: ignores calls within 3s of the last execution.
 */
let lastAutoConnectMs = 0;
const AUTO_CONNECT_DEBOUNCE_MS = 3000;

export function autoConnectSensors(): void {
  if (bleMode !== 'websocket') return;

  // Debounce: prevent duplicate calls within 3s
  const now = Date.now();
  if (now - lastAutoConnectMs < AUTO_CONNECT_DEBOUNCE_MS) {
    console.log('[BLE Bridge] Auto-connect debounced (called within 3s)');
    return;
  }
  lastAutoConnectMs = now;

  // Read sensors from active bike config (preferred source)
  const bikeConfig = useSettingsStore.getState().bikeConfig;
  const bikeSensors = bikeConfig?.sensors ?? {};

  for (const sensor of SENSOR_TYPES) {
    const fromBike = bikeSensors[sensor as keyof typeof bikeSensors];
    const saved = (fromBike && fromBike.address) ? fromBike : getSavedSensorDevice(sensor);
    if (saved) {
      console.log(`[BLE Bridge] Auto-connecting ${sensor} for bike "${bikeConfig?.name ?? '?'}": ${saved.name} (${saved.address})`);
      // Di2 uses shimanoConnect (requires Shimano protocol auth, not generic sensor)
      if (sensor === 'di2') {
        wsClient.send({ type: 'shimanoConnect', address: saved.address });
      } else {
        wsClient.send({ type: 'connectSensor', sensor, address: saved.address });
      }
    }
  }

  // Motor auto-connect is handled by initBLE (lines 72-77).
  // Don't duplicate here — the debounce prevents double calls anyway.
}

/** Get current BLE mode description */
export function getBLEModeDescription(): string {
  switch (bleMode) {
    case 'websocket': return 'Bridge (full control)';
    case 'native': return 'Native (full control)';
    case 'web': return 'Web BLE (read only)';
  }
}
