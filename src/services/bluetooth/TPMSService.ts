/**
 * TPMS Service — Tire Pressure Monitoring System
 *
 * Giant TPMS sensors are separate BLE devices (front and rear).
 * Each has its own service UUID, write and notify characteristics.
 * Pressure data is received via notifications in 0.1 PSI units.
 */

import { BLE_UUIDS } from '../../types/gev.types';
import { useBikeStore } from '../../store/bikeStore';

class TPMSService {
  private frontDevice: BluetoothDevice | null = null;
  private rearDevice: BluetoothDevice | null = null;

  /** Connect to the front TPMS sensor */
  async connectFront(): Promise<void> {
    try {
      this.frontDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_UUIDS.TPMS_FRONT_SERVICE] }],
      });

      const server = await this.frontDevice.gatt!.connect();
      const service = await server.getPrimaryService(BLE_UUIDS.TPMS_FRONT_SERVICE);
      const notifyChar = await service.getCharacteristic(BLE_UUIDS.TPMS_FRONT_NOTIFY);

      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        const pressureRaw = value.getUint16(0, true); // 0.1 PSI units
        const psi = pressureRaw / 10;
        useBikeStore.getState().setTPMSFront(psi);
      });

      console.log('[TPMS] Front sensor connected:', this.frontDevice.name);
    } catch (err) {
      console.warn('[TPMS] Front sensor connection failed:', err);
      throw err;
    }
  }

  /** Connect to the rear TPMS sensor */
  async connectRear(): Promise<void> {
    try {
      this.rearDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_UUIDS.TPMS_REAR_SERVICE] }],
      });

      const server = await this.rearDevice.gatt!.connect();
      const service = await server.getPrimaryService(BLE_UUIDS.TPMS_REAR_SERVICE);
      const notifyChar = await service.getCharacteristic(BLE_UUIDS.TPMS_REAR_NOTIFY);

      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        const pressureRaw = value.getUint16(0, true); // 0.1 PSI units
        const psi = pressureRaw / 10;
        useBikeStore.getState().setTPMSRear(psi);
      });

      console.log('[TPMS] Rear sensor connected:', this.rearDevice.name);
    } catch (err) {
      console.warn('[TPMS] Rear sensor connection failed:', err);
      throw err;
    }
  }

  disconnectFront(): void {
    if (this.frontDevice?.gatt?.connected) {
      this.frontDevice.gatt.disconnect();
    }
    this.frontDevice = null;
    useBikeStore.getState().setTPMSFront(0);
  }

  disconnectRear(): void {
    if (this.rearDevice?.gatt?.connected) {
      this.rearDevice.gatt.disconnect();
    }
    this.rearDevice = null;
    useBikeStore.getState().setTPMSRear(0);
  }

  isFrontConnected(): boolean {
    return this.frontDevice?.gatt?.connected ?? false;
  }

  isRearConnected(): boolean {
    return this.rearDevice?.gatt?.connected ?? false;
  }

  getFrontDeviceName(): string | null {
    return this.frontDevice?.name ?? null;
  }

  getRearDeviceName(): string | null {
    return this.rearDevice?.name ?? null;
  }
}

export const tpmsService = new TPMSService();

export function connectFrontTPMS(): Promise<void> {
  return tpmsService.connectFront();
}

export function connectRearTPMS(): Promise<void> {
  return tpmsService.connectRear();
}
