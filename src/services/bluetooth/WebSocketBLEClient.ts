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
import { calculateZones } from '../../types/athlete.types';
import { batteryEstimationService } from '../battery/BatteryEstimationService';
import { calibrateFromMotorRanges } from '../battery/ConsumptionCalibration';
import { recordBikeData, recordBatteryInfo, recordDeviceInfo, resetBikeProfile, recordMotorOdoHours, recordBatteryCapacity, recordMotorAvgCurrent, recordModeUsage, recordServiceStats } from '../sync/BikeProfileSync';
import { di2Service } from '../di2/Di2Service';

// Use 127.0.0.1 instead of localhost — Chrome Android blocks ws://localhost on HTTPS pages
const WS_URL = 'ws://127.0.0.1:8765';
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

export class WebSocketBLEClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _bridgeAvailable = false;
  private _bikeConnected = false;
  private _bridgeVersion = '';

  /** Minimum required bridge version for correct data */
  static readonly REQUIRED_VERSION = '0.9.6';

  // Scan event listeners
  private scanListeners: ScanListener[] = [];
  private scanDoneListeners: ScanDoneListener[] = [];

  // Periodic range polling
  private rangePollingTimer: ReturnType<typeof setInterval> | null = null;
  private static RANGE_POLL_MS = 2 * 60 * 1000; // Every 2 minutes

  /** Try to connect to the BLE Bridge middleware */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    // Clean up any existing connection attempt
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WSClient] Connected to BLE Bridge');
        this._connected = true;
        this._bridgeAvailable = true;
        this.stopReconnect();
        // Register beforeunload to auto-restore on page close/crash
        window.addEventListener('beforeunload', this.handleBeforeUnload);
        // Inject send function into Di2Service for Shimano commands
        di2Service.setSendFunction((msg: string) => this.ws?.send(msg));
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
        // Bridge not running is expected — reconnect silently
        this._connected = false;
        this.startReconnect();
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

  /** Bridge app version (e.g., "0.9.6") — empty if not yet received */
  get bridgeVersion(): string {
    return this._bridgeVersion;
  }

  /** Whether bridge version meets minimum requirement */
  get isBridgeOutdated(): boolean {
    if (!this._bridgeVersion) return false; // unknown = don't nag
    return compareVersions(this._bridgeVersion, WebSocketBLEClient.REQUIRED_VERSION) < 0;
  }

  /** Send a command to the bridge */
  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(data));
  }

  /** Send log message back to bridge (appears in APK logcat) */
  sendLog(msg: string): void {
    this.send({ type: 'pwaLog', msg });
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

  // === Range polling (periodic cmd 17 to get updated ranges during ride) ===

  private startRangePolling(): void {
    this.stopRangePolling();
    this.rangePollingTimer = setInterval(() => {
      if (this._bikeConnected) {
        this.send({ type: 'readBattery' });
      }
    }, WebSocketBLEClient.RANGE_POLL_MS);
  }

  private stopRangePolling(): void {
    if (this.rangePollingTimer) {
      clearInterval(this.rangePollingTimer);
      this.rangePollingTimer = null;
    }
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
        case 'bridgeInfo':
          this._bridgeVersion = (msg.version as string) || '';
          console.log(`[WSClient] Bridge v${this._bridgeVersion}`);
          if (this.isBridgeOutdated) {
            console.warn(`[WSClient] Bridge outdated! v${this._bridgeVersion} < required v${WebSocketBLEClient.REQUIRED_VERSION}`);
          }
          break;

        case 'connected':
          this._bikeConnected = true;
          store.setBLEStatus('connected');
          console.log('[WSClient] Bike connected:', msg.device, 'bonded:', msg.bonded);
          // Auto-read tuning on connect
          setTimeout(() => this.readTuning(), 1000);
          // Read battery details + range AFTER GEV session (needs ~4s to be active)
          setTimeout(() => this.send({ type: 'readBattery' }), 5000);
          // Start periodic range polling (every 2 minutes)
          this.startRangePolling();
          break;

        case 'disconnected':
          // Auto-restore original tuning before marking disconnected
          this.autoRestore();
          this._bikeConnected = false;
          store.setBLEStatus('disconnected');
          useTuningStore.getState().reset();
          resetBikeProfile();
          this.stopRangePolling();
          break;

        case 'battery':
          // BLE Battery Service (0x180F) — gateway battery, not motor SOC
          // Only use if we haven't received sgBattery/sgBatteryHealth yet
          if (store.battery_main_pct === 0 && store.battery_sub_pct === 0) {
            store.setBatteryPercent(msg.value);
          }
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
          // BLE Power Service (0x1818) — ignore on Giant e-bikes (no real power meter,
          // reports garbage data). Motor power comes from sgRiding (FC23 cmd 0x40) instead.
          if (!this._bikeConnected) {
            // Only use 0x1818 power from standalone power meter sensors (not bike)
            store.setPower(msg.value);
            batteryEstimationService.addSample(store.speed_kmh, msg.value, store.battery_percent);
            store.setRange(batteryEstimationService.getEstimatedRange(store.battery_percent));
          }
          break;

        case 'assistMode':
          store.setAssistMode(msg.value);
          break;

        case 'hr': {
          const bpm = msg.bpm as number;
          const hrMax = useSettingsStore.getState().riderProfile.hr_max;
          const zones = calculateZones(hrMax > 0 ? hrMax : 185);
          let zone = 0;
          for (let i = zones.length - 1; i >= 0; i--) {
            if (bpm >= zones[i]!.min_bpm) { zone = i + 1; break; }
          }
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
              // Sync to Supabase so other devices pick it up
              import('../sync/SettingsSyncService').then(({ scheduleSave }) => scheduleSave());
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

        case 'gevRiding': {
          // GEV cmd 0x38 encrypted riding data — power now correctly /10 in bridge
          const gevSpd = msg.speed as number || 0;
          const gevPwr = msg.power as number || 0;
          if (gevSpd > 0.5) store.setSpeed(gevSpd);
          // Only accept plausible motor power (SyncDrive Pro max ~600W)
          if (gevPwr > 0 && gevPwr <= 700) {
            store.setPower(Math.round(gevPwr));
            batteryEstimationService.addSample(gevSpd, gevPwr, store.battery_percent);
          }
          break;
        }

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
          store.setCrash(msg.magnitude as number);
          if ('vibrate' in navigator) {
            navigator.vibrate([500, 200, 500, 200, 500]);
          }
          break;

        case 'light':
          store.setLightLux(msg.lux as number);
          // Forward to AdaptiveBrightnessService for dynamic theme
          import('../sensors/AdaptiveBrightnessService').then(({ adaptiveBrightnessService }) => {
            adaptiveBrightnessService.updateLux(msg.lux);
          });
          break;

        case 'gyro':
          store.setGyro(msg.x as number, msg.y as number, msg.z as number);
          break;

        case 'magnetometer':
          store.setMagHeading(msg.heading as number);
          break;

        case 'deviceInfo':
          if (msg.firmware) store.setFirmwareVersion(msg.firmware);
          if (msg.hardware) store.setHardwareVersion(msg.hardware);
          if (msg.software) store.setSoftwareVersion(msg.software);
          break;

        // Shimano STEPS / Di2 messages — delegate to Di2Service
        case 'shimanoConnected':
        case 'shimanoStatus':
        case 'shimanoBattery':
        case 'shimanoGear':
        case 'shimanoComponents':
        case 'shimanoGearStats':
        case 'shimanoPce':
        case 'shimanoRealtime':
        case 'shimanoError':
        case 'shimanoFound':
          di2Service.handleMessage(msg);
          break;

        case 'shimanoBleLog':
          // Comprehensive BLE log from ShimanoProtocol — capture for analysis
          console.log(`[SHIMANO_BLE] ${msg.event}: ${msg.detail}${msg.hex ? ` | ${msg.hex} (${msg.bytes}B)` : ''}`);
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

        case 'sgRiding': {
          // FC23 cmd 0x40 — full ride telemetry (from resolveTd23Data decompilation)
          const spd = msg.speed as number || 0;
          const rawPwr = msg.powerW as number || msg.motorWatts as number || 0;
          const trq = msg.torqueNm as number || 0;
          const cad = msg.cadenceRpm as number || 0;
          const cur = msg.assistCurrentA as number || 0;
          const tDist = msg.tripDistKm as number || msg.odo as number || 0;
          const tTime = msg.tripTimeSec as number || 0;

          // Motor power: SyncDrive Pro max ~600W peak.
          // Bridge sends /10 scaled values. Reject implausible values (>700W = stale bug).
          const motorPwr = rawPwr > 0 && rawPwr <= 700 ? Math.round(rawPwr) : 0;

          // Rider power from torque × cadence: P = τ × ω = Nm × (RPM × 2π/60)
          const riderPwr = (trq > 0 && cad > 2) ? Math.round(trq * cad * 2 * Math.PI / 60) : 0;

          if (spd > 0.5) store.setSpeed(spd);
          if (motorPwr > 0 || riderPwr > 0) store.setPower(motorPwr > 0 ? motorPwr : riderPwr);
          if (cad > 0) store.setCadence(Math.round(cad));
          if (trq !== 0) store.setTorque(trq);
          if (cur > 0) store.setAssistCurrent(cur);
          if (tDist > 0) { store.setDistance(tDist); store.setTripDistance(tDist); }
          if (tTime > 0) store.setTripTime(tTime);
          if (tDist > 0) recordBikeData('total_odo_km', tDist);
          batteryEstimationService.addSample(spd, motorPwr, store.battery_percent);
          store.setRange(batteryEstimationService.getEstimatedRange(store.battery_percent));
          break;
        }

        case 'sgBattery':
          // Motor battery data (SOC + life %)
          store.setBatteryPercent(msg.soc);
          console.log(`[WSClient] Motor battery: SOC=${msg.soc}% life=${msg.life}%`);
          break;

        case 'rangePerMode': {
          // Range calculated by motor for each assist mode (in km)
          // GEV protocol uses uint8 per mode — bridge sends -1 for overflow (≥245)
          const raw = {
            eco: msg.eco as number, tour: msg.tour as number,
            active: msg.active as number, sport: msg.sport as number,
            power: msg.power as number, smart: msg.smart as number,
          };

          // First calibrate from valid (non-overflow) modes
          const validForCal = {
            eco: Math.max(raw.eco, 0), tour: Math.max(raw.tour, 0),
            active: Math.max(raw.active, 0), sport: Math.max(raw.sport, 0),
            power: Math.max(raw.power, 0),
          };
          if (validForCal.power > 0) calibrateFromMotorRanges(validForCal);

          // Resolve overflow modes — ECO/TOUR always overflow (>255km)
          // Use ratio to POWER range (avoids circular calibration bug)
          // Real data: ECO≈1.87×POWER, TOUR≈1.56×POWER (from RideControl)
          const estimated = new Set<string>();
          const resolved = { ...raw };
          const powerRange = raw.power > 0 ? raw.power : 166; // fallback

          const modes = ['eco', 'tour', 'active', 'sport', 'power', 'smart'] as const;
          type Mode = typeof modes[number];
          const overflowRatio: Partial<Record<Mode, number>> = {
            eco: 1.87,   // ECO ≈ 1.87× POWER range (311/166 from RideControl)
            tour: 1.56,  // TOUR ≈ 1.56× POWER range (259/166)
            smart: 1.69, // SMART(Auto) ≈ 1.69× POWER range (280/166)
          };
          for (const mode of modes) {
            if (resolved[mode as Mode] < 0) {
              const ratio = overflowRatio[mode];
              if (ratio && powerRange > 0) {
                resolved[mode as Mode] = Math.round(powerRange * ratio);
              } else {
                resolved[mode as Mode] = 0; // no estimate possible
              }
              estimated.add(mode);
            }
          }

          const rangeLog = `RNG: E=${resolved.eco}${estimated.has('eco') ? '~' : ''} T=${resolved.tour}${estimated.has('tour') ? '~' : ''} A=${resolved.active} S=${resolved.sport} P=${resolved.power} (raw:e${raw.eco},t${raw.tour})`;
          console.log(`[WSClient] ${rangeLog}`);
          this.sendLog(rangeLog);
          store.setRangePerMode(resolved, estimated);
          break;
        }

        case 'batteryInfo': {
          // Detailed battery info from GEV commands (cmd 13,14,19,55,56,57)
          const battery = msg.battery as string;
          const field = msg.field as string;
          if (field === 'level') {
            if (battery === 'main') store.setBatteryMain(msg.capacity as number);
            else if (battery === 'sub') store.setBatterySub(msg.capacity as number);
          }
          // Save to bike hardware profile
          recordBatteryInfo(msg);
          console.log(`[WSClient] Battery ${battery} ${field}:`, JSON.stringify(msg));
          break;
        }

        case 'sgBatteryIndividual': {
          // Individual battery SOC from GEV cmd 0x13 (main) or 0x37 (sub)
          const bat = msg.battery as string; // 'main' or 'sub'
          const socVal = msg.soc as number;
          const healthVal = msg.health as number;
          if (bat === 'main') {
            store.setBatteryMain(socVal);
            console.log(`[WSClient] Main battery: SOC=${socVal}% health=${healthVal}%`);
          } else if (bat === 'sub') {
            store.setBatterySub(socVal);
            console.log(`[WSClient] Sub battery: SOC=${socVal}% health=${healthVal}%`);
          }
          break;
        }

        case 'sgBatteryHealth': {
          // Dual battery from cmd 0x43 — REAL SOC source
          // bat1Health/bat2Health = battery health %, soc = combined charge %
          // No individual SOC available from protocol — only combined
          if (msg.soc !== undefined) store.setBatteryPercent(msg.soc);
          if (msg.bat1Health !== undefined) store.setBatteryMain(msg.bat1Health);
          if (msg.bat2Health !== undefined) store.setBatterySub(msg.bat2Health);
          // Legacy field names (old APK compat)
          if (msg.bat1Life !== undefined && msg.bat1Health === undefined) store.setBatteryMain(msg.bat1Life);
          if (msg.bat2Life !== undefined && msg.bat2Health === undefined) store.setBatterySub(msg.bat2Life);
          break;
        }

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
          // Wire codes map 1:1 to AssistMode enum (confirmed v0.9.2 by user)
          const GIANT_MODE_MAP: Record<number, number> = {
            0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6,
          };
          const wireMode = msg.wireMode ?? msg.assistLevel;
          if (wireMode !== undefined) {
            const mapped = GIANT_MODE_MAP[wireMode];
            if (mapped !== undefined) {
              store.setAssistMode(mapped);

              // uint16 remaining range from FC23 cmd 0x41 bytes[5-6]
              const currentRange = msg.currentRange as number | undefined;
              if (currentRange !== undefined && currentRange > 0 && currentRange < 65535) {
                const modeMap: Record<number, string> = { 1: 'eco', 2: 'tour', 3: 'active', 4: 'sport', 5: 'power', 6: 'smart' };
                const mk = modeMap[mapped] ?? 'power';
                const rpm = store.range_per_mode ?? { eco: 0, tour: 0, active: 0, sport: 0, power: 0, smart: 0 };
                const updated = { ...rpm, [mk]: currentRange };
                const estimated = new Set(store.range_estimated_modes);
                estimated.delete(mk);
                store.setRangePerMode(updated, estimated);
                this.sendLog(`MODE: wire=${wireMode}→${mk} range=${currentRange}km`);
              }
            }
          }
          break;
        }

        case 'fc23cmd42': {
          // eShift gear data from FC23 cmd 0x42
          const fg = msg.frontGear as number;
          const rg = msg.rearGear as number;
          if (fg > 0 || rg > 0) {
            store.setGears(fg, rg);
            store.setGear(rg); // compat with existing gear display
          }
          break;
        }

        case 'modeUsage':
          // Mode usage percentages from GEV cmd 6 → persist to bike_configs
          recordModeUsage(msg as Record<string, number>);
          console.log(`[WSClient] Mode usage: eco=${msg.eco}% tour=${msg.tour}% active=${msg.climb}% sport=${msg.climbPlus}% power=${msg.powerPlus}%`);
          this.sendLog(`USAGE: eco=${msg.eco}% tour=${msg.tour}% climb=${msg.climb}% power=${msg.powerPlus}%`);
          break;

        case 'motorAvgCurrent': {
          // Motor avg current per mode from GEV cmd 10 → persist to bike_configs
          const avgData = { boost: msg.boostAvgA as number, power: msg.powerAvgA as number, climb: msg.climbAvgA as number };
          recordMotorAvgCurrent(avgData);
          recordServiceStats(msg.serviceToolTimes as number, msg.lastServiceHour as number, msg.lastServiceKm as number);
          console.log(`[WSClient] Motor avg: boost=${msg.boostAvgA}A power=${msg.powerAvgA}A climb=${msg.climbAvgA}A svc=${msg.serviceToolTimes}`);
          this.sendLog(`AVGCUR: boost=${msg.boostAvgA}A power=${msg.powerAvgA}A climb=${msg.climbAvgA}A`);
          break;
        }

        case 'motorOdoHours':
          // Motor ODO + hours from GEV cmd 18 → persist to bike_configs
          store.setMotorOdo(msg.motorOdo as number, msg.totalHours as number);
          recordMotorOdoHours(msg.motorOdo as number, msg.totalHours as number);
          console.log(`[WSClient] Motor ODO=${msg.motorOdo}km hours=${msg.totalHours}h`);
          this.sendLog(`MOTOR: odo=${msg.motorOdo}km hours=${msg.totalHours}h`);
          break;

        case 'batteryCapacity':
          // Battery capacity details from GEV cmd 16 → persist to bike_configs
          recordBatteryCapacity(msg.epCapacity as number, msg.maxNotChargedDay as number, msg.notChargedCycles as number);
          console.log(`[WSClient] Bat capacity: ${msg.epCapacity}Ah notChgDays=${msg.maxNotChargedDay} notChgCycles=${msg.notChargedCycles}`);
          this.sendLog(`BATCAP: ${msg.epCapacity}Ah days=${msg.maxNotChargedDay} cycles=${msg.notChargedCycles}`);
          break;

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
          // Save to bike hardware profile
          if (msg.short && msg.ascii) recordDeviceInfo(msg.short as string, msg.ascii as string);
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

/** Compare semver strings: returns -1 if a < b, 0 if equal, 1 if a > b */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

export const wsClient = new WebSocketBLEClient();
