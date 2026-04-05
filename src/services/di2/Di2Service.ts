import { useBikeStore } from '../../store/bikeStore';

export interface ShiftEvent {
  gear_from: number;
  gear_to: number;
  direction: 'up' | 'down';
  timestamp: number;
}

export interface ShimanoState {
  connected: boolean;
  authenticated: boolean;
  serial: string;
  firmware: string;
  battery: number;
  gear: number;
  totalGears: number;
  shiftCount: number;
  components: ShimanoComponent[];
}

export interface ShimanoComponent {
  slot: number;
  type: number;
  status: number;
  gear: number;
}

export interface GearStats {
  currentGear: number;
  totalGears: number;
  shiftCount: number;
  gearUsage: Record<string, number>; // gear → ms
  history: { t: number; g: number }[];
}

type ShiftStartCallback = (e: ShiftEvent) => void;
type GearChangedCallback = (gear: number) => void;
type BatteryCallback = (level: number) => void;

/**
 * Shimano Di2 / STEPS service — communicates via WebSocket bridge to APK.
 *
 * The APK handles: BLE scan, Shimano auth (Xorshift128 + AES-128-ECB),
 * PCE protocol, gear tracking, battery reading.
 *
 * The PWA receives: gear changes, battery, shift events, component data.
 * The PWA sends: scan/connect commands, gear stat requests.
 */
class Di2Service {
  private static instance: Di2Service;

  // State
  private state: ShimanoState = {
    connected: false,
    authenticated: false,
    serial: '',
    firmware: '',
    battery: 0,
    gear: 0,
    totalGears: 12,
    shiftCount: 0,
    components: [],
  };

  // Shift history for ride statistics
  private shiftHistory: ShiftEvent[] = [];

  // Callbacks
  private onShiftStartCbs: ShiftStartCallback[] = [];
  private onGearChangedCbs: GearChangedCallback[] = [];
  private onBatteryCbs: BatteryCallback[] = [];

  // WebSocket send function (injected by WebSocketBLEClient)
  private sendFn: ((msg: string) => void) | null = null;

  static getInstance(): Di2Service {
    if (!Di2Service.instance) {
      Di2Service.instance = new Di2Service();
    }
    return Di2Service.instance;
  }

  /** Set the WebSocket send function (called by WebSocketBLEClient on connect) */
  setSendFunction(fn: (msg: string) => void): void {
    this.sendFn = fn;
  }

  /** Send command to APK bridge */
  private send(msg: Record<string, unknown>): void {
    if (this.sendFn) {
      this.sendFn(JSON.stringify(msg));
    }
  }

  // ═══════════════════════════════════════
  // COMMANDS — sent to APK
  // ═══════════════════════════════════════

  /** Scan for Shimano STEPS devices and auto-connect */
  scanAndConnect(): void {
    this.send({ type: 'shimanoScan' });
  }

  /** Connect to specific Shimano device by MAC address */
  connect(address: string): void {
    this.send({ type: 'shimanoConnect', address });
  }

  /** Disconnect from Shimano device */
  disconnect(): void {
    this.send({ type: 'shimanoDisconnect' });
  }

  /** Request battery level */
  requestBattery(): void {
    this.send({ type: 'shimanoBattery' });
  }

  /** Request current gear state */
  requestGearState(): void {
    this.send({ type: 'shimanoGearState' });
  }

  /** Request gear usage statistics */
  requestGearStats(): void {
    this.send({ type: 'shimanoGearStats' });
  }

  /** Reset shift/gear stats (call at ride start) */
  resetStats(): void {
    this.shiftHistory = [];
    this.state.shiftCount = 0;
    this.send({ type: 'shimanoResetStats' });
  }

  /** Send raw PCE command (advanced) */
  sendPceCommand(controlInfo: number, dataHex: string): void {
    this.send({ type: 'shimanoPceCommand', controlInfo, data: dataHex });
  }

  // ═══════════════════════════════════════
  // MESSAGE HANDLER — called by WebSocketBLEClient
  // ═══════════════════════════════════════

