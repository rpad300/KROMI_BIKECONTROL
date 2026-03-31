import {
  GEV_START,
  GEV_DEVICE_SG,
  GEV_CMD,
  type GEVData,
  type GEVAssistData,
  type GEVBatteryData,
  type GEVRidingData,
} from '../../types/gev.types';

/**
 * Build a GEV command packet for the Giant Smart Gateway.
 *
 * Packet format: [0xFC][device_id:0x21][cmd_id][payload_len][payload:N][checksum_hi][checksum_lo]
 */
export function buildCommand(cmdId: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const packet = new Uint8Array(4 + payload.length + 2);
  packet[0] = GEV_START;
  packet[1] = GEV_DEVICE_SG;
  packet[2] = cmdId;
  packet[3] = payload.length;
  packet.set(payload, 4);

  const checksum = calculateChecksum(packet.subarray(0, 4 + payload.length));
  packet[4 + payload.length] = (checksum >> 8) & 0xff;
  packet[4 + payload.length + 1] = checksum & 0xff;

  return packet;
}

/**
 * Build assist up/down command packets
 */
export function buildAssistUp(): Uint8Array {
  return buildCommand(GEV_CMD.ASSIST_UP);
}

export function buildAssistDown(): Uint8Array {
  return buildCommand(GEV_CMD.ASSIST_DOWN);
}

/**
 * Build assist mode set command (0xE2)
 * Mode: 0=OFF, 1=ECO, 2=TOUR, 3=SPORT, 4=POWER, 5=AUTO
 */
export function buildAssistModeCommand(mode: number): Uint8Array {
  const payload = new Uint8Array([mode & 0xff]);
  return buildCommand(GEV_CMD.ASSIST_CONFIG, payload);
}

/**
 * Parse incoming GEV notification packet
 */
export function parseGEVPacket(data: DataView): GEVData | null {
  if (data.byteLength < 6) return null;
  if (data.getUint8(0) !== GEV_START) return null;
  if (data.getUint8(1) !== GEV_DEVICE_SG) return null;

  const cmdId = data.getUint8(2);
  const payloadLen = data.getUint8(3);

  if (data.byteLength < 4 + payloadLen + 2) return null;

  // TODO: decrypt AES when key is available
  // const decrypted = GEVCrypto.decrypt(data, 4, payloadLen);

  switch (cmdId) {
    case GEV_CMD.ASSIST_DATA:
      return parseAssistData(data, 4, payloadLen);
    case GEV_CMD.BATTERY:
      return parseBatteryData(data, 4, payloadLen);
    case GEV_CMD.RIDING_DATA:
      return parseRidingData(data, 4, payloadLen);
    default:
      return null;
  }
}

function parseAssistData(_data: DataView, offset: number, _len: number): GEVAssistData | null {
  try {
    return {
      type: 'assist',
      assistMode: _data.getUint8(offset),
      assistCurrent: _data.byteLength > offset + 1 ? _data.getUint8(offset + 1) : 0,
    };
  } catch {
    return null;
  }
}

function parseBatteryData(_data: DataView, offset: number, _len: number): GEVBatteryData | null {
  try {
    return {
      type: 'battery',
      percent: _data.getUint8(offset),
      voltage: _data.byteLength > offset + 2 ? _data.getUint16(offset + 1, true) / 100 : 0,
      temperature: _data.byteLength > offset + 3 ? _data.getUint8(offset + 3) : 0,
    };
  } catch {
    return null;
  }
}

function parseRidingData(_data: DataView, offset: number, _len: number): GEVRidingData | null {
  try {
    return {
      type: 'riding',
      speed: _data.byteLength > offset + 1 ? _data.getUint16(offset, true) / 10 : 0,
      distance: _data.byteLength > offset + 5 ? _data.getUint32(offset + 2, true) : 0,
      power: _data.byteLength > offset + 7 ? _data.getUint16(offset + 6, true) : 0,
    };
  } catch {
    return null;
  }
}

function calculateChecksum(data: Uint8Array): number {
  let sum = 0;
  for (const byte of data) sum += byte;
  return sum & 0xffff;
}
