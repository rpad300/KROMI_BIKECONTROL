import { describe, it, expect } from 'vitest';
import { parseCSC, createInitialCSCState } from '../CSCParser';
import { WHEEL_CIRCUMFERENCE_M } from '../../../types/bike.types';

/** Helper: build a DataView with wheel + crank data (flags = 0x03) */
function buildCSCDataView(
  wheelRevs: number,
  wheelTime: number,
  crankRevs: number,
  crankTime: number,
): DataView {
  const buf = new ArrayBuffer(11);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x03); // flags: wheel + crank present
  dv.setUint32(1, wheelRevs, true);
  dv.setUint16(5, wheelTime, true);
  dv.setUint16(7, crankRevs, true);
  dv.setUint16(9, crankTime, true);
  return dv;
}

/** Helper: build a DataView with wheel data only (flags = 0x01) */
function buildWheelOnly(wheelRevs: number, wheelTime: number): DataView {
  const buf = new ArrayBuffer(7);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x01);
  dv.setUint32(1, wheelRevs, true);
  dv.setUint16(5, wheelTime, true);
  return dv;
}

describe('CSCParser', () => {
  describe('createInitialCSCState', () => {
    it('returns zeroed state', () => {
      const state = createInitialCSCState();
      expect(state.wheelRevs).toBe(0);
      expect(state.wheelTime).toBe(0);
      expect(state.crankRevs).toBe(0);
      expect(state.crankTime).toBe(0);
      expect(state.distance_km).toBe(0);
    });
  });

  describe('parseCSC — first reading (no previous data)', () => {
    it('returns zero speed/cadence on first notification', () => {
      const state = createInitialCSCState();
      const dv = buildCSCDataView(100, 1024, 10, 512);
      const result = parseCSC(dv, state);

      // First reading: prevState.wheelRevs === 0, so no speed calc
      expect(result.speed_kmh).toBe(0);
      expect(result.cadence_rpm).toBe(0);
      expect(result.distance_km).toBe(0);
    });
  });

  describe('parseCSC — speed calculation', () => {
    it('calculates speed from wheel revolutions', () => {
      const state = createInitialCSCState();

      // First reading — seeds the state
      const dv1 = buildWheelOnly(1000, 1024);
      parseCSC(dv1, state);

      // Second reading: 10 revs in 1 second (1024 units = 1s)
      const dv2 = buildWheelOnly(1010, 2048);
      const result = parseCSC(dv2, state);

      // Expected: 10 revs * 2.290m = 22.9m in 1s = 82.44 km/h
      const expectedSpeed = (10 * WHEEL_CIRCUMFERENCE_M / 1.0) * 3.6;
      expect(result.speed_kmh).toBeCloseTo(expectedSpeed, 1);
    });

    it('accumulates distance', () => {
      const state = createInitialCSCState();

      const dv1 = buildWheelOnly(1000, 1024);
      parseCSC(dv1, state);

      const dv2 = buildWheelOnly(1010, 2048);
      const result = parseCSC(dv2, state);

      const expectedDist = (10 * WHEEL_CIRCUMFERENCE_M) / 1000;
      expect(result.distance_km).toBeCloseTo(expectedDist, 4);
    });

    it('returns zero speed when stopped (timeDiff > 2)', () => {
      const state = createInitialCSCState();

      const dv1 = buildWheelOnly(1000, 0);
      parseCSC(dv1, state);

      // Same wheel revs, 3 seconds later — stopped
      const dv2 = buildWheelOnly(1000, 3072); // 3 * 1024 = 3s
      const result = parseCSC(dv2, state);

      expect(result.speed_kmh).toBe(0);
    });

    it('rejects unrealistic rev deltas (>= 100)', () => {
      const state = createInitialCSCState();

      const dv1 = buildWheelOnly(1000, 1024);
      parseCSC(dv1, state);

      // 150 revs in 1 second — absurd, should be rejected
      const dv2 = buildWheelOnly(1150, 2048);
      const result = parseCSC(dv2, state);

      expect(result.speed_kmh).toBe(0);
    });
  });

  describe('parseCSC — cadence calculation', () => {
    it('calculates cadence from crank revolutions', () => {
      const state = createInitialCSCState();

      // First reading
      const dv1 = buildCSCDataView(1000, 1024, 50, 1024);
      parseCSC(dv1, state);

      // 1 crank rev in 1 second = 60 RPM
      const dv2 = buildCSCDataView(1010, 2048, 51, 2048);
      const result = parseCSC(dv2, state);

      expect(result.cadence_rpm).toBe(60);
    });

    it('calculates higher cadence correctly', () => {
      const state = createInitialCSCState();

      const dv1 = buildCSCDataView(1000, 1024, 50, 1024);
      parseCSC(dv1, state);

      // 2 crank revs in 1 second = 120 RPM
      const dv2 = buildCSCDataView(1010, 2048, 52, 2048);
      const result = parseCSC(dv2, state);

      expect(result.cadence_rpm).toBe(120);
    });
  });

  describe('parseCSC — uint16 wheel time rollover', () => {
    it('handles wheelTime wrapping around 0xFFFF', () => {
      const state = createInitialCSCState();

      // Seed with time near max uint16
      const dv1 = buildWheelOnly(1000, 65000);
      parseCSC(dv1, state);

      // Time wraps: 65000 → 560 (delta = 1096 units ≈ 1.07s)
      const dv2 = buildWheelOnly(1005, 560);
      const result = parseCSC(dv2, state);

      const timeDiff = ((560 - 65000 + 0x10000) % 0x10000) / 1024.0;
      const expectedSpeed = (5 * WHEEL_CIRCUMFERENCE_M / timeDiff) * 3.6;
      expect(result.speed_kmh).toBeCloseTo(expectedSpeed, 1);
    });
  });
});
