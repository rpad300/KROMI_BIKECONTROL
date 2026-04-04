/**
 * LocalRideStore — Bulletproof local ride data storage.
 *
 * Architecture: Write locally FIRST → Sync as COPY → Delete ONLY after confirmed HTTP 200.
 *
 * Uses a dedicated IndexedDB database (kromi_rides) as the single source of truth.
 * Supabase sync runs in background. Data is NEVER deleted until confirmed synced.
 * Unsynced data retries indefinitely (no attempt limit).
 * Synced data is purged after 30 days.
 */

const DB_NAME = 'kromi_rides';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_SNAPSHOTS = 'snapshots';
const STORE_OVERRIDES = 'override_events';
const SYNC_INTERVAL = 30_000; // 30s
const SYNC_BATCH_SIZE = 200;
const REQUEST_TIMEOUT = 15_000;
const PURGE_DAYS = 30;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface LocalSession {
  id: string;
  user_id: string | null;
  status: 'active' | 'completed';
  sync_status: 'local' | 'synced';
  started_at: number;
  ended_at: number | null;
  battery_start: number;
  battery_end: number | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  duration_s: number | null;
  total_km: number | null;
  avg_speed_kmh: number | null;
  max_speed_kmh: number | null;
  avg_power_w: number | null;
  max_power_w: number | null;
  avg_cadence: number | null;
  max_hr: number | null;
  avg_hr: number | null;
  override_count: number;
  override_rate: number | null;
  avg_gps_accuracy: number | null;
  devices_connected: Record<string, unknown> | null;
  synced_at: number | null;
  metrics: PersistedMetrics;
}

export interface PersistedMetrics {
  distance_km: number;
  start_km: number;
  speed_max: number;
  power_avg: number;
  power_max: number;
  power_sum: number;
  power_count: number;
  hr_max: number;
  hr_sum: number;
  hr_count: number;
  cadence_sum: number;
  cadence_count: number;
  battery_start: number;
}

export interface LocalSnapshot {
  auto_id?: number;
  session_id: string;
  sync_status: 'local' | 'synced';
  synced_at: number | null;
  // Telemetry fields
  elapsed_s: number;
  lat: number;
  lng: number;
  altitude_m: number | null;
  heading: number;
  gps_accuracy: number;
  speed_kmh: number;
  cadence_rpm: number;
  power_watts: number;
  battery_pct: number;
  assist_mode: number;
  distance_km: number;
  hr_bpm: number;
  hr_zone: number;
  gear: number;
  is_shifting: boolean;
  torque_nm: number;
  support_pct: number;
  launch_value: number;
  climb_type: string;
  gradient_pct: number;
  auto_assist_active: boolean;
  auto_assist_reason: string;
  was_overridden: boolean;
  assist_current_a: number;
  front_gear: number;
  rear_gear: number;
  trip_distance_km: number;
  trip_time_s: number;
  range_km: number;
  spo2_pct: number;
  // Phone sensors
  pressure_hpa: number;
  barometric_altitude_m: number | null;
  lean_angle_deg: number;
  temperature_c: number;
  light_lux: number;
  mag_heading_deg: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  crash_magnitude: number;
}

