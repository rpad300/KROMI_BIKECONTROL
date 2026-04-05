/**
 * RouteService — CRUD for routes in Supabase.
 *
 * Uses REST API directly (same pattern as RideHistory).
 * Handles: save, list, get, delete, update favorites, link to ride session.
 */

import type { ParsedRoute, RoutePoint } from './GPXParser';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface SavedRoute {
  id: string;
  name: string;
  description: string;
  source: 'gpx' | 'komoot' | 'manual';
  source_url: string | null;
  points: RoutePoint[];
  total_distance_km: number;
  total_elevation_gain_m: number;
  total_elevation_loss_m: number;
  surface_summary: Record<string, number> | null;
  max_gradient_pct: number;
  avg_gradient_pct: number;
  estimated_wh: number | null;
  estimated_time_min: number | null;
  estimated_glycogen_g: number | null;
  bbox_north: number;
  bbox_south: number;
  bbox_east: number;
  bbox_west: number;
  is_favorite: boolean;
  ride_count: number;
  last_ridden_at: string | null;
  created_at: string;
  updated_at: string;
}

function headers(): Record<string, string> {
  return {
    'apikey': SUPABASE_KEY || '',
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

function baseUrl(): string {
  return `${SUPABASE_URL}/rest/v1/routes`;
}

/** Save a new route to Supabase. Returns the saved route with ID. */
export async function saveRoute(
  parsed: ParsedRoute,
  source: 'gpx' | 'komoot' = 'gpx',
  sourceUrl?: string,
  estimates?: { wh: number; time_min: number; glycogen_g: number },
): Promise<SavedRoute | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  const body = {
    name: parsed.name,
    description: parsed.description,
    source,
    source_url: sourceUrl || null,
    points: parsed.points,
    total_distance_km: parsed.total_distance_km,
    total_elevation_gain_m: parsed.total_elevation_gain_m,
    total_elevation_loss_m: parsed.total_elevation_loss_m,
    max_gradient_pct: parsed.max_gradient_pct,
    avg_gradient_pct: parsed.avg_gradient_pct,
    estimated_wh: estimates?.wh ?? null,
    estimated_time_min: estimates?.time_min ?? null,
    estimated_glycogen_g: estimates?.glycogen_g ?? null,
    bbox_north: parsed.bbox.north,
    bbox_south: parsed.bbox.south,
    bbox_east: parsed.bbox.east,
    bbox_west: parsed.bbox.west,
  };

  try {
    const res = await fetch(baseUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[RouteService] Save failed:', res.status);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  } catch (err) {
    console.error('[RouteService] Save error:', err);
    return null;
  }
}

/** List all saved routes, newest first. */
export async function listRoutes(): Promise<SavedRoute[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  try {
    const res = await fetch(
      `${baseUrl()}?order=updated_at.desc&select=id,name,description,source,total_distance_km,total_elevation_gain_m,total_elevation_loss_m,max_gradient_pct,estimated_wh,estimated_time_min,is_favorite,ride_count,last_ridden_at,created_at,updated_at,bbox_north,bbox_south,bbox_east,bbox_west`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** Get a single route with full points data. */
export async function getRoute(id: string): Promise<SavedRoute | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  try {
    const res = await fetch(`${baseUrl()}?id=eq.${id}`, { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] ?? null;
  } catch {
    return null;
  }
}

/** Delete a route. */
export async function deleteRoute(id: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;

  try {
    const res = await fetch(`${baseUrl()}?id=eq.${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Toggle favorite status. */
export async function toggleFavorite(id: string, isFavorite: boolean): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;

  try {
    const res = await fetch(`${baseUrl()}?id=eq.${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ is_favorite: isFavorite, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Update route estimates after pre-ride analysis. */
export async function updateEstimates(
  id: string,
  estimates: { wh: number; time_min: number; glycogen_g: number },
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;

  try {
    const res = await fetch(`${baseUrl()}?id=eq.${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({
        estimated_wh: estimates.wh,
        estimated_time_min: estimates.time_min,
        estimated_glycogen_g: estimates.glycogen_g,
        updated_at: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Link a ride session to a route + increment ride count. */
export async function linkRideToRoute(sessionId: string, routeId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;

  try {
    // Update ride_sessions
    await fetch(`${SUPABASE_URL}/rest/v1/ride_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ route_id: routeId }),
    });

    // Increment ride_count + update last_ridden_at
    await fetch(`${baseUrl()}?id=eq.${routeId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({
        ride_count: undefined, // will use RPC below
        last_ridden_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });

    // Increment ride_count via direct SQL (PATCH can't do increment)
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_route_ride_count`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ route_uuid: routeId }),
    }).catch(() => {
      // RPC might not exist yet — fallback: just update last_ridden_at
    });

    return true;
  } catch {
    return false;
  }
}

/** Update route name or description. */
export async function updateRoute(
  id: string,
  updates: { name?: string; description?: string },
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;

  try {
    const res = await fetch(`${baseUrl()}?id=eq.${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
