/**
 * BoschEBikeService — BLE protocol for Bosch eBike systems.
 *
 * Reverse-engineered from Bosch eBike Connect APK (jadx decompile).
 *
 * Protocol: MCSP (Motor Control Service Protocol) over BLE GATT
 *   - Segmented transport (STP) with 20-byte MTU chunks
 *   - Protobuf payloads for telemetry + commands
 *   - UUID prefix "424F5343" = ASCII "BOSC"
 *
 * Supported motors: Performance Line CX, Active Line Plus, Cargo Line
 * Supported displays: Kiox, Nyon, Intuvia, SmartphoneHub, LED Remote
 *
 * UUIDs:
 *   MCSP Service:  424F5343-4820-4D43-5350-76012E002E00
 *   MCSP Read:     424F5343-4820-4D43-5350-20204D49534F  (notify/indicate)
 *   MCSP Write:    424F5343-4820-4D43-5350-20204D4F5349  (write)
 *   BSS Service:   424F5343-4820-4253-5376-76012E002E00  (bootstrap)
 *   BSS Read:      424F5343-4820-4253-5320-20204D49534F
 *   BSS Write:     424F5343-4820-4253-5320-20204D4F5349
 */

// ── BLE UUIDs ───────────────────────────────────────────────────

export const BOSCH_MCSP_SERVICE = '424f5343-4820-4d43-5350-76012e002e00';
export const BOSCH_MCSP_READ    = '424f5343-4820-4d43-5350-20204d49534f';
export const BOSCH_MCSP_WRITE   = '424f5343-4820-4d43-5350-20204d4f5349';

export const BOSCH_BSS_SERVICE  = '424f5343-4820-4253-5376-76012e002e00';
export const BOSCH_BSS_READ     = '424f5343-4820-4253-5320-20204d49534f';
export const BOSCH_BSS_WRITE    = '424f5343-4820-4253-5320-20204d4f5349';

export const BOSCH_FAKE_DIS     = 'dc435fbe-837d-42c5-a987-a9de0087e491';

// Standard
export const BATTERY_SERVICE = 0x180f;
export const DIS_SERVICE = 0x180a;

// ── Assist Modes ────────────────────────────────────────────────

export enum BoschAssistMode {
  OFF = 0,
  ECO = 1,
  TOUR = 2,
  SPORT = 3,
  TURBO = 4,
}

export const BOSCH_MODE_LABELS: Record<number, string> = {
  [BoschAssistMode.OFF]: 'OFF',
  [BoschAssistMode.ECO]: 'ECO',
  [BoschAssistMode.TOUR]: 'TOUR',
  [BoschAssistMode.SPORT]: 'SPORT',
  [BoschAssistMode.TURBO]: 'TURBO',
};

export const BOSCH_MODE_COLORS: Record<number, string> = {
  [BoschAssistMode.OFF]: '#777575',
  [BoschAssistMode.ECO]: '#3fff8b',
  [BoschAssistMode.TOUR]: '#6e9bff',
  [BoschAssistMode.SPORT]: '#fbbf24',
  [BoschAssistMode.TURBO]: '#ff716c',
};

// ── Detection ───────────────────────────────────────────────────

export function isBoschEBike(name: string, uuids: string): boolean {
  const lower = uuids.toLowerCase();
  return (
    lower.includes('424f5343') || // "BOSC" prefix
    lower.includes('dc435fbe') || // Fake DIS
    /bosch/i.test(name) ||
    /^nyon/i.test(name) ||
    /^kiox/i.test(name) ||
    /^intuvia/i.test(name)
  );
}

// ── STP Segmentation helpers ────────────────────────────────────
// Bosch uses a Simple Transport Protocol with 20-byte segments.
// Header byte: bit7 = continuation, bits 0-5 = payload size or seq

function segmentMessage(data: Uint8Array, mtu = 20): Uint8Array[] {
  const maxPayload = mtu - 1; // 1 byte header
  const segments: Uint8Array[] = [];

  if (data.length <= maxPayload) {
    // Single segment: header = data length
    const seg = new Uint8Array(data.length + 1);
    seg[0] = data.length;
    seg.set(data, 1);
    segments.push(seg);
  } else {
    // Multi-segment
    let offset = 0;
    let seq = 0;
    while (offset < data.length) {
      const remaining = data.length - offset;
      const chunkSize = Math.min(remaining, maxPayload);
      const isLast = offset + chunkSize >= data.length;
      const seg = new Uint8Array(chunkSize + 1);
      seg[0] = isLast ? chunkSize : (0x80 | (seq & 0x3f)); // bit7 = more segments
      seg.set(data.subarray(offset, offset + chunkSize), 1);
      segments.push(seg);
      offset += chunkSize;
      seq++;
    }
  }
  return segments;
}

/** Reassemble STP segments into complete message */
function reassembleSegments(segments: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const seg of segments) totalLen += seg.length - 1; // minus header byte
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const seg of segments) {
    result.set(seg.subarray(1), offset);
    offset += seg.length - 1;
  }
  return result;
}

// ── Protobuf mini-encoder (shared with iGPSPORT) ───────────────

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

// ── Bosch eBike BLE Service ─────────────────────────────────────

export interface BoschEBikeState {
  connected: boolean;
  deviceName: string;
  batteryPct: number;
  assistMode: BoschAssistMode;
  speed: number;
  power: number;
  cadence: number;
  range: number;
  odometer: number;
  motorModel: string;
}

