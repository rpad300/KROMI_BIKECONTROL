import { BLE_UUIDS } from '../../types/gev.types';
import { useBikeStore } from '../../store/bikeStore';

export interface ShiftEvent {
  gear_from: number;
  direction: 'up' | 'down';
  timestamp: number;
}

type ShiftStartCallback = (e: ShiftEvent) => void;
type GearChangedCallback = (gear: number) => void;

/**
 * Shimano Di2 BLE E-Tube Protocol.
 * Requires EW-WU111 junction box on the bike.
 * Tracks gear position, detects shift events.
 */
class Di2Service {
  private static instance: Di2Service;
  private device: BluetoothDevice | null = null;
  private currentGear = 6;
  private shifting = false;
  private onShiftStartCbs: ShiftStartCallback[] = [];
  private onGearChangedCbs: GearChangedCallback[] = [];

  static getInstance(): Di2Service {
    if (!Di2Service.instance) {
      Di2Service.instance = new Di2Service();
    }
    return Di2Service.instance;
  }

  async connect(): Promise<void> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'SHIMANO' },
          { namePrefix: 'DI2' },
        ],
        optionalServices: [BLE_UUIDS.DI2_SERVICE],
      });

      const server = await this.device.gatt!.connect();
      const service = await server.getPrimaryService(BLE_UUIDS.DI2_SERVICE);
      const char = await service.getCharacteristic(BLE_UUIDS.DI2_NOTIFY);

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const data = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        this.parseNotification(data);
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        useBikeStore.getState().setServiceConnected('di2', false);
        setTimeout(() => this.connect(), 3000);
      });

      useBikeStore.getState().setServiceConnected('di2', true);
    } catch (err) {
      console.log('[Di2] Not available — operating without gear data');
    }
  }

  private parseNotification(data: DataView): void {
    if (data.getUint8(0) !== 0x01) return; // Only gear change events

    const gear = data.getUint8(2);
    const direction = data.getUint8(3) === 0 ? 'up' as const : 'down' as const;
    const status = data.getUint8(4);

    if (status === 0x01) {
      // Shift starting → inhibit motor
      this.shifting = true;
      useBikeStore.getState().setShifting(true);
      this.onShiftStartCbs.forEach((cb) =>
        cb({ gear_from: this.currentGear, direction, timestamp: Date.now() })
      );
    } else {
      // Shift complete
      this.shifting = false;
      this.currentGear = gear;
      useBikeStore.getState().setGear(gear);
      this.onGearChangedCbs.forEach((cb) => cb(gear));
    }
  }

  onShiftStart(cb: ShiftStartCallback): void { this.onShiftStartCbs.push(cb); }
  onGearChanged(cb: GearChangedCallback): void { this.onGearChangedCbs.push(cb); }
  getCurrentGear(): number { return this.currentGear; }
  isShifting(): boolean { return this.shifting; }
}

export const di2Service = Di2Service.getInstance();
