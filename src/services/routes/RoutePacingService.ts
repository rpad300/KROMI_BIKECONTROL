// src/services/routes/RoutePacingService.ts
/**
 * RoutePacingService — feeds route_remaining_km to KromiCore
 * and monitors battery feasibility during navigation.
 */

import { useRouteStore } from '../../store/routeStore';
import { useBikeStore } from '../../store/bikeStore';
import { batteryEstimationService } from '../battery/BatteryEstimationService';

let pacingInterval: ReturnType<typeof setInterval> | null = null;

/** Start battery pacing — updates KromiCore every 30s with route_remaining_km */
export function startPacing() {
  stopPacing();

  pacingInterval = setInterval(() => {
    const { navigation, activeRoutePoints } = useRouteStore.getState();
    if (!navigation.active || activeRoutePoints.length < 2) return;

    const remainingKm = navigation.distanceRemaining_m / 1000;
    const batteryPct = useBikeStore.getState().battery_percent;

    // Send route_remaining_km to bridge (KromiCore uses this for pacing)
    try {
      import('../bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
        if (wsClient.isConnected) {
          wsClient.send({
            type: 'kromiParams',
            route_remaining_km: Math.round(remainingKm * 10) / 10,
          });
        }
      });
    } catch {}

    // Check feasibility
    const estimate = batteryEstimationService.getFullEstimate(batteryPct, 'power');
    const rangeKm = estimate.range_km;

    if (rangeKm > 0 && remainingKm > 0) {
      const ratio = rangeKm / remainingKm;
      if (ratio < 0.8) {
        console.warn(`[Pacing] Battery insufficient: range=${rangeKm.toFixed(1)}km, remaining=${remainingKm.toFixed(1)}km (${(ratio * 100).toFixed(0)}%)`);
      }
    }
  }, 30_000);

  // Immediate first update
  const { navigation } = useRouteStore.getState();
  if (navigation.active) {
    const remainingKm = navigation.distanceRemaining_m / 1000;
    import('../bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
      if (wsClient.isConnected) {
        wsClient.send({
          type: 'kromiParams',
          route_remaining_km: Math.round(remainingKm * 10) / 10,
        });
      }
    }).catch(() => {});
  }
}

/** Stop battery pacing */
export function stopPacing() {
  if (pacingInterval) {
    clearInterval(pacingInterval);
    pacingInterval = null;
  }
  // Clear route from KromiCore
  import('../bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
    if (wsClient.isConnected) {
      wsClient.send({ type: 'kromiParams', route_remaining_km: -1 });
    }
  }).catch(() => {});
}
