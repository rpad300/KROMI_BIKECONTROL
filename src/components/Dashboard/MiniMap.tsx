import { useEffect, useRef, useState } from 'react';
import { useMapStore } from '../../store/mapStore';
import { initGoogleMaps, isMapsLoaded } from '../../services/maps/GoogleMapsService';

/**
 * MiniMap — compact Google Map for the Dashboard.
 * Shows current position with a marker, auto-follows rider.
 */
export function MiniMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [ready, setReady] = useState(false);

  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const alt = useMapStore((s) => s.altitude);
  const accuracy = useMapStore((s) => s.accuracy);
  const gpsError = useMapStore((s) => s.gpsError);

  useEffect(() => {
    initGoogleMaps().then(() => setReady(true)).catch(() => {});
  }, []);

  // Create map
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstance.current) return;
    if (!isMapsLoaded()) return;

    mapInstance.current = new google.maps.Map(mapRef.current, {
      center: { lat: lat || 41.19, lng: lng || -8.43 },
      zoom: 15,
      mapTypeId: 'terrain',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
      ],
    });
  }, [ready, lat, lng]);

  // Update position
  useEffect(() => {
    if (!mapInstance.current || !lat || !lng) return;
    const pos = { lat, lng };
    mapInstance.current.panTo(pos);

    if (!markerRef.current && isMapsLoaded()) {
      const dot = document.createElement('div');
      dot.style.cssText = 'width:14px;height:14px;background:#10b981;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px #10b981';
      markerRef.current = new google.maps.marker.AdvancedMarkerElement({
        map: mapInstance.current,
        position: pos,
        content: dot,
      });
    } else if (markerRef.current) {
      markerRef.current.position = pos;
    }
  }, [lat, lng]);

  if (gpsError) {
    return (
      <div className="bg-gray-800 rounded-xl p-3 h-16 flex items-center justify-center gap-2">
        <span className="material-symbols-outlined text-red-400 text-sm">location_off</span>
        <span className="text-red-400 text-xs">{gpsError}</span>
      </div>
    );
  }

  if (!lat && !lng) {
    return (
      <div className="bg-gray-800 rounded-xl p-3 h-16 flex items-center justify-center gap-2">
        <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-500 text-xs">A obter localizacao GPS...</span>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* Map */}
      <div ref={mapRef} className="h-36 w-full" />
      {/* Info bar */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-emerald-400 text-xs">my_location</span>
          <span className="text-[9px] text-gray-500 tabular-nums">{lat.toFixed(4)}, {lng.toFixed(4)}</span>
        </div>
        <div className="flex items-center gap-2">
          {alt !== null && (
            <span className="text-[9px] text-gray-400">
              <span className="text-gray-300 font-bold">{Math.round(alt)}</span>m
            </span>
          )}
          <span className="text-[9px] text-gray-600">±{Math.round(accuracy)}m</span>
        </div>
      </div>
    </div>
  );
}
