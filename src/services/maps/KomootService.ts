/**
 * Komoot Route Import Service
 *
 * Fetches route data from Komoot public tours.
 * Public tours expose a GPX download endpoint.
 * Parses the GPX XML and returns an array of route points
 * for elevation profile and auto-assist planning.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
  elevation: number;
}

/**
 * Extract tour ID from a Komoot URL or raw ID string.
 *
 * Supports formats:
 *   - https://www.komoot.com/tour/123456789
 *   - https://www.komoot.com/tour/123456789?ref=...
 *   - komoot.com/tour/123456789
 *   - 123456789
 */
function extractTourId(tourUrl: string): string | null {
  const trimmed = tourUrl.trim();

  // Pure numeric ID
  if (/^\d+$/.test(trimmed)) return trimmed;

  // URL pattern
  const match = trimmed.match(/komoot\.com\/(?:tour|Tour)\/(\d+)/i);
  return match?.[1] ?? null;
}

/**
 * Parse GPX XML string into an array of RoutePoints.
 */
function parseGPX(gpxXml: string): RoutePoint[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxXml, 'application/xml');
  const points: RoutePoint[] = [];

  // GPX uses <trkpt> for track points and <rtept> for route points
  const trkpts = doc.querySelectorAll('trkpt');
  const rtepts = doc.querySelectorAll('rtept');
  const allPts = trkpts.length > 0 ? trkpts : rtepts;

  allPts.forEach((pt) => {
    const lat = parseFloat(pt.getAttribute('lat') ?? '0');
    const lng = parseFloat(pt.getAttribute('lon') ?? '0');
    const eleEl = pt.querySelector('ele');
    const elevation = eleEl ? parseFloat(eleEl.textContent ?? '0') : 0;

    if (lat !== 0 && lng !== 0) {
      points.push({ lat, lng, elevation });
    }
  });

  return points;
}

/**
 * Import a route from Komoot.
 *
 * @param tourUrl - Komoot tour URL or numeric tour ID
 * @returns Array of route points with lat, lng, elevation
 * @throws Error if tour ID is invalid or fetch fails
 */
export async function importKomootRoute(tourUrl: string): Promise<RoutePoint[]> {
  const tourId = extractTourId(tourUrl);
  if (!tourId) {
    throw new Error('Invalid Komoot tour URL or ID');
  }

  // Komoot public GPX download endpoint
  const gpxUrl = `https://www.komoot.com/api/v007/tours/${tourId}.gpx`;

  const response = await fetch(gpxUrl, {
    headers: {
      Accept: 'application/gpx+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Komoot tour: ${response.status} ${response.statusText}`);
  }

  const gpxText = await response.text();
  const points = parseGPX(gpxText);

  if (points.length === 0) {
    throw new Error('No track points found in Komoot tour');
  }

  console.log(`[Komoot] Imported ${points.length} points from tour ${tourId}`);
  return points;
}
