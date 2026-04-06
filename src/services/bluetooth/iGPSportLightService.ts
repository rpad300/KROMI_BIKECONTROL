/**
 * iGPSPORT Light Service — BLE protocol for VS1800S and compatible lights.
 *
 * Protocol reverse-engineered from iGPSPORT Ride APK (jadx decompile):
 *   - Nordic UART Service (NUS) with 4 channels (CA9E, CA8E, CA7E, CA6E)
 *   - 20-byte binary header (CommonHead20Bytes) + Protocol Buffers payload
 *   - Light service type = 106 (0x6A), operations via protobuf messages
 *
 * Reference files:
 *   - BleInformation.java — UUIDs
 *   - AccessoriesLight2Delegate.java — command building
 *   - PeripheralLightApp.java — protobuf definitions
 *   - BaseHead20Bytes.java / CommonHead20Bytes.java — header format
 */

// ── BLE UUIDs (Nordic UART Service — User Control channel) ──────

/** NUS Service UUID (User Control channel — CA8E suffix) */
export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca8e';
/** NUS TX Characteristic (write commands TO the light) */
export const NUS_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca8e';
/** NUS RX Characteristic (receive notifications FROM the light) */
export const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca8e';

// Standard BLE services (available on most lights)
export const BATTERY_SERVICE_UUID = 0x180f;
export const BATTERY_LEVEL_UUID = 0x2a19;
export const DEVICE_INFO_SERVICE_UUID = 0x180a;

// ── Protocol Constants ──────────────────────────────────────────

/** Peripheral Service Types (from PeripheralCommon.java) */
export enum PeripheralServiceType {
  RADAR = 104,       // 0x68
  BLE_LIGHT = 106,   // 0x6A
  BLE_LIGHT_INBIKE = 107,
  EMOJI_LIGHT = 109, // 0x6D
}

/** Peripheral Operate Types */
export enum PeripheralOperateType {
  UNSPECIFIED = 0,
  SET = 1,
  GET = 2,
  ADD = 3,
  DEL = 4,
  CON = 5,
  REQUEST = 6,
  RESPONSE = 7,
}

/** Light Sub-Service Types (BLE_LIGHT_SERVICE enum) */
export enum LightSubService {
  LIGHT_CFG = 0,
  MODE_SUP = 1,       // Supported modes list
  MODE_CUR = 2,       // Current mode
  CUSTOM_MODE = 3,
  SMT_CONFIG = 4,     // Smart configuration
  LEFT_TIME = 5,      // Remaining time
  BAT_PCT = 6,        // Battery percentage
  MODE_ENABLE = 7,
  CONFIG_RESPECTIVE = 8,
  RIDE_CFG = 9,
}

/** Light Modes (BLE_LIGHT_MODE enum — full list from PeripheralLightApp.java) */
export enum LightMode {
  OFF = 0,
  HIGH_STEADY = 1,
  MID_STEADY = 2,
  LOW_STEADY = 3,
  HIGH_BLINK = 4,
  LOW_BLINK = 5,
  GRADIENT = 6,
  HBEAM_HIGH = 7,
  HBEAM_MID = 8,
  HBEAM_LOW = 9,
  LBEAM_HIGH = 10,
  LBEAM_MID = 11,
  LBEAM_LOW = 12,
  ROTATION = 13,
  LEFT_TURN = 14,
  RIGHT_TURN = 15,
  SUPER_HIGH = 16,
  SOS = 17,
  COMET_FLASH = 18,
  WATERFALL_FLASH = 19,
  PINWHEEL = 20,
}

/** Light Types (BLE_LIGHT_TYPE enum) */
export enum LightType {
  TAIL = 0,
  FRONT = 1,
  HEAD = 2,
  LEFT = 3,
  RIGHT = 4,
  TIRE = 5,
  PACK = 6,
  PEDAL = 7,
  FRAME = 8,
  SPOKE = 9,
  RADAR = 10,
  TURN = 11,
  FLASH = 12,
}

/** Human-readable labels for light modes */
export const LIGHT_MODE_LABELS: Record<number, string> = {
  [LightMode.OFF]: 'Off',
  [LightMode.HIGH_STEADY]: 'High',
  [LightMode.MID_STEADY]: 'Medium',
  [LightMode.LOW_STEADY]: 'Low',
  [LightMode.HIGH_BLINK]: 'Blink High',
  [LightMode.LOW_BLINK]: 'Blink Low',
  [LightMode.GRADIENT]: 'Gradient',
  [LightMode.ROTATION]: 'Rotation',
  [LightMode.LEFT_TURN]: 'Turn L',
  [LightMode.RIGHT_TURN]: 'Turn R',
  [LightMode.SUPER_HIGH]: 'Max',
  [LightMode.SOS]: 'SOS',
  [LightMode.COMET_FLASH]: 'Comet',
  [LightMode.WATERFALL_FLASH]: 'Waterfall',
  [LightMode.PINWHEEL]: 'Pinwheel',
};

