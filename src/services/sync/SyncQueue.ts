/**
 * SyncQueue — offline-first data persistence with auto-sync to Supabase.
 *
 * Strategy:
 * 1. Try direct Supabase POST/PATCH when online (fastest path)
 * 2. On failure or offline → queue to IndexedDB (never lost)
 * 3. On reconnect → auto-flush all pending items
 * 4. 4xx errors → permanent failure (schema/FK issue, don't retry)
 * 5. 5xx/network errors → transient, keep retrying
 * 6. All requests have 15s timeout via AbortController
 */

const DB_NAME = 'kromi_sync';
const DB_VERSION = 2;
const STORE_QUEUE = 'sync_queue';
const REQUEST_TIMEOUT = 15_000; // 15s per request

import { supaFetch, SupaFetchError } from '../../lib/supaFetch';

interface QueueItem {
  id?: number;
  table: string;
  method: 'POST' | 'PATCH';
  path: string;
  data: Record<string, unknown>;
  status: 'pending' | 'synced' | 'failed';
  attempts: number;
  created_at: number;
  synced_at: number | null;
  error: string | null;
}

/** supaFetch with AbortController timeout */
function supaFetchWithTimeout(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs = REQUEST_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return supaFetch(path, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const SUPA_POST_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

class SyncQueue {
  private db: IDBDatabase | null = null;
  private flushing = false;
  private onlineHandler: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const store = db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('table', 'table', { unique: false });
        }
      };

      req.onsuccess = () => {
        this.db = req.result;

        if (!this.db.objectStoreNames.contains(STORE_QUEUE)) {
          this.db.close();
          this.db = null;
          const delReq = indexedDB.deleteDatabase(DB_NAME);
          delReq.onsuccess = () => { this.init().then(resolve).catch(reject); };
          delReq.onerror = () => reject(new Error('Failed to delete corrupt DB'));
          return;
        }

        if (!this.onlineHandler) {
          this.onlineHandler = () => this.flush();
          window.addEventListener('online', this.onlineHandler);
        }
        this.flush();
        resolve();
      };

      req.onerror = () => reject(req.error);
    });
  }

  /** Push data — direct Supabase when online, IndexedDB fallback when offline */
  async push(table: string, data: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST', path?: string): Promise<void> {
    const restPath = path ?? `/${table}`;

    if (navigator.onLine) {
      try {
        await supaFetchWithTimeout(`/rest/v1${restPath}`, {
          method,
          headers: SUPA_POST_HEADERS,
          body: JSON.stringify(data),
        });
        return;
      } catch (err) {
        if (err instanceof SupaFetchError) {
          // 4xx = permanent error (FK violation, schema issue) — still queue for visibility but log
          console.error(`[SyncQueue] ${method} ${restPath} failed (${err.status}):`, err.body);
          if (err.status >= 400 && err.status < 500) {
            this.remoteLog('error', `SyncQueue ${method} ${restPath} → ${err.status}: ${err.body.slice(0, 300)}`);
          }
        } else {
          console.warn('[SyncQueue] Direct send failed, queueing:', err);
        }
      }
    }

    // Fallback: queue to IndexedDB
    await this.queueToIDB({ table, method, path: restPath, data });
  }

  /** Push a batch of items */
  async pushBatch(table: string, items: Record<string, unknown>[]): Promise<void> {
    if (items.length === 0) return;

    if (navigator.onLine) {
      try {
        await supaFetchWithTimeout(`/rest/v1/${table}`, {
          method: 'POST',
          headers: SUPA_POST_HEADERS,
          body: JSON.stringify(items),
        });
        return;
      } catch (err) {
        if (err instanceof SupaFetchError) {
          console.error(`[SyncQueue] Batch /${table} failed (${err.status}):`, err.body);
        } else {
          console.warn('[SyncQueue] Direct batch failed, queueing:', err);
        }
      }
    }

    // Queue each item individually to IndexedDB
    for (const data of items) {
      await this.queueToIDB({ table, method: 'POST', path: `/${table}`, data });
    }
  }

  /** Queue a single item to IndexedDB */
  private async queueToIDB(item: { table: string; method: 'POST' | 'PATCH'; path: string; data: Record<string, unknown> }): Promise<void> {
    try {
      await this.init();
      await this.addToStore({
        ...item,
        status: 'pending',
        attempts: 0,
        created_at: Date.now(),
        synced_at: null,
        error: null,
      });
    } catch (err) {
      console.error('[SyncQueue] IndexedDB queue failed:', err);
    }
  }

  /** Flush all pending IndexedDB items to Supabase */
  async flush(): Promise<number> {
    if (this.flushing || !this.db || !navigator.onLine) return 0;
    this.flushing = true;

    let synced = 0;
    try {
      const pending = await this.getPending();
      if (pending.length === 0) { this.flushing = false; return 0; }

      // Group POST items by path for batch insert
      const groups = new Map<string, QueueItem[]>();
      for (const item of pending) {
        const key = `${item.method}:${item.path}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }

      for (const [, items] of groups) {
        const first = items[0]!;
        try {
          // Batch POST
          if (first.method === 'POST' && items.length > 1) {
            try {
              await supaFetchWithTimeout(`/rest/v1${first.path}`, {
                method: 'POST',
                headers: SUPA_POST_HEADERS,
                body: JSON.stringify(items.map((i) => i.data)),
              });
              for (const item of items) { await this.markSynced(item.id!); synced++; }
            } catch (err) {
              if (err instanceof SupaFetchError) {
                for (const item of items) { await this.markError(item.id!, err.body, err.status); }
              } else {
                for (const item of items) { await this.markError(item.id!, String(err), 0); }
              }
            }
          } else {
            // Single items
            for (const item of items) {
              try {
                await supaFetchWithTimeout(`/rest/v1${item.path}`, {
                  method: item.method,
                  headers: SUPA_POST_HEADERS,
                  body: JSON.stringify(item.data),
                });
                await this.markSynced(item.id!);
                synced++;
              } catch (err) {
                if (err instanceof SupaFetchError) {
                  await this.markError(item.id!, err.body, err.status);
                } else {
                  await this.markError(item.id!, String(err), 0);
                }
              }
            }
          }
        } catch (err) {
          console.warn('[SyncQueue] Flush group failed:', err);
        }
      }

      if (synced > 0) console.log(`[SyncQueue] Flushed ${synced}/${pending.length} items`);
    } finally {
      this.flushing = false;
    }

    return synced;
  }

  async getPendingCount(): Promise<number> {
    try {
      await this.init();
      const pending = await this.getPending();
      return pending.length;
    } catch {
      return 0;
    }
  }

  async cleanup(): Promise<void> {
    if (!this.db) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const tx = this.db.transaction(STORE_QUEUE, 'readwrite');
    const req = tx.objectStore(STORE_QUEUE).index('status').openCursor(IDBKeyRange.only('synced'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const item = cursor.value as QueueItem;
        if (item.synced_at && item.synced_at < cutoff) cursor.delete();
        cursor.continue();
      }
    };
  }

  // ── IndexedDB helpers ──

  private addToStore(item: Omit<QueueItem, 'id'>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('DB not initialized')); return; }
      const tx = this.db.transaction(STORE_QUEUE, 'readwrite');
      const req = tx.objectStore(STORE_QUEUE).add(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private getPending(): Promise<QueueItem[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) { resolve([]); return; }
      const tx = this.db.transaction(STORE_QUEUE, 'readonly');
      const req = tx.objectStore(STORE_QUEUE).index('status').getAll(IDBKeyRange.only('pending'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private markSynced(id: number): Promise<void> {
    return this.updateStatus(id, 'synced', Date.now());
  }

  /** Mark error with status classification: 4xx = permanent failure, 5xx/0 = retry */
  private markError(id: number, error: string, httpStatus: number): Promise<void> {
    // 4xx errors (except 409 conflict) are permanent — don't retry
    const isPermanent = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 409;
    if (isPermanent) {
      return this.updateStatus(id, 'failed', null, error);
    }
    // 5xx, network errors, 409 — transient, keep as pending for retry
    return this.updateStatus(id, 'pending', null, error);
  }

  private updateStatus(id: number, status: string, synced_at: number | null, error?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) { resolve(); return; }
      const tx = this.db.transaction(STORE_QUEUE, 'readwrite');
      const req = tx.objectStore(STORE_QUEUE).get(id);
      req.onsuccess = () => {
        const item = req.result as QueueItem;
        if (!item) { resolve(); return; }
        item.status = status as QueueItem['status'];
        item.synced_at = synced_at;
        item.attempts++;
        if (error) item.error = error;
        if (item.attempts >= 10 && item.status === 'pending') item.status = 'failed';
        tx.objectStore(STORE_QUEUE).put(item);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
  /** Send a log entry directly to debug_logs (fire-and-forget, never queued) */
  private remoteLog(level: string, message: string): void {
    supaFetch('/rest/v1/debug_logs', {
      method: 'POST',
      headers: SUPA_POST_HEADERS,
      body: JSON.stringify({ level, message: message.slice(0, 1000), data: { ts: new Date().toISOString(), ua: navigator.userAgent.slice(0, 200) } }),
    }).catch(() => {}); // truly fire-and-forget
  }
}

export const syncQueue = new SyncQueue();
