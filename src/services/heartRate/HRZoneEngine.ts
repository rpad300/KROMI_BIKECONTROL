export interface HRZone {
  zone: 1 | 2 | 3 | 4 | 5;
  name: string;
  min_pct: number;
  max_pct: number;
  motor_multiplier: number;
}

const HR_ZONES: HRZone[] = [
  { zone: 1, name: 'Recuperacao', min_pct: 0, max_pct: 60, motor_multiplier: 0.2 },
  { zone: 2, name: 'Base', min_pct: 60, max_pct: 70, motor_multiplier: 0.4 },
  { zone: 3, name: 'Aerobico', min_pct: 70, max_pct: 80, motor_multiplier: 0.7 },
  { zone: 4, name: 'Limiar', min_pct: 80, max_pct: 90, motor_multiplier: 1.0 },
  { zone: 5, name: 'Maximo', min_pct: 90, max_pct: 100, motor_multiplier: 1.2 },
];

export class HRZoneEngine {
  private hrMax: number;
  private hrTargetZone: number;
  private history: { value: number; timestamp: number }[] = [];
  private readonly SMOOTHING_WINDOW_S = 10;

  constructor(hrMax: number, targetZone: number = 3) {
    this.hrMax = hrMax;
    this.hrTargetZone = targetZone;
  }

  updateProfile(hrMax: number, targetZone: number): void {
    this.hrMax = hrMax;
    this.hrTargetZone = targetZone;
  }

  addReading(bpm: number): void {
    const now = Date.now();
    this.history.push({ value: bpm, timestamp: now });
    // Keep last 30s only
    this.history = this.history.filter((r) => now - r.timestamp < 30000);
  }

  /** Smoothed HR (average of last 10s) */
  getSmoothedHR(): number {
    const now = Date.now();
    const recent = this.history.filter((r) => now - r.timestamp < this.SMOOTHING_WINDOW_S * 1000);
    if (recent.length === 0) return 0;
    return Math.round(recent.reduce((sum, r) => sum + r.value, 0) / recent.length);
  }

  /** Current zone (1-5) */
  getCurrentZone(): HRZone {
    const hr = this.getSmoothedHR();
    const pct = this.hrMax > 0 ? (hr / this.hrMax) * 100 : 0;
    return HR_ZONES.find((z) => pct >= z.min_pct && pct < z.max_pct) ?? HR_ZONES[0]!;
  }

  /** % of HRmax */
  getHRPercent(): number {
    return this.hrMax > 0 ? (this.getSmoothedHR() / this.hrMax) * 100 : 0;
  }

  /** HR trend: rising, falling, stable */
  getTrend(): 'rising' | 'falling' | 'stable' {
    if (this.history.length < 4) return 'stable';
    const recent = this.history.slice(-4).map((r) => r.value);
    const diff = recent[recent.length - 1]! - recent[0]!;
    if (diff > 5) return 'rising';
    if (diff < -5) return 'falling';
    return 'stable';
  }

  /** BPM reserve until target zone limit. Positive = below target, negative = above */
  getHRReserve(): number {
    const targetZone = HR_ZONES[this.hrTargetZone - 1];
    if (!targetZone) return 0;
    const targetMaxBpm = this.hrMax * (targetZone.max_pct / 100);
    return targetMaxBpm - this.getSmoothedHR();
  }

  getZoneNames(): Record<number, string> {
    return Object.fromEntries(HR_ZONES.map((z) => [z.zone, z.name]));
  }
}

export function parseHeartRate(data: DataView): number {
  const flags = data.getUint8(0);
  const isUint16 = (flags & 0x01) !== 0;
  return isUint16 ? data.getUint16(1, true) : data.getUint8(1);
}
