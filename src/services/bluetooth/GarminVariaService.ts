/**
 * GarminVariaService — BLE protocol for Garmin Varia lights and radar.
 *
 * Garmin uses GFDI (Garmin Fitness Device Interface) over BLE GATT:
 *   - Two device types with different UUIDs
 *   - Protobuf-based messaging (GDI.Proto.BikeLight / GDI.Proto.Radar)
 *   - Write commands → Write characteristic
 *   - Receive data  → Notify/Read characteristic
 *
 * Reverse-engineered from Garmin Connect APK (jadx decompile).
 *
 * Device Type 1: Varia RTL (Radar + Tail Light)
 *   Service:  6A4E8022-667B-11E3-949A-0800200C9A66
 *   Notify:   6A4ECD28-667B-11E3-949A-0800200C9A66
 *   Write:    6A4E4C80-667B-11E3-949A-0800200C9A66
 *
 * Device Type 2: Varia HL / UT (Head Light)
 *   Service:  16AA8022-3769-4C74-A755-877DDE3A2930
 *   Notify:   4ACBCD28-7425-868E-F447-915C8F00D0CB
 *   Write:    DF334C80-E6A7-D082-274D-78FC66F85E16
 */

// ── BLE UUIDs ───────────────────────────────────────────────────

/** Varia RTL (Radar + Tail Light) — 6A4E family */
export const VARIA_RTL_SERVICE = '6a4e8022-667b-11e3-949a-0800200c9a66';
export const VARIA_RTL_NOTIFY  = '6a4ecd28-667b-11e3-949a-0800200c9a66';
export const VARIA_RTL_WRITE   = '6a4e4c80-667b-11e3-949a-0800200c9a66';

/** Varia HL / UT (Head Light) — 16AA family */
export const VARIA_HL_SERVICE = '16aa8022-3769-4c74-a755-877dde3a2930';
export const VARIA_HL_NOTIFY  = '4acbcd28-7425-868e-f447-915c8f00d0cb';
export const VARIA_HL_WRITE   = 'df334c80-e6a7-d082-274d-78fc66f85e16';

/** Standard Battery Service (most Varia devices support this) */
export const BATTERY_SERVICE_UUID = 0x180f;
export const BATTERY_LEVEL_UUID = 0x2a19;

// ── Garmin Light Modes ──────────────────────────────────────────

export enum GarminLightMode {
  CUSTOM_FLASH_1 = 0,
  CUSTOM_FLASH_2 = 1,
  CUSTOM_FLASH_3 = 2,
  CUSTOM_FLASH_4 = 3,
  CUSTOM_FLASH_5 = 4,
  SOLID_HIGH = 100,
  SOLID_MEDIUM = 101,
  SOLID_LOW = 102,
  PELOTON = 103,
  DAY_FLASH = 104,
  NIGHT_FLASH = 105,
  OFF = 106,
}

export const GARMIN_MODE_LABELS: Record<number, string> = {
  [GarminLightMode.CUSTOM_FLASH_1]: 'Custom 1',
  [GarminLightMode.CUSTOM_FLASH_2]: 'Custom 2',
  [GarminLightMode.CUSTOM_FLASH_3]: 'Custom 3',
  [GarminLightMode.SOLID_HIGH]: 'High',
  [GarminLightMode.SOLID_MEDIUM]: 'Medium',
  [GarminLightMode.SOLID_LOW]: 'Low',
  [GarminLightMode.PELOTON]: 'Peloton',
  [GarminLightMode.DAY_FLASH]: 'Day Flash',
  [GarminLightMode.NIGHT_FLASH]: 'Night Flash',
  [GarminLightMode.OFF]: 'Off',
};

// ── Radar Sensitivity ───────────────────────────────────────────

export enum RadarSensitivity {
  OFF = 0,
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
}

// ── Device type detection ───────────────────────────────────────

export type VariaDeviceType = 'rtl' | 'hl' | 'unknown';

export function detectVariaType(serviceUuids: string[]): VariaDeviceType {
  const uuidsLower = serviceUuids.map(u => u.toLowerCase());
  if (uuidsLower.some(u => u.includes('6a4e8022') || u.includes('6a4e'))) return 'rtl';
  if (uuidsLower.some(u => u.includes('16aa8022'))) return 'hl';
  return 'unknown';
}

