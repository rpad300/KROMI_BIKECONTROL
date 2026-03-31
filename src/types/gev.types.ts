// === GEV Giant Protocol Types ===

export const GEV_START = 0xfc;
export const GEV_DEVICE_SG = 0x21; // Smart Gateway

export const GEV_CMD = {
  CONNECTION: 0x01,
  MODE_STATE: 0x02,
  BATTERY: 0x03,
  SPEED_DISTANCE: 0x05,
  ASSIST_DATA: 0x15,
  RIDING_DATA: 0x38,
  ASSIST_CONFIG: 0xe2,
  // Button commands (IDs to confirm when AES key obtained)
  ASSIST_UP: 0xa1,
  ASSIST_DOWN: 0xa2,
  LIGHT: 0xa3,
  WALK: 0xa4,
} as const;

export type GEVCommandId = (typeof GEV_CMD)[keyof typeof GEV_CMD];

export interface GEVPacket {
  startByte: number;
  deviceId: number;
  cmdId: number;
  payloadLen: number;
  payload: Uint8Array;
  checksum: number;
}

export interface GEVAssistData {
  type: 'assist';
  assistMode: number; // 0-5
  assistCurrent: number;
}

export interface GEVBatteryData {
  type: 'battery';
  percent: number;
  voltage: number;
  temperature: number;
}

export interface GEVRidingData {
  type: 'riding';
  speed: number;
  distance: number;
  power: number;
}

export type GEVData = GEVAssistData | GEVBatteryData | GEVRidingData;

// === BLE Service UUIDs ===
export const BLE_UUIDS = {
  // Standard services
  BATTERY_SERVICE: '0000180f-0000-1000-8000-00805f9b34fb',
  BATTERY_LEVEL: '00002a19-0000-1000-8000-00805f9b34fb',

  CSC_SERVICE: '00001816-0000-1000-8000-00805f9b34fb',
  CSC_MEASUREMENT: '00002a5b-0000-1000-8000-00805f9b34fb',

  POWER_SERVICE: '00001818-0000-1000-8000-00805f9b34fb',
  POWER_MEASUREMENT: '00002a63-0000-1000-8000-00805f9b34fb',

  HR_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb',
  HR_MEASUREMENT: '00002a37-0000-1000-8000-00805f9b34fb',

  // Giant proprietary
  GEV_SERVICE: 'f0ba3012-6cac-4c99-9089-4b0a1df45002',
  GEV_NOTIFY: 'f0ba3013-6cac-4c99-9089-4b0a1df45002',

  // SRAM AXS (Flight Attendant)
  SRAM_SERVICE: '4d500001-4745-5630-3031-e50e24dcca9e',
  SRAM_WRITE: '4d500002-4745-5630-3031-e50e24dcca9e',
  SRAM_NOTIFY: '4d500003-4745-5630-3031-e50e24dcca9e',

  // Shimano Di2
  DI2_SERVICE: '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  DI2_WRITE: '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  DI2_NOTIFY: '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e',
} as const;
