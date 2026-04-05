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

  // Giant proprietary — Legacy GEV (AES encrypted binary)
  GEV_SERVICE: 'f0ba3012-6cac-4c99-9089-4b0a1df45002',
  GEV_NOTIFY: 'f0ba3013-6cac-4c99-9089-4b0a1df45002',

  // Giant proprietary — Protobuf service (newer protocol, app_menuProto.proto)
  PROTO_SERVICE: 'f0ba5201-6cac-4c99-9089-4b0a1df45002',
  PROTO_WRITE: 'f0ba5202-6cac-4c99-9089-4b0a1df45002',
  PROTO_NOTIFY: 'f0ba5203-6cac-4c99-9089-4b0a1df45002',
  PROTO_EXTRA: 'f0ba5204-6cac-4c99-9089-4b0a1df45002',

  // SRAM AXS (Flight Attendant)
  SRAM_SERVICE: '4d500001-4745-5630-3031-e50e24dcca9e',
  SRAM_WRITE: '4d500002-4745-5630-3031-e50e24dcca9e',
  SRAM_NOTIFY: '4d500003-4745-5630-3031-e50e24dcca9e',

  // Shimano Di2 / STEPS — proprietary UUIDs (base: SHIMANO_BLE)
  DI2_SERVICE: '000018ff-5348-494d-414e-4f5f424c4500',        // E-Tube main
  DI2_AUTH_CONTROL: '00002af3-5348-494d-414e-4f5f424c4500',   // Auth command
  DI2_AUTH_NONCE: '00002af4-5348-494d-414e-4f5f424c4500',     // Auth challenge
  DI2_PCE_RESPONSE: '00002af9-5348-494d-414e-4f5f424c4500',   // PCE response (notify)
  DI2_PCE_COMMAND: '00002afa-5348-494d-414e-4f5f424c4500',    // PCE command (write)
  DI2_INFO_SERVICE: '000018fe-5348-494d-414e-4f5f424c4500',   // Info service
  DI2_REALTIME_SERVICE: '000018ef-5348-494d-414e-4f5f424c4500', // Real-time / D-FLY
  DI2_RT_STATUS: '00002ac0-5348-494d-414e-4f5f424c4500',      // Status (I,R)
  DI2_RT_NOTIFY: '00002ac1-5348-494d-414e-4f5f424c4500',      // Live data (N)
  DI2_RT_COMPS: '00002ac3-5348-494d-414e-4f5f424c4500',       // Component slots (I,R)

  // Device Information Service (0x180A)
  DEVICE_INFO_SERVICE: '0000180a-0000-1000-8000-00805f9b34fb',
  FIRMWARE_REVISION: '00002a26-0000-1000-8000-00805f9b34fb',
  HARDWARE_REVISION: '00002a27-0000-1000-8000-00805f9b34fb',
  SOFTWARE_REVISION: '00002a28-0000-1000-8000-00805f9b34fb',

  // TPMS (Tire Pressure Monitoring)
  TPMS_FRONT_SERVICE: '83c80001-4a61-60b9-3a2b-1300855e588c',
  TPMS_FRONT_WRITE: '83c80002-4a61-60b9-3a2b-1300855e588c',
  TPMS_FRONT_NOTIFY: '83c80003-4a61-60b9-3a2b-1300855e588c',
  TPMS_REAR_SERVICE: '84c80001-4a61-60b9-3a2b-1300855e588c',
  TPMS_REAR_WRITE: '84c80002-4a61-60b9-3a2b-1300855e588c',
  TPMS_REAR_NOTIFY: '84c80003-4a61-60b9-3a2b-1300855e588c',
} as const;
