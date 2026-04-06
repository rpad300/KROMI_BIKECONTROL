/**
 * SpecializedTurboService — BLE protocol for Specialized TurboConnect system.
 *
 * This is the PROPRIETARY Specialized protocol (different from MCSP+BES3 in Flow).
 * Used by: Turbo, Levo, Vado, Como, PLW, Pluto series.
 *
 * Reverse-engineered from Specialized APK (jadx decompile).
 *
 * Architecture: 3 BLE services with read/write/notify characteristics
 *   SERVICE_1: Primary telemetry + commands (read+notify, write-no-response)
 *   SERVICE_2: Secondary data channel
 *   SERVICE_3: Notification channel
 *
 * UUIDs (ASCII encoded: "7102IMHOBRUT" = Turbo HMI):
 *   Service 1:  00000001-3731-3032-494D-484F42525554
 *   Service 2:  00000002-3731-3032-494D-484F42525554
 *   Service 3:  00000003-3731-3032-494D-484F42525554
 *
 * Alternative Service 2/3 UUIDs (KINOGIGATR):
 *   Service 2b: 00000002-0000-4B49-4E4F-525441474947
 *   Service 3b: 00000003-0000-4B49-4E4F-525441474947
 */

// ── BLE UUIDs ───────────────────────────────────────────────────

const TURBO_BASE = '-3731-3032-494d-484f42525554';

export const TURBO_SERVICE_1 = `00000001${TURBO_BASE}`;
export const TURBO_SERVICE_2 = `00000002${TURBO_BASE}`;
export const TURBO_SERVICE_3 = `00000003${TURBO_BASE}`;

// Characteristic short IDs (combined with service base UUID)
export const TURBO_S1_READ_NOTIFY = `00000011${TURBO_BASE}`;  // shortID 17 = 0x11
export const TURBO_S1_WRITE       = `00000021${TURBO_BASE}`;  // shortID 33 = 0x21

// Alternative UUIDs (older bikes — GIGATRONKI pattern)
const ALT_BASE = '-0000-4b49-4e4f-525441474947';
export const TURBO_SERVICE_2_ALT = `00000002${ALT_BASE}`;
export const TURBO_SERVICE_3_ALT = `00000003${ALT_BASE}`;

// Standard
export const BATTERY_SERVICE = 0x180f;
export const CSC_SERVICE = '00001816-0000-1000-8000-00805f9b34fb';

// ── Bike Types ──────────────────────────────────────────────────

export enum SpecBikeType {
  PROTOTYPE = 0,
  TURBO = 1,
  LEVO1 = 2,
  VADO = 3,
  PLW = 4,
  LEVO2 = 5,
  COMO2 = 6,
  PLW2 = 7,
  APLW2 = 8,
  PLUTO = 9,
  APLUTO = 10,
  APLUTOPLUS = 11,
  PLUTO2 = 12,
}

export const SPEC_BIKE_NAMES: Record<number, string> = {
  [SpecBikeType.TURBO]: 'Turbo',
  [SpecBikeType.LEVO1]: 'Levo',
  [SpecBikeType.VADO]: 'Vado',
  [SpecBikeType.PLW]: 'PLW',
  [SpecBikeType.LEVO2]: 'Levo 2',
  [SpecBikeType.COMO2]: 'Como 2',
  [SpecBikeType.PLUTO]: 'Pluto',
  [SpecBikeType.APLUTO]: 'Active Pluto',
  [SpecBikeType.APLUTOPLUS]: 'Active Pluto+',
  [SpecBikeType.PLUTO2]: 'Pluto 2',
};

// ── Display Types ───────────────────────────────────────────────

export enum SpecDisplayType {
  TURBO = 'TURBO',
  LEVO1 = 'LEVO1',
  TCX1 = 'TCX1',
  TCU2 = 'TCU2',
  TCDW2 = 'TCDW2',
  T3 = 'T3',
  H3 = 'H3',
  C4 = 'C4',
  T4 = 'T4',
}

// ── Detection ───────────────────────────────────────────────────

export function isSpecializedTurbo(name: string, uuids: string): boolean {
  const lower = uuids.toLowerCase();
  return (
    lower.includes('3731-3032-494d') || // TURBO_BASE
    lower.includes('4b49-4e4f-5254') || // ALT_BASE
    /turbo.*connect/i.test(name)
  );
}

// ── State ───────────────────────────────────────────────────────

export interface SpecTurboState {
  connected: boolean;
  deviceName: string;
  bikeType: SpecBikeType;
  displayType: string;

