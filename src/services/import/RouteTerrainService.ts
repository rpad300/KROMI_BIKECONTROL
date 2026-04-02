/**
 * RouteTerrainService — queries OSM Overpass for terrain along a GPS route.
 * Samples N points along the route, queries terrain for each.
 * Returns surface type per sampled point, interpolated for all records.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MAX_SAMPLES = 30; // Query terrain at 30 points along the route (avoid API spam)

export type SurfaceCategory = 'paved' | 'gravel' | 'dirt' | 'technical';

export interface RouteTerrain {
  /** Surface category per record index */
  surfaces: SurfaceCategory[];
  /** Summary: percentage of route per surface */
  summary: Record<SurfaceCategory, number>;
}

const PAVED = ['asphalt', 'concrete', 'paved', 'paving_stones', 'cobblestone'];
const GRAVEL = ['gravel', 'fine_gravel', 'compacted', 'pebblestone'];
const DIRT = ['dirt', 'earth', 'mud', 'sand', 'grass', 'ground', 'wood'];

function categorize(surface: string, highway: string, mtbScale: number | null): SurfaceCategory {
  if (mtbScale !== null && mtbScale >= 2) return 'technical';
  if (PAVED.includes(surface)) return 'paved';
  if (GRAVEL.includes(surface)) return 'gravel';
  if (DIRT.includes(surface)) return 'dirt';
  if (['path', 'track'].includes(highway)) return 'dirt';
  if (['cycleway', 'residential', 'tertiary', 'secondary', 'primary'].includes(highway)) return 'paved';
  return 'gravel';
}

async function querySurface(lat: number, lng: number): Promise<SurfaceCategory> {
  try {
    const query = `[out:json][timeout:5];way(around:30,${lat},${lng})[highway];out tags 1;`;
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) return 'gravel';

    const data = await res.json();
    const elements = data.elements as Array<{ tags?: Record<string, string> }>;
    if (!elements?.length) return 'dirt'; // off-road

    // Prefer paths/tracks over roads
    const ranked = elements.sort((a, b) => {
      const pr: Record<string, number> = { path: 0, track: 1, cycleway: 2, footway: 3 };
      return (pr[a.tags?.highway ?? ''] ?? 5) - (pr[b.tags?.highway ?? ''] ?? 5);
    });

    const tags = ranked[0]?.tags ?? {};
    const mtbRaw = tags['mtb:scale'];
    return categorize(tags.surface ?? '', tags.highway ?? '', mtbRaw ? parseInt(mtbRaw) : null);
  } catch {
    return 'gravel';
  }
}

/**
 * Enrich route records with terrain data from OSM.
 * Samples MAX_SAMPLES points, interpolates between them.
 */
export async function enrichRouteWithTerrain(
  records: Array<{ lat: number; lng: number }>
): Promise<RouteTerrain> {
  const total = records.length;
  if (total === 0) return { surfaces: [], summary: { paved: 0, gravel: 100, dirt: 0, technical: 0 } };

  // Sample N evenly spaced points
  const step = Math.max(1, Math.floor(total / MAX_SAMPLES));
  const sampleIndices: number[] = [];
  for (let i = 0; i < total; i += step) sampleIndices.push(i);
  if (sampleIndices[sampleIndices.length - 1] !== total - 1) sampleIndices.push(total - 1);

  console.log(`[RouteTerrain] Querying ${sampleIndices.length} points along ${total}-point route...`);

  // Query each sample with 1s delay between requests (respect Overpass rate limits)
  const sampleResults: Array<{ idx: number; surface: SurfaceCategory }> = [];
  for (const idx of sampleIndices) {
    const r = records[idx]!;
    if (r.lat === 0 && r.lng === 0) {
      sampleResults.push({ idx, surface: 'gravel' });
      continue;
    }
    const surface = await querySurface(r.lat, r.lng);
    sampleResults.push({ idx, surface });
    // Rate limit: 1s between requests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Interpolate: fill all records between samples with nearest sample value
  const surfaces: SurfaceCategory[] = new Array(total).fill('gravel');
  for (let s = 0; s < sampleResults.length - 1; s++) {
    const from = sampleResults[s]!;
    const to = sampleResults[s + 1]!;
    for (let i = from.idx; i < to.idx; i++) {
      // Use the surface of the nearest sample
      surfaces[i] = (i - from.idx) < (to.idx - i) ? from.surface : to.surface;
    }
  }
  // Last segment
  const last = sampleResults[sampleResults.length - 1]!;
  for (let i = last.idx; i < total; i++) surfaces[i] = last.surface;

  // Summary
  const counts: Record<SurfaceCategory, number> = { paved: 0, gravel: 0, dirt: 0, technical: 0 };
  for (const s of surfaces) counts[s]++;
  const summary: Record<SurfaceCategory, number> = {
    paved: Math.round(counts.paved / total * 100),
    gravel: Math.round(counts.gravel / total * 100),
    dirt: Math.round(counts.dirt / total * 100),
    technical: Math.round(counts.technical / total * 100),
  };

  console.log(`[RouteTerrain] Summary: ${summary.paved}% paved, ${summary.gravel}% gravel, ${summary.dirt}% dirt, ${summary.technical}% technical`);
  return { surfaces, summary };
}
