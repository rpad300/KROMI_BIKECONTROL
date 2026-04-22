/**
 * DouglasPeucker.ts — GPS trail line simplification
 * Uses Douglas-Peucker algorithm with haversine-based distances.
 */

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in metres between two lat/lng points. */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(aVal));
}

/**
 * Perpendicular distance (metres) from point P to the line defined by A→B.
 * Uses Heron's formula: area = sqrt(s*(s-a)*(s-b)*(s-c)), h = 2*area / base.
 * Degeneracy (A ≈ B): returns haversine(P, A).
 */
function perpendicularDistance(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const base = haversineM(a, b);
  if (base < 1e-9) {
    // Degenerate: A and B are the same point
    return haversineM(p, a);
  }
  const distPA = haversineM(p, a);
  const distPB = haversineM(p, b);
  // Heron's formula
  const s = (base + distPA + distPB) / 2;
  const areaSquared = s * (s - base) * (s - distPA) * (s - distPB);
  // Clamp to avoid NaN from floating-point precision issues near collinear points
  const area = Math.sqrt(Math.max(0, areaSquared));
  return (2 * area) / base;
}

/**
 * Douglas-Peucker line simplification for GPS trails.
 * Preserves all fields on kept points; does not mutate input.
 *
 * @param points         Array of objects with at least {lat, lng}.
 * @param toleranceMeters  Maximum allowed perpendicular deviation (default 5 m).
 * @returns Simplified array (subset of input objects, same references).
 */
export function douglasPeucker<T extends { lat: number; lng: number; [key: string]: unknown }>(
  points: T[],
  toleranceMeters = 5,
): T[] {
  if (points.length <= 2) {
    return points.slice();
  }

  // Find the point with the maximum perpendicular distance from the line
  // connecting the first and last points.
  const first = points[0] as T;
  const last = points[points.length - 1] as T;

  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i] as T, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }

  if (maxDist > toleranceMeters) {
    // Recursively simplify each half and merge
    const left = douglasPeucker(points.slice(0, maxIndex + 1), toleranceMeters);
    const right = douglasPeucker(points.slice(maxIndex), toleranceMeters);
    // left ends with points[maxIndex]; right starts with points[maxIndex] — drop duplicate
    return [...left.slice(0, -1), ...right];
  }

  // All intermediate points are within tolerance — keep only endpoints
  return [first, last];
}
