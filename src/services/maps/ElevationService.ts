import type { ElevationPoint } from '../../types/elevation.types';
import { destinationFromHeading, isMapsLoaded } from './GoogleMapsService';
import type { RoutePoint } from '../autoAssist/ElevationPredictor';

const FETCH_INTERVAL_MS = 3000; // Max 1 fetch per 3s (API quota)
const CACHE_TTL_MS = 30000; // Cache results for 30s (profile cache)

// ── Gap #6: Persistent Elevation Cache (IndexedDB) ──────────

const CACHE_GRID_PRECISION = 4; // ~11m grid cells at equator
const PERSISTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day TTL

interface CacheEntry {
  elevation: number;
  ts: number;
}

class ElevationCache {
  private dbName = 'kromi-elevation-cache';
  private memCache = new Map<string, CacheEntry>();
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  private gridKey(lat: number, lng: number): string {
    return `${lat.toFixed(CACHE_GRID_PRECISION)}_${lng.toFixed(CACHE_GRID_PRECISION)}`;
  }

  async get(lat: number, lng: number): Promise<number | null> {
    const key = this.gridKey(lat, lng);

    // 1. Memory cache (instant)
    const mem = this.memCache.get(key);
    if (mem && Date.now() - mem.ts < PERSISTENT_TTL_MS) return mem.elevation;

    // 2. IndexedDB (fast)
    try {
      const db = await this.getDB();
      const stored = await this.idbGet(db, key);
      if (stored && Date.now() - stored.ts < PERSISTENT_TTL_MS) {
        this.memCache.set(key, stored);
        return stored.elevation;
      }
    } catch {
      // IndexedDB unavailable, continue without persistent cache
    }
    return null;
  }

  async set(lat: number, lng: number, elevation: number): Promise<void> {
    const key = this.gridKey(lat, lng);
    const entry: CacheEntry = { elevation, ts: Date.now() };
    this.memCache.set(key, entry);

    try {
      const db = await this.getDB();
      await this.idbPut(db, key, entry);
    } catch {
      // IndexedDB unavailable, memory-only cache
    }
  }

