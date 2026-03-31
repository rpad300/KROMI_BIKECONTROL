/**
 * Giant Smart Gateway Protobuf BLE Service.
 *
 * Uses the F0BA52xx service with app_menuProto.proto protocol.
 * This is the newer protocol used by recent Giant eBikes (2022+).
 *
 * Communication pattern:
 *   APP -> SG: Write to F0BA5202 (protobuf-encoded hmi_menu with method=SET or GET)
 *   SG -> APP: Notify on F0BA5203 (protobuf-encoded hmi_menu with method=RESPONSE or NOTIFY)
 *
 * Since we can't use .proto compilation in the browser easily,
 * we manually encode/decode the critical protobuf messages.
 */

import { BLE_UUIDS } from '../../types/gev.types';
import { useBikeStore } from '../../store/bikeStore';

// Protobuf wire format helpers
// Field encoding: (field_number << 3) | wire_type
// Wire types: 0=varint, 1=64bit, 2=length-delimited, 5=32bit

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value >>> 0; // unsigned
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

function decodeVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  for (let i = offset; i < data.length; i++) {
    const byte = data[i]!;
    value |= (byte & 0x7f) << shift;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: value >>> 0, bytesRead };
}

function encodeField(fieldNumber: number, wireType: number, data: Uint8Array): Uint8Array {
  const tag = encodeVarint((fieldNumber << 3) | wireType);
  if (wireType === 2) {
    // Length-delimited
    const len = encodeVarint(data.length);
    const result = new Uint8Array(tag.length + len.length + data.length);
    result.set(tag, 0);
    result.set(len, tag.length);
    result.set(data, tag.length + len.length);
    return result;
  } else if (wireType === 0) {
    // Varint — data IS the varint
    const result = new Uint8Array(tag.length + data.length);
    result.set(tag, 0);
    result.set(data, tag.length);
    return result;
  }
  return new Uint8Array(0);
}

function encodeVarintField(fieldNumber: number, value: number): Uint8Array {
  return encodeField(fieldNumber, 0, encodeVarint(value));
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// Protocol enums (from app_menuProto.proto)
const Method = { SET: 1, GET: 2, RESPONSE: 3, NOTIFY: 4 } as const;
const DataSource = { SG20: 1, APP: 6 } as const;

// === Protobuf message builders ===

/**
 * Build a GET request for bike data.
 * hmi_menu { proto_version=6, method=GET, source=APP, bike={} }
 */
function buildGetBikeInfo(): Uint8Array {
  const bikeModule = encodeField(5, 2, new Uint8Array(0)); // bikeInfoModule (empty = request all)
  return concat(
    encodeVarintField(99, 6),           // proto_version = VERSION_0_2_3
    encodeVarintField(98, Method.GET),  // method = GET
    encodeVarintField(1, DataSource.APP), // source = APP
    bikeModule,
  );
}

/**
 * Build a GET request for eParts (component info).
 */
function buildGetEParts(): Uint8Array {
  return concat(
    encodeVarintField(99, 6),
    encodeVarintField(98, Method.GET),
    encodeVarintField(1, DataSource.APP),
    encodeField(2, 2, new Uint8Array(0)), // ePartModule (empty = request all)
  );
}

/**
 * Build a GET request for display config.
 */
function buildGetDisplayConfig(): Uint8Array {
  return concat(
    encodeVarintField(99, 6),
    encodeVarintField(98, Method.GET),
    encodeVarintField(1, DataSource.APP),
    encodeField(6, 2, new Uint8Array(0)), // displayConfigModule
  );
}

/**
 * Build a GET request for bike config (assist modes, settings).
 */
function buildGetBikeConfig(): Uint8Array {
  return concat(
    encodeVarintField(99, 6),
    encodeVarintField(98, Method.GET),
    encodeVarintField(1, DataSource.APP),
    encodeField(4, 2, new Uint8Array(0)), // bikeConfigModule
  );
}

// === Protobuf response parser ===

interface ParsedField {
  fieldNumber: number;
  wireType: number;
  value: number | Uint8Array;
}

function parseProtobuf(data: Uint8Array): ParsedField[] {
  const fields: ParsedField[] = [];
  let offset = 0;

  while (offset < data.length) {
    const { value: tag, bytesRead: tagBytes } = decodeVarint(data, offset);
    offset += tagBytes;
    if (tagBytes === 0) break;

    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      // Varint
      const { value, bytesRead } = decodeVarint(data, offset);
      offset += bytesRead;
      fields.push({ fieldNumber, wireType, value });
    } else if (wireType === 2) {
      // Length-delimited
      const { value: len, bytesRead } = decodeVarint(data, offset);
      offset += bytesRead;
      const bytes = data.subarray(offset, offset + len);
      offset += len;
      fields.push({ fieldNumber, wireType, value: bytes });
    } else if (wireType === 1) {
      // 64-bit fixed
      offset += 8;
    } else if (wireType === 5) {
      // 32-bit fixed
      offset += 4;
    } else {
      break; // Unknown wire type
    }
  }

  return fields;
}

