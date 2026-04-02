/**
 * TerrainService — queries OpenStreetMap via Overpass API for trail/terrain info.
 * Returns surface type, trail classification, MTB scale, etc.
 * Free, no API key needed. Caches for 30s (terrain doesn't change fast).
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_MS = 30_000;     // 30s cache
const RADIUS_M = 30;         // Search within 30m of GPS position
const MIN_INTERVAL_MS = 10_000; // Don't query more than once per 10s

export interface TrailInfo {
  /** Surface type: asphalt, gravel, dirt, grass, sand, etc. */
  surface: string;
  /** Highway type: track, path, cycleway, residential, etc. */
  highway: string;
  /** MTB difficulty scale (0-5, null if not rated) */
  mtb_scale: number | null;
  /** Trail name if available */
  name: string | null;
  /** Surface category for motor adjustment */
  category: 'paved' | 'gravel' | 'dirt' | 'technical';
  /** Trail width if available */
  width: string | null;
  /** Incline tag if available */
  incline: string | null;
  /** Raw OSM tags for debugging */
  tags: Record<string, string>;
  /** When this data was fetched */
  updated_at: number;
}

let cached: TrailInfo | null = null;
let lastFetchAt = 0;
let fetching = false;

function categorize(surface: string, highway: string, mtbScale: number | null): TrailInfo['category'] {
  if (mtbScale !== null && mtbScale >= 2) return 'technical';
  const pavedSurfaces = ['asphalt', 'concrete', 'paved', 'paving_stones', 'cobblestone'];
  const gravelSurfaces = ['gravel', 'fine_gravel', 'compacted', 'pebblestone'];
  if (pavedSurfaces.includes(surface)) return 'paved';
  if (gravelSurfaces.includes(surface)) return 'gravel';
  if (['dirt', 'earth', 'mud', 'sand', 'grass', 'ground', 'wood'].includes(surface)) return 'dirt';
  // Infer from highway type if surface not tagged
  if (['path', 'track'].includes(highway)) return 'dirt';
  if (['cycleway', 'residential', 'tertiary', 'secondary', 'primary'].includes(highway)) return 'paved';
  return 'gravel'; // default for unknown
}

export async function fetchTrailInfo(lat: number, lng: number): Promise<TrailInfo | null> {
  if (lat === 0 && lng === 0) return null;
  if (cached && Date.now() - lastFetchAt < CACHE_MS) return cached;
  if (fetching) return cached;
  if (Date.now() - lastFetchAt < MIN_INTERVAL_MS) return cached;

  fetching = true;
  try {
    // Overpass query: find nearest way (road/path/track) within radius
    const query = `[out:json][timeout:5];
      way(around:${RADIUS_M},${lat},${lng})[highway];
      out tags 1;`;

    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) {
      console.warn(`[Terrain] Overpass error: ${res.status}`);
      return cached;
    }

    const data = await res.json();
    const elements = data.elements as Array<{ tags?: Record<string, string> }>;

    if (!elements || elements.length === 0) {
      // No way found nearby — off-road
      cached = {
        surface: 'unknown', highway: 'off-road', mtb_scale: null,
        name: null, category: 'dirt', width: null, incline: null,
        tags: {}, updated_at: Date.now(),
      };
      lastFetchAt = Date.now();
      return cached;
    }

    // Pick the most relevant way (prefer paths/tracks over roads)
    const ranked = elements.sort((a, b) => {
      const aHw = a.tags?.highway ?? '';
      const bHw = b.tags?.highway ?? '';
      const priority: Record<string, number> = { path: 0, track: 1, cycleway: 2, footway: 3, residential: 4 };
      return (priority[aHw] ?? 5) - (priority[bHw] ?? 5);
    });

    const tags = ranked[0]?.tags ?? {};
    const surface = tags.surface ?? '';
    const highway = tags.highway ?? '';
    const mtbRaw = tags['mtb:scale'];
    const mtbScale = mtbRaw ? parseInt(mtbRaw, 10) : null;

    cached = {
      surface: surface || 'unknown',
      highway,
      mtb_scale: mtbScale !== null && !isNaN(mtbScale) ? mtbScale : null,
      name: tags.name ?? null,
      category: categorize(surface, highway, mtbScale),
      width: tags.width ?? null,
      incline: tags.incline ?? null,
      tags,
      updated_at: Date.now(),
    };
    lastFetchAt = Date.now();
    console.log(`[Terrain] ${cached.highway}/${cached.surface} → ${cached.category}${cached.mtb_scale !== null ? ` S${cached.mtb_scale}` : ''}${cached.name ? ` "${cached.name}"` : ''}`);
    return cached;
  } catch (err) {
    console.warn('[Terrain] Fetch failed:', err);
    return cached;
  } finally {
    fetching = false;
  }
}

export function getCachedTrail(): TrailInfo | null {
  return cached;
}
