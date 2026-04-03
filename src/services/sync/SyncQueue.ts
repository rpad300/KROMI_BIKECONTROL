/**
 * SyncQueue — offline-first data persistence with auto-sync to Supabase.
 *
 * Strategy: direct Supabase sync when online, IndexedDB fallback when offline.
 * On reconnect, pending IndexedDB items are flushed automatically.
 */

const DB_NAME = 'kromi_sync';
const DB_VERSION = 2;
const STORE_QUEUE = 'sync_queue';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

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

        // Safety: if DB exists but store is missing, recreate
        if (!this.db.objectStoreNames.contains(STORE_QUEUE)) {
          this.db.close();
          this.db = null;
          const delReq = indexedDB.deleteDatabase(DB_NAME);
          delReq.onsuccess = () => { this.init().then(resolve).catch(reject); };
          delReq.onerror = () => reject(new Error('Failed to delete corrupt DB'));
          return;
        }

        this.onlineHandler = () => this.flush();
        window.addEventListener('online', this.onlineHandler);
        this.flush();
        resolve();
      };

      req.onerror = () => reject(req.error);
    });
  }

  /** Push data — direct Supabase when online, IndexedDB fallback when offline */
  async push(table: string, data: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST', path?: string): Promise<void> {
    const restPath = path ?? `/${table}`;

    if (navigator.onLine && SUPABASE_URL && SUPABASE_KEY) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1${restPath}`, {
          method,
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(data),
        });
        if (res.ok) return;
        console.error(`[SyncQueue] ${method} ${restPath} failed (${res.status}):`, await res.text());
      } catch (err) {
        console.warn('[SyncQueue] Direct send failed, queueing:', err);
      }
    }

    // Fallback: queue to IndexedDB
    try {
      await this.init();
      await this.addToStore({
        table, method, path: restPath, data,
        status: 'pending', attempts: 0, created_at: Date.now(),
        synced_at: null, error: null,
      });
    } catch (err) {
      console.error('[SyncQueue] IndexedDB queue failed:', err);
    }
  }

  /** Push a batch of items (e.g., snapshot buffer) */
  async pushBatch(table: string, items: Record<string, unknown>[]): Promise<void> {
    if (navigator.onLine && SUPABASE_URL && SUPABASE_KEY) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(items),
        });
        if (res.ok) return;
        console.error(`[SyncQueue] Batch /${table} failed (${res.status}):`, await res.text());
      } catch (err) {
        console.warn('[SyncQueue] Direct batch failed, queueing:', err);
      }
    }

    try {
      await this.init();
      for (const data of items) {
        await this.addToStore({
          table, method: 'POST', path: `/${table}`, data,
          status: 'pending', attempts: 0, created_at: Date.now(),
          synced_at: null, error: null,
        });
      }
    } catch (err) {
      console.error('[SyncQueue] IndexedDB batch queue failed:', err);
    }
  }

  /** Flush all pending IndexedDB items to Supabase */
  async flush(): Promise<number> {
    if (this.flushing || !this.db || !SUPABASE_URL || !SUPABASE_KEY) return 0;
    this.flushing = true;

    let synced = 0;
    try {
      const pending = await this.getPending();
      if (pending.length === 0) { this.flushing = false; return 0; }

      const groups = new Map<string, QueueItem[]>();
      for (const item of pending) {
        const key = `${item.method}:${item.path}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }

      for (const [, items] of groups) {
        const first = items[0]!;
        try {
          if (first.method === 'POST' && items.length > 1) {
            const res = await fetch(`${SUPABASE_URL}/rest/v1${first.path}`, {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_KEY!,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify(items.map((i) => i.data)),
            });
            if (res.ok) {
              for (const item of items) { await this.markSynced(item.id!); synced++; }
            } else {
              const err = await res.text();
              for (const item of items) { await this.markFailed(item.id!, err); }
            }
          } else {
            for (const item of items) {
              try {
                const res = await fetch(`${SUPABASE_URL}/rest/v1${item.path}`, {
                  method: item.method,
                  headers: {
                    'apikey': SUPABASE_KEY!,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal',
                  },
                  body: JSON.stringify(item.data),
                });
                if (res.ok) { await this.markSynced(item.id!); synced++; }
                else { await this.markFailed(item.id!, await res.text()); }
              } catch (err) {
                await this.markFailed(item.id!, String(err));
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
    const pending = await this.getPending();
    return pending.length;
  }

  async cleanup(): Promise<void> {
    if (!this.db) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const tx = this.db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const req = store.index('status').openCursor(IDBKeyRange.only('synced'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const item = cursor.value as QueueItem;
        if (item.synced_at && item.synced_at < cutoff) cursor.delete();
        cursor.continue();
      }
    };
  }

  private addToStore(item: Omit<QueueItem, 'id'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_QUEUE, 'readwrite');
      const req = tx.objectStore(STORE_QUEUE).add(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private getPending(): Promise<QueueItem[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_QUEUE, 'readonly');
      const req = tx.objectStore(STORE_QUEUE).index('status').getAll(IDBKeyRange.only('pending'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private markSynced(id: number): Promise<void> {
    return this.updateStatus(id, 'synced', Date.now());
  }

  private markFailed(id: number, error: string): Promise<void> {
    return this.updateStatus(id, 'pending', null, error);
  }

  private updateStatus(id: number, status: string, synced_at: number | null, error?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_QUEUE, 'readwrite');
      const req = tx.objectStore(STORE_QUEUE).get(id);
      req.onsuccess = () => {
        const item = req.result as QueueItem;
        if (!item) { resolve(); return; }
        item.status = status as QueueItem['status'];
        item.synced_at = synced_at;
        item.attempts++;
        if (error) item.error = error;
        if (item.attempts >= 10) item.status = 'failed';
        tx.objectStore(STORE_QUEUE).put(item);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
}

export const syncQueue = new SyncQueue();