/** Check if a device name or UUID set looks like a Garmin Varia */
export function isGarminVaria(name: string, uuids: string): boolean {
  const lower = uuids.toLowerCase();
  return (
    lower.includes('6a4e') ||
    lower.includes('16aa8022') ||
    /varia/i.test(name) ||
    /^rtl/i.test(name) ||
    /^ut\s?800/i.test(name) ||
    /^hl\s?500/i.test(name)
  );
}

// ── Garmin GFDI Protobuf helpers ────────────────────────────────
// GFDI uses standard Google protobuf, but the messages are wrapped
// in a GFDI transport layer. For basic light control, we can build
// minimal protobuf commands.

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return bytes;
}

function encodeField(fieldNumber: number, value: number): number[] {
  const tag = (fieldNumber << 3) | 0;
  return [...encodeVarint(tag), ...encodeVarint(value)];
}

/** Build a simple GFDI command to change light mode */
function buildChangeModeCommand(modeIndex: number): Uint8Array {
  // GFDI wraps protobuf in a transport frame:
  // [length_varint][protobuf_payload]
  // The ChangeCurrentLightModeRequest has field 1 = mode index
  const proto = [...encodeField(1, modeIndex)];
  // GFDI message type for BikeLight ChangeCurrentLightMode = 0x01 (request)
  // Wrap in GFDI Smart message envelope
  const envelope = [
    ...encodeField(1, 5003),  // message_type = BikeLight service
    ...encodeField(2, 1),     // sub_type = ChangeCurrentLightMode
    ...encodeField(3, proto.length), // payload_length
    ...proto,
  ];
  return new Uint8Array(envelope);
}

/** Build GFDI command to request capabilities */
function buildCapabilitiesRequest(): Uint8Array {
  const envelope = [
    ...encodeField(1, 5003),  // BikeLight service
    ...encodeField(2, 3),     // CapabilitiesRequest
  ];
  return new Uint8Array(envelope);
}

// ── Service State ───────────────────────────────────────────────

export interface GarminVariaState {
  connected: boolean;
  deviceName: string;
  deviceType: VariaDeviceType;
  batteryPct: number;
  // Light
  currentMode: number;
  supportedModes: number[];
  // Radar
  incidentDetected: boolean;
  radarActive: boolean;
}

// ── Garmin Varia BLE Service ────────────────────────────────────

export class GarminVariaService {
  private device: BluetoothDevice | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private deviceType: VariaDeviceType = 'unknown';

  state: GarminVariaState = {
    connected: false,
    deviceName: '',
    deviceType: 'unknown',
    batteryPct: 0,
    currentMode: GarminLightMode.OFF,
    supportedModes: [],
    incidentDetected: false,
    radarActive: false,
  };

  onStateChange: ((state: GarminVariaState) => void) | null = null;