function findField(fields: ParsedField[], fieldNumber: number): ParsedField | undefined {
  return fields.find((f) => f.fieldNumber === fieldNumber);
}

// === Main Protobuf BLE Service ===

export class GiantProtobufService {
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private responseResolvers: Array<(data: Uint8Array) => void> = [];

  /**
   * Try to connect to the F0BA5201 protobuf service on the GATT server.
   * Returns true if the service is available.
   */
  async tryConnect(server: BluetoothRemoteGATTServer): Promise<boolean> {
    try {
      const service = await server.getPrimaryService(BLE_UUIDS.PROTO_SERVICE);
      this.writeChar = await service.getCharacteristic(BLE_UUIDS.PROTO_WRITE);
      this.notifyChar = await service.getCharacteristic(BLE_UUIDS.PROTO_NOTIFY);

      await this.notifyChar.startNotifications();
      this.notifyChar.addEventListener('characteristicvaluechanged', (e) => {
        this.handleNotification(e);
      });

      console.log('[Proto] Connected to Giant Protobuf service F0BA5201');
      useBikeStore.getState().setServiceConnected('gev', true);
      return true;
    } catch (err) {
      console.warn('[Proto] Protobuf service F0BA5201 not available:', err);
      return false;
    }
  }

  isConnected(): boolean {
    return this.writeChar !== null && this.notifyChar !== null;
  }

  /**
   * Handle incoming protobuf notification from the Smart Gateway.
   */
  private handleNotification(event: Event) {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    const data = new Uint8Array(char.value!.buffer);

    console.log('[Proto] Received:', Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' '));

