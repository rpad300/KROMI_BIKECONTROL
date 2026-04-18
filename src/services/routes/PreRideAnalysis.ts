/**
 * PreRideAnalysis — estimates battery, nutrition, and time for a planned route.
 *
 * Uses PhysicsEngine to calculate Wh per segment, NutritionEngine constants
 * for glycogen/hydration, and current battery state for feasibility check.
 */

import type { RoutePoint } from './GPXParser';
import type { PreRideAnalysis, RouteWeatherSegment } from '../../store/routeStore';
import { computeForces, surfaceToCrr, airDensityFromTemp, CDA_PRESETS, type CdaPreset } from '../intelligence/PhysicsEngine';
import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { useBikeStore } from '../../store/bikeStore';
import { getCachedWeather } from '../weather/WeatherService';
import { getCachedOpenMeteo } from '../weather/OpenMeteoService';
import { batteryEstimationService } from '../battery/BatteryEstimationService';

// Carb fraction by effort level (simplified from NutritionEngine)
const CARB_FRACTION = { easy: 0.40, moderate: 0.65, hard: 0.85 };
const MECHANICAL_EFFICIENCY = 0.24;
const KCAL_PER_G_GLYCOGEN = 4.0;

// ── Gap #10: Open-Meteo forecast helper ──────────────────────

