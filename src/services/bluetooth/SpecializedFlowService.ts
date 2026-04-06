/**
 * SpecializedFlowService — BLE protocol for Specialized Turbo e-bikes.
 *
 * Reverse-engineered from Specialized Flow (Mission Control) APK (jadx decompile).
 *
 * Protocol stack:
 *   1. MCSP (Mission Control Service Protocol) — primary telemetry + commands
 *   2. BES3 (Bosch eBike System 3) — motor communication (1100+ protobuf messages)
 *   3. COBI — SmartphoneHub connectivity
 *
 * Supported bikes: Turbo Levo, Creo, Vado, Como
 * Motor: Brose/Specialized with Bosch integration
 *
 * UUIDs:
 *   MCSP Service:  00000010-EAA2-11E9-81B4-2A2AE2DBCCE4
 *   MCSP Receive:  00000011-EAA2-11E9-81B4-2A2AE2DBCCE4  (notify)
 *   MCSP Send:     00000012-EAA2-11E9-81B4-2A2AE2DBCCE4  (write)
 *   BES3 Service:  0000FE02-0000-1000-8000-00805F9B34FB
 *   COBI CUI050:   C0B11800-FEE1-C001-FEE1-FA57FEE15AFE
 *   COBI CUI100:   C0B11802-FEE1-C001-FEE1-FA57FEE15AFE
 */

// ── BLE UUIDs ───────────────────────────────────────────────────

export const SPEC_MCSP_SERVICE = '00000010-eaa2-11e9-81b4-2a2ae2dbcce4';
export const SPEC_MCSP_RECEIVE = '00000011-eaa2-11e9-81b4-2a2ae2dbcce4';
export const SPEC_MCSP_SEND    = '00000012-eaa2-11e9-81b4-2a2ae2dbcce4';

export const BES3_SERVICE      = '0000fe02-0000-1000-8000-00805f9b34fb';
export const COBI_CUI050       = 'c0b11800-fee1-c001-fee1-fa57fee15afe';
export const COBI_CUI100       = 'c0b11802-fee1-c001-fee1-fa57fee15afe';

// Standard
export const BATTERY_SERVICE = 0x180f;
export const DIS_SERVICE = 0x180a;
export const HR_SERVICE = 0x180d;

// ── Assist Modes ────────────────────────────────────────────────

export interface SpecAssistMode {
  id: number;
  nameShort: string;
  nameLong: string;
  color: string;
  userAdjustable: boolean;
}

/** Default Specialized assist modes */
export const SPEC_DEFAULT_MODES: SpecAssistMode[] = [
  { id: 0, nameShort: 'ECO', nameLong: 'Eco', color: '#3fff8b', userAdjustable: true },
  { id: 1, nameShort: 'TRAIL', nameLong: 'Trail', color: '#6e9bff', userAdjustable: true },
  { id: 2, nameShort: 'TURBO', nameLong: 'Turbo', color: '#ff716c', userAdjustable: true },
];

export const SPEC_MODE_LABELS: Record<number, string> = {
  0: 'ECO',
  1: 'TRAIL',
  2: 'TURBO',
};

export const SPEC_MODE_COLORS: Record<number, string> = {
  0: '#3fff8b',
  1: '#6e9bff',
  2: '#ff716c',
};

// ── Detection ───────────────────────────────────────────────────

export function isSpecializedBike(name: string, uuids: string): boolean {
  const lower = uuids.toLowerCase();
  return (
    lower.includes('eaa2-11e9') || // MCSP service
    lower.includes('0000fe02') ||  // BES3
    lower.includes('c0b11800') ||  // COBI
    /specialized/i.test(name) ||
    /turbo/i.test(name) ||
    /^levo/i.test(name) ||
    /^creo/i.test(name) ||
    /^vado/i.test(name) ||
    /^como/i.test(name)
  );
}

// ── Protobuf helpers (shared pattern) ───────────────────────────

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
  bytes.push(v & 0x7f);
  return bytes;
}

function encodeField(fieldNumber: number, value: number): number[] {
  return [...encodeVarint((fieldNumber << 3) | 0), ...encodeVarint(value)];
}

function decodeVarint(data: Uint8Array, offset: number): [number, number] {
  let value = 0; let shift = 0; let pos = offset;
  while (pos < data.length) {
    const b = data[pos]!; value |= (b & 0x7f) << shift; pos++;
    if ((b & 0x80) === 0) break; shift += 7;
    if (shift > 35) break;
  }
  return [value >>> 0, pos - offset];
}

function parseProtoFields(data: Uint8Array): Map<number, number> {
  const fields = new Map<number, number>();
  let offset = 0;
  while (offset < data.length) {
    const [tag, tagLen] = decodeVarint(data, offset); offset += tagLen;
    const fieldNumber = tag >>> 3; const wireType = tag & 0x07;
    if (wireType === 0) {
      const [value, valLen] = decodeVarint(data, offset); offset += valLen;
      fields.set(fieldNumber, value);
    } else if (wireType === 2) {
      const [length, lenLen] = decodeVarint(data, offset); offset += lenLen + length;
    } else break;
  }
  return fields;
}

// ── Specialized Flow BLE Service ────────────────────────────────

export interface SpecializedState {
  connected: boolean;
  deviceName: string;
  bikeModel: string;      // Turbo Levo, Creo, etc.
  batteryPct: number;
  batteryPct2: number;     // Secondary battery (dual battery bikes)
  remainingEnergy: number; // Wh
  cellTemp: number;        // Battery cell temperature
  assistMode: number;
  speed: number;
  power: number;
  cadence: number;
  range: number;
  odometer: number;
  lightOn: boolean;
  walkAssist: boolean;
}