/** Icons for key modes (Material Symbols) */
export const LIGHT_MODE_ICONS: Partial<Record<number, string>> = {
  [LightMode.OFF]: 'flashlight_off',
  [LightMode.HIGH_STEADY]: 'flashlight_on',
  [LightMode.MID_STEADY]: 'flashlight_on',
  [LightMode.LOW_STEADY]: 'flashlight_on',
  [LightMode.HIGH_BLINK]: 'emergency',
  [LightMode.LOW_BLINK]: 'emergency',
  [LightMode.LEFT_TURN]: 'turn_left',
  [LightMode.RIGHT_TURN]: 'turn_right',
  [LightMode.SOS]: 'sos',
};

// ── Light state interface ───────────────────────────────────────

export interface LightState {
  connected: boolean;
  deviceName: string;
  batteryPct: number;
  currentMode: LightMode;
  supportedModes: LightMode[];
  lightType: LightType;
  remainingTimeMs: number;
}

// ── Protobuf Mini-Encoder (hand-rolled, no library needed) ──────
// Only varint wire type (0) — sufficient for iGPSPORT light protocol

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0; // Ensure unsigned
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return bytes;
}

/** Encode a protobuf field (varint wire type = 0) */
function encodeField(fieldNumber: number, value: number): number[] {
  const tag = (fieldNumber << 3) | 0; // wire type 0 = varint
  return [...encodeVarint(tag), ...encodeVarint(value)];
}

/** Build protobuf message for light commands */
function buildLightProto(fields: { field: number; value: number }[]): Uint8Array {
  const bytes: number[] = [];
  for (const { field, value } of fields) {
    bytes.push(...encodeField(field, value));
  }
  return new Uint8Array(bytes);
}

// ── CRC8 (same algorithm as iGPSPORT BaseHead20Bytes) ──────────

function crc8(data: Uint8Array | number[]): number {
  let crc = 0;
  for (const b of data) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x80) {
        crc = ((crc << 1) ^ 0x07) & 0xff;
      } else {
        crc = (crc << 1) & 0xff;
      }
    }
  }
  return crc;
}

// ── 20-Byte Command Header Builder ─────────────────────────────
/**
 * Header structure (from BaseHead20Bytes.java):
 *   [0]  firstCommand       = 0x01
 *   [1]  mainServiceByte    = PeripheralServiceType
 *   [2]  secondServiceByte  = LightSubService
 *   [3]  reserved           = 0xFF
 *   [4]  mainCommandByte    = PeripheralOperateType
 *   [5]  secondCommandByte  = (optional sub-operate)
 *   [6]  reserved           = 0xFF
 *   [7]  dataSizeHigh       = (protobuf length >> 8)
 *   [8]  dataSizeLow        = (protobuf length & 0xFF)
 *   [9]  protobufCRC        = CRC8 of protobuf data
 *   [10] endType            = 0x01 (protobuf)
 *   [11-18] reserved        = all 0xFF
 *   [19] totalCRC           = CRC8 of bytes [0..18]
 */
function buildHeader(
  serviceType: PeripheralServiceType,
  subService: LightSubService,
  operateType: PeripheralOperateType,
  protoData: Uint8Array,
  secondOperate = 0xff,
): Uint8Array {
  const header = new Uint8Array(20);
  header[0] = 0x01;
  header[1] = serviceType;
  header[2] = subService;
  header[3] = 0xff;
  header[4] = operateType;
  header[5] = secondOperate;
  header[6] = 0xff;
  header[7] = (protoData.length >> 8) & 0xff;
  header[8] = protoData.length & 0xff;
  header[9] = protoData.length > 0 ? crc8(protoData) : 0;
  header[10] = 0x01; // END_TYPE_PB
  // Bytes 11-18 = 0xFF
  for (let i = 11; i <= 18; i++) header[i] = 0xff;
  // Byte 19 = CRC8 of bytes 0-18
  header[19] = crc8(header.subarray(0, 19));
  return header;
}

