import { BLE_UUIDS } from '../../types/gev.types';
// GIANT_DEVICE_NAME used for reference: 'GBHA25704'
import { parseCSC, createInitialCSCState } from './CSCParser';
import { parsePower } from './PowerParser';
import { parseGEVPacket, buildAssistUp, buildAssistDown, buildAssistModeCommand } from './GEVProtocol';
import { useBikeStore } from '../../store/bikeStore';
import type { CSCState } from '../../types/bike.types';

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

class GiantBLEService {
  private static instance: GiantBLEService;
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private gevCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private cscState: CSCState = createInitialCSCState();
  private reconnectAttempt = 0;
  private pendingCommand = false;

  static getInstance(): GiantBLEService {
    if (!GiantBLEService.instance) {
      GiantBLEService.instance = new GiantBLEService();
    }
    return GiantBLEService.instance;
  }

  /** Request BLE device and connect to all services.
   * Uses namePrefix filter ('GBHA' or 'Giant') to flexibly match the bike.
   * After connection, subscribes to all available BLE services. */
  async connect(): Promise<void> {
    const store = useBikeStore.getState();
    store.setBLEStatus('connecting');

    try {
      // Use namePrefix for more flexible matching — the bike may advertise
      // as "GBHA25704", "Giant GBHA25704", etc. If exact name known, try that first.
      // All services that we may access MUST be listed in optionalServices,
      // otherwise Chrome silently blocks access after connection.
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
          BLE_UUIDS.HR_SERVICE,
          BLE_UUIDS.DI2_SERVICE,
          BLE_UUIDS.SRAM_SERVICE,
        ],
      });

      // Save device name for auto-connect next time
      if (this.device.name) {
        this.saveDeviceName(this.device.name);
      }

      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      this.server = await this.device.gatt!.connect();
      this.reconnectAttempt = 0;
      store.setBLEStatus('connected');

      await this.subscribeAll();
    } catch (err) {
      console.error('[BLE] Connection failed:', err);
      store.setBLEStatus('disconnected');
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
    this.cscState = createInitialCSCState();
    useBikeStore.getState().setBLEStatus('disconnected');
  }

  /** Subscribe to all available BLE services (silent fail per service) */
  private async subscribeAll(): Promise<void> {
    await Promise.allSettled([
      this.subscribeBattery(),
      this.subscribeCSC(),
      this.subscribePower(),
      this.subscribeGEV(),
      this.subscribeHeartRate(),
      this.subscribeDi2(),
    ]);
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

      // Initial read
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
        useBikeStore.getState().setPower(result.power_watts);
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
      console.warn('[BLE] GEV service not available (expected without pairing):', err);
    }
  }

  // ── Heart Rate (0x180D) ────────────────────────────────
  private async subscribeHeartRate(): Promise<void> {
    try {
      const service = await this.server!.getPrimaryService(BLE_UUIDS.HR_SERVICE);
      const char = await service.getCharacteristic(BLE_UUIDS.HR_MEASUREMENT);

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        // HR Measurement: flags byte, then HR value (uint8 or uint16 depending on bit 0)
        const flags = value.getUint8(0);
        const is16bit = flags & 0x01;
        const bpm = is16bit ? value.getUint16(1, true) : value.getUint8(1);
        // Simple zone calc (will be refined by HRZoneEngine)
        const zone = bpm < 100 ? 1 : bpm < 130 ? 2 : bpm < 155 ? 3 : bpm < 175 ? 4 : 5;
        useBikeStore.getState().setHR(bpm, zone);
      });
      useBikeStore.getState().setServiceConnected('heartRate', true);
    } catch (err) {
      console.warn('[BLE] Heart Rate service not available:', err);
    }
  }

  // ── Shimano Di2 (6e40fec1) ────────────────────────────
  private async subscribeDi2(): Promise<void> {
    try {
      const service = await this.server!.getPrimaryService(BLE_UUIDS.DI2_SERVICE);
      const char = await service.getCharacteristic(BLE_UUIDS.DI2_NOTIFY);

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        // Di2 gear position: byte 4 is rear gear index (1-12)
        if (value.byteLength >= 5) {
          const gear = value.getUint8(4);
          if (gear >= 1 && gear <= 12) {
            useBikeStore.getState().setGear(gear);
          }
        }
      });
      useBikeStore.getState().setServiceConnected('di2', true);
    } catch (err) {
      console.warn('[BLE] Di2 service not available:', err);
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
    // Clear pending flag after a short delay
    setTimeout(() => { this.pendingCommand = false; }, 500);
  }

  isPendingCommand(): boolean {
    return this.pendingCommand;
  }

  private async writeGEV(packet: Uint8Array): Promise<void> {
    if (!this.gevCharacteristic) {
      console.warn('[BLE] GEV characteristic not available for writing');
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
          await this.subscribeAll();
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

  getDeviceName(): string | null {
    return this.device?.name ?? null;
  }

  // ── Device Name Persistence (per user) ────────────────
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