  async setBatch(points: { lat: number; lng: number; elevation: number }[]): Promise<void> {
    const now = Date.now();
    // Always update memory cache
    for (const p of points) {
      const key = this.gridKey(p.lat, p.lng);
      this.memCache.set(key, { elevation: p.elevation, ts: now });
    }

    // Batch write to IndexedDB
    try {
      const db = await this.getDB();
      const tx = db.transaction('elevations', 'readwrite');
      const store = tx.objectStore('elevations');
      for (const p of points) {
        const key = this.gridKey(p.lat, p.lng);
        store.put({ elevation: p.elevation, ts: now }, key);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // IndexedDB unavailable
    }
  }

  /** Get cache statistics */
  getStats(): { memSize: number } {
    return { memSize: this.memCache.size };
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('elevations');
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  private idbGet(db: IDBDatabase, key: string): Promise<CacheEntry | undefined> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('elevations', 'readonly');
      const req = tx.objectStore('elevations').get(key);
      req.onsuccess = () => resolve(req.result as CacheEntry | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private idbPut(db: IDBDatabase, key: string, value: CacheEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('elevations', 'readwrite');
      tx.objectStore('elevations').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// ── Elevation Service ─────────────────────────────────────────

class ElevationService {
  private static instance: ElevationService;
  private elevator: google.maps.ElevationService | null = null;
  private cache = new Map<string, { data: ElevationPoint[]; timestamp: number }>();
  private lastFetchTime = 0;
  private lastResult: ElevationPoint[] = [];

  // Gap #6: Persistent grid-level cache
  private elevationCache = new ElevationCache();

  static getInstance(): ElevationService {
    if (!ElevationService.instance) {
      ElevationService.instance = new ElevationService();
    }
    return ElevationService.instance;
  }

  private getElevator(): google.maps.ElevationService | null {
    if (!isMapsLoaded()) return null;
    if (!this.elevator) {
      this.elevator = new google.maps.ElevationService();
    }
    return this.elevator;
  }

  /**
   * PRIMARY MODE: No route, just GPS + heading.
   * Generates points ahead in current direction and fetches elevation.
   * Gap #6: Uses persistent cache to reduce API calls by 80-90%.
   */
  async getElevationByHeading(
    lat: number,
    lng: number,
    headingDeg: number,
    lookaheadM: number = 300,
    numSamples: number = 15
  ): Promise<ElevationPoint[]> {
    const elevator = this.getElevator();
    if (!elevator) return this.lastResult;

    // Throttle
    const now = Date.now();
    if (now - this.lastFetchTime < FETCH_INTERVAL_MS) {
      return this.lastResult;
    }

    // Profile-level cache key: position rounded to ~100m + heading rounded to 10deg
    const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}_${Math.round(headingDeg / 10) * 10}_${lookaheadM}`;

    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    // Generate sample points ahead
    const stepM = lookaheadM / numSamples;
    const samplePoints: { lat: number; lng: number; idx: number }[] = [];

    for (let i = 0; i <= numSamples; i++) {
      const distM = stepM * i;
      const point = destinationFromHeading({ lat, lng }, headingDeg, distM);
      samplePoints.push({ lat: point.lat, lng: point.lng, idx: i });
    }

    // Gap #6: Check persistent cache for each point
    const cachedElevations: (number | null)[] = await Promise.all(
      samplePoints.map(p => this.elevationCache.get(p.lat, p.lng))
    );

    // Find uncached points
    const uncachedIndices = samplePoints
      .map((_, i) => i)
      .filter(i => cachedElevations[i] === null);

    let fetchedElevations: Map<number, number> = new Map();

    if (uncachedIndices.length > 0) {
      // Only fetch uncached points from API
      const uncachedLatLngs = uncachedIndices.map(i => {
        const p = samplePoints[i]!;
        return new google.maps.LatLng(p.lat, p.lng);
      });

      try {
        const result = await elevator.getElevationForLocations({ locations: uncachedLatLngs });

        if (result.results && result.results.length > 0) {
          // Map fetched results back to original indices
          const batchPoints: { lat: number; lng: number; elevation: number }[] = [];
          for (let j = 0; j < result.results.length; j++) {
            const origIdx = uncachedIndices[j]!;
            const elev = result.results[j]!.elevation;
            fetchedElevations.set(origIdx, elev);
            batchPoints.push({
              lat: samplePoints[origIdx]!.lat,
              lng: samplePoints[origIdx]!.lng,
              elevation: elev,
            });
          }

          // Store fetched points in persistent cache (batch)
          await this.elevationCache.setBatch(batchPoints);
        }

        this.lastFetchTime = now;
      } catch (err) {
        console.warn('[Elevation] API call failed:', err);
        // If API fails but we have some cached data, use what we have
        if (uncachedIndices.length === samplePoints.length) {
          return this.lastResult;
        }
      }
    }

    // Build merged profile from cached + fetched
    const profile: ElevationPoint[] = samplePoints.map((p, i) => {
      const elevation = cachedElevations[i] ?? fetchedElevations.get(i) ?? 0;
      const distFromCurrent = stepM * i;
      const prevElev = i > 0
        ? (cachedElevations[i - 1] ?? fetchedElevations.get(i - 1) ?? elevation)
        : elevation;
      const gradientPct = i > 0 ? ((elevation - prevElev) / stepM) * 100 : 0;

      return {
        lat: p.lat,
        lng: p.lng,
        elevation,
        distance_from_current: distFromCurrent,
        gradient_pct: gradientPct,
      };
    });

    // Only store profile if we have meaningful data
    if (profile.length >= 2 && profile.some(p => p.elevation !== 0)) {
      this.cache.set(cacheKey, { data: profile, timestamp: now });
      this.lastResult = profile;

      // Cleanup old profile cache entries
      for (const [key, val] of this.cache) {
        if (now - val.timestamp > CACHE_TTL_MS * 2) this.cache.delete(key);
      }

      const cacheStats = this.elevationCache.getStats();
      if (uncachedIndices.length > 0) {
        console.log(
          `[Elevation] Fetched ${uncachedIndices.length}/${samplePoints.length} points from API ` +
          `(${samplePoints.length - uncachedIndices.length} cached). Grid cache: ${cacheStats.memSize} entries.`
        );
      }
    }

    return profile;
  }

  /**
   * ROUTE MODE: Elevation along a planned route path.
   */
  async getElevationAlongRoute(
    routePath: google.maps.LatLng[],
    numSamples: number = 50
  ): Promise<ElevationPoint[]> {
    const elevator = this.getElevator();
    if (!elevator || routePath.length < 2) return [];

    try {
      const result = await elevator.getElevationAlongPath({
        path: routePath,
        samples: Math.min(numSamples, 512),
      });

      if (!result.results || result.results.length < 2) return [];

      let cumulativeDistance = 0;

      const profile = result.results.map((r, i) => {
        if (i > 0) {
          const prev = result.results[i - 1]!;
          const segDist = google.maps.geometry.spherical.computeDistanceBetween(
            prev.location!,
            r.location!
          );
          cumulativeDistance += segDist;
        }

        const prevElev = i > 0 ? result.results[i - 1]!.elevation : r.elevation;
        const segLen = i > 0
          ? google.maps.geometry.spherical.computeDistanceBetween(
              result.results[i - 1]!.location!,
              r.location!
            )
          : 1;

        return {
          lat: r.location!.lat(),
          lng: r.location!.lng(),
          elevation: r.elevation,
          distance_from_current: cumulativeDistance,
          gradient_pct: i > 0 ? ((r.elevation - prevElev) / segLen) * 100 : 0,
        };
      });

      // Gap #6: Cache all fetched route elevations for future discovery mode use
      const batchPoints = result.results.map(r => ({
        lat: r.location!.lat(),
        lng: r.location!.lng(),
        elevation: r.elevation,
      }));
      this.elevationCache.setBatch(batchPoints).catch(() => {
        // Best-effort caching
      });

      return profile;
    } catch (err) {
      console.warn('[Elevation] Route elevation failed:', err);
      return [];
    }
  }

  /**
   * Gap #6: Pre-cache route elevation on GPX load (offline use).
   * Samples every sampleSpacingM along route and fetches uncached elevations.
   * Call this when a route/GPX is loaded to prepare for offline riding.
   */
  async preCacheRoute(routePoints: RoutePoint[], sampleSpacingM: number = 50): Promise<void> {
    const elevator = this.getElevator();
    if (!elevator || routePoints.length < 2) return;

    // Sample route points at specified spacing
    const samplePoints: { lat: number; lng: number }[] = [];
    let nextSampleDist = 0;

    for (const pt of routePoints) {
      if (pt.distance_from_start_m >= nextSampleDist) {
        samplePoints.push({ lat: pt.lat, lng: pt.lng });
        nextSampleDist = pt.distance_from_start_m + sampleSpacingM;
      }
    }

    // Check which are already cached
    const uncached: { lat: number; lng: number }[] = [];
    for (const p of samplePoints) {
      if (await this.elevationCache.get(p.lat, p.lng) === null) {
        uncached.push(p);
      }
    }

    if (uncached.length === 0) {
      console.log(`[Elevation] Route pre-cache: all ${samplePoints.length} points already cached.`);
      return;
    }

    // Batch fetch uncached (Google API supports up to 512 points per request)
    const BATCH_SIZE = 500;
    let totalFetched = 0;

    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE);
      const locations = batch.map(p => new google.maps.LatLng(p.lat, p.lng));

      try {
        const result = await elevator.getElevationForLocations({ locations });

        if (result.results && result.results.length > 0) {
          const batchPoints = result.results.map(r => ({
            lat: r.location!.lat(),
            lng: r.location!.lng(),
            elevation: r.elevation,
          }));
          await this.elevationCache.setBatch(batchPoints);
          totalFetched += batchPoints.length;
        }
      } catch (err) {
        console.warn(`[Elevation] Pre-cache batch ${i / BATCH_SIZE + 1} failed:`, err);
      }
    }

    console.log(
      `[Elevation] Pre-cached ${totalFetched} points for route ` +
      `(${samplePoints.length - uncached.length} already cached).`
    );
  }

  /** Get last cached result (for UI when throttled) */
  getLastResult(): ElevationPoint[] {
    return this.lastResult;
  }

  /** Get persistent cache stats */
  getCacheStats(): { memSize: number } {
    return this.elevationCache.getStats();
  }
}

export const elevationService = ElevationService.getInstance();
