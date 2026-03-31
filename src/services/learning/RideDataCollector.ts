import type { AssistMode } from '../../types/bike.types';
import type { ClimbType } from '../torque/TorqueEngine';

export interface RideSnapshot {
  timestamp: number;
  speed_kmh: number;
  cadence_rpm: number;
  power_watts: number;
  battery_pct: number;
  assist_mode: AssistMode;
  torque_nm: number;
  support_pct: number;
  gear: number;
  hr_bpm: number;
  hr_zone: number;
  gradient_pct: number;
  elevation_m: number;
  climb_type: ClimbType;
  ride_duration_s: number;
  distance_km: number;
  was_overridden: boolean;
}

export interface RideSummary {
  id: string;
  snapshots: RideSnapshot[];
  duration_s: number;
  total_km: number;
  total_elevation_m: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  avg_power_w: number;
  max_power_w: number;
  avg_cadence: number;
  max_hr: number;
  avg_hr: number;
  battery_start: number;
  battery_end: number;
  override_rate: number;
  ftp_estimate: number;
  tss_score: number;
  override_events: RideSnapshot[];
  created_at: Date;
}

const DB_NAME = 'bikecontrol';
const DB_VERSION = 1;
const STORE_RIDES = 'rides';
class RideDataCollector {
  private static instance: RideDataCollector;
  private snapshots: RideSnapshot[] = [];
  private rideStartTime = 0;
  private batteryStart = 0;
  private recording = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private db: IDBDatabase | null = null;

  static getInstance(): RideDataCollector {
    if (!RideDataCollector.instance) {
      RideDataCollector.instance = new RideDataCollector();
    }
    return RideDataCollector.instance;
  }

  async initialize(): Promise<void> {
    this.db = await this.openDB();
  }

  startRecording(batteryPct: number): void {
    if (this.recording) return;
    this.recording = true;
    this.snapshots = [];
    this.rideStartTime = Date.now();
    this.batteryStart = batteryPct;
  }

  stopRecording(): void {
    this.recording = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRecording(): boolean {
    return this.recording;
  }

  /** Call every 5s from the main loop with current app state */
  captureSnapshot(snapshot: Omit<RideSnapshot, 'ride_duration_s'>): void {
    if (!this.recording) return;
    this.snapshots.push({
      ...snapshot,
      ride_duration_s: (Date.now() - this.rideStartTime) / 1000,
    });
  }

  /** Finalize ride: build summary, store in IndexedDB */
  async finalizeRide(batteryEnd: number): Promise<RideSummary | null> {
    this.stopRecording();
    if (this.snapshots.length < 5) return null; // Too short

    const summary = this.buildSummary(batteryEnd);
    await this.saveToDB(summary);
    this.snapshots = [];
    return summary;
  }

  private buildSummary(batteryEnd: number): RideSummary {
    const snaps = this.snapshots;
    const overrideSnaps = snaps.filter((s) => s.was_overridden);
    const hrSnaps = snaps.filter((s) => s.hr_bpm > 0);
    const powerSnaps = snaps.filter((s) => s.power_watts > 0);

    const maxHR = hrSnaps.length > 0 ? Math.max(...hrSnaps.map((s) => s.hr_bpm)) : 0;
    const avgHR = hrSnaps.length > 0
      ? Math.round(hrSnaps.reduce((sum, s) => sum + s.hr_bpm, 0) / hrSnaps.length)
      : 0;

    const avgPower = powerSnaps.length > 0
      ? Math.round(powerSnaps.reduce((sum, s) => sum + s.power_watts, 0) / powerSnaps.length)
      : 0;

    // FTP estimate: avg power in zone 4 sustained > 20min
    const z4Snaps = snaps.filter((s) => s.hr_zone === 4 && s.power_watts > 0 && s.ride_duration_s > 1200);
    const ftpEstimate = z4Snaps.length > 10
      ? Math.round(z4Snaps.reduce((sum, s) => sum + s.power_watts, 0) / z4Snaps.length * 0.95)
      : 0;

    // TSS (Training Stress Score)
    const durationH = (snaps[snaps.length - 1]?.ride_duration_s ?? 0) / 3600;
    const intensityFactor = ftpEstimate > 0 ? avgPower / ftpEstimate : 0.7;
    const tss = durationH * intensityFactor * intensityFactor * 100;

    // Elevation gain
    let elevGain = 0;
    for (let i = 1; i < snaps.length; i++) {
      const diff = snaps[i]!.elevation_m - snaps[i - 1]!.elevation_m;
      if (diff > 0) elevGain += diff;
    }

    return {
      id: crypto.randomUUID(),
      snapshots: snaps,
      duration_s: snaps[snaps.length - 1]?.ride_duration_s ?? 0,
      total_km: snaps[snaps.length - 1]?.distance_km ?? 0,
      total_elevation_m: Math.round(elevGain),
      avg_speed_kmh: Math.round(snaps.reduce((s, r) => s + r.speed_kmh, 0) / snaps.length * 10) / 10,
      max_speed_kmh: Math.max(...snaps.map((s) => s.speed_kmh)),
      avg_power_w: avgPower,
      max_power_w: Math.max(...powerSnaps.map((s) => s.power_watts), 0),
      avg_cadence: Math.round(snaps.reduce((s, r) => s + r.cadence_rpm, 0) / snaps.length),
      max_hr: maxHR,
      avg_hr: avgHR,
      battery_start: this.batteryStart,
      battery_end: batteryEnd,
      override_rate: snaps.length > 0 ? overrideSnaps.length / snaps.length : 0,
      ftp_estimate: ftpEstimate,
      tss_score: Math.round(tss),
      override_events: overrideSnaps,
      created_at: new Date(),
    };
  }

  async getRecentRides(limit: number = 10): Promise<RideSummary[]> {
    if (!this.db) return [];
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_RIDES, 'readonly');
      const store = tx.objectStore(STORE_RIDES);
      const request = store.getAll();
      request.onsuccess = () => {
        const rides = (request.result as RideSummary[])
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, limit);
        resolve(rides);
      };
      request.onerror = () => resolve([]);
    });
  }

  private async saveToDB(summary: RideSummary): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_RIDES, 'readwrite');
      const store = tx.objectStore(STORE_RIDES);
      // Store without raw snapshots to save space
      const toStore = { ...summary, snapshots: [] };
      const request = store.put(toStore, summary.id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_RIDES)) {
          db.createObjectStore(STORE_RIDES);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

export const rideDataCollector = RideDataCollector.getInstance();
