import { useEffect, useState } from 'react';
import { useMapStore } from '../../store/mapStore';
import { fetchWeather, type WeatherData } from '../../services/weather/WeatherService';

const WIND_ARROWS = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'] as const;

function windArrow(deg: number): string {
  return WIND_ARROWS[Math.round(deg / 45) % 8] ?? '↑';
}

export function WeatherWidget() {
  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    if (!lat || !lng) return;
    fetchWeather(lat, lng).then(setWeather);
    const interval = setInterval(() => {
      fetchWeather(lat, lng).then(setWeather);
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [lat !== 0, lng !== 0]);

  if (!weather) return null;

  const tempColor = weather.temp_c > 30 ? 'text-red-400'
    : weather.temp_c > 20 ? 'text-yellow-400'
    : weather.temp_c > 10 ? 'text-emerald-400'
    : weather.temp_c > 0 ? 'text-blue-400' : 'text-blue-300';

  const weatherIcon = weather.cloud_cover_pct > 70 ? 'cloud'
    : weather.cloud_cover_pct > 30 ? 'partly_cloudy_day'
    : 'clear_day';

  return (
    <div className="bg-gray-800 rounded-xl p-2 flex items-center gap-3">
      <span className="material-symbols-outlined text-xl text-gray-400">{weatherIcon}</span>

      <div className="flex items-baseline gap-0.5">
        <span className={`text-lg font-black tabular-nums ${tempColor}`}>{Math.round(weather.temp_c)}</span>
        <span className="text-[9px] text-gray-600">°C</span>
      </div>

      <div className="text-[9px] text-gray-500">
        ST {Math.round(weather.feels_like_c)}°
      </div>

      <div className="flex items-center gap-0.5 ml-auto">
        <span className="text-[10px] text-gray-500">{windArrow(weather.wind_dir_deg)}</span>
        <span className="text-xs text-gray-400 tabular-nums">{Math.round(weather.wind_speed_kmh)}</span>
        <span className="text-[8px] text-gray-600">km/h</span>
      </div>

      <div className="flex items-center gap-0.5">
        <span className="material-symbols-outlined text-xs text-blue-400">water_drop</span>
        <span className="text-xs text-gray-400 tabular-nums">{weather.humidity_pct}%</span>
      </div>
    </div>
  );
}
