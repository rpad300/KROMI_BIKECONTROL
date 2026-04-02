/**
 * WebSocket BLE Client — connects to the BLE Bridge middleware app.
 *
 * The middleware Android app (BLE Bridge) runs a WebSocket server on localhost:8765.
 * This client connects to it and forwards BLE data to the Zustand stores.
 *
 * Protocol: JSON messages (see docs/GIANT_BLE_PROTOCOL.md)
 */

import { useBikeStore } from '../../store/bikeStore';
import { useTuningStore, type TuningLevels } from '../../store/tuningStore';
import { useSettingsStore } from '../../store/settingsStore';
import { batteryEstimationService } from '../battery/BatteryEstimationService';

const WS_URL = 'ws://localhost:8765';
const RECONNECT_INTERVAL = 3000;

export interface ScanResultDevice {
  name: string;
  address: string;
  rssi: number;
  uuids: string;
  tags: string[];
}

type ScanListener = (device: ScanResultDevice) => void;
type ScanDoneListener = () => void;

class WebSocketBLEClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _bridgeAvailable = false;
  private _bikeConnected = false;

  // Scan event listeners
  private scanListeners: ScanListener[] = [];
  private scanDoneListeners: ScanDoneListener[] = [];

  /** Try to connect to the BLE Bridge middleware */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WSClient] Connected to BLE Bridge');
        this._connected = true;
        this._bridgeAvailable = true;
        this.stopReconnect();
        // Register beforeunload to auto-restore on page close/crash
        window.addEventListener('beforeunload', this.handleBeforeUnload);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = () => {
        console.log('[WSClient] Disconnected from BLE Bridge');
        this._connected = false;
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
        this.startReconnect();
      };

      this.ws.onerror = () => {
        // Silent — bridge not running is expected when using PWA without middleware
        this._connected = false;
      };
    } catch {
      this._connected = false;
    }
  }

  disconnect(): void {
    this.stopReconnect();
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  /** Whether WebSocket to bridge is open */
  get isConnected(): boolean {
    return this._connected;
  }

  /** Whether the bike is connected (via bridge) */
  get isBikeConnected(): boolean {
    return this._bikeConnected;
  }

  /** Whether the bridge has ever been detected in this session */
  get bridgeAvailable(): boolean {
    return this._bridgeAvailable;
  }

  /** Send a command to the bridge */
  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(data));
  }

  /** Request bike connection via bridge */
  connectBike(): void {
    this.send({ type: 'connect' });
  }

  /** Request bike disconnection via bridge */
  disconnectBike(): void {
    this.send({ type: 'disconnect' });
  }

  /** Send assist mode command via bridge */
  sendAssistMode(mode: number): void {
    this.send({ type: 'assistMode', value: mode });
  }

  /** Send assist up via bridge */
  sendAssistUp(): void {
    this.send({ type: 'assistUp' });
  }

  /** Send assist down via bridge */
  sendAssistDown(): void {
    this.send({ type: 'assistDown' });
  }

  /** Request protobuf data */
  requestProtoData(module: string): void {
    this.send({ type: 'protoGet', module });
  }

  // === Scan API (PWA-driven device picker) ===

  /** Start BLE scan — results come as scanResult messages */
  startScan(): void {
    this.send({ type: 'scan' });
  }

  /** Stop ongoing scan */
  stopScan(): void {
    this.send({ type: 'stopScan' });
  }

  /** Connect to a specific device by MAC address */
  connectToDevice(address: string): void {
    this.send({ type: 'connectDevice', address });
  }

  /** Register scan result listener — called per device found */
  onScanResult(listener: ScanListener): () => void {
    this.scanListeners.push(listener);
    return () => { this.scanListeners = this.scanListeners.filter((l) => l !== listener); };
  }

  /** Register scan done listener */
  onScanDone(listener: ScanDoneListener): () => void {
    this.scanDoneListeners.push(listener);
    return () => { this.scanDoneListeners = this.scanDoneListeners.filter((l) => l !== listener); };
  }

  // === Tuning API ===

  /** Read current tuning levels from motor */
  readTuning(): void {
    useTuningStore.getState().setStatus('reading');
    this.send({ type: 'readTuning' });
  }

  /** Write tuning levels to motor */
  setTuning(levels: TuningLevels): void {
    useTuningStore.getState().setStatus('writing');
    this.send({
      type: 'setTuning',
      power: levels.power,
      sport: levels.sport,
      active: levels.active,
      tour: levels.tour,
      eco: levels.eco,
    });
  }

  /** Set single mode's tuning level */
  setTuningMode(mode: string, level: number): void {
    const current = useTuningStore.getState().current;
    this.setTuning({ ...current, [mode]: level });
  }

  /** Preset: all modes to MAX (level 1 = max power) */
  tuneMax(): void {
    this.send({ type: 'tuneMax' });
  }

  /** Preset: all modes to MIN (level 3 = min power) */
  tuneMin(): void {
    this.send({ type: 'tuneMin' });
  }

  /** Restore original tuning saved on connect */
  tuneRestore(): void {
    const original = useTuningStore.getState().original;
    if (original) {
      this.setTuning(original);
    } else {
      this.send({ type: 'tuneRestore' });
    }
  }

  /** Auto-restore: called on disconnect/close to put motor back to original */
  private autoRestore(): void {
    const { original, hasRead } = useTuningStore.getState();
    if (hasRead && original) {
      console.log('[WSClient] Auto-restoring original tuning on disconnect');
      this.setTuning(original);
    }
  }

  /** beforeunload handler — restore tuning on page close/refresh */
  private handleBeforeUnload = (): void => {
    this.autoRestore();
  };

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      const store = useBikeStore.getState();

      switch (msg.type) {
        case 'connected':
          this._bikeConnected = true;
          store.setBLEStatus('connected');
          console.log('[WSClient] Bike connected:', msg.device, 'bonded:', msg.bonded);
          // Auto-read tuning on connect to capture original for restore
          setTimeout(() => this.readTuning(), 1000);
          break;

        case 'disconnected':
          // Auto-restore original tuning before marking disconnected
          this.autoRestore();
          this._bikeConnected = false;
          store.setBLEStatus('disconnected');
          useTuningStore.getState().reset();
          break;

        case 'battery':
          store.setBatteryPercent(msg.value);
          break;

        case 'speed':
          store.setSpeed(msg.value);
          batteryEstimationService.addSample(msg.value, store.power_watts, store.battery_percent);
          store.setRange(batteryEstimationService.getEstimatedRange(store.battery_percent));
          break;

        case 'distance':
          store.setDistance(msg.value);
          break;

        case 'cadence':
          store.setCadence(msg.value);
          break;

        case 'power':
          store.setPower(msg.value);
          batteryEstimationService.addSample(store.speed_kmh, msg.value, store.battery_percent);
          store.setRange(batteryEstimationService.getEstimatedRange(store.battery_percent));
          break;

        case 'assistMode':
          store.setAssistMode(msg.value);
          break;

        case 'hr': {
          // Calculate zone from athlete profile HRmax (not hardcoded)
          const bpm = msg.bpm as number;
          const hrMax = useSettingsStore.getState().riderProfile.hr_max;
          const pct = hrMax > 0 ? bpm / hrMax : 0;
          const zone = pct < 0.5 ? 0 : pct < 0.6 ? 1 : pct < 0.7 ? 2 : pct < 0.8 ? 3 : pct < 0.9 ? 4 : 5;
          store.setHR(bpm, zone);
          break;
        }

        case 'sensorConnected': {
          const sensorServiceMap: Record<string, string> = {
            hr: 'heartRate', di2: 'di2', sram: 'sram', power: 'power',
          };
          const serviceKey = sensorServiceMap[msg.sensor as string];
          if (serviceKey) {
            store.setServiceConnected(serviceKey as 'heartRate' | 'di2' | 'sram' | 'power', true);
            import('./BLEBridge').then(({ saveSensorDevice }) => {
              saveSensorDevice(msg.sensor, { name: msg.name || msg.sensor, address: msg.address });
              console.log(`[WSClient] ${msg.sensor} saved: ${msg.name} (${msg.address})`);
            });
          }
          break;
        }

        case 'sensorDisconnected': {
          const svcMap: Record<string, string> = {
            hr: 'heartRate', di2: 'di2', sram: 'sram', power: 'power',
          };
          const svcKey = svcMap[msg.sensor as string];
          if (svcKey) {
            store.setServiceConnected(svcKey as 'heartRate' | 'di2' | 'sram' | 'power', false);
            if (msg.sensor === 'hr') store.setHR(0, 0);
          }
          break;
        }

        case 'gear':
          store.setGear(msg.value);
          break;

        case 'gevBattery':
          store.setBatteryPercent(msg.percent);
          if (msg.voltage) store.setBatteryVoltage(msg.voltage);
          break;

        case 'gevRiding':
          if (msg.speed) store.setSpeed(msg.speed);
          if (msg.power) store.setPower(msg.power);
          break;

        case 'services': {
          const svc = msg.data || msg;
          if (svc.battery !== undefined) store.setServiceConnected('battery', svc.battery);
          if (svc.csc !== undefined) store.setServiceConnected('csc', svc.csc);
          if (svc.power !== undefined) store.setServiceConnected('power', svc.power);
          if (svc.gev !== undefined) store.setServiceConnected('gev', svc.gev);
          if (svc.hr !== undefined) store.setServiceConnected('heartRate', svc.hr);
          break;
        }

        case 'barometer':
          store.setBarometer(msg.pressure, msg.altitude);
          break;

        case 'accel':
          store.setLeanAngle(msg.lean);
          break;

        case 'temperature':
          store.setTemperature(msg.value);
          break;

        case 'crash':
          console.warn('[WSClient] CRASH DETECTED — magnitude:', msg.magnitude);
          if ('vibrate' in navigator) {
            navigator.vibrate([500, 200, 500, 200, 500]);
          }
          break;

        case 'light':
          // Forward to AdaptiveBrightnessService for dynamic theme
          import('../sensors/AdaptiveBrightnessService').then(({ adaptiveBrightnessService }) => {
            adaptiveBrightnessService.updateLux(msg.lux);
          });
          break;

        case 'deviceInfo':
          if (msg.firmware) store.setFirmwareVersion(msg.firmware);
          if (msg.hardware) store.setHardwareVersion(msg.hardware);
          if (msg.software) store.setSoftwareVersion(msg.software);
          break;

        case 'tpmsFront':
          store.setTPMSFront(msg.psi);
          break;

        case 'tpmsRear':
          store.setTPMSRear(msg.psi);
          break;

        case 'gevRaw':
        case 'protoRaw':
          console.log(`[WSClient] ${msg.type}:`, msg.hex);
          break;

        case 'sgRiding':
          // Parsed motor telemetry — speed, torque, power, cadence, assist%, distance, time
          if (msg.speed > 0.5) store.setSpeed(msg.speed);
          if (msg.power) store.setPower(Math.round(msg.power));
          if (msg.cadence) store.setCadence(Math.round(msg.cadence));
          if (msg.torque) store.setTorque?.(msg.torque);
          if (msg.tripDistance) store.setDistance(msg.tripDistance);
          batteryEstimationService.addSample(msg.speed || 0, msg.power || 0, store.battery_percent);
          store.setRange(batteryEstimationService.getEstimatedRange(store.battery_percent));
          break;

        case 'sgBattery':
          // Motor battery data (SOC + life %)
          store.setBatteryPercent(msg.soc);
          console.log(`[WSClient] Motor battery: SOC=${msg.soc}% life=${msg.life}%`);
          break;

        case 'sgBatteryHealth':
          // Dual battery health from cmd 0x43: bat1Life, bat2Life, soc
          if (msg.bat1Life !== undefined) store.setBatteryMain(msg.bat1Life);
          if (msg.bat2Life !== undefined) store.setBatterySub(msg.bat2Life);
          if (msg.soc !== undefined) store.setBatteryPercent(msg.soc);
          break;

        case 'sgMotorStatus':
          // Motor status with voltage
          console.log(`[WSClient] Motor: bat1=${msg.bat1} bat2=${msg.bat2} v=${msg.voltage}`);
          if (msg.voltage) store.setBatteryVoltage(msg.voltage);
          break;

        case 'sgConnected':
          console.log(`[WSClient] GEV session: ${msg.success ? 'ACTIVE' : 'FAILED'}`);
          break;

        case 'sgTuning': {
          console.log(`[WSClient] Tuning data: ${msg.hex}`);
          // Parse tuning levels — either from pre-parsed fields or from hex
          let levels: TuningLevels | null = null;

          if (msg.power !== undefined) {
            // Bridge sent parsed fields
            levels = { power: msg.power, sport: msg.sport, active: msg.active, tour: msg.tour, eco: msg.eco };
          } else if (msg.hex && typeof msg.hex === 'string' && msg.hex.length >= 10) {
            // Parse from hex: 2c03XXYYZZ...
            // byte[2] = (POWER_lv+1) | ((SPORT_lv+1) << 4)
            // byte[3] = (ACTIVE_lv+1) | ((TOUR_lv+1) << 4)
            // byte[4] = (ECO_lv+1)
            const b2 = parseInt(msg.hex.substring(4, 6), 16);
            const b3 = parseInt(msg.hex.substring(6, 8), 16);
            const b4 = parseInt(msg.hex.substring(8, 10), 16);
            if (!isNaN(b2) && !isNaN(b3) && !isNaN(b4)) {
              levels = {
                power: (b2 & 0x0F),
                sport: (b2 >> 4) & 0x0F,
                active: (b3 & 0x0F),
                tour: (b3 >> 4) & 0x0F,
                eco: (b4 & 0x0F),
              };
            }
          }

          if (levels) {
            console.log('[WSClient] Parsed tuning:', levels);
            const tuning = useTuningStore.getState();
            tuning.setCurrent(levels);
            if (!tuning.original) {
              tuning.setOriginal(levels);
              console.log('[WSClient] Saved original tuning for auto-restore:', levels);
            }
          }
          break;
        }

        case 'sgTuningSet':
          // SET_TUNING confirmation from bridge
          if (msg.success) {
            useTuningStore.getState().setStatus('success');
            console.log('[WSClient] Tuning SET confirmed');
          } else {
            useTuningStore.getState().setStatus('error');
            console.warn('[WSClient] Tuning SET failed');
          }
          break;

        case 'fc23cmd41': {
          // Motor/assist state from FC23 telemetry — byte[7] = Giant wire mode
          // Giant wire values → Our AssistMode enum
          // Giant wire values map 1:1 to our AssistMode enum
          // 6 = SMART ASSIST (startup default, not in UP/DOWN cycle)
          const GIANT_MODE_MAP: Record<number, number> = {
            0: 0,  // OFF
            1: 1,  // ECO
            2: 2,  // TOUR
            3: 3,  // ACTIVE
            4: 4,  // SPORT
            5: 5,  // POWER
            6: 6,  // SMART (startup)
          };
          const wireMode = msg.wireMode ?? msg.assistLevel;
          if (wireMode !== undefined) {
            const mapped = GIANT_MODE_MAP[wireMode];
            if (mapped !== undefined) {
              store.setAssistMode(mapped);
            }
          }
          break;
        }

        case 'sgResponse':
          console.log(`[WSClient] Response cmd=${msg.cmd} key=${msg.key}: ${msg.decrypted}`);
          break;

        case 'sgNotify':
          console.log('[WSClient] SG raw:', msg.hex);
          break;

        case 'charRead':
          // Device info from serial reads
          if (msg.short === '2A27') store.setHardwareVersion(msg.ascii);
          if (msg.short === '2A28') store.setSoftwareVersion(msg.ascii);
          if (msg.short === '2A26') store.setFirmwareVersion(msg.ascii);
          console.log(`[WSClient] Read [${msg.short}]: ${msg.ascii || msg.hex}`);
          break;

        case 'allServices':
          console.log('[WSClient] Full service map:', msg.data);
          break;

        // === Scan results (PWA-driven device picker) ===
        case 'scanResult': {
          const device: ScanResultDevice = {
            name: msg.name,
            address: msg.address,
            rssi: msg.rssi,
            uuids: msg.uuids ?? '',
            tags: msg.tags ?? [],
          };
          console.log(`[WSClient] Scan: ${device.name} (${device.address}) RSSI:${device.rssi} [${device.tags}]`);
          this.scanListeners.forEach((l) => l(device));
          break;
        }

        case 'scanDone':
          console.log('[WSClient] Scan complete');
          this.scanDoneListeners.forEach((l) => l());
          break;

        case 'connectFailed':
          console.warn('[WSClient] Connect failed:', msg.reason);
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  }

  private startReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(() => {
      if (!this._connected) {
        this.connect();
      }
    }, RECONNECT_INTERVAL);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const wsClient = new WebSocketBLEClient();
