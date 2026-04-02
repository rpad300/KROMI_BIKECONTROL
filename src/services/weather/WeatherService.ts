/**
 * WeatherService — fetches current weather from Google Maps Weather API.
 * Uses same API key as Google Maps. Caches for 10 minutes.
 * Endpoint: weather.googleapis.com/v1/currentConditions:lookup
 */

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

export interface WeatherData {
  temp_c: number;
  feels_like_c: number;
  humidity_pct: number;
  wind_speed_kmh: number;
  wind_dir_deg: number;
  cloud_cover_pct: number;
  description: string;
  uv_index: number;
  updated_at: number;
}

let cached: WeatherData | null = null;
let lastFetchAt = 0;
let fetching = false;

export async function fetchWeather(lat: number, lng: number): Promise<WeatherData | null> {
  if (!API_KEY) return null;
  if (lat === 0 && lng === 0) return null;

  // Return cache if fresh
  if (cached && Date.now() - lastFetchAt < CACHE_MS) return cached;
  if (fetching) return cached;

  fetching = true;
  try {
    const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${API_KEY}&location.latitude=${lat}&location.longitude=${lng}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Weather] API error: ${res.status}`);
      return cached;
    }

    const data = await res.json();
    cached = {
      temp_c: data.temperature?.degrees ?? 0,
      feels_like_c: data.feelsLikeTemperature?.degrees ?? 0,
      humidity_pct: data.relativeHumidity ?? 0,
      wind_speed_kmh: data.wind?.speed?.value ?? 0,
      wind_dir_deg: data.wind?.direction?.degrees ?? 0,
      cloud_cover_pct: data.cloudCover ?? 0,
      description: data.weatherCondition?.description?.text ?? '',
      uv_index: data.uvIndex ?? 0,
      updated_at: Date.now(),
    };
    lastFetchAt = Date.now();
    console.log(`[Weather] ${cached.temp_c}°C, vento ${cached.wind_speed_kmh}km/h, humidade ${cached.humidity_pct}%`);
    return cached;
  } catch (err) {
    console.warn('[Weather] Fetch failed:', err);
    return cached;
  } finally {
    fetching = false;
  }
}

export function getCachedWeather(): WeatherData | null {
  return cached;
}
