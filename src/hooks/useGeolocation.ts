import { useEffect, useRef } from 'react';
import { useMapStore } from '../store/mapStore';

/**
 * Watches GPS position with high accuracy (for bike speed and heading).
 * Updates mapStore with lat, lng, heading, accuracy, altitude, speed.
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

        store.setPosition(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.heading ?? store.heading, // Keep last heading if null
          pos.coords.accuracy
        );

        if (pos.coords.altitude !== null) {
          store.setAltitude(pos.coords.altitude);
        }
        if (pos.coords.speed !== null) {
          store.setGpsSpeed(pos.coords.speed);
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
      }
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      useMapStore.getState().setGpsActive(false);
    };
  }, []);
}
