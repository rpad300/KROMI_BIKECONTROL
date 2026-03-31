/**
 * WebSocket BLE Client — connects to the BLE Bridge middleware app.
 *
 * The middleware Android app (BLE Bridge) runs a WebSocket server on localhost:8765.
 * This client connects to it and forwards BLE data to the Zustand stores.
 *
 * Protocol: JSON messages (see docs/GIANT_BLE_PROTOCOL.md)
 */

import { useBikeStore } from '../../store/bikeStore';
import { batteryEstimationService } from '../battery/BatteryEstimationService';

const WS_URL = 'ws://localhost:8765';
const RECONNECT_INTERVAL = 3000;

class WebSocketBLEClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _bridgeAvailable = false;

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
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = () => {
        console.log('[WSClient] Disconnected from BLE Bridge');
        this._connected = false;
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

  get isConnected(): boolean {
    return this._connected;
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

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      const store = useBikeStore.getState();

      switch (msg.type) {
        case 'connected':
          store.setBLEStatus('connected');
          console.log('[WSClient] Bike connected:', msg.device);
          break;

        case 'disconnected':
          store.setBLEStatus('disconnected');
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

        case 'hr':
          store.setHR(msg.bpm, msg.zone);
          break;

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

        case 'gevRaw':
        case 'protoRaw':
          // Raw data for debugging — logged but not processed here
          console.log(`[WSClient] ${msg.type}:`, msg.hex);
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
