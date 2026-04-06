/**
 * ShimanoMotorService — BLE protocol for Shimano STEPS e-bike motors.
 *
 * Reverse-engineered from Shimano E-TUBE RIDE APK (jadx decompile).
 *
 * Service: SHIMANO_BICYCLE_INFORMATION (0x18EF)
 * Protocol: SBI (Shimano Bicycle Information) commands + STEPS telemetry
 *
 * Supported motors: EP800, EP600, EP8, E8000, E7000, E6100, E5000
 *
 * Characteristics:
 *   0x2AC0  FEATURE              — READ, INDICATE
 *   0x2AC1  PERIODIC_INFORMATION — NOTIFY (battery, status, profiles)
 *   0x2AC2  INSTANTANEOUS_INFO   — INDICATE (real-time data)
 *   0x2AC3  DFLY_CH_SWITCH       — READ, INDICATE
 *   0x2AC4  SBI_CONTROL_POINT    — INDICATE, WRITE (command interface)
 *   0x2AC5  SYSTEM_SERIAL_NUMBER — READ
 */

// ── BLE UUIDs ───────────────────────────────────────────────────

const SHIMANO_BASE = '-5348-494d-414e-4f5f424c4500';

export const SBI_SERVICE          = `000018ef${SHIMANO_BASE}`;
export const SBI_FEATURE          = `00002ac0${SHIMANO_BASE}`;
export const SBI_PERIODIC_INFO    = `00002ac1${SHIMANO_BASE}`;
export const SBI_INSTANTANEOUS    = `00002ac2${SHIMANO_BASE}`;
export const SBI_DFLY_SWITCH      = `00002ac3${SHIMANO_BASE}`;
export const SBI_CONTROL_POINT    = `00002ac4${SHIMANO_BASE}`;
export const SBI_SERIAL_NUMBER    = `00002ac5${SHIMANO_BASE}`;

// Standard services (motor also exposes these)
export const CYCLING_POWER_SERVICE = 0x1818;
export const CP_MEASUREMENT = 0x2a63;
export const BATTERY_SERVICE = 0x180f;
export const DIS_SERVICE = 0x180a;

// ── SBI Operation Codes ─────────────────────────────────────────

export enum SbiOpCode {
  CHANGE_SHIFT_MODE = 0x01,
  CHANGE_ASSIST_MODE = 0x02,
  CHANGE_LIGHT_STATUS = 0x03,
  REQUEST_RESET = 0x04,
  REQUEST_STEPS_STATUS = 0x05,
  MTB_ADDITIONAL_INFO = 0x11,
  WIRELESS_SWITCH_INFO = 0x12,
  ASSIST_PROFILE_NAME = 0x13,
  DCAS_SERIAL_NUMBER = 0x70,
  RESPONSE_CODE = 0x80,
}

// ── Assist Modes ────────────────────────────────────────────────

export enum ShimanoAssistMode {
  OFF = 0x00,
  ECO = 0x01,
  TRAIL = 0x02,    // NORMAL on non-MTB
  BOOST = 0x03,    // HIGH on non-MTB
  WALK_STOP = 0x04,
  WALK_ACTIVATE = 0x05,
  LEVEL_UP = 0x7e,
  LEVEL_DOWN = 0x7f,
}

export const SHIMANO_MODE_LABELS: Record<number, string> = {
  [ShimanoAssistMode.OFF]: 'OFF',
  [ShimanoAssistMode.ECO]: 'ECO',
  [ShimanoAssistMode.TRAIL]: 'TRAIL',
  [ShimanoAssistMode.BOOST]: 'BOOST',
  [ShimanoAssistMode.WALK_STOP]: 'WALK OFF',
  [ShimanoAssistMode.WALK_ACTIVATE]: 'WALK',
};

export const SHIMANO_MODE_COLORS: Record<number, string> = {
  [ShimanoAssistMode.OFF]: '#777575',
  [ShimanoAssistMode.ECO]: '#3fff8b',
  [ShimanoAssistMode.TRAIL]: '#6e9bff',
  [ShimanoAssistMode.BOOST]: '#ff716c',
};

// ── SBI Response Codes ──────────────────────────────────────────

export enum SbiResponseCode {
  SUCCESS = 0x00,
  DEVICE_BUSY = 0x01,
  INVALID_COMMAND = 0x02,
  INVALID_PARAMETER = 0x03,
  GENERAL_ERROR = 0xff,
}

// ── Detection ───────────────────────────────────────────────────