export class SpecializedFlowService {
  private device: BluetoothDevice | null = null;
  private sendChar: BluetoothRemoteGATTCharacteristic | null = null;
  private recvChar: BluetoothRemoteGATTCharacteristic | null = null;

  state: SpecializedState = {
    connected: false, deviceName: '', bikeModel: '',
    batteryPct: 0, batteryPct2: 0, remainingEnergy: 0, cellTemp: 0,
    assistMode: 0, speed: 0, power: 0, cadence: 0,
    range: 0, odometer: 0, lightOn: false, walkAssist: false,
  };

  onStateChange: ((state: SpecializedState) => void) | null = null;
  onData: ((type: string, data: Record<string, unknown>) => void) | null = null;

  /** Connect via Web Bluetooth */
  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [SPEC_MCSP_SERVICE] },
          { services: [BES3_SERVICE] },
        ],
        optionalServices: [BATTERY_SERVICE, DIS_SERVICE, COBI_CUI050, COBI_CUI100],
      });
      return this.connectGatt();
    } catch (err) {
      console.warn('[Specialized] Connection failed:', err);
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

      // Try MCSP first (primary for Flow app)
      let service: BluetoothRemoteGATTService;
      try {
        service = await server.getPrimaryService(SPEC_MCSP_SERVICE);
        this.recvChar = await service.getCharacteristic(SPEC_MCSP_RECEIVE);
        this.sendChar = await service.getCharacteristic(SPEC_MCSP_SEND);
        console.log('[Specialized] MCSP service connected');
      } catch {
        // Try BES3 as fallback
        try {
          service = await server.getPrimaryService(BES3_SERVICE);
          // BES3 uses different characteristic discovery
          const chars = await service.getCharacteristics();
          for (const c of chars) {
            const props = c.properties;
            if (props.notify || props.indicate) this.recvChar = c;
            if (props.write || props.writeWithoutResponse) this.sendChar = c;
          }
          console.log('[Specialized] BES3 service connected');
        } catch {
          console.warn('[Specialized] No MCSP or BES3 service found');
          return false;
        }
      }

      // Subscribe to notifications
      if (this.recvChar) {
        await this.recvChar.startNotifications();
        this.recvChar.addEventListener('characteristicvaluechanged', (event) => {
          const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
          if (value) this.handleNotification(new Uint8Array(value.buffer));
        });
      }

      // Read battery
      try {
        const batService = await server.getPrimaryService(BATTERY_SERVICE);
        const batChar = await batService.getCharacteristic(0x2a19);
        const batValue = await batChar.readValue();
        this.state.batteryPct = batValue.getUint8(0);
      } catch { /* no battery service */ }

      // Read device info
      try {
        const disService = await server.getPrimaryService(DIS_SERVICE);
        const modelChar = await disService.getCharacteristic(0x2a24);
        const modelValue = await modelChar.readValue();
        this.state.bikeModel = new TextDecoder().decode(modelValue.buffer).trim();
      } catch { /* no DIS */ }

      this.state.connected = true;
      this.state.deviceName = this.device.name ?? 'Specialized Turbo';
      this.notifyStateChange();

      console.log(`[Specialized] Connected: ${this.state.deviceName} (${this.state.bikeModel})`);
      return true;
    } catch (err) {
      console.warn('[Specialized] GATT connection failed:', err);
      return false;
    }
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.handleDisconnect();
  }

  isConnected(): boolean { return this.state.connected; }
  getDeviceName(): string | null { return this.state.connected ? this.state.deviceName : null; }

  /** Set assist mode */
  async setAssistMode(mode: number): Promise<void> {
    if (!this.sendChar) return;
    const proto = new Uint8Array([
      ...encodeField(1, 2), // message type = assist mode change
      ...encodeField(2, mode),
    ]);
    try {
      await this.sendChar.writeValueWithResponse(proto);
    } catch (err) {
      console.warn('[Specialized] Write failed:', err);
    }
    this.state.assistMode = mode;
    this.notifyStateChange();
  }

  /** Toggle bike light */
  async toggleLight(): Promise<void> {
    if (!this.sendChar) return;
    this.state.lightOn = !this.state.lightOn;
    const proto = new Uint8Array([
      ...encodeField(1, this.state.lightOn ? 3 : 4), // BikeLightOn / BikeLightOff
    ]);
    try {
      await this.sendChar.writeValueWithResponse(proto);
    } catch (err) {
      console.warn('[Specialized] Write failed:', err);
    }
    this.notifyStateChange();
  }

  // ── Internal ──────────────────────────────────────────────────

  private handleNotification(data: Uint8Array): void {
    const fields = parseProtoFields(data);
    const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[Specialized] Notify fields:`, Object.fromEntries(fields), `raw: ${hex}`);

    // Parse BES3/MCSP telemetry — field mapping based on DashboardService proto
    // These will need refinement with real hardware, but cover the key patterns
    for (const [field, value] of fields) {
      // Battery SOC
      if (field <= 5 && value >= 0 && value <= 100) {
        if (this.state.batteryPct === 0 || field === 1) {
          this.state.batteryPct = value;
          this.onData?.('battery', { value });
        }
      }
      // Assist mode change
      if (field <= 3 && value >= 0 && value <= 5) {
        this.state.assistMode = value;
        this.onData?.('assistMode', { value });
      }
    }

    this.notifyStateChange();
  }

  private handleDisconnect(): void {
    this.state.connected = false;
    this.sendChar = null;
    this.recvChar = null;
    this.notifyStateChange();
    console.log('[Specialized] Disconnected');
  }

  private notifyStateChange(): void {
    this.onStateChange?.({ ...this.state });
  }
}

export const specializedFlowService = new SpecializedFlowService();