/** Merge header + protobuf into final command bytes */
function buildCommand(
  serviceType: PeripheralServiceType,
  subService: LightSubService,
  operateType: PeripheralOperateType,
  protoData: Uint8Array,
  secondOperate = 0xff,
): Uint8Array {
  const header = buildHeader(serviceType, subService, operateType, protoData, secondOperate);
  const cmd = new Uint8Array(header.length + protoData.length);
  cmd.set(header, 0);
  cmd.set(protoData, header.length);
  return cmd;
}

// ── Protobuf Field Numbers (from blt_message_format) ────────────
// These are the field numbers used in the protobuf messages
const PROTO_FIELDS = {
  SERVICE_TYPE: 1,
  OPERATE_TYPE: 2,
  BLT_SERVICE_TYPE: 3,
  BLT_OPERATE_TYPE: 4,
  // Data unions (oneOf):
  BAT_PCT: 5,
  LEFT_TIME: 6,
  CUR_MODE: 10,
  MODE_SET: 13,
} as const;

// ── Command Builders ────────────────────────────────────────────

/** Build command: Read current light mode */
export function cmdReadCurrentMode(): Uint8Array {
  const proto = buildLightProto([
    { field: PROTO_FIELDS.SERVICE_TYPE, value: PeripheralServiceType.BLE_LIGHT },
    { field: PROTO_FIELDS.OPERATE_TYPE, value: PeripheralOperateType.GET },
    { field: PROTO_FIELDS.BLT_SERVICE_TYPE, value: LightSubService.MODE_CUR },
  ]);
  return buildCommand(
    PeripheralServiceType.BLE_LIGHT,
    LightSubService.MODE_CUR,
    PeripheralOperateType.GET,
    proto,
  );
}

/** Build command: Read supported light modes */
export function cmdReadSupportedModes(): Uint8Array {
  const proto = buildLightProto([
    { field: PROTO_FIELDS.SERVICE_TYPE, value: PeripheralServiceType.BLE_LIGHT },
    { field: PROTO_FIELDS.OPERATE_TYPE, value: PeripheralOperateType.GET },
    { field: PROTO_FIELDS.BLT_SERVICE_TYPE, value: LightSubService.MODE_SUP },
  ]);
  return buildCommand(
    PeripheralServiceType.BLE_LIGHT,
    LightSubService.MODE_SUP,
    PeripheralOperateType.GET,
    proto,
  );
}

/** Build command: Switch light to a specific mode */
export function cmdSwitchMode(mode: LightMode): Uint8Array {
  const proto = buildLightProto([
    { field: PROTO_FIELDS.SERVICE_TYPE, value: PeripheralServiceType.BLE_LIGHT },
    { field: PROTO_FIELDS.OPERATE_TYPE, value: PeripheralOperateType.SET },
    { field: PROTO_FIELDS.BLT_SERVICE_TYPE, value: LightSubService.MODE_CUR },
    { field: PROTO_FIELDS.CUR_MODE, value: mode },
  ]);
  return buildCommand(
    PeripheralServiceType.BLE_LIGHT,
    LightSubService.MODE_CUR,
    PeripheralOperateType.SET,
    proto,
  );
}

/** Build command: Read battery percentage */
export function cmdReadBattery(): Uint8Array {
  const proto = buildLightProto([
    { field: PROTO_FIELDS.SERVICE_TYPE, value: PeripheralServiceType.BLE_LIGHT },
    { field: PROTO_FIELDS.OPERATE_TYPE, value: PeripheralOperateType.GET },
    { field: PROTO_FIELDS.BLT_SERVICE_TYPE, value: LightSubService.BAT_PCT },
  ]);
  return buildCommand(
    PeripheralServiceType.BLE_LIGHT,
    LightSubService.BAT_PCT,
    PeripheralOperateType.GET,
    proto,
  );
}

/** Build command: Read remaining time */
export function cmdReadRemainingTime(): Uint8Array {
  const proto = buildLightProto([
    { field: PROTO_FIELDS.SERVICE_TYPE, value: PeripheralServiceType.BLE_LIGHT },
    { field: PROTO_FIELDS.OPERATE_TYPE, value: PeripheralOperateType.GET },
    { field: PROTO_FIELDS.BLT_SERVICE_TYPE, value: LightSubService.LEFT_TIME },
  ]);
  return buildCommand(
    PeripheralServiceType.BLE_LIGHT,
    LightSubService.LEFT_TIME,
    PeripheralOperateType.GET,
    proto,
  );
}

