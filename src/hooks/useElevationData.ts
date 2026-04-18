import { useEffect, useRef } from 'react';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { elevationService } from '../services/maps/ElevationService';

const ELEVATION_TICK_MS = 3000; // Fetch elevation every 3 seconds

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
      const map = useMapStore.getState();
      if (!map.gpsActive || map.latitude === 0) return;

      const config = useSettingsStore.getState().autoAssist;
      const lookaheadM = config?.lookahead_m ?? 500;

      try {
        const profile = await elevationService.getElevationByHeading(
          map.latitude,
          map.longitude,
          map.heading,
          lookaheadM,
        );

        if (profile.length >= 2) {
          // Analyze terrain from profile
          const gradients = profile.map((p) => p.gradient_pct);
          const avgGrad = gradients.reduce((a, b) => a + b, 0) / gradients.length;
          const maxGrad = Math.max(...gradients.map(Math.abs));
          const currentGrad = profile[0]?.gradient_pct ?? 0;

          // Find next transition (significant gradient change)
          let nextTransition = null;
          for (let i = 1; i < profile.length; i++) {
            const delta = Math.abs(profile[i]!.gradient_pct - currentGrad);
            if (delta > 3 && profile[i]!.distance_from_current > 50) {
              const gradAfter = profile[i]!.gradient_pct;
              nextTransition = {
                distance_m: Math.round(profile[i]!.distance_from_current),
                gradient_after_pct: gradAfter,
                type: gradAfter > currentGrad ? 'flat_to_climb' as const : 'climb_to_flat' as const,
                is_preemptive: profile[i]!.distance_from_current < 150,
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
        // Elevation API unavailable — don't crash, just skip this tick
      }
    }, ELEVATION_TICK_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
