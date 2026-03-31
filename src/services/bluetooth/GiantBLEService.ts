import { BLE_UUIDS } from '../../types/gev.types';
import { parseCSC, createInitialCSCState } from './CSCParser';
import { parsePower } from './PowerParser';
import { parseGEVPacket, buildAssistUp, buildAssistDown, buildAssistModeCommand } from './GEVProtocol';
import { giantProtobufService } from './GiantProtobufService';
import { useBikeStore } from '../../store/bikeStore';
import { batteryEstimationService } from '../battery/BatteryEstimationService';
import type { CSCState } from '../../types/bike.types';

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

class GiantBLEService {
  private static instance: GiantBLEService;
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private gevCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private protoConnected = false;
  private cscState: CSCState = createInitialCSCState();
  private reconnectAttempt = 0;
  private pendingCommand = false;

  // Separate devices for HR and Di2
  private hrDevice: BluetoothDevice | null = null;
  private di2Device: BluetoothDevice | null = null;

  static getInstance(): GiantBLEService {
    if (!GiantBLEService.instance) {
      GiantBLEService.instance = new GiantBLEService();
    }
    return GiantBLEService.instance;
  }

  /** Connect to the Giant Smart Gateway (motor, battery, speed, power).
   * HR and Di2 are separate devices — use connectHR() and connectDi2(). */
  async connect(): Promise<void> {
    const store = useBikeStore.getState();
    store.setBLEStatus('connecting');

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'GBHA' },
          { namePrefix: 'Giant' },
        ],
        optionalServices: [
          BLE_UUIDS.BATTERY_SERVICE,
          BLE_UUIDS.CSC_SERVICE,
          BLE_UUIDS.POWER_SERVICE,
          BLE_UUIDS.GEV_SERVICE,
          BLE_UUIDS.PROTO_SERVICE,
        ],
      });

      if (this.device.name) {
        this.saveDeviceName(this.device.name);
      }

      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      this.server = await this.device.gatt!.connect();
      this.reconnectAttempt = 0;
      store.setBLEStatus('connected');

      // Only subscribe to services that live on the Smart Gateway
      await this.subscribeGatewayServices();
    } catch (err) {
      console.error('[BLE] Connection failed:', err);
      store.setBLEStatus('disconnected');
      throw err;
    }
  }

  /** Connect to a Heart Rate monitor (Polar, Garmin, Wahoo, etc.) */
  async connectHR(): Promise<void> {
    try {
      this.hrDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_UUIDS.HR_SERVICE] }],
      });

      const server = await this.hrDevice.gatt!.connect();
      const service = await server.getPrimaryService(BLE_UUIDS.HR_SERVICE);
      const char = await service.getCharacteristic(BLE_UUIDS.HR_MEASUREMENT);

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        const flags = value.getUint8(0);
        const is16bit = flags & 0x01;
        const bpm = is16bit ? value.getUint16(1, true) : value.getUint8(1);
        const zone = bpm < 100 ? 1 : bpm < 130 ? 2 : bpm < 155 ? 3 : bpm < 175 ? 4 : 5;
        useBikeStore.getState().setHR(bpm, zone);
      });

      useBikeStore.getState().setServiceConnected('heartRate', true);
      console.log('[BLE] HR connected:', this.hrDevice.name);
    } catch (err) {
      console.warn('[BLE] HR connection failed:', err);
      throw err;
    }
  }

  /** Connect to a Shimano Di2 wireless unit (EW-WU111) */
  async connectDi2(): Promise<void> {
    try {
      this.di2Device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_UUIDS.DI2_SERVICE] }],
        optionalServices: [BLE_UUIDS.DI2_SERVICE],
      });

      const server = await this.di2Device.gatt!.connect();
      const service = await server.getPrimaryService(BLE_UUIDS.DI2_SERVICE);
      const char = await service.getCharacteristic(BLE_UUIDS.DI2_NOTIFY);

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        if (value.byteLength >= 5) {
          const gear = value.getUint8(4);
          if (gear >= 1 && gear <= 12) {
            useBikeStore.getState().setGear(gear);
          }
        }
      });

      useBikeStore.getState().setServiceConnected('di2', true);
      console.log('[BLE] Di2 connected:', this.di2Device.name);
    } catch (err) {
      console.warn('[BLE] Di2 connection failed:', err);
      throw err;
    }
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.server = null;
    this.gevCharacteristic = null;
    this.protoConnected = false;
    this.cscState = createInitialCSCState();
    useBikeStore.getState().setBLEStatus('disconnected');
  }

  disconnectHR(): void {
    if (this.hrDevice?.gatt?.connected) {
      this.hrDevice.gatt.disconnect();
    }
    this.hrDevice = null;
    useBikeStore.getState().setServiceConnected('heartRate', false);
  }

  disconnectDi2(): void {
    if (this.di2Device?.gatt?.connected) {
      this.di2Device.gatt.disconnect();
    }
    this.di2Device = null;
    useBikeStore.getState().setServiceConnected('di2', false);
  }

  /** Subscribe to services on the Smart Gateway.
   * Tries Protobuf service (F0BA5201) first, then legacy GEV (F0BA3012). */
  private async subscribeGatewayServices(): Promise<void> {
    // Try protobuf service first (newer bikes)
    this.protoConnected = await giantProtobufService.tryConnect(this.server!);
    if (this.protoConnected) {
      console.log('[BLE] Protobuf service connected — requesting bike data...');
      // Request initial data from the bike
      giantProtobufService.requestAllData().catch(() => {});
    }

    await Promise.allSettled([
      this.subscribeBattery(),
      this.subscribeCSC(),
      this.subscribePower(),
      // Only try legacy GEV if protobuf is not available
      !this.protoConnected ? this.subscribeGEV() : Promise.resolve(),
    ]);
  }

  /** Check if protobuf service is connected */
  isProtoConnected(): boolean {
    return this.protoConnected;
  }

  // ── Battery (0x180F) ──────────────────────────────────
  private async subscribeBattery(): Promise<void> {
    try {
      const service = await this.server!.getPrimaryService(BLE_UUIDS.BATTERY_SERVICE);
      const char = await service.getCharacteristic(BLE_UUIDS.BATTERY_LEVEL);

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        useBikeStore.getState().setBatteryPercent(value.getUint8(0));
      });

      const initial = await char.readValue();
      useBikeStore.getState().setBatteryPercent(initial.getUint8(0));
      useBikeStore.getState().setServiceConnected('battery', true);
    } catch (err) {
      console.warn('[BLE] Battery service not available:', err);
    }
  }

  // ── CSC - Speed + Cadence (0x1816) ────────────────────
  private async subscribeCSC(): Promise<void> {
    try {
      const service = await this.server!.getPrimaryService(BLE_UUIDS.CSC_SERVICE);
      const char = await service.getCharacteristic(BLE_UUIDS.CSC_MEASUREMENT);

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        const result = parseCSC(value, this.cscState);
        const store = useBikeStore.getState();
        store.setSpeed(result.speed_kmh);
        store.setCadence(result.cadence_rpm);
        store.setDistance(result.distance_km);

        // Update range estimation
        batteryEstimationService.addSample(result.speed_kmh, store.power_watts, store.battery_percent);
        const range = batteryEstimationService.getEstimatedRange(store.battery_percent);
        store.setRange(range);
      });
      useBikeStore.getState().setServiceConnected('csc', true);
    } catch (err) {
      console.warn('[BLE] CSC service not available:', err);
    }
  }

  // ── Cycling Power (0x1818) ────────────────────────────
  private async subscribePower(): Promise<void> {
    try {
      const service = await this.server!.getPrimaryService(BLE_UUIDS.POWER_SERVICE);
      const char = await service.getCharacteristic(BLE_UUIDS.POWER_MEASUREMENT);

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        const result = parsePower(value);
        const store = useBikeStore.getState();
        store.setPower(result.power_watts);

        // Update range estimation
        batteryEstimationService.addSample(store.speed_kmh, result.power_watts, store.battery_percent);
        const range = batteryEstimationService.getEstimatedRange(store.battery_percent);
        store.setRange(range);
      });
      useBikeStore.getState().setServiceConnected('power', true);
    } catch (err) {
      console.warn('[BLE] Power service not available:', err);
    }
  }

  // ── GEV Giant Protocol (F0BA3012) ─────────────────────
  private async subscribeGEV(): Promise<void> {
    try {
      const service = await this.server!.getPrimaryService(BLE_UUIDS.GEV_SERVICE);
      const notifyChar = await service.getCharacteristic(BLE_UUIDS.GEV_NOTIFY);
      this.gevCharacteristic = notifyChar;

      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        const parsed = parseGEVPacket(value);
        if (!parsed) return;

        const store = useBikeStore.getState();
        switch (parsed.type) {
          case 'assist':
            store.setAssistMode(parsed.assistMode);
            break;
          case 'battery':
            store.setBatteryPercent(parsed.percent);
            break;
          case 'riding':
            if (parsed.power > 0) store.setPower(parsed.power);
            break;
        }
      });
      useBikeStore.getState().setServiceConnected('gev', true);
    } catch (err) {
      console.warn('[BLE] GEV service not available (may need pairing via RideControl):', err);
    }
  }

  // ── Motor Control Commands ────────────────────────────
  async sendAssistUp(): Promise<void> {
    await this.writeGEV(buildAssistUp());
  }

  async sendAssistDown(): Promise<void> {
    await this.writeGEV(buildAssistDown());
  }

  async sendAssistMode(mode: number): Promise<void> {
    this.pendingCommand = true;
    await this.writeGEV(buildAssistModeCommand(mode));
    setTimeout(() => { this.pendingCommand = false; }, 500);
  }

  isPendingCommand(): boolean {
    return this.pendingCommand;
  }

  private async writeGEV(packet: Uint8Array): Promise<void> {
    if (!this.gevCharacteristic) {
      console.warn('[BLE] GEV not available — motor control requires pairing via Giant RideControl app first');
      return;
    }
    try {
      await this.gevCharacteristic.writeValueWithResponse(packet);
    } catch (err) {
      console.error('[BLE] GEV write failed:', err);
    }
  }

  // ── Reconnection ──────────────────────────────────────
  private async handleDisconnect(): Promise<void> {
    useBikeStore.getState().setBLEStatus('reconnecting');
    console.log('[BLE] Disconnected, attempting reconnect...');

    while (this.reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
      const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)]!;
      await new Promise(r => setTimeout(r, delay));
      this.reconnectAttempt++;

      try {
        if (this.device?.gatt) {
          this.server = await this.device.gatt.connect();
          this.reconnectAttempt = 0;
          useBikeStore.getState().setBLEStatus('connected');
          await this.subscribeGatewayServices();
          console.log('[BLE] Reconnected successfully');
          return;
        }
      } catch (err) {
        console.warn(`[BLE] Reconnect attempt ${this.reconnectAttempt} failed:`, err);
      }
    }

    console.error('[BLE] Max reconnect attempts reached');
    useBikeStore.getState().setBLEStatus('disconnected');
  }

  isConnected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  isHRConnected(): boolean {
    return this.hrDevice?.gatt?.connected ?? false;
  }

  isDi2Connected(): boolean {
    return this.di2Device?.gatt?.connected ?? false;
  }

  getDeviceName(): string | null {
    return this.device?.name ?? null;
  }

  getHRDeviceName(): string | null {
    return this.hrDevice?.name ?? null;
  }

  getDi2DeviceName(): string | null {
    return this.di2Device?.name ?? null;
  }

  // ── Device Name Persistence ────────────────────────────
  private saveDeviceName(name: string): void {
    localStorage.setItem('bikecontrol_ble_device', name);
  }

  getSavedDeviceName(): string | null {
    return localStorage.getItem('bikecontrol_ble_device');
  }

  hasSavedDevice(): boolean {
    return !!this.getSavedDeviceName();
  }
}

export const giantBLEService = GiantBLEService.getInstance();
