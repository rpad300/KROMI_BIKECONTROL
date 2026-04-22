import { useEffect, useRef } from 'react';
import { useMapStore } from '../store/mapStore';
import { useBikeStore } from '../store/bikeStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { elevationService } from '../services/maps/ElevationService';

const ELEVATION_TICK_MS = 3000; // Base tick (used at normal speeds)
const ELEVATION_SLOW_MS = 10000; // Slower tick at <5 km/h
const ELEVATION_BACKOFF_MS = 30000; // After 10 failures, reduce to every 30s
let elevationConsecutiveFailures = 0;
let lastElevationFetchAt = 0;

/**
 * Always-on elevation data provider.
 *
 * Fetches elevation profile ahead of the rider and pushes it to
 * autoAssistStore for UI consumption (ElevationProfile, ClimbApproach,
 * ClimbDashboard, GradientHero).
 *
 * This runs INDEPENDENTLY of auto-assist mode — the rider should
 * ALWAYS see gradient data, climb profiles, and elevation charts
 * regardless of whether auto-assist or KromiEngine is enabled.
 *
 * Motor control decisions are handled separately by useAutoAssist
 * and useMotorControl hooks.
 */
export function useElevationData() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      // After 10 consecutive failures, back off to reduce API spam
      if (elevationConsecutiveFailures >= 10) {
        // Only run every ELEVATION_BACKOFF_MS during backoff
        if (Date.now() % ELEVATION_BACKOFF_MS > ELEVATION_TICK_MS + 500) return;
      }

      const map = useMapStore.getState();
      if (!map.gpsActive || map.latitude === 0) return;

      // Speed-gated: skip if moving slowly and fetched recently
      const speed = useBikeStore.getState().speed_kmh;
      const now = Date.now();
      const interval = speed < 2 ? ELEVATION_BACKOFF_MS : speed < 5 ? ELEVATION_SLOW_MS : ELEVATION_TICK_MS;
      if (now - lastElevationFetchAt < interval) return;
      lastElevationFetchAt = now;

      const config = useSettingsStore.getState().autoAssist;
      const lookaheadM = config?.lookahead_m ?? 500;

      try {
        const profile = await elevationService.getElevationByHeading(
          map.latitude,
          map.longitude,
          map.heading,
          lookaheadM,
        );

        elevationConsecutiveFailures = 0; // reset on success

        if (profile.length >= 2) {
          // Analyze terrain from profile
          const gradients = profile.map((p) => p.gradient_pct);
          const avgGrad = gradients.reduce((a, b) => a + b, 0) / gradients.length;
          const maxGrad = Math.max(...gradients.map(Math.abs));
          const currentGrad = profile[0]?.gradient_pct ?? 0;

          // Find next transition (significant gradient change)
          let nextTransition = null;
          for (let i = 1; i < profile.length; i++) {
            const pt = profile[i];
            if (!pt) continue;
            const delta = Math.abs(pt.gradient_pct - currentGrad);
            if (delta > 3 && pt.distance_from_current > 50) {
              const gradAfter = pt.gradient_pct;
              nextTransition = {
                distance_m: Math.round(pt.distance_from_current),
                gradient_after_pct: gradAfter,
                type: gradAfter > currentGrad ? 'flat_to_climb' as const : 'climb_to_flat' as const,
                is_preemptive: pt.distance_from_current < 150,
                target_mode: gradAfter > 12 ? 5 : gradAfter > 8 ? 4 : gradAfter > 5 ? 3 : gradAfter > 3 ? 2 : 1,
              };
              break;
            }
          }

          useAutoAssistStore.getState().setTerrain({
            current_gradient_pct: currentGrad,
            avg_upcoming_gradient_pct: avgGrad,
            max_upcoming_gradient_pct: maxGrad,
            next_transition: nextTransition,
            profile,
          });
        }
      } catch (err) {
        elevationConsecutiveFailures++;
        if (elevationConsecutiveFailures <= 3) {
          console.warn('[ElevationData] Fetch failed:', err);
        }
        // After 10 failures, frequency is automatically reduced (see top of callback)
      }
    }, ELEVATION_TICK_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
