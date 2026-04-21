// src/services/routes/RerouteService.ts
/**
 * RerouteService — calculates return-to-route path via Google Directions API
 * when rider deviates > 50m for > 5 seconds.
 */

import { isMapsLoaded } from '../maps/GoogleMapsService';
import type { RoutePoint } from './GPXParser';

export interface ReroutePath {
  points: google.maps.LatLngLiteral[];
  distanceM: number;
  durationS: number;
}

let lastRerouteMs = 0;
const REROUTE_COOLDOWN_MS = 15_000; // Don't re-request more than every 15s

/**
 * Calculate a path from current position back to the nearest route point ahead.
 * Uses Google Directions API (bicycling mode).
 */
export async function calculateReroute(
  currentLat: number,
  currentLng: number,
  routePoints: RoutePoint[],
  currentIndex: number,
): Promise<ReroutePath | null> {
  if (!isMapsLoaded()) return null;

  // Cooldown
  const now = Date.now();
  if (now - lastRerouteMs < REROUTE_COOLDOWN_MS) return null;
  lastRerouteMs = now;

  // Target: 200-500m ahead on route from current index
  const targetIdx = Math.min(
    currentIndex + Math.ceil(routePoints.length * 0.02), // ~2% ahead
    routePoints.length - 1,
  );
  const target = routePoints[targetIdx]!;

  try {
    const service = new google.maps.DirectionsService();
    const result = await service.route({
      origin: { lat: currentLat, lng: currentLng },
      destination: { lat: target.lat, lng: target.lng },
      travelMode: google.maps.TravelMode.BICYCLING,
    });

    if (result.routes.length === 0 || !result.routes[0]!.legs[0]) return null;

    const leg = result.routes[0]!.legs[0]!;
    const points = result.routes[0]!.overview_path.map(p => ({
      lat: p.lat(),
      lng: p.lng(),
    }));

    return {
      points,
      distanceM: leg.distance?.value ?? 0,
      durationS: leg.duration?.value ?? 0,
    };
  } catch (err) {
    console.warn('[Reroute] Directions API failed:', err);
    return null;
  }
}