/** Build command: Read smart config */
export function cmdReadSmartConfig(): Uint8Array {
  const proto = buildLightProto([
    { field: PROTO_FIELDS.SERVICE_TYPE, value: PeripheralServiceType.BLE_LIGHT },
    { field: PROTO_FIELDS.OPERATE_TYPE, value: PeripheralOperateType.GET },
    { field: PROTO_FIELDS.BLT_SERVICE_TYPE, value: LightSubService.SMT_CONFIG },
  ]);
  return buildCommand(
    PeripheralServiceType.BLE_LIGHT,
    LightSubService.SMT_CONFIG,
    PeripheralOperateType.GET,
    proto,
  );
}

// ── Response Parser ─────────────────────────────────────────────

/** Parse a varint from a buffer starting at offset. Returns [value, bytesConsumed]. */
function decodeVarint(data: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < data.length) {
    const b = data[pos]!;
    value |= (b & 0x7f) << shift;
    pos++;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) break; // protect against malformed data
  }
  return [value >>> 0, pos - offset];
}

/** Parse protobuf fields from response data (after 20-byte header) */
export function parseProtoFields(data: Uint8Array): Map<number, number> {
  const fields = new Map<number, number>();
  let offset = 0;
  while (offset < data.length) {
    const [tag, tagLen] = decodeVarint(data, offset);
    offset += tagLen;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      // Varint
      const [value, valLen] = decodeVarint(data, offset);
      offset += valLen;
      fields.set(fieldNumber, value);
    } else if (wireType === 2) {
      // Length-delimited (embedded message or bytes)
      const [length, lenLen] = decodeVarint(data, offset);
      offset += lenLen;
      offset += length; // Skip embedded data for now
    } else {
      // Unknown wire type — skip
      break;
    }
  }
  return fields;
}

/** Parse response header (first 20 bytes) */
export function parseResponseHeader(data: Uint8Array): {
  valid: boolean;
  serviceType: number;
  subService: number;
  operateType: number;
  dataSize: number;
} | null {
  if (data.length < 20) return null;

  const totalCrc = crc8(data.subarray(0, 19));
  const valid = totalCrc === data[19];

  return {
    valid,
    serviceType: data[1]!,
    subService: data[2]!,
    operateType: data[4]!,
    dataSize: (data[7]! << 8) | data[8]!,
  };
}

// ── iGPSPORT Light BLE Service ──────────────────────────────────

export class IGPSportLightService {
  private device: BluetoothDevice | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private responseBuffer: Uint8Array = new Uint8Array(0);

  // Public state
  state: LightState = {
    connected: false,
    deviceName: '',
    batteryPct: 0,
    currentMode: LightMode.OFF,
    supportedModes: [],
    lightType: LightType.TAIL,
    remainingTimeMs: 0,
  };

  /** Callback when state changes */
  onStateChange: ((state: LightState) => void) | null = null;

