/**
 * Motor tuning model — 5 independent ASMO parameters.
 *
 * Based on decompiled Giant RideControl APK v1.33 (TuningData.java).
 * Each ASMO parameter has 3 possible values (wire 0, 1, 2).
 * Wire value = table index. Value sent on wire = index + 1.
 *
 * DU7 (SyncDrive Pro) tables:
 *   ASMO1 Support %:  [360, 350, 300]
 *   ASMO2 Torque:     [300, 250, 200]
 *   ASMO3 Mid torque: [250, 200, 175]
 *   ASMO4 Low torque: [175, 150, 125]
 *   ASMO5 Launch:     [100, 75, 50]
 *
 * SET_TUNING encoding (cmd 0x2D, key 3):
 *   byte[2] = (ASMO1_wire+1) | ((ASMO2_wire+1) << 4)
 *   byte[3] = (ASMO3_wire+1) | ((ASMO4_wire+1) << 4)
 *   byte[4] = (ASMO5_wire+1)
 *
 * 3^5 = 243 possible combinations.
 */

/** Wire value: 0 = max, 1 = mid, 2 = min */
export type AsmoWire = 0 | 1 | 2;

/** The 5 independent motor calibration parameters */
export interface AsmoCalibration {
  support: AsmoWire;    // ASMO1: Support % (how much the motor multiplies rider input)
  torque: AsmoWire;     // ASMO2: Main torque (high-range Nm)
  midTorque: AsmoWire;  // ASMO3: Mid-range torque
  lowTorque: AsmoWire;  // ASMO4: Low-range torque
  launch: AsmoWire;     // ASMO5: Launch responsiveness
}

/** DU type tables — maps wire value to actual motor parameter */
export interface DUTables {
  support: [number, number, number];     // ASMO1
  torque: [number, number, number];      // ASMO2
  midTorque: [number, number, number];   // ASMO3
  lowTorque: [number, number, number];   // ASMO4
  launch: [number, number, number];      // ASMO5
}

/** DU7 = SyncDrive Pro (Giant Trance X E+ 2023) */
export const DU7_TABLES: DUTables = {
  support:   [360, 350, 300],
  torque:    [300, 250, 200],
  midTorque: [250, 200, 175],
  lowTorque: [175, 150, 125],
  launch:    [100, 75, 50],
};

/** Human-readable names */
export const ASMO_LABELS: Record<keyof AsmoCalibration, string> = {
  support: 'Support %',
  torque: 'Torque',
  midTorque: 'Mid Torque',
  lowTorque: 'Low Torque',
  launch: 'Launch',
};

/** Get actual values from wire calibration */
export function resolveCalibration(cal: AsmoCalibration, tables: DUTables = DU7_TABLES) {
  return {
    support: tables.support[cal.support],
    torque: tables.torque[cal.torque],
    midTorque: tables.midTorque[cal.midTorque],
    lowTorque: tables.lowTorque[cal.lowTorque],
    launch: tables.launch[cal.launch],
  };
}

/** Encode calibration to 3 bytes for SET_TUNING */
export function encodeCalibration(cal: AsmoCalibration): [number, number, number] {
  return [
    (cal.support + 1) | ((cal.torque + 1) << 4),
    (cal.midTorque + 1) | ((cal.lowTorque + 1) << 4),
    cal.launch + 1,
  ];
}

/** Decode 3 bytes from READ_TUNING to calibration */
export function decodeCalibration(b0: number, b1: number, b2: number): AsmoCalibration {
  return {
    support: ((b0 & 0x0F) - 1) as AsmoWire,
    torque: (((b0 >> 4) & 0x0F) - 1) as AsmoWire,
    midTorque: ((b1 & 0x0F) - 1) as AsmoWire,
    lowTorque: (((b1 >> 4) & 0x0F) - 1) as AsmoWire,
    launch: (b2 - 1) as AsmoWire,
  };
}

/** Default factory calibration (from READ_TUNING: 33 22 02) */
export const FACTORY_CALIBRATION: AsmoCalibration = {
  support: 2,    // 300%
  torque: 2,     // 200
  midTorque: 1,  // 200
  lowTorque: 1,  // 150
  launch: 1,     // 75
};

/** All max */
export const MAX_CALIBRATION: AsmoCalibration = {
  support: 0, torque: 0, midTorque: 0, lowTorque: 0, launch: 0,
};

/** All min */
export const MIN_CALIBRATION: AsmoCalibration = {
  support: 2, torque: 2, midTorque: 2, lowTorque: 2, launch: 2,
};
