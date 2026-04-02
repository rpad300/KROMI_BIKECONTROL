/**
 * HistoricalWeatherService — fetches past weather for a specific date/location.
 * Uses Open-Meteo Archive API (free, no API key, data from 1940).
 * Returns hourly weather for the ride's date and location.
 */

export interface HistoricalWeather {
  temp_c: number;
  feels_like_c: number;
  humidity_pct: number;
  wind_speed_kmh: number;
  wind_dir_deg: number;
  precipitation_mm: number;
}

/**
 * Fetch historical weather for a ride.
 * @param lat - GPS latitude (start of ride)
 * @param lng - GPS longitude (start of ride)
 * @param date - Ride date (ISO string or Date)
 * @param hour - Hour of the ride (0-23) to pick closest data
 * @returns Weather conditions at that time, or null on error
 */
export async function fetchHistoricalWeather(
  lat: number, lng: number, date: Date, hour: number
): Promise<HistoricalWeather | null> {
  if (lat === 0 && lng === 0) return null;

  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}`
      + `&start_date=${dateStr}&end_date=${dateStr}`
      + `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,apparent_temperature`
      + `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[HistWeather] API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const hourly = data.hourly;
    if (!hourly?.time?.length) return null;

    // Find the closest hour
    const idx = Math.min(Math.max(0, hour), hourly.time.length - 1);

    const result: HistoricalWeather = {
      temp_c: hourly.temperature_2m?.[idx] ?? 0,
      feels_like_c: hourly.apparent_temperature?.[idx] ?? hourly.temperature_2m?.[idx] ?? 0,
      humidity_pct: hourly.relative_humidity_2m?.[idx] ?? 0,
      wind_speed_kmh: hourly.wind_speed_10m?.[idx] ?? 0,
      wind_dir_deg: hourly.wind_direction_10m?.[idx] ?? 0,
      precipitation_mm: hourly.precipitation?.[idx] ?? 0,
    };

    console.log(`[HistWeather] ${dateStr} ${hour}h: ${result.temp_c}°C, vento ${result.wind_speed_kmh}km/h, humidade ${result.humidity_pct}%`);
    return result;
  } catch (err) {
    console.warn('[HistWeather] Fetch failed:', err);
    return null;
  }
}
