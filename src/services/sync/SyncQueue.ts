/**
 * SyncQueue — offline-first data persistence with auto-sync to Supabase.
 *
 * All writes go to IndexedDB first (never lost), then attempt Supabase.
 * If offline/error → queued as pending → auto-flushed when back online.
 *
 * Usage:
 *   await syncQueue.push('ride_snapshots', snapshotData);
 *   // Data saved locally immediately, synced to Supabase when possible
 */

const DB_NAME = 'kromi_sync';
const DB_VERSION = 1;
const STORE_QUEUE = 'sync_queue';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

interface QueueItem {
  id?: number;           // auto-incremented by IndexedDB
  table: string;         // Supabase table name
  method: 'POST' | 'PATCH';
  path: string;          // REST path (e.g., /ride_snapshots)
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

        // Auto-flush when back online
        this.onlineHandler = () => this.flush();
        window.addEventListener('online', this.onlineHandler);

        // Flush any pending items from previous session
        this.flush();

        resolve();
      };

      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Push data to be synced. Saved locally immediately.
   * If online, tries Supabase right away. If not, queued.
   */
  async push(table: string, data: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST', path?: string): Promise<void> {
    await this.init();

    const item: Omit<QueueItem, 'id'> = {
      table,
      method,
      path: path ?? `/${table}`,
      data,
      status: 'pending',
      attempts: 0,
      created_at: Date.now(),
      synced_at: null,
      error: null,
    };

    // Save to IndexedDB first (never lost)
    await this.addToStore(item);

    // Try immediate sync if online
    if (navigator.onLine) {
      this.flush();
    }
  }

  /**
   * Push a batch of items (e.g., snapshot buffer).
   */
  async pushBatch(table: string, items: Record<string, unknown>[]): Promise<void> {
    await this.init();
    for (const data of items) {
      await this.addToStore({
        table,
        method: 'POST',
        path: `/${table}`,
        data,
        status: 'pending',
        attempts: 0,
        created_at: Date.now(),
        synced_at: null,
        error: null,
      });
    }
    if (navigator.onLine) this.flush();
  }

  /**
   * Flush all pending items to Supabase.
   */
  async flush(): Promise<number> {
    if (this.flushing || !this.db || !SUPABASE_URL || !SUPABASE_KEY) return 0;
    this.flushing = true;

    let synced = 0;
    try {
      const pending = await this.getPending();
      if (pending.length === 0) { this.flushing = false; return 0; }

      // Group by table for batch insert
      const groups = new Map<string, QueueItem[]>();
      for (const item of pending) {
        const key = `${item.method}:${item.path}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }

      for (const [, items] of groups) {
        const first = items[0]!;

        try {
          // Batch POST: send array of data
          if (first.method === 'POST' && items.length > 1) {
            const body = items.map((i) => i.data);
            const res = await fetch(`${SUPABASE_URL}/rest/v1${first.path}`, {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_KEY!,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify(body),
            });

            if (res.ok) {
              for (const item of items) {
                await this.markSynced(item.id!);
                synced++;
              }
            } else {
              const err = await res.text();
              for (const item of items) {
                await this.markFailed(item.id!, err);
              }
            }
          } else {
            // Single item
            for (const item of items) {
              try {
                const res = await fetch(`${SUPABASE_URL}/rest/v1${item.path}`, {
                  method: item.method,
                  headers: {
                    'apikey': SUPABASE_KEY!,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': item.method === 'PATCH' ? 'return=minimal' : 'return=minimal',
                  },
                  body: JSON.stringify(item.data),
                });

                if (res.ok) {
                  await this.markSynced(item.id!);
                  synced++;
                } else {
                  await this.markFailed(item.id!, await res.text());
                }
              } catch (err) {
                await this.markFailed(item.id!, String(err));
              }
            }
          }
        } catch (err) {
          console.warn('[SyncQueue] Batch flush failed:', err);
        }
      }

      if (synced > 0) {
        console.log(`[SyncQueue] Flushed ${synced}/${pending.length} items`);
      }
    } finally {
      this.flushing = false;
    }

    return synced;
  }

  /** Get count of pending items */
  async getPendingCount(): Promise<number> {
    const pending = await this.getPending();
    return pending.length;
  }

  /** Clean up synced items older than 24h */
  async cleanup(): Promise<void> {
    if (!this.db) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const tx = this.db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const index = store.index('status');
    const req = index.openCursor(IDBKeyRange.only('synced'));

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const item = cursor.value as QueueItem;
        if (item.synced_at && item.synced_at < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  }

  // ── IndexedDB helpers ────────────────────────

  private addToStore(item: Omit<QueueItem, 'id'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_QUEUE);
      const req = store.add(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private getPending(): Promise<QueueItem[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_QUEUE);
      const index = store.index('status');
      const req = index.getAll(IDBKeyRange.only('pending'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private markSynced(id: number): Promise<void> {
    return this.updateStatus(id, 'synced', Date.now());
  }

  private markFailed(id: number, error: string): Promise<void> {
    return this.updateStatus(id, 'pending', null, error); // stays pending for retry
  }

  private updateStatus(id: number, status: string, synced_at: number | null, error?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_QUEUE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result as QueueItem;
        if (!item) { resolve(); return; }
        item.status = status as QueueItem['status'];
        item.synced_at = synced_at;
        item.attempts++;
        if (error) item.error = error;
        // Give up after 10 attempts
        if (item.attempts >= 10) item.status = 'failed';
        store.put(item);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
}

export const syncQueue = new SyncQueue();