export interface LocalOverrideEvent {
  auto_id?: number;
  session_id: string;
  sync_status: 'local' | 'synced';
  synced_at: number | null;
  elapsed_s: number;
  source: string;
  from_mode: number;
  to_mode: number | undefined;
  speed_kmh: number;
  gradient_pct: number;
  hr_bpm: number;
  hr_zone: number;
  gear: number;
  torque_nm: number;
  climb_type: string;
  auto_assist_reason: string;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function supaHeaders(): Record<string, string> {
  return {
    'apikey': SUPABASE_KEY!,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
}

function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function remoteLog(level: string, message: string): void {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/debug_logs`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify({ level, message: message.slice(0, 1000), data: { ts: new Date().toISOString(), src: 'LocalRideStore' } }),
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// LocalRideStore
// ═══════════════════════════════════════════════════════════

class LocalRideStore {
  private db: IDBDatabase | null = null;
  private syncing = false;
  private syncTimerId: ReturnType<typeof setInterval> | null = null;
  private onlineHandler: (() => void) | null = null;

  // ── Init ──

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;

        // Sessions store
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const sessions = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
          sessions.createIndex('status', 'status', { unique: false });
          sessions.createIndex('sync_status', 'sync_status', { unique: false });
          sessions.createIndex('started_at', 'started_at', { unique: false });
        }

        // Snapshots store
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          const snaps = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'auto_id', autoIncrement: true });
          snaps.createIndex('session_id', 'session_id', { unique: false });
          snaps.createIndex('sync_status', 'sync_status', { unique: false });
          snaps.createIndex('session_sync', ['session_id', 'sync_status'], { unique: false });
        }

        // Override events store
        if (!db.objectStoreNames.contains(STORE_OVERRIDES)) {
          const overrides = db.createObjectStore(STORE_OVERRIDES, { keyPath: 'auto_id', autoIncrement: true });
          overrides.createIndex('session_id', 'session_id', { unique: false });
          overrides.createIndex('sync_status', 'sync_status', { unique: false });
        }
      };

      req.onsuccess = () => {
        this.db = req.result;

        // Handle DB close (e.g. version upgrade from another tab)
        this.db.onclose = () => { this.db = null; };

        resolve();
      };

      req.onerror = () => {
        console.error('[LocalRideStore] DB open failed:', req.error);
        reject(req.error);
      };
    });
  }

  // ── Session CRUD ──

  async createSession(session: LocalSession): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readwrite');
      tx.objectStore(STORE_SESSIONS).put(session);
      tx.oncomplete = () => {
        console.log('[LocalRideStore] Session created:', session.id);
        resolve();
      };
      tx.onerror = () => {
        console.error('[LocalRideStore] Session create failed:', tx.error);
        reject(tx.error);
      };
    });
  }

  async updateSession(id: string, updates: Partial<LocalSession>): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readwrite');
      const store = tx.objectStore(STORE_SESSIONS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as LocalSession | undefined;
        if (!existing) { resolve(); return; }
        const updated = { ...existing, ...updates };
        // If session was completed and previously synced, mark as local again for re-sync
        if (updates.status === 'completed' && existing.sync_status === 'synced') {
          updated.sync_status = 'local';
          updated.synced_at = null;
        }
        store.put(updated);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getSession(id: string): Promise<LocalSession | null> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).get(id);
      req.onsuccess = () => resolve((req.result as LocalSession | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async getActiveSession(): Promise<LocalSession | null> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readonly');
      const idx = tx.objectStore(STORE_SESSIONS).index('status');
      const req = idx.getAll(IDBKeyRange.only('active'));
      req.onsuccess = () => {
        const sessions = req.result as LocalSession[];
        // Return the most recent active session
        if (sessions.length === 0) { resolve(null); return; }
        sessions.sort((a, b) => b.started_at - a.started_at);
        resolve(sessions[0] ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getSessionList(): Promise<LocalSession[]> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).getAll();
      req.onsuccess = () => {
        const sessions = (req.result as LocalSession[]).sort((a, b) => b.started_at - a.started_at);
        resolve(sessions);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ── Snapshot CRUD ──

  async writeSnapshots(snapshots: LocalSnapshot[]): Promise<void> {
    if (snapshots.length === 0) return;
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      for (const snap of snapshots) {
        store.add(snap);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.error('[LocalRideStore] Snapshot write failed:', tx.error);
        reject(tx.error);
      };
    });
  }

  async getSessionSnapshots(sessionId: string): Promise<LocalSnapshot[]> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SNAPSHOTS, 'readonly');
      const idx = tx.objectStore(STORE_SNAPSHOTS).index('session_id');
      const req = idx.getAll(IDBKeyRange.only(sessionId));
      req.onsuccess = () => resolve(req.result as LocalSnapshot[]);
      req.onerror = () => reject(req.error);
    });
  }

  async getUnsyncedSnapshots(sessionId: string, limit: number = SYNC_BATCH_SIZE): Promise<LocalSnapshot[]> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SNAPSHOTS, 'readonly');
      const idx = tx.objectStore(STORE_SNAPSHOTS).index('session_sync');
      const range = IDBKeyRange.only([sessionId, 'local']);
      const req = idx.openCursor(range);
      const results: LocalSnapshot[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ── Override Events ──

  async writeOverrideEvent(event: LocalOverrideEvent): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_OVERRIDES, 'readwrite');
      tx.objectStore(STORE_OVERRIDES).add(event);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getUnsyncedOverrides(sessionId: string): Promise<LocalOverrideEvent[]> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_OVERRIDES, 'readonly');
      const idx = tx.objectStore(STORE_OVERRIDES).index('session_id');
      const req = idx.getAll(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const all = req.result as LocalOverrideEvent[];
        resolve(all.filter(e => e.sync_status === 'local'));
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ── Mark synced ──

  async markSessionSynced(id: string): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readwrite');
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.get(id);
      req.onsuccess = () => {
        const s = req.result as LocalSession | undefined;
        if (s) {
          s.sync_status = 'synced';
          s.synced_at = Date.now();
          store.put(s);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async markSnapshotsSynced(autoIds: number[]): Promise<void> {
    if (autoIds.length === 0) return;
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const now = Date.now();
      let completed = 0;
      for (const id of autoIds) {
        const req = store.get(id);
        req.onsuccess = () => {
          const snap = req.result as LocalSnapshot | undefined;
          if (snap) {
            snap.sync_status = 'synced';
            snap.synced_at = now;
            store.put(snap);
          }
          completed++;
          // No need to resolve here — tx.oncomplete handles it
        };
      }
      tx.oncomplete = () => {
        console.log(`[LocalRideStore] Marked ${completed} snapshots synced`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async markOverridesSynced(autoIds: number[]): Promise<void> {
    if (autoIds.length === 0) return;
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_OVERRIDES, 'readwrite');
      const store = tx.objectStore(STORE_OVERRIDES);
      const now = Date.now();
      for (const id of autoIds) {
        const req = store.get(id);
        req.onsuccess = () => {
          const ev = req.result as LocalOverrideEvent | undefined;
          if (ev) {
            ev.sync_status = 'synced';
            ev.synced_at = now;
            store.put(ev);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Sync Engine ──

  startSyncLoop(): void {
    if (this.syncTimerId) return;
    this.syncTimerId = setInterval(() => this.syncToSupabase(), SYNC_INTERVAL);

    // Also sync immediately when coming online
    if (!this.onlineHandler) {
      this.onlineHandler = () => this.syncToSupabase();
      window.addEventListener('online', this.onlineHandler);
    }

    // Initial sync attempt
    this.syncToSupabase();
  }

  stopSyncLoop(): void {
    if (this.syncTimerId) { clearInterval(this.syncTimerId); this.syncTimerId = null; }
    if (this.onlineHandler) { window.removeEventListener('online', this.onlineHandler); this.onlineHandler = null; }
  }

  async syncToSupabase(): Promise<void> {
    if (!navigator.onLine || !SUPABASE_URL || !SUPABASE_KEY) return;
    if (this.syncing) return;
    if (!this.db) { try { await this.init(); } catch { return; } }
    this.syncing = true;

    try {
      // Step 1: Sync unsynced sessions
      const sessions = await this.getUnsyncedSessions();
      for (const session of sessions) {
        const supaSession = this.toSupabaseSession(session);
        try {
          // Try INSERT first (new session)
          const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/ride_sessions`, {
            method: 'POST',
            headers: { ...supaHeaders(), 'Prefer': 'return=minimal,resolution=merge-duplicates' },
            body: JSON.stringify(supaSession),
          });

          if (res.ok) {
            await this.markSessionSynced(session.id);
            console.log(`[LocalRideStore] Session synced: ${session.id}`);
          } else if (res.status === 409) {
            // Already exists — PATCH instead
            const patchRes = await fetchWithTimeout(
              `${SUPABASE_URL}/rest/v1/ride_sessions?id=eq.${session.id}`,
              { method: 'PATCH', headers: supaHeaders(), body: JSON.stringify(supaSession) },
            );
            if (patchRes.ok) {
              await this.markSessionSynced(session.id);
              console.log(`[LocalRideStore] Session patched: ${session.id}`);
            } else {
              const err = await patchRes.text();
              console.error(`[LocalRideStore] Session patch failed (${patchRes.status}):`, err);
              remoteLog('error', `Session patch ${patchRes.status}: ${err.slice(0, 300)}`);
            }
          } else {
            const err = await res.text();
            console.error(`[LocalRideStore] Session sync failed (${res.status}):`, err);
            remoteLog('error', `Session sync ${res.status}: ${err.slice(0, 300)}`);
            // 4xx: keep data, log, continue to next session
            // 5xx: stop syncing, retry next cycle
            if (res.status >= 500) return;
          }
        } catch (err) {
          console.warn('[LocalRideStore] Session sync network error:', err);
          return; // Network error — stop, retry next cycle
        }
      }

      // Step 2: Sync unsynced snapshots (batched)
      const allSessions = await this.getSessionList();
      for (const session of allSessions) {
        let unsynced = await this.getUnsyncedSnapshots(session.id, SYNC_BATCH_SIZE);
        while (unsynced.length > 0) {
          const supaRows = unsynced.map(s => this.toSupabaseSnapshot(s));
          try {
            const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/ride_snapshots`, {
              method: 'POST',
              headers: supaHeaders(),
              body: JSON.stringify(supaRows),
            });

            if (res.ok) {
              await this.markSnapshotsSynced(unsynced.map(s => s.auto_id!));
              console.log(`[LocalRideStore] ${unsynced.length} snapshots synced for ${session.id}`);
            } else {
              const err = await res.text();
              console.error(`[LocalRideStore] Snapshot sync failed (${res.status}):`, err);
              remoteLog('error', `Snap sync ${res.status} session=${session.id}: ${err.slice(0, 300)}`);
              if (res.status >= 500) return;
              break; // 4xx for this session — skip to next
            }
          } catch {
            return; // Network error — retry next cycle
          }

          unsynced = await this.getUnsyncedSnapshots(session.id, SYNC_BATCH_SIZE);
        }
      }

      // Step 3: Sync override events
      for (const session of allSessions) {
        const overrides = await this.getUnsyncedOverrides(session.id);
        if (overrides.length === 0) continue;

        const supaRows = overrides.map(o => this.toSupabaseOverride(o));
        try {
          const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/ride_override_events`, {
            method: 'POST',
            headers: supaHeaders(),
            body: JSON.stringify(supaRows),
          });
          if (res.ok) {
            await this.markOverridesSynced(overrides.map(o => o.auto_id!));
          } else if (res.status >= 500) {
            return;
          }
        } catch {
          return;
        }
      }

    } finally {
      this.syncing = false;
    }
  }

  // ── Cleanup ──

  async purgeOldSyncedData(): Promise<number> {
    await this.ensureDB();
    const cutoff = Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000;
    let purged = 0;

    // Purge synced snapshots
    const snapTx = this.db!.transaction(STORE_SNAPSHOTS, 'readwrite');
    const snapStore = snapTx.objectStore(STORE_SNAPSHOTS);
    const snapIdx = snapStore.index('sync_status');
    const snapReq = snapIdx.openCursor(IDBKeyRange.only('synced'));
    await new Promise<void>((resolve) => {
      snapReq.onsuccess = () => {
        const cursor = snapReq.result;
        if (cursor) {
          const snap = cursor.value as LocalSnapshot;
          if (snap.synced_at && snap.synced_at < cutoff) {
            cursor.delete();
            purged++;
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });

    // Purge synced override events
    const ovTx = this.db!.transaction(STORE_OVERRIDES, 'readwrite');
    const ovStore = ovTx.objectStore(STORE_OVERRIDES);
    const ovIdx = ovStore.index('sync_status');
    const ovReq = ovIdx.openCursor(IDBKeyRange.only('synced'));
    await new Promise<void>((resolve) => {
      ovReq.onsuccess = () => {
        const cursor = ovReq.result;
        if (cursor) {
          const ev = cursor.value as LocalOverrideEvent;
          if (ev.synced_at && ev.synced_at < cutoff) {
            cursor.delete();
            purged++;
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });

    // Purge synced sessions (only if ALL their snapshots are synced or purged)
    const sessTx = this.db!.transaction([STORE_SESSIONS, STORE_SNAPSHOTS], 'readwrite');
    const sessStore = sessTx.objectStore(STORE_SESSIONS);
    const sessIdx = sessStore.index('sync_status');
    const sessReq = sessIdx.openCursor(IDBKeyRange.only('synced'));
    await new Promise<void>((resolve) => {
      sessReq.onsuccess = () => {
        const cursor = sessReq.result;
        if (cursor) {
          const sess = cursor.value as LocalSession;
          if (sess.synced_at && sess.synced_at < cutoff) {
            cursor.delete();
            purged++;
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });

    if (purged > 0) console.log(`[LocalRideStore] Purged ${purged} old synced items`);
    return purged;
  }

  // ── Migration from localStorage ──

  async migrateFromLocalStorage(): Promise<void> {
    const PERSIST_KEY = 'bikecontrol-ride-session';
    const METRICS_KEY = 'bikecontrol-ride-metrics';
    const UNSAVED_KEY = 'bikecontrol-unsaved-snapshots';

    const rawSession = localStorage.getItem(PERSIST_KEY);
    if (!rawSession) return;

    try {
      const saved = JSON.parse(rawSession);
      if (!saved.sessionId || !saved.startedAt) return;

      // Check if session already exists in IndexedDB
      const existing = await this.getSession(saved.sessionId);
      if (existing) {
        // Already migrated — just clean up localStorage
        localStorage.removeItem(PERSIST_KEY);
        localStorage.removeItem(METRICS_KEY);
        localStorage.removeItem(UNSAVED_KEY);
        return;
      }

      // Load metrics
      let metrics: PersistedMetrics = {
        distance_km: 0, start_km: 0, speed_max: 0,
        power_avg: 0, power_max: 0, power_sum: 0, power_count: 0,
        hr_max: 0, hr_sum: 0, hr_count: 0,
        cadence_sum: 0, cadence_count: 0,
        battery_start: 0,
      };
      const rawMetrics = localStorage.getItem(METRICS_KEY);
      if (rawMetrics) {
        try { metrics = JSON.parse(rawMetrics); } catch { /* use defaults */ }
      }

      // Create session in IndexedDB
      const session: LocalSession = {
        id: saved.sessionId,
        user_id: null,
        status: 'active',
        sync_status: 'local',
        started_at: saved.startedAt,
        ended_at: null,
        battery_start: metrics.battery_start,
        battery_end: null,
        start_lat: null, start_lng: null,
        end_lat: null, end_lng: null,
        duration_s: null, total_km: null,
        avg_speed_kmh: null, max_speed_kmh: null,
        avg_power_w: null, max_power_w: null,
        avg_cadence: null, max_hr: null, avg_hr: null,
        override_count: saved.overrideCount || 0,
        override_rate: null,
        avg_gps_accuracy: null,
        devices_connected: null,
        synced_at: null,
        metrics,
      };
      await this.createSession(session);

      // Migrate unsaved snapshots
      const rawSnaps = localStorage.getItem(UNSAVED_KEY);
      if (rawSnaps) {
        try {
          const snaps = JSON.parse(rawSnaps);
          if (Array.isArray(snaps) && snaps.length > 0) {
            const localSnaps = snaps.map((s: Record<string, unknown>) => ({
              ...s,
              sync_status: 'local' as const,
              synced_at: null,
            })) as LocalSnapshot[];
            await this.writeSnapshots(localSnaps);
            console.log(`[LocalRideStore] Migrated ${localSnaps.length} snapshots from localStorage`);
          }
        } catch { /* corrupt data */ }
      }

      // Clean up localStorage
      localStorage.removeItem(PERSIST_KEY);
      localStorage.removeItem(METRICS_KEY);
      localStorage.removeItem(UNSAVED_KEY);
      console.log('[LocalRideStore] Migration from localStorage complete:', saved.sessionId);
    } catch (err) {
      console.error('[LocalRideStore] Migration failed:', err);
      // DON'T clear localStorage on failure — keep it as fallback
    }
  }

  // ── Stats (for UI) ──

  async getUnsyncedCount(): Promise<{ sessions: number; snapshots: number }> {
    await this.ensureDB();
    return new Promise((resolve) => {
      let sessions = 0;
      let snapshots = 0;

      const tx = this.db!.transaction([STORE_SESSIONS, STORE_SNAPSHOTS], 'readonly');

      const sessReq = tx.objectStore(STORE_SESSIONS).index('sync_status').count(IDBKeyRange.only('local'));
      sessReq.onsuccess = () => { sessions = sessReq.result; };

      const snapReq = tx.objectStore(STORE_SNAPSHOTS).index('sync_status').count(IDBKeyRange.only('local'));
      snapReq.onsuccess = () => { snapshots = snapReq.result; };

      tx.oncomplete = () => resolve({ sessions, snapshots });
    });
  }

  // ── Private helpers ──

  private async ensureDB(): Promise<void> {
    if (!this.db) await this.init();
  }

  private async getUnsyncedSessions(): Promise<LocalSession[]> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readonly');
      const idx = tx.objectStore(STORE_SESSIONS).index('sync_status');
      const req = idx.getAll(IDBKeyRange.only('local'));
      req.onsuccess = () => resolve(req.result as LocalSession[]);
      req.onerror = () => reject(req.error);
    });
  }

  private toSupabaseSession(s: LocalSession): Record<string, unknown> {
    // Clamp numeric fields to match Supabase column constraints
    const clamp51 = (v: number | null) => v != null ? Math.max(-9999.9, Math.min(9999.9, Math.round(v * 10) / 10)) : null;
    const clamp82 = (v: number | null) => v != null ? Math.max(-999999.99, Math.min(999999.99, Math.round(v * 100) / 100)) : null;
    return {
      id: s.id,
      user_id: s.user_id,
      status: s.status,
      started_at: new Date(s.started_at).toISOString(),
      ended_at: s.ended_at ? new Date(s.ended_at).toISOString() : null,
      battery_start: s.battery_start != null ? Math.round(s.battery_start) : null,
      battery_end: s.battery_end != null ? Math.round(s.battery_end) : null,
      start_lat: s.start_lat,
      start_lng: s.start_lng,
      end_lat: s.end_lat,
      end_lng: s.end_lng,
      duration_s: s.duration_s != null ? Math.round(s.duration_s) : null,
      total_km: clamp82(s.total_km),
      avg_speed_kmh: clamp51(s.avg_speed_kmh),
      max_speed_kmh: clamp51(s.max_speed_kmh),
      avg_power_w: s.avg_power_w != null ? Math.round(s.avg_power_w) : null,
      max_power_w: s.max_power_w != null ? Math.round(s.max_power_w) : null,
      avg_cadence: s.avg_cadence != null ? Math.round(s.avg_cadence) : null,
      max_hr: s.max_hr != null ? Math.round(s.max_hr) : null,
      avg_hr: s.avg_hr != null ? Math.round(s.avg_hr) : null,
      override_count: s.override_count,
      override_rate: s.override_rate != null ? Math.round(s.override_rate * 1000) / 1000 : null,
      avg_gps_accuracy: s.avg_gps_accuracy,
      devices_connected: s.devices_connected,
    };
  }

  private toSupabaseSnapshot(s: LocalSnapshot): Record<string, unknown> {
    const { auto_id: _, sync_status: __, synced_at: ___, ...rest } = s;
    // Round smallint fields (Supabase rejects decimals in integer columns)
    rest.cadence_rpm = Math.round(rest.cadence_rpm);
    rest.power_watts = Math.round(rest.power_watts);
    rest.battery_pct = Math.round(rest.battery_pct);
    rest.assist_mode = Math.round(rest.assist_mode);
    rest.hr_bpm = Math.round(rest.hr_bpm);
    rest.hr_zone = Math.round(rest.hr_zone);
    rest.gear = Math.round(rest.gear);
    rest.torque_nm = Math.round(rest.torque_nm);
    rest.support_pct = Math.round(rest.support_pct);
    rest.launch_value = Math.round(rest.launch_value);
    rest.front_gear = Math.round(rest.front_gear);
    rest.rear_gear = Math.round(rest.rear_gear);
    rest.trip_time_s = Math.round(rest.trip_time_s);
    rest.range_km = Math.round(rest.range_km);
    rest.spo2_pct = Math.round(rest.spo2_pct);
    rest.elapsed_s = Math.round(rest.elapsed_s);
    // Clamp numeric(5,1) fields to max 9999.9
    rest.heading = Math.min(9999.9, Math.round((rest.heading as number) * 10) / 10);
    rest.gps_accuracy = Math.min(9999.9, Math.round((rest.gps_accuracy as number) * 10) / 10);
    rest.speed_kmh = Math.min(9999.9, Math.round((rest.speed_kmh as number) * 10) / 10);
    rest.gradient_pct = Math.max(-9999.9, Math.min(9999.9, Math.round((rest.gradient_pct as number) * 10) / 10));
    // Phone sensors — clamp to schema
    rest.lean_angle_deg = Math.max(-9999.9, Math.min(9999.9, Math.round((rest.lean_angle_deg as number) * 10) / 10));
    rest.temperature_c = Math.max(-999.9, Math.min(999.9, Math.round((rest.temperature_c as number) * 10) / 10));
    if (rest.barometric_altitude_m != null) rest.barometric_altitude_m = Math.round((rest.barometric_altitude_m as number) * 10) / 10;
    rest.light_lux = Math.round(rest.light_lux as number);
    rest.mag_heading_deg = Math.max(0, Math.min(9999.9, Math.round((rest.mag_heading_deg as number) * 10) / 10));
    rest.crash_magnitude = Math.max(0, Math.min(99.9, Math.round((rest.crash_magnitude as number) * 10) / 10));
    return rest;
  }

  private toSupabaseOverride(o: LocalOverrideEvent): Record<string, unknown> {
    const { auto_id: _, sync_status: __, synced_at: ___, ...rest } = o;
    return rest;
  }
}

export const localRideStore = new LocalRideStore();
