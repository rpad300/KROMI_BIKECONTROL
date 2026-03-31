import { useEffect, useRef, useState } from 'react';
import { useMapStore } from '../../store/mapStore';
import { useBikeStore } from '../../store/bikeStore';
import { initGoogleMaps, isMapsLoaded } from '../../services/maps/GoogleMapsService';
import { ASSIST_MODE_LABELS } from '../../types/bike.types';

export function MapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const gpsActive = useMapStore((s) => s.gpsActive);
  const speed = useBikeStore((s) => s.speed_kmh);
  const battery = useBikeStore((s) => s.battery_percent);
  const assistMode = useBikeStore((s) => s.assist_mode);

  // Initialize Google Maps
  useEffect(() => {
    initGoogleMaps()
      .then(() => setReady(true))
      .catch((err) => setError(`Maps: ${err}`));
  }, []);

  // Create map instance
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstance.current) return;
    if (!isMapsLoaded()) return;

    mapInstance.current = new google.maps.Map(mapRef.current, {
      center: { lat: lat || 38.7, lng: lng || -9.14 }, // Default: Lisbon
      zoom: 15,
      mapTypeId: 'terrain',
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        // Dark theme for night riding
        { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
      ],
    });
  }, [ready, lat, lng]);

  // Update marker position
  useEffect(() => {
    if (!mapInstance.current || !lat || !lng) return;

    const position = { lat, lng };

    if (!markerRef.current) {
      const pin = document.createElement('div');
      pin.className = 'w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg';
      markerRef.current = new google.maps.marker.AdvancedMarkerElement({
        map: mapInstance.current,
        position,
        content: pin,
      });
    } else {
      markerRef.current.position = position;
    }

    mapInstance.current.panTo(position);
  }, [lat, lng]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900 p-4">
        <div className="text-center">
          <div className="text-red-400 text-lg mb-2">Mapa indisponivel</div>
          <div className="text-gray-500 text-sm">{error}</div>
          <div className="text-gray-600 text-xs mt-2">
            Configura VITE_GOOGLE_MAPS_API_KEY no .env
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Map */}
      <div ref={mapRef} className="flex-1" />

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gray-900/90 px-4 py-2 flex items-center justify-between">
        <span className="text-white font-bold tabular-nums">
          {speed.toFixed(1)} km/h
        </span>
        <span className="text-blue-400 font-bold">
          {ASSIST_MODE_LABELS[assistMode]}
        </span>
        <span className="text-gray-400">
          🔋 {battery}%
        </span>
      </div>

      {/* GPS status */}
      {!gpsActive && (
        <div className="absolute top-4 left-4 bg-red-900/80 px-3 py-1 rounded-lg text-sm text-red-300">
          GPS inactivo
        </div>
      )}
    </div>
  );
}