  /** Connect to a light via Web Bluetooth */
  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE_UUID] }],
        optionalServices: [BATTERY_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID],
      });

      if (!this.device.gatt) return false;

      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      const server = await this.device.gatt.connect();
      const nusService = await server.getPrimaryService(NUS_SERVICE_UUID);

      // TX = write TO light (we write to TX characteristic)
      this.txChar = await nusService.getCharacteristic(NUS_TX_UUID);
      // RX = read FROM light (we subscribe to RX characteristic)
      this.rxChar = await nusService.getCharacteristic(NUS_RX_UUID);

      // Subscribe to notifications
      await this.rxChar.startNotifications();
      this.rxChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) this.handleNotification(new Uint8Array(value.buffer));
      });

      // Read battery from standard BLE Battery Service
      try {
        const batteryService = await server.getPrimaryService(BATTERY_SERVICE_UUID);
        const batteryChar = await batteryService.getCharacteristic(BATTERY_LEVEL_UUID);
        const batteryValue = await batteryChar.readValue();
        this.state.batteryPct = batteryValue.getUint8(0);
      } catch {
        // Battery service not available — will read via NUS protocol
      }

      this.state.connected = true;
      this.state.deviceName = this.device.name ?? 'iGPSPORT Light';
      this.notifyStateChange();

      // Query initial state
      await this.sendCommand(cmdReadCurrentMode());
      await this.sendCommand(cmdReadSupportedModes());
      await this.sendCommand(cmdReadBattery());

      console.log(`[Light] Connected to ${this.state.deviceName}`);
      return true;
    } catch (err) {
      console.warn('[Light] Connection failed:', err);
      return false;
    }
  }

  /** Connect to a specific device by reference (from WebSocket bridge scan) */
  async connectToDevice(device: BluetoothDevice): Promise<boolean> {
    this.device = device;
    try {
      if (!this.device.gatt) return false;

      const server = await this.device.gatt.connect();
      const nusService = await server.getPrimaryService(NUS_SERVICE_UUID);

      this.txChar = await nusService.getCharacteristic(NUS_TX_UUID);
      this.rxChar = await nusService.getCharacteristic(NUS_RX_UUID);

      await this.rxChar.startNotifications();
      this.rxChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) this.handleNotification(new Uint8Array(value.buffer));
      });

      this.state.connected = true;
      this.state.deviceName = this.device.name ?? 'iGPSPORT Light';
      this.notifyStateChange();

      // Query initial state
      await this.sendCommand(cmdReadCurrentMode());
      await this.sendCommand(cmdReadSupportedModes());
      await this.sendCommand(cmdReadBattery());

      console.log(`[Light] Connected to ${this.state.deviceName}`);
      return true;
    } catch (err) {
      console.warn('[Light] ConnectToDevice failed:', err);
      return false;
    }
  }

  /** Disconnect */
  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnect();
  }

  /** Whether connected */
  isConnected(): boolean {
    return this.state.connected;
  }

  /** Get device name */
  getDeviceName(): string | null {
    return this.state.connected ? this.state.deviceName : null;
  }

  /** Switch light mode */
  async setMode(mode: LightMode): Promise<void> {
    await this.sendCommand(cmdSwitchMode(mode));
    this.state.currentMode = mode;
    this.notifyStateChange();
  }

  /** Toggle light on/off */
  async toggle(): Promise<void> {
    if (this.state.currentMode === LightMode.OFF) {
      // Turn on to last known non-off mode, default to LOW_STEADY
      await this.setMode(LightMode.LOW_STEADY);
    } else {
      await this.setMode(LightMode.OFF);
    }
  }

  /** Refresh battery and mode */
  async refresh(): Promise<void> {
    await this.sendCommand(cmdReadBattery());
    await this.sendCommand(cmdReadCurrentMode());
  }

  // ── Internal ──────────────────────────────────────────────────

  private async sendCommand(cmd: Uint8Array): Promise<void> {
    if (!this.txChar) return;
    const hex = Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const svc = PeripheralServiceType[cmd[1]!] ?? `0x${(cmd[1] ?? 0).toString(16)}`;
    const sub = LightSubService[cmd[2]!] ?? `0x${(cmd[2] ?? 0).toString(16)}`;
    const op = PeripheralOperateType[cmd[4]!] ?? `0x${(cmd[4] ?? 0).toString(16)}`;
    console.log(`[Light:TX] ${svc}.${sub} op=${op} ${cmd.length}B: ${hex}`);
    try {
      // BLE has 20-byte MTU typically, but NUS can handle larger packets
      // Send in chunks of 20 bytes if needed
      const MTU = 20;
      for (let offset = 0; offset < cmd.length; offset += MTU) {
        const chunk = cmd.slice(offset, Math.min(offset + MTU, cmd.length));
        await this.txChar.writeValueWithoutResponse(chunk);
      }
    } catch (err) {
      console.warn('[Light:TX] Send failed:', err);
    }
  }

  private handleNotification(data: Uint8Array): void {
    const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[Light:RX] ${data.length}B: ${hex}`);

    // Accumulate data (responses may span multiple notifications)
    const merged = new Uint8Array(this.responseBuffer.length + data.length);
    merged.set(this.responseBuffer);
    merged.set(data, this.responseBuffer.length);
    this.responseBuffer = merged;

    // Need at least 20-byte header to parse
    if (this.responseBuffer.length < 20) {
      console.log(`[Light:RX] Buffered ${this.responseBuffer.length}/20 header bytes`);
      return;
    }

    const header = parseResponseHeader(this.responseBuffer);
    if (!header) {
      console.warn('[Light:RX] Header parse failed — flushing buffer');
      this.responseBuffer = new Uint8Array(0);
      return;
    }

    const totalExpected = 20 + header.dataSize;
    console.log(`[Light:RX] Header: svc=${header.serviceType} sub=${header.subService} op=${header.operateType} dataSize=${header.dataSize} valid=${header.valid} | have=${this.responseBuffer.length}/${totalExpected}`);

    if (this.responseBuffer.length < totalExpected) return; // Wait for more data

    // Extract protobuf payload
    const protoData = this.responseBuffer.slice(20, totalExpected);
    // Reset buffer (keep any leftover bytes)
    this.responseBuffer = this.responseBuffer.slice(totalExpected);

    if (!header.valid) {
      const headerHex = Array.from(this.responseBuffer.subarray(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.warn(`[Light:RX] CRC mismatch — header: ${headerHex}`);
      return;
    }

    this.handleResponse(header.serviceType, header.subService, header.operateType, protoData);
  }

  private handleResponse(
    serviceType: number,
    subService: number,
    operateType: number,
    protoData: Uint8Array,
  ): void {
    const hex = Array.from(protoData).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const svcName = PeripheralServiceType[serviceType] ?? `0x${serviceType.toString(16)}`;
    const subName = LightSubService[subService] ?? `0x${subService.toString(16)}`;
    const opName = PeripheralOperateType[operateType] ?? `0x${operateType.toString(16)}`;

    if (serviceType !== PeripheralServiceType.BLE_LIGHT) {
      console.log(`[Light:RESP] Non-light service: ${svcName} sub=${subName} op=${opName} | ${hex}`);
      return;
    }

    const fields = parseProtoFields(protoData);
    console.log(`[Light:RESP] ${subName} op=${opName} fields:`, Object.fromEntries(fields), `| ${hex}`);

    switch (subService) {
      case LightSubService.MODE_CUR: {
        const mode = fields.get(PROTO_FIELDS.CUR_MODE) ?? fields.get(10);
        if (mode !== undefined) {
          const modeName = LightMode[mode] ?? `unknown(${mode})`;
          console.log(`[Light:RESP] Current mode: ${modeName} (${mode})`);
          this.state.currentMode = mode as LightMode;
          this.notifyStateChange();
        }
        break;
      }

      case LightSubService.BAT_PCT: {
        const pct = fields.get(PROTO_FIELDS.BAT_PCT) ?? fields.get(5);
        if (pct !== undefined) {
          console.log(`[Light:RESP] Battery: ${pct}%`);
          this.state.batteryPct = pct;
          this.notifyStateChange();
        }
        break;
      }

      case LightSubService.LEFT_TIME: {
        const time = fields.get(PROTO_FIELDS.LEFT_TIME) ?? fields.get(6);
        if (time !== undefined) {
          console.log(`[Light:RESP] Remaining time: ${time}ms (${Math.round(time / 60000)}min)`);
          this.state.remainingTimeMs = time;
          this.notifyStateChange();
        }
        break;
      }

      case LightSubService.MODE_SUP: {
        // Supported modes: try all field numbers as potential mode values
        const modes: LightMode[] = [];
        for (const [fieldNum, value] of fields) {
          if (fieldNum >= 5 && value >= 0 && value <= 20) {
            modes.push(value as LightMode);
          }
        }
        // Also scan raw bytes for mode values (packed repeated varint)
        if (modes.length === 0 && protoData.length > 0) {
          console.log(`[Light:RESP] MODE_SUP: no modes in fields, scanning raw bytes...`);
          for (let i = 0; i < protoData.length; i++) {
            const b = protoData[i]!;
            if (b <= 20) console.log(`  byte[${i}]=${b} → ${LightMode[b] ?? '?'}`);
          }
        }
        if (modes.length > 0) {
          this.state.supportedModes = modes;
          this.notifyStateChange();
          console.log(`[Light:RESP] Supported modes: [${modes.map(m => LightMode[m] ?? m).join(', ')}]`);
        } else {
          console.log(`[Light:RESP] MODE_SUP: raw fields:`, Object.fromEntries(fields));
        }
        break;
      }

      case LightSubService.SMT_CONFIG:
        console.log(`[Light:RESP] Smart config fields:`, Object.fromEntries(fields));
        break;

      default:
        console.log(`[Light:RESP] Unhandled sub=${subName} op=${opName} fields:`, Object.fromEntries(fields));
    }
  }

  private handleDisconnect(): void {
    this.state.connected = false;
    this.state.batteryPct = 0;
    this.state.currentMode = LightMode.OFF;
    this.txChar = null;
    this.rxChar = null;
    this.responseBuffer = new Uint8Array(0);
    this.notifyStateChange();
    console.log('[Light] Disconnected');
  }

  private notifyStateChange(): void {
    this.onStateChange?.({ ...this.state });
  }
}

/** Singleton instance */
export const iGPSportLightService = new IGPSportLightService();
