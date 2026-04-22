/**
 * useRouteNavigation — tracks rider position on active route during ride.
 *
 * Updates routeStore.navigation every 2s with:
 * - Current position on route (nearest point index)
 * - Distance remaining
 * - Deviation from route
 * - Next significant event (gradient change, turn)
 * - Progress percentage
 *
 * Also feeds route data into KromiEngine's LookaheadController.
 */

import { useEffect } from 'react';
import { subscribeRideTick2s } from '../services/RideTickService';
import { useMapStore } from '../store/mapStore';
import { useRouteStore } from '../store/routeStore';
import type { RoutePoint } from '../services/routes/GPXParser';
import { haversineM } from '../services/gps/DouglasPeucker';

export function useRouteNavigation() {
  useEffect(() => {
    const tickFn = () => {
      const { navigation, activeRoutePoints, updateNavigation } = useRouteStore.getState();
      if (!navigation.active || activeRoutePoints.length < 2) return;

      const map = useMapStore.getState();
      if (!map.gpsActive || map.latitude === 0) return;

      const lat = map.latitude;
      const lng = map.longitude;
      const points = activeRoutePoints;

      // Find nearest point on route
      const { idx, dist } = findNearest(lat, lng, points, navigation.currentIndex);

      // Total route distance
      const totalDist = points[points.length - 1]!.distance_from_start_m;
      const currentDist = points[idx]!.distance_from_start_m;
      const remaining = totalDist - currentDist;
      const progress = totalDist > 0 ? (currentDist / totalDist) * 100 : 0;

      // Next significant event (gradient > 8% within 500m)
      let nextEventDist: number | null = null;
      let nextEventText: string | null = null;
      for (let i = idx + 1; i < points.length - 1 && i < idx + 50; i++) {
        const p0 = points[i]!;
        const p1 = points[i + 1]!;
        const segDist = p1.distance_from_start_m - p0.distance_from_start_m;
        if (segDist < 5) continue;
        const grad = ((p1.elevation - p0.elevation) / segDist) * 100;
        if (Math.abs(grad) > 8) {
          nextEventDist = p0.distance_from_start_m - currentDist;
          nextEventText = grad > 0
            ? `Subida ${Math.abs(grad).toFixed(0)}% a ${Math.round(nextEventDist)}m`
            : `Descida ${Math.abs(grad).toFixed(0)}% a ${Math.round(nextEventDist)}m`;
          break;
        }
      }

      // Bearing to next waypoint (10 points ahead)
      const nextIdx = Math.min(idx + 10, points.length - 1);
      const nextPt = points[nextIdx]!;
      const bearing = calculateBearing(lat, lng, nextPt.lat, nextPt.lng);

      updateNavigation({
        currentIndex: idx,
        distanceFromStart_m: currentDist,
        distanceRemaining_m: Math.round(remaining),
        deviationM: Math.round(dist),
        distanceToNextEvent_m: nextEventDist ? Math.round(nextEventDist) : null,
        nextEventText,
        bearingToNext: Math.round(bearing),
        progress_pct: Math.round(progress * 10) / 10,
      });

      // Feed gradient to KromiCore via JS Bridge
      if (idx < points.length - 1) {
        const p0 = points[idx]!;
        const p1 = points[Math.min(idx + 3, points.length - 1)]!;
        const segDist = p1.distance_from_start_m - p0.distance_from_start_m;
        if (segDist > 5) {
          const routeGradient = ((p1.elevation - p0.elevation) / segDist) * 100;
          const bridge = (window as unknown as Record<string, unknown>).KromiBridge as
            | { setGradient?: (g: number) => void }
            | undefined;
          bridge?.setGradient?.(routeGradient);
        }
      }
    };

    const unsubTick = subscribeRideTick2s(tickFn);

    return () => {
      unsubTick();
    };
  }, []);
}

/** Find nearest route point to current GPS position */
function findNearest(
  lat: number, lng: number, points: RoutePoint[], hint: number,
): { idx: number; dist: number } {
  // Search around hint (±30 points for efficiency)
  const start = Math.max(0, hint - 10);
  const end = Math.min(points.length, hint + 30);
  let bestIdx = hint;
  let bestDist = Infinity;

  for (let i = start; i < end; i++) {
    const p = points[i]!;
    const d = haversineM({ lat, lng }, { lat: p.lat, lng: p.lng });
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return { idx: bestIdx, dist: bestDist };
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
