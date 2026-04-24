import { useEffect, useRef } from 'react';
import { useMapStore } from '../store/mapStore';
import { useBikeStore } from '../store/bikeStore';
import { processGPSFix } from '../services/gps/GPSFilterEngine';

/**
 * Watches GPS position with high accuracy.
 * Passes raw fixes through GPSFilterEngine (Kalman filter + quality gate).
 * Updates mapStore with filtered coords.
 * Updates bikeStore.elevation_gain_m live.
 *
 * Recording decisions (shouldRecord) are consumed by RideSessionManager
 * via onShouldRecord callback.
 */
export function useGeolocation() {
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      useMapStore.getState().setGpsError('Geolocation nao suportada');
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const store = useMapStore.getState();
        store.setGpsActive(true);
        store.setGpsError(null);

        // Use BLE speed if available, fallback to GPS speed for ride recording without bike
        const bleSpeed = useBikeStore.getState().speed_kmh;
        const gpsSpeedMs = pos.coords.speed;
        const gpsSpeedKmh = gpsSpeedMs != null && gpsSpeedMs >= 0 ? gpsSpeedMs * 3.6 : 0;
        const bikeSpeed = bleSpeed > 0 ? bleSpeed : gpsSpeedKmh;

        const result = processGPSFix(
          {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            altitude: pos.coords.altitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading,
            timestamp: pos.timestamp,
          },
          bikeSpeed,
        );

        // Update mapStore with Kalman-filtered coords
        store.setPosition(result.lat, result.lng, result.heading ?? store.heading, result.accuracy);
        store.setGpsQuality(result.gpsQuality);

        if (result.altitude !== null) {
          store.setAltitude(result.altitude, pos.coords.altitude);
        }
        if (pos.coords.speed !== null) {
          store.setGpsSpeed(pos.coords.speed);
        }

        // GPS fallback: update bikeStore speed/distance when BLE not connected
        // This makes all dashboard widgets show GPS data automatically
        const bike = useBikeStore.getState();
        if (bike.ble_status !== 'connected' || bike.speed_kmh === 0) {
          if (gpsSpeedKmh > 0) bike.setSpeed(gpsSpeedKmh);
          // Distance is tracked via mapStore.gpsDistanceKm (see setPosition)
        }

        // Update live elevation gain in bikeStore
        useBikeStore.getState().setElevationGain(result.elevationGain);

        // Notify RideSessionManager to record a point
        if (result.shouldRecord && _onRecordCallbacks.size > 0) {
          _onRecordCallbacks.forEach((cb) => cb());
        }
      },
      (err) => {
        useMapStore.getState().setGpsError(err.message);
        useMapStore.getState().setGpsActive(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      },
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      useMapStore.getState().setGpsActive(false);
    };
  }, []);
}

// ── Recording callback for RideSessionManager ──────────────────────

type RecordCallback = () => void;
const _onRecordCallbacks = new Set<RecordCallback>();

/** Register a callback to be called when GPSFilterEngine decides to record a point */
export function onShouldRecord(cb: RecordCallback): () => void {
  _onRecordCallbacks.add(cb);
  return () => { _onRecordCallbacks.delete(cb); };
}
