import type { PowerResult } from '../../types/bike.types';

/**
 * Parse Cycling Power Measurement - BLE 0x2A63
 *
 * Format (14 bytes):
 *   Bytes 0-1:  flags = 0x0050
 *   Bytes 2-3:  instantaneous power (int16 LE, watts)
 *   Bytes 4-7:  cumulative wheel revolutions (uint32 LE)
 *   Bytes 8-9:  last wheel event time (uint16 LE)
 *   Bytes 10-13: force magnitudes
 */
export function parsePower(data: DataView): PowerResult {
  const power_watts = data.getInt16(2, true);
  return { power_watts: Math.max(0, power_watts) };
}
