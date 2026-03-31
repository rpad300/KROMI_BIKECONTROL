import { AssistMode } from '../../types/bike.types';
import { useBikeStore } from '../../store/bikeStore';
import { di2Service } from './Di2Service';
import { giantBLEService } from '../bluetooth/GiantBLEService';

/**
 * Inhibits motor for 250ms during each gear shift.
 * Reduces to ECO (not OFF — OFF causes abrupt jerk).
 * Protects chain, eliminates chain drop, smooths shift.
 */
class ShiftMotorInhibit {
  private static instance: ShiftMotorInhibit;
  private savedMode: AssistMode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getInstance(): ShiftMotorInhibit {
    if (!ShiftMotorInhibit.instance) {
      ShiftMotorInhibit.instance = new ShiftMotorInhibit();
    }
    return ShiftMotorInhibit.instance;
  }

  initialize(): void {
    di2Service.onShiftStart(async () => {
      const currentMode = useBikeStore.getState().assist_mode;
      this.savedMode = currentMode;

      // Reduce to ECO during shift (not OFF — would cause jerk)
      if (currentMode !== AssistMode.ECO && currentMode !== AssistMode.OFF) {
        await giantBLEService.sendAssistMode(AssistMode.ECO);
        // Do NOT call notifyManualOverride — this is not a human override
      }

      // Safety: always resume after 400ms even without Di2 confirmation
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.resume(), 400);
    });

    di2Service.onGearChanged(async () => {
      await this.resume();
    });
  }

  private async resume(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.savedMode !== null) {
      await giantBLEService.sendAssistMode(this.savedMode);
      this.savedMode = null;
    }
  }
}

export const shiftMotorInhibit = ShiftMotorInhibit.getInstance();