  // Battery
  batteryPct: number;
  batteryVoltage: number;
  batteryTemp: number;
  batteryHealth: number;
  chargingActive: boolean;

  // Telemetry
  speed: number;
  cadence: number;
  power: number;
  assistMode: number;
  range: number;

  // Motor
  motorTemp: number;
  motorError: number;
}

// ── Service ─────────────────────────────────────────────────────

export class SpecializedTurboService {
  private device: BluetoothDevice | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;

  state: SpecTurboState = {
    connected: false, deviceName: '', bikeType: SpecBikeType.PROTOTYPE,
    displayType: '', batteryPct: 0, batteryVoltage: 0, batteryTemp: 0,
    batteryHealth: 0, chargingActive: false, speed: 0, cadence: 0,
    power: 0, assistMode: 0, range: 0, motorTemp: 0, motorError: 0,
  };

  onStateChange: ((state: SpecTurboState) => void) | null = null;
  onData: ((type: string, data: Record<string, unknown>) => void) | null = null;

  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [TURBO_SERVICE_1] }],
        optionalServices: [TURBO_SERVICE_2, TURBO_SERVICE_3, BATTERY_SERVICE, CSC_SERVICE],
      });
      return this.connectGatt();
    } catch (err) {
      console.warn('[SpecTurbo] Connection failed:', err);
      return false;
    }
  }

  async connectToDevice(device: BluetoothDevice): Promise<boolean> {
    this.device = device;
    return this.connectGatt();
  }

  private async connectGatt(): Promise<boolean> {
    if (!this.device?.gatt) return false;

    try {
      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());
      const server = await this.device.gatt.connect();

      // Service 1 — primary telemetry
      const s1 = await server.getPrimaryService(TURBO_SERVICE_1);

      // Subscribe to S1 read/notify
      const notifyChar = await s1.getCharacteristic(TURBO_S1_READ_NOTIFY);
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (v) this.handleNotification(new Uint8Array(v.buffer), 1);
      });

      // S1 write
      this.writeChar = await s1.getCharacteristic(TURBO_S1_WRITE);

      // Service 3 — notification channel
      try {
        const s3 = await server.getPrimaryService(TURBO_SERVICE_3);
        const chars = await s3.getCharacteristics();
        for (const c of chars) {
          if (c.properties.notify) {
            await c.startNotifications();
            c.addEventListener('characteristicvaluechanged', (e) => {
              const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
              if (v) this.handleNotification(new Uint8Array(v.buffer), 3);
            });
          }
        }
      } catch { /* S3 not available */ }

      // Battery
      try {
        const batService = await server.getPrimaryService(BATTERY_SERVICE);
        const batChar = await batService.getCharacteristic(0x2a19);
        const batValue = await batChar.readValue();
        this.state.batteryPct = batValue.getUint8(0);
      } catch { /* no battery */ }

      this.state.connected = true;
      this.state.deviceName = this.device.name ?? 'Specialized Turbo';
      this.notifyStateChange();

      console.log(`[SpecTurbo] Connected: ${this.state.deviceName}`);
      return true;
    } catch (err) {
      console.warn('[SpecTurbo] GATT failed:', err);
      return false;
    }
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.handleDisconnect();
  }

  isConnected(): boolean { return this.state.connected; }
  getDeviceName(): string | null { return this.state.connected ? this.state.deviceName : null; }

  /** Send command to motor via S1 write characteristic */
  async sendCommand(data: Uint8Array): Promise<void> {
    if (!this.writeChar) return;
    try {
      await this.writeChar.writeValueWithoutResponse(data);
    } catch (err) {
      console.warn('[SpecTurbo] Write failed:', err);
    }
  }

  private handleNotification(data: Uint8Array, service: number): void {
    const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[SpecTurbo] S${service} notify: ${hex} (${data.length}B)`);

    // Parse ride data from notifications
    // Exact format depends on the display/bike type — will be refined with hardware testing
    // For now, forward raw data for analysis
    this.onData?.('specializedTurboRaw', { service, hex, length: data.length });

    // Heuristic: battery SOC often in first few bytes
    if (data.length >= 2) {
      const val = data[1]!;
      if (val >= 0 && val <= 100 && data[0]! <= 10) {
        this.state.batteryPct = val;
        this.onData?.('battery', { value: val });
      }
    }

    this.notifyStateChange();
  }

  private handleDisconnect(): void {
    this.state.connected = false;
    this.writeChar = null;
    this.notifyStateChange();
    console.log('[SpecTurbo] Disconnected');
  }

  private notifyStateChange(): void {
    this.onStateChange?.({ ...this.state });
  }
}

export const specializedTurboService = new SpecializedTurboService();
