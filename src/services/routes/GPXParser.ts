/**
 * GPXParser — parses standard GPX 1.1 files into RoutePoint arrays.
 *
 * Supports: <trk>/<trkseg>/<trkpt> (tracks) and <rte>/<rtept> (routes).
 * Extracts: lat, lng, elevation, name, description.
 * Calculates: distance_from_start_m, total distance, elevation gain/loss, bbox.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
  elevation: number;
  distance_from_start_m: number;
}

export interface ParsedRoute {
  name: string;
  description: string;
  points: RoutePoint[];
  total_distance_km: number;
  total_elevation_gain_m: number;
  total_elevation_loss_m: number;
  max_gradient_pct: number;
  avg_gradient_pct: number;
  bbox: { north: number; south: number; east: number; west: number };
}

/**
 * Parse a GPX XML string into a structured route.
 * Supports GPX 1.0 and 1.1 from Komoot, Strava, Garmin, RideWithGPS, etc.
 */
export function parseGPX(gpxString: string): ParsedRoute | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxString, 'application/xml');

  if (doc.querySelector('parsererror')) {
    console.error('[GPX] XML parse error');
    return null;
  }

  // Extract name and description
  const name = doc.querySelector('trk > name, rte > name, metadata > name')?.textContent?.trim() || 'Rota importada';
  const description = doc.querySelector('trk > desc, rte > desc, metadata > desc')?.textContent?.trim() || '';

  // Extract points — prefer tracks (trkpt), fallback to routes (rtept)
  let pointElements = doc.querySelectorAll('trkpt');
  if (pointElements.length === 0) {
    pointElements = doc.querySelectorAll('rtept');
  }
  if (pointElements.length < 2) {
    console.error('[GPX] Not enough points:', pointElements.length);
    return null;
  }

  // Parse raw lat/lng/elevation
  const raw: { lat: number; lng: number; ele: number }[] = [];
  pointElements.forEach(pt => {
    const lat = parseFloat(pt.getAttribute('lat') || '0');
    const lng = parseFloat(pt.getAttribute('lon') || '0');
    const eleEl = pt.querySelector('ele');
    const ele = eleEl ? parseFloat(eleEl.textContent || '0') : 0;
    if (lat !== 0 || lng !== 0) {
      raw.push({ lat, lng, ele });
    }
  });

  if (raw.length < 2) return null;

  // Calculate distances and build RoutePoints
  const points: RoutePoint[] = [];
  let cumulativeDist = 0;
  let elevGain = 0;
  let elevLoss = 0;
  let maxGrad = 0;
  let gradSum = 0;
  let gradCount = 0;
  let north = -90, south = 90, east = -180, west = 180;

  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]!;

    if (i > 0) {
      const prev = raw[i - 1]!;
      const segDist = haversineM(prev.lat, prev.lng, p.lat, p.lng);
      cumulativeDist += segDist;

      const dEle = p.ele - prev.ele;
      if (dEle > 0) elevGain += dEle;
      else elevLoss += Math.abs(dEle);

      if (segDist > 5) { // avoid division by tiny distances
        const grad = (dEle / segDist) * 100;
        maxGrad = Math.max(maxGrad, Math.abs(grad));
        gradSum += Math.abs(grad);
        gradCount++;
      }
    }

    // Bbox
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);

    points.push({
      lat: p.lat,
      lng: p.lng,
      elevation: p.ele,
      distance_from_start_m: Math.round(cumulativeDist),
    });
  }

  // Simplify if too many points (>2000) — keep every Nth point
  const simplified = points.length > 2000
    ? simplifyPoints(points, 1000)
    : points;

  return {
    name,
    description,
    points: simplified,
    total_distance_km: Math.round(cumulativeDist / 10) / 100, // 2 decimal
    total_elevation_gain_m: Math.round(elevGain),
    total_elevation_loss_m: Math.round(elevLoss),
    max_gradient_pct: Math.round(maxGrad * 10) / 10,
    avg_gradient_pct: gradCount > 0 ? Math.round((gradSum / gradCount) * 10) / 10 : 0,
    bbox: { north, south, east, west },
  };
}

/** Parse a GPX file (File object from input[type=file]) */
export async function parseGPXFile(file: File): Promise<ParsedRoute | null> {
  const text = await file.text();
  return parseGPX(text);
}

/** Simplify route by keeping every Nth point + first + last */
function simplifyPoints(points: RoutePoint[], target: number): RoutePoint[] {
  if (points.length <= target) return points;
  const step = Math.ceil(points.length / target);
  const result: RoutePoint[] = [points[0]!];
  for (let i = step; i < points.length - 1; i += step) {
    result.push(points[i]!);
  }
  result.push(points[points.length - 1]!);
  return result;
}

/** Haversine distance in meters */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