export class BoschEBikeService {
  private device: BluetoothDevice | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private readChar: BluetoothRemoteGATTCharacteristic | null = null;
  private pendingSegments: Uint8Array[] = [];

  state: BoschEBikeState = {
    connected: false, deviceName: '', batteryPct: 0,
    assistMode: BoschAssistMode.OFF, speed: 0, power: 0,
    cadence: 0, range: 0, odometer: 0, motorModel: '',
  };

  onStateChange: ((state: BoschEBikeState) => void) | null = null;
  /** Callback for forwarding parsed data as JSON (for WebSocket bridge compatibility) */
  onData: ((type: string, data: Record<string, unknown>) => void) | null = null;

  /** Connect via Web Bluetooth */
  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BOSCH_MCSP_SERVICE] }],
        optionalServices: [BOSCH_BSS_SERVICE, BATTERY_SERVICE, DIS_SERVICE, BOSCH_FAKE_DIS],
      });
      return this.connectGatt();
    } catch (err) {
      console.warn('[Bosch] Connection failed:', err);
      return false;
    }
  }

  /** Connect to a known device */
  async connectToDevice(device: BluetoothDevice): Promise<boolean> {
    this.device = device;
    return this.connectGatt();
  }

  private async connectGatt(): Promise<boolean> {
    if (!this.device?.gatt) return false;

    try {
      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());
      const server = await this.device.gatt.connect();

      // MCSP service
      const mcspService = await server.getPrimaryService(BOSCH_MCSP_SERVICE);
      this.readChar = await mcspService.getCharacteristic(BOSCH_MCSP_READ);
      this.writeChar = await mcspService.getCharacteristic(BOSCH_MCSP_WRITE);

      // Subscribe to notifications
      await this.readChar.startNotifications();
      this.readChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) this.handleNotification(new Uint8Array(value.buffer));
      });

      // Read battery
      try {
        const batService = await server.getPrimaryService(BATTERY_SERVICE);
        const batChar = await batService.getCharacteristic(0x2a19);
        const batValue = await batChar.readValue();
        this.state.batteryPct = batValue.getUint8(0);
      } catch { /* no battery service */ }

      // Read manufacturer from DIS
      try {
        const disService = await server.getPrimaryService(DIS_SERVICE);
        const mfgChar = await disService.getCharacteristic(0x2a29);
        const mfgValue = await mfgChar.readValue();
        const decoder = new TextDecoder();
        this.state.motorModel = decoder.decode(mfgValue.buffer).trim();
      } catch { /* no DIS */ }

      this.state.connected = true;
      this.state.deviceName = this.device.name ?? 'Bosch eBike';
      this.notifyStateChange();

      console.log(`[Bosch] Connected: ${this.state.deviceName} (${this.state.motorModel})`);
      return true;
    } catch (err) {
      console.warn('[Bosch] GATT connection failed:', err);
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
  async setAssistMode(mode: BoschAssistMode): Promise<void> {
    // Build protobuf command for assist mode change
    const proto = new Uint8Array([
      ...encodeField(1, 1), // message type = assist mode change
      ...encodeField(2, mode),
    ]);
    await this.sendMCSP(proto);
    this.state.assistMode = mode;
    this.notifyStateChange();
  }

  // ── Internal ──────────────────────────────────────────────────

  private async sendMCSP(data: Uint8Array): Promise<void> {
    if (!this.writeChar) return;
    const segments = segmentMessage(data);
    for (const seg of segments) {
      try {
        await this.writeChar.writeValueWithResponse(seg);
      } catch (err) {
        console.warn('[Bosch] Write failed:', err);
      }
    }
  }

  private handleNotification(data: Uint8Array): void {
    if (data.length === 0) return;

    const header = data[0]!;
    const isMultiSegment = (header & 0x80) !== 0;

    if (isMultiSegment) {
      this.pendingSegments.push(data);
      return; // Wait for final segment
    }

    // Final or single segment
    let fullMessage: Uint8Array;
    if (this.pendingSegments.length > 0) {
      this.pendingSegments.push(data);
      fullMessage = reassembleSegments(this.pendingSegments);
      this.pendingSegments = [];
    } else {
      fullMessage = data.subarray(1); // Skip header byte
    }

    this.parseMessage(fullMessage);
  }

  private parseMessage(data: Uint8Array): void {
    const fields = parseProtoFields(data);
    const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[Bosch] Message fields:`, Object.fromEntries(fields), `raw: ${hex}`);

    // Extract telemetry from protobuf fields
    // Field mapping depends on the Bosch message type, but common patterns:
    for (const [field, value] of fields) {
      // Battery SOC (typically field 1-3 in battery messages)
      if (value >= 0 && value <= 100 && field <= 5) {
        // Could be battery — check context
      }
      // Assist mode (1-4)
      if (value >= 1 && value <= 4 && field <= 3) {
        const prev = this.state.assistMode;
        if (value !== prev) {
          this.state.assistMode = value as BoschAssistMode;
          this.onData?.('assistMode', { value });
        }
      }
    }

    this.notifyStateChange();
  }

  private handleDisconnect(): void {
    this.state.connected = false;
    this.writeChar = null;
    this.readChar = null;
    this.pendingSegments = [];
    this.notifyStateChange();
    console.log('[Bosch] Disconnected');
  }

  private notifyStateChange(): void {
    this.onStateChange?.({ ...this.state });
  }
}

export const boschEBikeService = new BoschEBikeService();