async function fetchOpenMeteoForecast(lat: number, lng: number): Promise<{
  temp_c: number;
  wind_speed: number;
  wind_direction: number;
  precipitation_prob: number;
}> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability&forecast_days=1`;

  const res = await fetch(url);
  const data = await res.json();

  // Get current hour's data
  const now = new Date();
  const hourIdx = now.getHours();

  return {
    temp_c: data.hourly?.temperature_2m?.[hourIdx] ?? 20,
    wind_speed: data.hourly?.windspeed_10m?.[hourIdx] ?? 0,
    wind_direction: data.hourly?.winddirection_10m?.[hourIdx] ?? 0,
    precipitation_prob: data.hourly?.precipitation_probability?.[hourIdx] ?? 0,
  };
}

/** Calculate bearing between two points (degrees, 0=North) */
function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/**
 * Gap #10: Sample weather along route at regular intervals.
 * Uses Open-Meteo (free, no API key required).
 */
export async function getRouteWeather(
  routePoints: RoutePoint[],
  sampleIntervalKm: number = 10,
): Promise<RouteWeatherSegment[]> {
  const segments: RouteWeatherSegment[] = [];
  if (routePoints.length < 2) return segments;

  let lastSampleDist = -sampleIntervalKm; // ensure first point is sampled

  for (let i = 0; i < routePoints.length; i++) {
    const point = routePoints[i]!;
    const distKm = point.distance_from_start_m / 1000;
    if (distKm - lastSampleDist < sampleIntervalKm && distKm > 0) continue;

    lastSampleDist = distKm;

    try {
      const weather = await fetchOpenMeteoForecast(point.lat, point.lng);

      // Calculate route heading at this point
      const nextIdx = Math.min(i + 5, routePoints.length - 1);
      const routeHeading = calculateBearing(
        point.lat, point.lng,
        routePoints[nextIdx]!.lat, routePoints[nextIdx]!.lng,
      );

      // Calculate headwind component relative to route heading
      const headwind = weather.wind_speed *
        Math.cos((weather.wind_direction - routeHeading) * Math.PI / 180);

      segments.push({
        distance_km: distKm,
        lat: point.lat,
        lng: point.lng,
        temp_c: weather.temp_c,
        wind_speed_kmh: weather.wind_speed,
        wind_direction_deg: weather.wind_direction,
        headwind_component_kmh: Math.round(headwind * 10) / 10,
        precipitation_probability: weather.precipitation_prob,
      });
    } catch (err) {
      console.warn(`[PreRide] Weather fetch failed at ${distKm.toFixed(1)}km:`, err);
    }
  }

  return segments;
}

/**
 * Analyze a route and produce battery/nutrition/time estimates.
 * Runs entirely client-side using PhysicsEngine.
 */
export function analyzeRoute(points: RoutePoint[]): PreRideAnalysis | null {
  if (!points || points.length < 2) return null;

  const settings = useSettingsStore.getState();
  const rider = settings.riderProfile;
  const bike = safeBikeConfig(settings.bikeConfig);
  const bikeState = useBikeStore.getState();

  const totalMass = (rider.weight_kg || 135) + (bike.weight_kg || 24);
  const wheelCircumM = (bike.wheel_circumference_mm || 2290) / 1000;
  const chainring = parseInt(bike.chainring_teeth?.replace(/\D/g, '') || '34') || 34;
  const sprockets = bike.cassette_sprockets?.length >= 2
    ? [...bike.cassette_sprockets].sort((a, b) => b - a)
    : [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10];

  // Weather for air density
  const weather = getCachedWeather() ?? getCachedOpenMeteo();
  const airDensity = weather ? airDensityFromTemp(weather.temp_c) : 1.225;
  const tempC = weather?.temp_c ?? 20;
  const crr = surfaceToCrr(null); // default, will be refined per segment when terrain data available

  let totalWh = 0;
  let totalTimeS = 0;
  let motorOffKm = 0;
  let demandingSegments = 0;
  let glycogenG = 0;
  let hydrationMl = 0;

  // Process in 200m segments
  const SEGMENT_M = 200;
  let segStart = 0;

  while (segStart < points.length - 1) {
    // Find segment end
    let segEnd = segStart + 1;
    while (
      segEnd < points.length - 1 &&
      points[segEnd]!.distance_from_start_m - points[segStart]!.distance_from_start_m < SEGMENT_M
    ) {
      segEnd++;
    }

    const p0 = points[segStart]!;
    const p1 = points[segEnd]!;
    const distM = p1.distance_from_start_m - p0.distance_from_start_m;
    if (distM < 10) { segStart = segEnd; continue; }

    const gradient = ((p1.elevation - p0.elevation) / distM) * 100;

    // Estimate speed for this gradient
    const estSpeed = estimateSpeed(gradient);
    const speedMs = estSpeed / 3.6;
    const segTimeS = speedMs > 0 ? distM / speedMs : 0;
    totalTimeS += segTimeS;

    // Physics
    const motorActive = estSpeed < 25;
    if (!motorActive) {
      motorOffKm += distM / 1000;
    }

    if (motorActive && speedMs > 0) {
      const forces = computeForces({
        speed_kmh: estSpeed,
        gradient_pct: gradient,
        cadence_rpm: 75, // assume comfortable cadence
        power_watts: 0,  // no power meter data for planning
        currentGear: 6,  // mid gear
        totalMass, wheelCircumM, chainring, sprockets,
        crr,
        cda: CDA_PRESETS[(bike.cda_preset || 'mtb_upright') as CdaPreset] ?? CDA_PRESETS.mtb_upright,
        airDensity, windComponent: 0,
      });

      const motorW = forces.P_motor_gap * forces.fadeFactor;
      totalWh += (motorW * segTimeS) / 3600;

      // Glycogen: metabolic cost of P_human
      const metabolicW = forces.P_human / MECHANICAL_EFFICIENCY;
      const kcalMin = metabolicW / 69.7;
      const effortLevel = gradient > 8 ? 'hard' : gradient > 3 ? 'moderate' : 'easy';
      const carbFrac = CARB_FRACTION[effortLevel];
      glycogenG += (kcalMin * carbFrac / KCAL_PER_G_GLYCOGEN) * (segTimeS / 60);
    } else if (speedMs > 0) {
      // Motor off segment — still burns glycogen from rider effort
      const metabolicW = (totalMass * 9.81 * Math.abs(Math.sin(Math.atan(gradient / 100))) * speedMs) / MECHANICAL_EFFICIENCY;
      const kcalMin = Math.max(2, metabolicW / 69.7); // minimum basal metabolic
      glycogenG += (kcalMin * CARB_FRACTION.easy / KCAL_PER_G_GLYCOGEN) * (segTimeS / 60);
    }

    // Hydration
    const estPower = 100; // rough average human power
    const tempFactor = Math.max(0, (tempC - 15) * 0.03);
    const sweatRateLH = 0.5 + (0.015 * estPower / 10) + tempFactor;
    hydrationMl += (sweatRateLH * 1000 * segTimeS) / 3600;

    if (Math.abs(gradient) > 10) demandingSegments++;

    segStart = segEnd;
  }

  // Battery feasibility
  const batteryEstimate = batteryEstimationService.getFullEstimate(
    bikeState.battery_percent || 100, 'power',
  );
  const remainingWh = batteryEstimate.remaining_wh;
  const margin = remainingWh > 0 ? ((remainingWh - totalWh) / remainingWh) * 100 : 0;

  // Nutrition recommendations
  const carbsNeeded = Math.round(glycogenG * 0.6); // replace ~60% of what's burned
  const fluidNeeded = Math.round(hydrationMl * 0.8); // replace ~80% of what's lost

  // Summary
  const parts: string[] = [];
  const totalKm = points[points.length - 1]!.distance_from_start_m / 1000;
  parts.push(`${totalKm.toFixed(1)}km, ${Math.round(totalTimeS / 60)}min estimados.`);
  parts.push(`Bateria: ${Math.round(totalWh)}Wh necessarios de ${Math.round(remainingWh)}Wh disponiveis (${Math.round(margin)}% margem).`);

  if (margin < 0) {
    parts.push('AVISO: Bateria pode nao chegar. Reduz assistencia ou carrega antes.');
  } else if (margin < 20) {
    parts.push('Margem apertada. Conserva bateria nos trocos planos.');
  }

  if (glycogenG > 300) {
    parts.push(`Leva ${Math.ceil(carbsNeeded / 40)} barras e ${Math.ceil(fluidNeeded / 500)} garrafas.`);
  }

  return {
    feasible: margin > 0,
    total_wh: Math.round(totalWh),
    battery_remaining_wh: Math.round(remainingWh),
    battery_margin_pct: Math.round(margin),
    estimated_time_min: Math.round(totalTimeS / 60),
    glycogen_g: Math.round(glycogenG),
    hydration_ml: Math.round(hydrationMl),
    carbs_needed_g: carbsNeeded,
    fluid_needed_ml: fluidNeeded,
    segment_count: Math.ceil(totalKm),
    demanding_segments: demandingSegments,
    motor_off_km: Math.round(motorOffKm * 10) / 10,
    summary: parts.join(' '),
    // Gap #10: Weather (populated by analyzeRouteWithWeather)
    routeWeather: [],
    avgHeadwind: 0,
    worstHeadwindSegment: null,
  };
}

/**
 * Gap #10: Async version of analyzeRoute that includes weather along the route.
 * Call this for pre-ride planning when network is available.
 */
export async function analyzeRouteWithWeather(
  points: RoutePoint[],
  sampleIntervalKm: number = 10,
): Promise<PreRideAnalysis | null> {
  // Run sync analysis first
  const base = analyzeRoute(points);
  if (!base) return null;

  // Fetch weather along route
  try {
    const routeWeather = await getRouteWeather(points, sampleIntervalKm);
    if (routeWeather.length === 0) return base;

    // Calculate average headwind
    const avgHeadwind = routeWeather.reduce((sum, s) => sum + s.headwind_component_kmh, 0) / routeWeather.length;

    // Find worst headwind segment
    const worstHeadwindSegment = routeWeather.reduce<RouteWeatherSegment | null>((worst, seg) => {
      if (!worst || seg.headwind_component_kmh > worst.headwind_component_kmh) return seg;
      return worst;
    }, null);

    // Re-calculate energy with wind data
    let windAdjustedWh = base.total_wh;
    if (Math.abs(avgHeadwind) > 3) {
      // Headwind adds roughly 3% energy per km/h of headwind
      const windFactor = 1 + (avgHeadwind * 0.03);
      windAdjustedWh = Math.round(base.total_wh * Math.max(0.5, windFactor));
    }

    // Update summary with weather info
    const weatherParts = [base.summary];
    if (avgHeadwind > 5) {
      weatherParts.push(`Vento contrario medio de ${Math.round(avgHeadwind)}km/h. Energia ajustada para ${windAdjustedWh}Wh.`);
    } else if (avgHeadwind < -5) {
      weatherParts.push(`Vento a favor medio de ${Math.round(Math.abs(avgHeadwind))}km/h.`);
    }

    const precipSegments = routeWeather.filter(s => s.precipitation_probability > 50);
    if (precipSegments.length > 0) {
      weatherParts.push(`Probabilidade de chuva em ${precipSegments.length} pontos da rota.`);
    }

    return {
      ...base,
      total_wh: windAdjustedWh,
      battery_margin_pct: base.battery_remaining_wh > 0
        ? Math.round(((base.battery_remaining_wh - windAdjustedWh) / base.battery_remaining_wh) * 100)
        : 0,
      feasible: base.battery_remaining_wh >= windAdjustedWh,
      routeWeather,
      avgHeadwind: Math.round(avgHeadwind * 10) / 10,
      worstHeadwindSegment,
      summary: weatherParts.join(' '),
    };
  } catch (err) {
    console.warn('[PreRide] Weather analysis failed, using base analysis:', err);
    return base;
  }
}

/** Estimate speed for a given gradient (km/h) */
function estimateSpeed(gradient: number): number {
  if (gradient > 15) return 8;
  if (gradient > 10) return 12;
  if (gradient > 5) return 18;
  if (gradient > 0) return 22;
  if (gradient > -5) return 25;
  return 30;
}