export function isShimanoMotor(name: string, uuids: string): boolean {
  const lower = uuids.toLowerCase();
  return (
    lower.includes('18ef') ||  // SBI service
    lower.includes('5348-494d-414e') || // SHIMANO BLE base
    /^ep[0-9]/i.test(name) ||
    /shimano.*steps/i.test(name) ||
    /^steps/i.test(name) ||
    /^e[0-9]{4}/i.test(name) // E8000, E7000, E6100, E5000
  );
}

// ── Telemetry State ─────────────────────────────────────────────

export interface ShimanoMotorState {
  connected: boolean;
  deviceName: string;
  serialNumber: string;

  // Assist
  assistMode: ShimanoAssistMode;
  assistProfile: number;    // Active E-TUBE PROJECT profile
  assistLevel: number;      // 0-100% assistance
  walkAssist: boolean;

  // Telemetry
  speed: number;            // km/h
  cadence: number;          // RPM
  power: number;            // W (from Cycling Power)
  torque: number;           // Nm

  // Battery
  batteryPct: number;       // 0-100%
  nominalCapacity: number;  // From STEPS_STATUS

  // Range (from TRAVELING_INFO2)
  rangeEco: number;         // km
  rangeTrail: number;       // km
  rangeBoost: number;       // km

  // Trip
  tripDistance: number;     // km
  totalDistance: number;    // km (odometer)
  tripTime: number;        // seconds
  speedAvg: number;        // km/h
  speedMax: number;        // km/h

  // Status
  lightOn: boolean;
  error: number;           // 0xFF = no error
  warning: number;
  maintenanceAlert: boolean;
  forcedEco: boolean;
  shiftAdvice: number;     // 0=none, 1=up, 2=down
}

// ── Service ─────────────────────────────────────────────────────

export class ShimanoMotorService {
  private device: BluetoothDevice | null = null;
  private controlPoint: BluetoothRemoteGATTCharacteristic | null = null;
  private sequenceNumber = 0;

  state: ShimanoMotorState = {
    connected: false, deviceName: '', serialNumber: '',
    assistMode: ShimanoAssistMode.OFF, assistProfile: 0, assistLevel: 0, walkAssist: false,
    speed: 0, cadence: 0, power: 0, torque: 0,
    batteryPct: 0, nominalCapacity: 0,
    rangeEco: 0, rangeTrail: 0, rangeBoost: 0,
    tripDistance: 0, totalDistance: 0, tripTime: 0, speedAvg: 0, speedMax: 0,
    lightOn: false, error: 0xff, warning: 0, maintenanceAlert: false,
    forcedEco: false, shiftAdvice: 0,
  };

