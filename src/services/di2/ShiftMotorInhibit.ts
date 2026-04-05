import { AssistMode } from '../../types/bike.types';
import { useBikeStore } from '../../store/bikeStore';
import { di2Service } from './Di2Service';
import { sendAssistMode } from '../bluetooth/BLEBridge';

/**
 * Inhibits motor for 300ms during each gear shift.
 * Reduces to ECO (not OFF — OFF causes abrupt jerk).
 * Protects chain, eliminates chain drop, smooths shift.
 *
 * Uses BLEBridge.sendAssistMode() which works in both
 * WebSocket (APK) and Web Bluetooth modes.
 */
class ShiftMotorInhibit {
  private static instance: ShiftMotorInhibit;
  private savedMode: AssistMode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  static getInstance(): ShiftMotorInhibit {
    if (!ShiftMotorInhibit.instance) {
      ShiftMotorInhibit.instance = new ShiftMotorInhibit();
    }
    return ShiftMotorInhibit.instance;
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    di2Service.onShiftStart(async (event) => {
      const currentMode = useBikeStore.getState().assist_mode;
      this.savedMode = currentMode;

      console.log(`[ShiftInhibit] Shift ${event.direction}: mode ${currentMode} → ECO (inhibit)`);

      // Reduce to ECO during shift (not OFF — would cause jerk)
      if (currentMode !== AssistMode.ECO && currentMode !== AssistMode.OFF) {
        await sendAssistMode(AssistMode.ECO);
      }

      // Safety: always resume after 400ms even without Di2 confirmation
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.resume(), 400);
    });

    di2Service.onGearChanged(async (gear) => {
      console.log(`[ShiftInhibit] Gear confirmed: ${gear} — resuming motor`);
      await this.resume();
    });

    console.log('[ShiftInhibit] Initialized — listening for Di2 shift events');
  }

  private async resume(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.savedMode !== null) {
      console.log(`[ShiftInhibit] Resume mode: ${this.savedMode}`);
      await sendAssistMode(this.savedMode);
      this.savedMode = null;
    }
  }
}

export const shiftMotorInhibit = ShiftMotorInhibit.getInstance();
