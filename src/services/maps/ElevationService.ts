import type { ElevationPoint } from '../../types/elevation.types';
import { destinationFromHeading, isMapsLoaded } from './GoogleMapsService';

const FETCH_INTERVAL_MS = 3000; // Max 1 fetch per 3s (API quota)
const CACHE_TTL_MS = 30000; // Cache results for 30s

class ElevationService {
  private static instance: ElevationService;
  private elevator: google.maps.ElevationService | null = null;
  private cache = new Map<string, { data: ElevationPoint[]; timestamp: number }>();
  private lastFetchTime = 0;
  private lastResult: ElevationPoint[] = [];

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

    // Cache key: position rounded to ~100m + heading rounded to 10°
    const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}_${Math.round(headingDeg / 10) * 10}_${lookaheadM}`;

    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    // Generate points ahead
    const stepM = lookaheadM / numSamples;
    const points: google.maps.LatLng[] = [];

    for (let i = 0; i <= numSamples; i++) {
      const distM = stepM * i;
      const point = destinationFromHeading({ lat, lng }, headingDeg, distM);
      points.push(new google.maps.LatLng(point.lat, point.lng));
    }

    try {
      const result = await elevator.getElevationForLocations({ locations: points });

      if (!result.results || result.results.length < 2) return this.lastResult;

      const profile: ElevationPoint[] = result.results.map((r, i) => {
        const distFromCurrent = stepM * i;
        const prevElev = i > 0 ? result.results[i - 1]!.elevation : r.elevation;
        const gradientPct = i > 0 ? ((r.elevation - prevElev) / stepM) * 100 : 0;

        return {
          lat: r.location!.lat(),
          lng: r.location!.lng(),
          elevation: r.elevation,
          distance_from_current: distFromCurrent,
          gradient_pct: gradientPct,
        };
      });

      // Cache + store
      this.cache.set(cacheKey, { data: profile, timestamp: now });
      this.lastFetchTime = now;
      this.lastResult = profile;

      // Cleanup old cache entries
      for (const [key, val] of this.cache) {
        if (now - val.timestamp > CACHE_TTL_MS * 2) this.cache.delete(key);
      }

      return profile;
    } catch (err) {
      console.warn('[Elevation] API call failed:', err);
      return this.lastResult;
    }
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

      return result.results.map((r, i) => {
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
    } catch (err) {
      console.warn('[Elevation] Route elevation failed:', err);
      return [];
    }
  }

  /** Get last cached result (for UI when throttled) */
  getLastResult(): ElevationPoint[] {
    return this.lastResult;
  }
}

export const elevationService = ElevationService.getInstance();
