import type { CSCState, CSCResult } from '../../types/bike.types';
import { WHEEL_CIRCUMFERENCE_M } from '../../types/bike.types';

/**
 * Parse CSC Measurement (Cycling Speed and Cadence) - BLE 0x2A5B
 *
 * Format (11 bytes when both wheel + crank present):
 *   Byte 0:    flags (bit0 = wheel data, bit1 = crank data)
 *   Bytes 1-4: cumulative wheel revolutions (uint32 LE)
 *   Bytes 5-6: last wheel event time (uint16 LE, 1/1024 s)
 *   Bytes 7-8: cumulative crank revolutions (uint16 LE)
 *   Bytes 9-10: last crank event time (uint16 LE, 1/1024 s)
 */
export function parseCSC(data: DataView, prevState: CSCState): CSCResult {
  if (data.byteLength < 1) {
    return { speed_kmh: 0, cadence_rpm: 0, distance_km: prevState.distance_km };
  }

  const flags = data.getUint8(0);
  const hasWheel = (flags & 0x01) !== 0;
  const hasCrank = (flags & 0x02) !== 0;

  const expectedLen = 1 + (hasWheel ? 6 : 0) + (hasCrank ? 4 : 0);
  if (data.byteLength < expectedLen) {
    console.warn('[CSC] Short packet:', data.byteLength, 'expected', expectedLen);
    return { speed_kmh: 0, cadence_rpm: 0, distance_km: prevState.distance_km };
  }

  let offset = 1;
  let speed_kmh = 0;
  let cadence_rpm = 0;
  let distance_km = prevState.distance_km;

  if (hasWheel) {
    const wheelRevs = data.getUint32(offset, true);
    offset += 4;
    const wheelTime = data.getUint16(offset, true);
    offset += 2;

    if (prevState.wheelRevs > 0) {
      // Handle uint32 rollover
      const revDiff = (wheelRevs - prevState.wheelRevs + 0x100000000) % 0x100000000;
      // Handle uint16 rollover, convert to seconds (1/1024 s units)
      const timeDiff = ((wheelTime - prevState.wheelTime + 0x10000) % 0x10000) / 1024.0;

      if (timeDiff > 0 && revDiff > 0 && revDiff < 100) {
        const distanceM = revDiff * WHEEL_CIRCUMFERENCE_M;
        speed_kmh = (distanceM / timeDiff) * 3.6;
        distance_km += distanceM / 1000;
      } else if (timeDiff > 2) {
        speed_kmh = 0; // Stopped
      }
    }

    // Update state for next calculation
    prevState.wheelRevs = wheelRevs;
    prevState.wheelTime = wheelTime;
    prevState.distance_km = distance_km;
  }

  if (hasCrank) {
    const crankRevs = data.getUint16(offset, true);
    offset += 2;
    const crankTime = data.getUint16(offset, true);

    if (prevState.crankRevs > 0) {
      const revDiff = (crankRevs - prevState.crankRevs + 0x10000) % 0x10000;
      const timeDiff = ((crankTime - prevState.crankTime + 0x10000) % 0x10000) / 1024.0;

      if (timeDiff > 0 && revDiff > 0 && revDiff < 20) {
        cadence_rpm = Math.round((revDiff / timeDiff) * 60);
      } else if (timeDiff > 3) {
        cadence_rpm = 0;
      }
    }

    prevState.crankRevs = crankRevs;
    prevState.crankTime = crankTime;
  }

  return { speed_kmh, cadence_rpm, distance_km };
}

export function createInitialCSCState(): CSCState {
  return {
    wheelRevs: 0,
    wheelTime: 0,
    crankRevs: 0,
    crankTime: 0,
    distance_km: 0,
  };
}
