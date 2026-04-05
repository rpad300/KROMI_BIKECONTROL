/**
 * OpenMeteoService — free weather API (no key needed).
 * Returns wind speed/direction + temperature for physics engine.
 * Fallback when Google Weather API is unavailable or paid.
 * Cache: 10 minutes. Rate: max 1 request per 10min.
 */

import type { WeatherData } from './WeatherService';

const CACHE_MS = 10 * 60 * 1000; // 10 minutes

let cached: WeatherData | null = null;
let lastFetchAt = 0;
let fetching = false;

export async function fetchOpenMeteoWeather(lat: number, lng: number): Promise<WeatherData | null> {
  if (lat === 0 && lng === 0) return null;
  if (cached && Date.now() - lastFetchAt < CACHE_MS) return cached;
  if (fetching) return cached;

  fetching = true;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
      + `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[OpenMeteo] API error: ${res.status}`);
      return cached;
    }

    const data = await res.json();
    const c = data.current;
    if (!c) return cached;

    cached = {
      temp_c: c.temperature_2m ?? 20,
      feels_like_c: c.temperature_2m ?? 20,
      humidity_pct: c.relative_humidity_2m ?? 50,
      wind_speed_kmh: c.wind_speed_10m ?? 0,
      wind_dir_deg: c.wind_direction_10m ?? 0,
      cloud_cover_pct: 0,
      description: '',
      uv_index: 0,
      updated_at: Date.now(),
    };
    lastFetchAt = Date.now();
    console.log(`[OpenMeteo] ${cached.temp_c}°C, vento ${cached.wind_speed_kmh}km/h @ ${cached.wind_dir_deg}°`);
    return cached;
  } catch (err) {
    console.warn('[OpenMeteo] Fetch failed:', err);
    return cached;
  } finally {
    fetching = false;
  }
}

export function getCachedOpenMeteo(): WeatherData | null {
  return cached;
}