  onStateChange: ((state: ShimanoMotorState) => void) | null = null;
  onData: ((type: string, data: Record<string, unknown>) => void) | null = null;

  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SBI_SERVICE] }],
        optionalServices: [CYCLING_POWER_SERVICE, BATTERY_SERVICE, DIS_SERVICE],
      });
      return this.connectGatt();
    } catch (err) {
      console.warn('[ShimanoMotor] Connection failed:', err);
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

      // SBI Service
      const sbiService = await server.getPrimaryService(SBI_SERVICE);

      // Subscribe to periodic info (battery, status, speed, cadence)
      const periodicChar = await sbiService.getCharacteristic(SBI_PERIODIC_INFO);
      await periodicChar.startNotifications();
      periodicChar.addEventListener('characteristicvaluechanged', (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (v) this.parsePeriodicInfo(new DataView(v.buffer));
      });

      // Control point (write commands + read responses)
      this.controlPoint = await sbiService.getCharacteristic(SBI_CONTROL_POINT);
      await this.controlPoint.startNotifications();
      this.controlPoint.addEventListener('characteristicvaluechanged', (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (v) this.parseControlResponse(new Uint8Array(v.buffer));
      });

      // Read serial number
      try {
        const serialChar = await sbiService.getCharacteristic(SBI_SERIAL_NUMBER);
        const serialValue = await serialChar.readValue();
        this.state.serialNumber = new TextDecoder().decode(serialValue.buffer).trim();
      } catch { /* no serial */ }

      // Subscribe to Cycling Power (real-time watts)
      try {
        const cpService = await server.getPrimaryService(CYCLING_POWER_SERVICE);
        const cpChar = await cpService.getCharacteristic(CP_MEASUREMENT);
        await cpChar.startNotifications();
        cpChar.addEventListener('characteristicvaluechanged', (e) => {
          const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
          if (v) this.parsePowerMeasurement(new DataView(v.buffer));
        });
      } catch { /* no power service */ }

      // Read battery
      try {
        const batService = await server.getPrimaryService(BATTERY_SERVICE);
        const batChar = await batService.getCharacteristic(0x2a19);
        const batValue = await batChar.readValue();
        this.state.batteryPct = batValue.getUint8(0);
      } catch { /* no battery service */ }

      this.state.connected = true;
      this.state.deviceName = this.device.name ?? 'Shimano STEPS';
      this.notifyStateChange();

      // Request initial status
      this.sendSbiCommand(SbiOpCode.REQUEST_STEPS_STATUS, []);

      console.log(`[ShimanoMotor] Connected: ${this.state.deviceName} (${this.state.serialNumber})`);
      return true;
    } catch (err) {
      console.warn('[ShimanoMotor] GATT connection failed:', err);
      return false;
    }
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.handleDisconnect();
  }

  isConnected(): boolean { return this.state.connected; }
  getDeviceName(): string | null { return this.state.connected ? this.state.deviceName : null; }

  // ── Commands ──────────────────────────────────────────────────

  async setAssistMode(mode: ShimanoAssistMode): Promise<void> {
    this.sendSbiCommand(SbiOpCode.CHANGE_ASSIST_MODE, [mode]);
  }

  async toggleLight(): Promise<void> {
    this.state.lightOn = !this.state.lightOn;
    this.sendSbiCommand(SbiOpCode.CHANGE_LIGHT_STATUS, [this.state.lightOn ? 0x02 : 0x01]);
  }

  async requestStatus(): Promise<void> {
    this.sendSbiCommand(SbiOpCode.REQUEST_STEPS_STATUS, []);
  }

  async startWalkAssist(): Promise<void> {
    this.sendSbiCommand(SbiOpCode.CHANGE_ASSIST_MODE, [ShimanoAssistMode.WALK_ACTIVATE]);
  }

  async stopWalkAssist(): Promise<void> {
    this.sendSbiCommand(SbiOpCode.CHANGE_ASSIST_MODE, [ShimanoAssistMode.WALK_STOP]);
  }

  // ── SBI Command Writer ────────────────────────────────────────

  private sendSbiCommand(opCode: SbiOpCode, params: number[]): void {
    if (!this.controlPoint) return;
    this.sequenceNumber = (this.sequenceNumber + 1) & 0x7f; // Clear MSB
    const cmd = new Uint8Array([opCode, this.sequenceNumber, ...params]);
    try {
      this.controlPoint.writeValueWithResponse(cmd);
    } catch (err) {
      console.warn('[ShimanoMotor] SBI write failed:', err);
    }
  }

  // ── Parsers ───────────────────────────────────────────────────

  private parsePeriodicInfo(dv: DataView): void {
    if (dv.byteLength < 2) return;
    const infoType = dv.getUint8(0);

    switch (infoType) {
      case 0x01: this.parseStepsStatus(dv); break;
      case 0x02: this.parseTravelingInfo1(dv); break;
      case 0x03: this.parseTravelingInfo2(dv); break;
      default:
        console.log(`[ShimanoMotor] Unknown periodic info type: 0x${infoType.toString(16)}`);
    }
  }

  /** STEPS_STATUS (0x01) — battery, errors, profile, assist state */
  private parseStepsStatus(dv: DataView): void {
    if (dv.byteLength < 18) return;

    const errorWarning = dv.getUint8(1);
    this.state.error = errorWarning;
    this.state.maintenanceAlert = dv.getUint8(4) === 1;

    const lightStatus = dv.getUint8(6);
    if (lightStatus !== 0xff) this.state.lightOn = lightStatus === 2;

    const forcedEco = dv.getUint8(7);
    if (forcedEco !== 0xff) this.state.forcedEco = forcedEco === 1;

    const shiftAdvice = dv.getUint8(8);
    if (shiftAdvice !== 0xff) this.state.shiftAdvice = shiftAdvice;

    const nomCapacity = dv.getUint16(9, true);
    if (nomCapacity !== 0xffff) {
      this.state.nominalCapacity = nomCapacity;
      // Nominal capacity as proxy for battery %
      // Actual mapping depends on motor model, but 0-500 is typical
      if (nomCapacity > 0 && nomCapacity < 1000) {
        this.state.batteryPct = Math.round((nomCapacity / 500) * 100);
        this.onData?.('battery', { value: this.state.batteryPct });
      }
    }

    this.state.assistProfile = dv.getUint8(15);
    this.notifyStateChange();
    this.onData?.('stepsStatus', {
      error: this.state.error,
      maintenance: this.state.maintenanceAlert,
      light: this.state.lightOn,
      forcedEco: this.state.forcedEco,
      profile: this.state.assistProfile,
    });
  }

  /** TRAVELING_INFORMATION1 (0x02) — assist, speed, cadence, time */
  private parseTravelingInfo1(dv: DataView): void {
    if (dv.byteLength < 10) return;

    const rawAssist = dv.getUint8(1);
    const baseMode = rawAssist & 0x0f;
    if (baseMode >= 0 && baseMode <= 5) {
      this.state.assistMode = baseMode as ShimanoAssistMode;
      this.state.walkAssist = baseMode === ShimanoAssistMode.WALK_ACTIVATE;
      this.onData?.('assistMode', { value: baseMode });
    }

    const rawSpeed = dv.getInt16(2, true);
    if (rawSpeed !== -32768) {
      this.state.speed = rawSpeed / 100;
      this.onData?.('speed', { value: this.state.speed });
    }

    const assistLevel = dv.getInt8(4);
    if (assistLevel !== -128) this.state.assistLevel = assistLevel;

    const cadence = dv.getUint8(5);
    if (cadence !== 0xff) {
      this.state.cadence = cadence;
      this.onData?.('cadence', { value: cadence });
    }

    const travelTime = dv.getUint32(6, true);
    if (travelTime !== 0xffffffff) this.state.tripTime = travelTime;

    this.notifyStateChange();
  }

  /** TRAVELING_INFORMATION2 (0x03) — distance, range per mode */
  private parseTravelingInfo2(dv: DataView): void {
    if (dv.byteLength < 19) return;

    const tripDist = dv.getUint32(1, true);
    if (tripDist !== 0xffffffff) this.state.tripDistance = tripDist / 1000;

    const totalDist = dv.getUint32(5, true);
    if (totalDist !== 0xffffffff) this.state.totalDistance = totalDist / 1000;

    const avgSpeed = dv.getInt16(9, true);
    if (avgSpeed !== -32768) this.state.speedAvg = avgSpeed / 100;

    const maxSpeed = dv.getInt16(11, true);
    if (maxSpeed !== -32768) this.state.speedMax = maxSpeed / 100;

    // Range per mode (km) — directly from motor!
    const rangeBoost = dv.getUint16(13, true);
    const rangeTrail = dv.getUint16(15, true);
    const rangeEco = dv.getUint16(17, true);

    if (rangeBoost !== 0xffff) this.state.rangeBoost = rangeBoost;
    if (rangeTrail !== 0xffff) this.state.rangeTrail = rangeTrail;
    if (rangeEco !== 0xffff) this.state.rangeEco = rangeEco;

    this.notifyStateChange();
    this.onData?.('rangePerMode', {
      eco: this.state.rangeEco,
      trail: this.state.rangeTrail,
      boost: this.state.rangeBoost,
    });
  }

  /** Cycling Power Measurement — motor power (W) + torque (Nm) */
  private parsePowerMeasurement(dv: DataView): void {
    if (dv.byteLength < 4) return;
    const flags = dv.getUint16(0, true);
    const watts = dv.getInt16(2, true);
    this.state.power = Math.max(0, watts);
    this.onData?.('power', { value: this.state.power });

    // Accumulated torque if present (bit 2)
    if (flags & 0x04 && dv.byteLength >= 6) {
      const rawTorque = dv.getUint16(4, true);
      this.state.torque = rawTorque / 32; // spec says Nm * 32
    }

    this.notifyStateChange();
  }

  private parseControlResponse(data: Uint8Array): void {
    if (data.length < 3) return;
    if (data[0] !== SbiOpCode.RESPONSE_CODE) return;

    const seq = data[1]!;
    const responseCode = data[2]!;
    const success = responseCode === SbiResponseCode.SUCCESS;

    console.log(`[ShimanoMotor] SBI response: seq=${seq} code=${responseCode} ${success ? 'OK' : 'FAIL'}`);

    if (!success) {
      const codeLabel = {
        [SbiResponseCode.DEVICE_BUSY]: 'Device busy',
        [SbiResponseCode.INVALID_COMMAND]: 'Invalid command',
        [SbiResponseCode.INVALID_PARAMETER]: 'Invalid parameter',
        [SbiResponseCode.GENERAL_ERROR]: 'General error',
      }[responseCode] ?? `Unknown (${responseCode})`;
      console.warn(`[ShimanoMotor] SBI error: ${codeLabel}`);
    }
  }

  private handleDisconnect(): void {
    this.state.connected = false;
    this.controlPoint = null;
    this.notifyStateChange();
    console.log('[ShimanoMotor] Disconnected');
  }

  private notifyStateChange(): void {
    this.onStateChange?.({ ...this.state });
  }
}

export const shimanoMotorService = new ShimanoMotorService();