  /** Connect via Web Bluetooth — browser device picker */
  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [VARIA_RTL_SERVICE] },
          { services: [VARIA_HL_SERVICE] },
        ],
        optionalServices: [BATTERY_SERVICE_UUID],
      });

      return this.connectToDevice(this.device);
    } catch (err) {
      console.warn('[GarminVaria] Connection failed:', err);
      return false;
    }
  }

  /** Connect to a specific device (from scan results) */
  async connectToDevice(device: BluetoothDevice): Promise<boolean> {
    this.device = device;

    try {
      if (!this.device.gatt) return false;

      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());

      const server = await this.device.gatt.connect();

      // Try RTL service first, then HL
      let service: BluetoothRemoteGATTService | null = null;
      let notifyUuid: string;
      let writeUuid: string;

      try {
        service = await server.getPrimaryService(VARIA_RTL_SERVICE);
        this.deviceType = 'rtl';
        notifyUuid = VARIA_RTL_NOTIFY;
        writeUuid = VARIA_RTL_WRITE;
      } catch {
        try {
          service = await server.getPrimaryService(VARIA_HL_SERVICE);
          this.deviceType = 'hl';
          notifyUuid = VARIA_HL_NOTIFY;
          writeUuid = VARIA_HL_WRITE;
        } catch {
          console.warn('[GarminVaria] No Varia service found');
          return false;
        }
      }

      this.notifyChar = await service.getCharacteristic(notifyUuid);
      this.writeChar = await service.getCharacteristic(writeUuid);

      // Subscribe to notifications
      await this.notifyChar.startNotifications();
      this.notifyChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) this.handleNotification(new Uint8Array(value.buffer));
      });

      // Read battery
      try {
        const battService = await server.getPrimaryService(BATTERY_SERVICE_UUID);
        const battChar = await battService.getCharacteristic(BATTERY_LEVEL_UUID);
        const battValue = await battChar.readValue();
        this.state.batteryPct = battValue.getUint8(0);
      } catch { /* no battery service */ }

      this.state.connected = true;
      this.state.deviceName = this.device.name ?? 'Garmin Varia';
      this.state.deviceType = this.deviceType;
      this.notifyStateChange();

      // Request capabilities
      await this.sendCommand(buildCapabilitiesRequest());

      console.log(`[GarminVaria] Connected: ${this.state.deviceName} (${this.deviceType})`);
      return true;
    } catch (err) {
      console.warn('[GarminVaria] ConnectToDevice failed:', err);
      return false;
    }
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.handleDisconnect();
  }

  isConnected(): boolean { return this.state.connected; }
  getDeviceName(): string | null { return this.state.connected ? this.state.deviceName : null; }

  /** Change light mode */
  async setMode(mode: number): Promise<void> {
    await this.sendCommand(buildChangeModeCommand(mode));
    this.state.currentMode = mode;
    this.notifyStateChange();
  }

  /** Toggle light on/off */
  async toggle(): Promise<void> {
    if (this.state.currentMode === GarminLightMode.OFF) {
      await this.setMode(GarminLightMode.SOLID_LOW);
    } else {
      await this.setMode(GarminLightMode.OFF);
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  private async sendCommand(data: Uint8Array): Promise<void> {
    if (!this.writeChar) return;
    try {
      await this.writeChar.writeValueWithoutResponse(data);
    } catch (err) {
      console.warn('[GarminVaria] Write failed:', err);
    }
  }

  private handleNotification(data: Uint8Array): void {
    const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[GarminVaria] Notify: ${hex} (${data.length}B)`);

    // Parse GFDI protobuf response — extract key fields
    // For now, log raw data for analysis. Full parsing will be refined
    // after live testing with actual Varia hardware.

    // Basic heuristic: if we see incident data from radar
    if (this.deviceType === 'rtl' && data.length >= 4) {
      // Look for radar alert patterns in the GFDI response
      // Garmin radar uses binary incident_detected field
      this.parseRadarData(data);
    }

    // Light status updates
    if (data.length >= 2) {
      this.parseLightData(data);
    }
  }

  private parseRadarData(data: Uint8Array): void {
    // GFDI radar responses contain VariaStatus protobuf
    // Parse varint fields looking for incident_detected (bool, field ~1-3)
    let offset = 0;
    while (offset < data.length) {
      if (offset + 1 >= data.length) break;
      const tag = data[offset]!;
      const fieldNum = tag >>> 3;
      const wireType = tag & 0x07;
      offset++;

      if (wireType === 0) {
        // Varint
        let val = 0; let shift = 0;
        while (offset < data.length) {
          const b = data[offset]!;
          val |= (b & 0x7f) << shift;
          offset++;
          if ((b & 0x80) === 0) break;
          shift += 7;
        }

        // incident_detected is typically field 1 or 2 as bool
        if (fieldNum <= 5 && val === 1) {
          if (!this.state.incidentDetected) {
            this.state.incidentDetected = true;
            this.state.radarActive = true;
            this.notifyStateChange();
            console.log('[GarminVaria] RADAR: Vehicle detected!');
          }
        }
      } else if (wireType === 2) {
        // Length-delimited
        if (offset >= data.length) break;
        const len = data[offset]!;
        offset += 1 + len;
      } else {
        break;
      }
    }

    // If no incident found in this packet, clear after timeout
    // (handled by RadarService hysteresis)
  }

  private parseLightData(data: Uint8Array): void {
    // Look for light mode value in GFDI response
    // Mode values: 100-106 for standard modes
    for (let i = 0; i < data.length - 1; i++) {
      const val = data[i]!;
      if (val >= 100 && val <= 106) {
        this.state.currentMode = val;
        this.notifyStateChange();
        console.log(`[GarminVaria] Light mode: ${GARMIN_MODE_LABELS[val] ?? val}`);
        break;
      }
    }
  }

  private handleDisconnect(): void {
    this.state.connected = false;
    this.state.incidentDetected = false;
    this.state.radarActive = false;
    this.writeChar = null;
    this.notifyChar = null;
    this.notifyStateChange();
    console.log('[GarminVaria] Disconnected');
  }

  private notifyStateChange(): void {
    this.onStateChange?.({ ...this.state });
  }
}

/** Singleton */
export const garminVariaService = new GarminVariaService();