  /** Process a message from the APK bridge */
  handleMessage(data: Record<string, unknown>): void {
    switch (data.type) {
      case 'shimanoConnected':
        this.state.connected = true;
        this.state.authenticated = true;
        this.state.serial = (data.serial as string) || '';
        this.state.firmware = (data.firmware as string) || '';
        useBikeStore.getState().setServiceConnected('di2', true);
        console.log(`[Di2] Connected: ${this.state.serial} FW=${this.state.firmware}`);
        // Auto-read battery + gear state
        this.requestBattery();
        this.requestGearState();
        break;

      case 'shimanoStatus': {
        const status = data.status as string;
        if (status === 'disconnected') {
          this.state.connected = false;
          this.state.authenticated = false;
          useBikeStore.getState().setServiceConnected('di2', false);
        }
        break;
      }

      case 'shimanoBattery': {
        const level = data.level as number;
        this.state.battery = level;
        useBikeStore.getState().setDi2Battery(level);
        this.onBatteryCbs.forEach((cb) => cb(level));
        break;
      }

      case 'shimanoGear': {
        const gear = data.gear as number;
        const previousGear = data.previousGear as number;
        const direction = (data.direction as 'up' | 'down') || (gear > previousGear ? 'up' : 'down');
        const totalGears = (data.totalGears as number) || 12;
        const shiftCount = (data.shiftCount as number) || 0;

        this.state.gear = gear;
        this.state.totalGears = totalGears;
        this.state.shiftCount = shiftCount;

        // Update store — this triggers GearEfficiencyEngine + ShiftMotorInhibit
        const store = useBikeStore.getState();
        store.setGear(gear);
        store.setShiftCount(shiftCount);
        store.setTotalGears(totalGears);
        // Brief shifting flag for motor inhibit
        store.setShifting(true);
        setTimeout(() => useBikeStore.getState().setShifting(false), 300);

        // Record shift event
        const shiftEvent: ShiftEvent = {
          gear_from: previousGear,
          gear_to: gear,
          direction,
          timestamp: Date.now(),
        };
        this.shiftHistory.push(shiftEvent);

        // Notify callbacks
        this.onShiftStartCbs.forEach((cb) => cb(shiftEvent));
        this.onGearChangedCbs.forEach((cb) => cb(gear));

        console.log(`[Di2] Gear: ${previousGear} → ${gear} (${direction}) total shifts: ${shiftCount}`);
        break;
      }

      case 'shimanoComponents': {
        const comps = data.components as ShimanoComponent[];
        if (Array.isArray(comps)) {
          this.state.components = comps;
        }
        break;
      }

      case 'shimanoGearStats': {
        // Stats response from APK — forward to any listeners
        console.log('[Di2] Gear stats:', data);
        break;
      }

      case 'shimanoPce': {
        // Raw PCE response — log for debugging
        console.log(`[Di2] PCE: ${data.hex}`);
        break;
      }

      case 'shimanoRealtime': {
        // Real-time notification data
        console.log(`[Di2] RT: ${data.hex}`);
        break;
      }

      case 'shimanoError': {
        console.warn(`[Di2] Error: ${data.error}`);
        break;
      }

      case 'shimanoFound': {
        console.log(`[Di2] Found: ${data.name} (${data.address}) RSSI=${data.rssi}`);
        break;
      }
    }
  }

  // ═══════════════════════════════════════
  // CALLBACKS
  // ═══════════════════════════════════════

  onShiftStart(cb: ShiftStartCallback): void { this.onShiftStartCbs.push(cb); }
  onGearChanged(cb: GearChangedCallback): void { this.onGearChangedCbs.push(cb); }
  onBattery(cb: BatteryCallback): void { this.onBatteryCbs.push(cb); }

  // ═══════════════════════════════════════
  // GETTERS
  // ═══════════════════════════════════════

  getCurrentGear(): number { return this.state.gear; }
  getTotalGears(): number { return this.state.totalGears; }
  getBattery(): number { return this.state.battery; }
  getShiftCount(): number { return this.state.shiftCount; }
  getShiftHistory(): ShiftEvent[] { return [...this.shiftHistory]; }
  isConnected(): boolean { return this.state.connected; }
  isShifting(): boolean { return false; } // Shimano wireless shifts are instant
  getState(): ShimanoState { return { ...this.state }; }

  /**
   * Get gear usage statistics for ride summary.
   * Returns: { gearNumber: durationMs } + shift count + history
   */
  getRideGearStats(): { shiftCount: number; shiftHistory: ShiftEvent[]; gearUsageMs: Record<number, number> } {
    const gearUsageMs: Record<number, number> = {};

    if (this.shiftHistory.length >= 1) {
      for (let i = 0; i < this.shiftHistory.length; i++) {
        const event = this.shiftHistory[i]!;
        const nextTime = i < this.shiftHistory.length - 1
          ? this.shiftHistory[i + 1]!.timestamp
          : Date.now();
        const duration = nextTime - event.timestamp;
        const gear = event.gear_to;
        gearUsageMs[gear] = (gearUsageMs[gear] || 0) + duration;
      }
    }

    return {
      shiftCount: this.shiftHistory.length,
      shiftHistory: [...this.shiftHistory],
      gearUsageMs,
    };
  }
}

export const di2Service = Di2Service.getInstance();
