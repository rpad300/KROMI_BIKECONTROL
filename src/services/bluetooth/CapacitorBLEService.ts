/**
 * Capacitor BLE Service — Native Android Bluetooth access.
 *
 * When running as a Capacitor Android app, this service replaces Web Bluetooth
 * with the @capacitor-community/bluetooth-le plugin. This enables:
 * - BLE bonding/pairing (required for Giant GEV/Proto services)
 * - Background BLE connections
 * - Access to proprietary services (F0BA3012, F0BA5201)
 * - Motor control (assist mode, torque)
 *
 * Falls back to Web Bluetooth when running in browser (PWA mode).
 */

import { BleClient, type BleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { BLE_UUIDS } from '../../types/gev.types';
import { useBikeStore } from '../../store/bikeStore';
import { parseCSC, createInitialCSCState } from './CSCParser';
import { parsePower } from './PowerParser';
import { parseGEVPacket } from './GEVProtocol';
import { batteryEstimationService } from '../battery/BatteryEstimationService';
import { encrypt } from './GEVCrypto';
import type { CSCState } from '../../types/bike.types';

// GEV command IDs for motor control
const GEV_CMD_ASSIST_CONFIG = 0xe2;
const GEV_START = 0xfc;
const GEV_DEVICE_SG = 0x21;

/** Check if running inside Capacitor native app */
export function isCapacitorNative(): boolean {
  return Capacitor.isNativePlatform();
}

class CapacitorBLEServiceImpl {
  private device: BleDevice | null = null;
  private cscState: CSCState = createInitialCSCState();
  private gevAvailable = false;
  private protoAvailable = false;

  /**
   * Initialize BLE — must be called once on app start.
   */
  async initialize(): Promise<void> {
    try {
      await BleClient.initialize({ androidNeverForLocation: false });
      console.log('[CapBLE] Initialized');
    } catch (err) {
      console.error('[CapBLE] Init failed:', err);
    }
  }

  /**
   * Scan and connect to the Giant Smart Gateway.
   * Uses native BLE which supports bonding for GEV/Proto access.
   */
  async connect(): Promise<void> {
    const store = useBikeStore.getState();
    store.setBLEStatus('connecting');

    try {
      // Request device with scan dialog
      this.device = await BleClient.requestDevice({
        namePrefix: 'GBHA',
        optionalServices: [
          BLE_UUIDS.BATTERY_SERVICE,
          BLE_UUIDS.CSC_SERVICE,
          BLE_UUIDS.POWER_SERVICE,
          BLE_UUIDS.GEV_SERVICE,
          BLE_UUIDS.PROTO_SERVICE,
        ],
      });

      console.log('[CapBLE] Device selected:', this.device.name, this.device.deviceId);

      // Connect with bonding support
      await BleClient.connect(this.device.deviceId, (deviceId) => {
        console.log('[CapBLE] Disconnected:', deviceId);
        useBikeStore.getState().setBLEStatus('disconnected');
      });

      // Create bond (this triggers Android pairing dialog if needed)
      try {
        await BleClient.createBond(this.device.deviceId);
        console.log('[CapBLE] Bonded successfully');
      } catch {
        console.warn('[CapBLE] Bonding not supported or already bonded');
      }

      store.setBLEStatus('connected');

      // Discover and subscribe to all services
      await this.subscribeAll();
    } catch (err) {
      console.error('[CapBLE] Connection failed:', err);
      store.setBLEStatus('disconnected');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        await BleClient.disconnect(this.device.deviceId);
      } catch { /* ignore */ }
      this.device = null;
    }
    this.gevAvailable = false;
    this.protoAvailable = false;
    this.cscState = createInitialCSCState();
    useBikeStore.getState().setBLEStatus('disconnected');
  }

  private async subscribeAll(): Promise<void> {
    if (!this.device) return;
    const id = this.device.deviceId;

    await Promise.allSettled([
      this.subscribeBattery(id),
      this.subscribeCSC(id),
      this.subscribePower(id),
      this.subscribeGEV(id),
      this.subscribeProto(id),
    ]);
  }

  // ── Battery ──────────────────────────────────
  private async subscribeBattery(deviceId: string): Promise<void> {
    try {
      // Read initial value
      const result = await BleClient.read(deviceId, BLE_UUIDS.BATTERY_SERVICE, BLE_UUIDS.BATTERY_LEVEL);
      const view = new DataView(result.buffer);
      useBikeStore.getState().setBatteryPercent(view.getUint8(0));

      // Subscribe to notifications
      await BleClient.startNotifications(deviceId, BLE_UUIDS.BATTERY_SERVICE, BLE_UUIDS.BATTERY_LEVEL, (value) => {
        const view = new DataView(value.buffer);
        useBikeStore.getState().setBatteryPercent(view.getUint8(0));
      });

      useBikeStore.getState().setServiceConnected('battery', true);
      console.log('[CapBLE] Battery subscribed');
    } catch (err) {
      console.warn('[CapBLE] Battery not available:', err);
    }
  }

  // ── CSC ──────────────────────────────────────
  private async subscribeCSC(deviceId: string): Promise<void> {
    try {
      await BleClient.startNotifications(deviceId, BLE_UUIDS.CSC_SERVICE, BLE_UUIDS.CSC_MEASUREMENT, (value) => {
        const view = new DataView(value.buffer);
        const result = parseCSC(view, this.cscState);
        const store = useBikeStore.getState();
        store.setSpeed(result.speed_kmh);
        store.setCadence(result.cadence_rpm);
        store.setDistance(result.distance_km);

        batteryEstimationService.addSample(result.speed_kmh, store.power_watts, store.battery_percent);
        store.setRange(batteryEstimationService.getEstimatedRange(store.battery_percent));
      });

      useBikeStore.getState().setServiceConnected('csc', true);
      console.log('[CapBLE] CSC subscribed');
    } catch (err) {
      console.warn('[CapBLE] CSC not available:', err);
    }
  }

  // ── Power ────────────────────────────────────
  private async subscribePower(deviceId: string): Promise<void> {
    try {
      await BleClient.startNotifications(deviceId, BLE_UUIDS.POWER_SERVICE, BLE_UUIDS.POWER_MEASUREMENT, (value) => {
        const view = new DataView(value.buffer);
        const result = parsePower(view);
        const store = useBikeStore.getState();
        store.setPower(result.power_watts);

        batteryEstimationService.addSample(store.speed_kmh, result.power_watts, store.battery_percent);
        store.setRange(batteryEstimationService.getEstimatedRange(store.battery_percent));
      });

      useBikeStore.getState().setServiceConnected('power', true);
      console.log('[CapBLE] Power subscribed');
    } catch (err) {
      console.warn('[CapBLE] Power not available:', err);
    }
  }

  // ── GEV (Legacy — with bonding, now accessible!) ─────
  private async subscribeGEV(deviceId: string): Promise<void> {
    try {
      await BleClient.startNotifications(deviceId, BLE_UUIDS.GEV_SERVICE, BLE_UUIDS.GEV_NOTIFY, (value) => {
        const parsed = parseGEVPacket(value);
        if (!parsed) return;

        const store = useBikeStore.getState();
        switch (parsed.type) {
          case 'assist':
            store.setAssistMode(parsed.assistMode);
            break;
          case 'battery':
            store.setBatteryPercent(parsed.percent);
            break;
          case 'riding':
            if (parsed.power > 0) store.setPower(parsed.power);
            break;
        }
      });

      this.gevAvailable = true;
      useBikeStore.getState().setServiceConnected('gev', true);
      console.log('[CapBLE] GEV service connected — motor control available!');
    } catch (err) {
      console.warn('[CapBLE] GEV not available:', err);
    }
  }

  // ── Proto (F0BA5201 — with bonding, now accessible!) ──
  private async subscribeProto(deviceId: string): Promise<void> {
    try {
      await BleClient.startNotifications(deviceId, BLE_UUIDS.PROTO_SERVICE, BLE_UUIDS.PROTO_NOTIFY, (value) => {
        const data = new Uint8Array(value.buffer);
        console.log('[CapBLE] Proto notify:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
        // TODO: parse protobuf response and update store
      });

      this.protoAvailable = true;
      console.log('[CapBLE] Protobuf service connected!');
    } catch (err) {
      console.warn('[CapBLE] Proto not available:', err);
    }
  }

  // ── Motor Control Commands ────────────────────

  /**
   * Change assist mode on the bike motor.
   * Only works with Capacitor native BLE (bonded connection).
   */
  async sendAssistMode(mode: number): Promise<boolean> {
    if (!this.device || !this.gevAvailable) return false;

    try {
      // Build GEV command packet
      const payload = new Uint8Array([mode & 0xff]);
      const packet = new Uint8Array(4 + payload.length + 2);
      packet[0] = GEV_START;
      packet[1] = GEV_DEVICE_SG;
      packet[2] = GEV_CMD_ASSIST_CONFIG;
      packet[3] = payload.length;
      packet.set(payload, 4);

      // Checksum
      let sum = 0;
      for (let i = 0; i < 4 + payload.length; i++) sum += packet[i]!;
      packet[4 + payload.length] = (sum >> 8) & 0xff;
      packet[5 + payload.length] = sum & 0xff;

      // Encrypt with AES key 4 (motor commands)
      const encrypted = await encrypt(packet, 4);

      // Write to GEV characteristic
      await BleClient.write(this.device.deviceId, BLE_UUIDS.GEV_SERVICE, BLE_UUIDS.GEV_NOTIFY, new DataView(encrypted.buffer));

      console.log('[CapBLE] Assist mode set to:', mode);
      return true;
    } catch (err) {
      console.error('[CapBLE] Assist mode write failed:', err);

      // Try unencrypted as fallback
      try {
        const payload = new Uint8Array([mode & 0xff]);
        const packet = new Uint8Array(4 + payload.length + 2);
        packet[0] = GEV_START;
        packet[1] = GEV_DEVICE_SG;
        packet[2] = GEV_CMD_ASSIST_CONFIG;
        packet[3] = payload.length;
        packet.set(payload, 4);
        let sum = 0;
        for (let i = 0; i < 4 + payload.length; i++) sum += packet[i]!;
        packet[4 + payload.length] = (sum >> 8) & 0xff;
        packet[5 + payload.length] = sum & 0xff;

        await BleClient.write(this.device.deviceId, BLE_UUIDS.GEV_SERVICE, BLE_UUIDS.GEV_NOTIFY, new DataView(packet.buffer));
        console.log('[CapBLE] Assist mode set (unencrypted):', mode);
        return true;
      } catch (err2) {
        console.error('[CapBLE] Unencrypted write also failed:', err2);
        return false;
      }
    }
  }

  isGEVAvailable(): boolean {
    return this.gevAvailable;
  }

  isProtoAvailable(): boolean {
    return this.protoAvailable;
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  getDeviceName(): string | null {
    return this.device?.name ?? null;
  }
}

export const capacitorBLEService = new CapacitorBLEServiceImpl();
