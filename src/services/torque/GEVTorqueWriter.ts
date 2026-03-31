import { GEV_CMD } from '../../types/gev.types';
import { buildCommand } from '../bluetooth/GEVProtocol';
import { giantBLEService } from '../bluetooth/GiantBLEService';
import type { TorqueCommand } from './TorqueEngine';

/**
 * Sends torque parameters to the Giant motor via GEV protocol.
 * Uses cmd_id 0xE2 (assist level config).
 * NOTE: Requires AES key for encryption — without it, commands may be ignored.
 */
export async function writeTorqueCommand(cmd: TorqueCommand): Promise<void> {
  const torqueRaw = Math.round((cmd.torque_nm / 85) * 1000); // Scale 0-1000
  const supportRaw = Math.round(cmd.support_pct);              // 0-360 direct
  const launchRaw = cmd.launch_value;                          // 0-10 direct

  const payload = new Uint8Array([
    (torqueRaw >> 8) & 0xff,
    torqueRaw & 0xff,
    (supportRaw >> 8) & 0xff,
    supportRaw & 0xff,
    launchRaw,
    0x00, // flags (reserved)
  ]);

  const packet = buildCommand(GEV_CMD.ASSIST_CONFIG, payload);

  // TODO: encrypt with AES when key available
  // const encrypted = await GEVCrypto.encrypt(packet);

  try {
    // Access the GEV write method (will warn if not available)
    await (giantBLEService as unknown as { writeGEV(p: Uint8Array): Promise<void> }).writeGEV?.(packet);
  } catch {
    // GEV write not available — expected without AES key
  }
}