    // Try to parse as hmi_menu protobuf
    try {
      const fields = parseProtobuf(data);
      const method = findField(fields, 98);
      const source = findField(fields, 1);

      console.log('[Proto] Method:', method?.value, 'Source:', source?.value);

      // Check for bikeInfo (field 5)
      const bikeInfo = findField(fields, 5);
      if (bikeInfo && bikeInfo.value instanceof Uint8Array) {
        this.parseBikeInfo(bikeInfo.value);
      }

      // Check for eParts (field 2)
      const eParts = findField(fields, 2);
      if (eParts && eParts.value instanceof Uint8Array) {
        this.parseEParts(eParts.value);
      }

      // Check for bikeConfig (field 4)
      const bikeConfig = findField(fields, 4);
      if (bikeConfig && bikeConfig.value instanceof Uint8Array) {
        this.parseBikeConfig(bikeConfig.value);
      }

      // Resolve any pending request
      if (this.responseResolvers.length > 0) {
        const resolver = this.responseResolvers.shift()!;
        resolver(data);
      }
    } catch (err) {
      console.warn('[Proto] Parse error:', err);
    }
  }

  private parseBikeInfo(data: Uint8Array) {
    const fields = parseProtobuf(data);
    const frameNumber = findField(fields, 1); // string
    const odo = findField(fields, 2); // uint32

    if (odo && typeof odo.value === 'number') {
      console.log('[Proto] ODO:', odo.value, 'km');
    }
    if (frameNumber && frameNumber.value instanceof Uint8Array) {
      const fn = new TextDecoder().decode(frameNumber.value);
      console.log('[Proto] Frame number:', fn);
    }
  }

  private parseEParts(data: Uint8Array) {
    const fields = parseProtobuf(data);
    // Each field 1-14 is an ePartInfo submessage
    for (const field of fields) {
      if (field.value instanceof Uint8Array && field.value.length > 0) {
        const partFields = parseProtobuf(field.value);
        const modelName = findField(partFields, 1);
        const fwVersion = findField(partFields, 2);

        const name = modelName instanceof Object && 'value' in modelName && modelName.value instanceof Uint8Array
          ? new TextDecoder().decode(modelName.value) : '';
        const fw = fwVersion instanceof Object && 'value' in fwVersion && fwVersion.value instanceof Uint8Array
          ? new TextDecoder().decode(fwVersion.value) : '';

        if (name || fw) {
          const partNames = ['', 'SG', 'Sensor', 'Display', 'Remote1', 'Remote2', 'DriveChain', 'eShifting', 'eSuspension', 'SubBattery', 'Battery', 'Charger', 'IoT', 'Radar', 'TailLight'];
          console.log(`[Proto] ePart[${partNames[field.fieldNumber] ?? field.fieldNumber}]: ${name} fw:${fw}`);
        }
      }
    }
  }

  private parseBikeConfig(data: Uint8Array) {
    const fields = parseProtobuf(data);
    for (const field of fields) {
      if (typeof field.value === 'number') {
        const configNames: Record<number, string> = {
          1: 'language', 2: 'sys_unit', 3: 'dayMode', 4: 'nightMode',
          6: 'timestamp', 8: 'first_use', 11: 'brightness_mode',
        };
        console.log(`[Proto] Config ${configNames[field.fieldNumber] ?? field.fieldNumber}: ${field.value}`);
      }
    }
  }

  /**
   * Send a protobuf message and wait for response (with timeout).
   */
  private async sendAndWait(message: Uint8Array, timeoutMs = 3000): Promise<Uint8Array | null> {
    if (!this.writeChar) return null;

    return new Promise(async (resolve) => {
      const timer = setTimeout(() => {
        // Remove resolver on timeout
        const idx = this.responseResolvers.indexOf(resolverFn);
        if (idx >= 0) this.responseResolvers.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const resolverFn = (data: Uint8Array) => {
        clearTimeout(timer);
        resolve(data);
      };
      this.responseResolvers.push(resolverFn);

      try {
        // BLE MTU is typically 20 bytes, may need chunking for larger messages
        if (message.length <= 20) {
          await this.writeChar!.writeValueWithResponse(message);
        } else {
          // Chunk into 20-byte segments
          for (let i = 0; i < message.length; i += 20) {
            const chunk = message.subarray(i, Math.min(i + 20, message.length));
            await this.writeChar!.writeValueWithResponse(chunk);
          }
        }
      } catch (err) {
        clearTimeout(timer);
        console.error('[Proto] Write failed:', err);
        resolve(null);
      }
    });
  }

  /**
   * Send a raw protobuf message (fire and forget).
   */
  async send(message: Uint8Array): Promise<void> {
    if (!this.writeChar) {
      console.warn('[Proto] Write characteristic not available');
      return;
    }
    try {
      if (message.length <= 20) {
        await this.writeChar.writeValueWithResponse(message);
      } else {
        for (let i = 0; i < message.length; i += 20) {
          const chunk = message.subarray(i, Math.min(i + 20, message.length));
          await this.writeChar.writeValueWithResponse(chunk);
        }
      }
    } catch (err) {
      console.error('[Proto] Write failed:', err);
    }
  }

  // === Public API ===

  async requestBikeInfo(): Promise<void> {
    console.log('[Proto] Requesting bike info...');
    await this.sendAndWait(buildGetBikeInfo());
  }

  async requestEParts(): Promise<void> {
    console.log('[Proto] Requesting eParts...');
    await this.sendAndWait(buildGetEParts());
  }

  async requestDisplayConfig(): Promise<void> {
    console.log('[Proto] Requesting display config...');
    await this.sendAndWait(buildGetDisplayConfig());
  }

  async requestBikeConfig(): Promise<void> {
    console.log('[Proto] Requesting bike config...');
    await this.sendAndWait(buildGetBikeConfig());
  }

  /**
   * Request all available data from the Smart Gateway.
   */
  async requestAllData(): Promise<void> {
    await this.requestBikeInfo();
    await this.requestEParts();
    await this.requestBikeConfig();
    await this.requestDisplayConfig();
  }
}

export const giantProtobufService = new GiantProtobufService();
