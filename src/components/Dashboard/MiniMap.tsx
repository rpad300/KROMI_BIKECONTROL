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
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [mapType, setMapType] = useState<'hybrid' | 'terrain' | 'roadmap'>('hybrid');

  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const alt = useMapStore((s) => s.altitude);
  const accuracy = useMapStore((s) => s.accuracy);
  const gpsError = useMapStore((s) => s.gpsError);

  useEffect(() => {
    initGoogleMaps()
      .then(() => setReady(true))
      .catch(() => setError(true));
  }, []);

  // Create map
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstance.current) return;
    if (!isMapsLoaded()) return;

    try {
      mapInstance.current = new google.maps.Map(mapRef.current, {
        center: { lat: lat || 41.19, lng: lng || -8.43 },
        zoom: 15,
        mapTypeId: mapType,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
      });
    } catch (e) {
      console.error('[MiniMap] Failed to create map:', e);
      setError(true);
    }
  }, [ready]);

  // Update map type
  useEffect(() => {
    mapInstance.current?.setMapTypeId(mapType);
  }, [mapType]);

  // Update position
  useEffect(() => {
    if (!mapInstance.current || !lat || !lng) return;
    const pos = { lat, lng };
    mapInstance.current.panTo(pos);

    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({
        map: mapInstance.current,
        position: pos,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#10b981',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });
    } else {
      markerRef.current.setPosition(pos);
    }
  }, [lat, lng]);

  if (error) {
    return (
      <div className="bg-gray-800 rounded-xl p-3 h-16 flex items-center justify-center gap-2">
        <span className="material-symbols-outlined text-yellow-400 text-sm">map</span>
        <span className="text-gray-500 text-xs">Mapa indisponivel</span>
      </div>
    );
  }

  if (gpsError) {
    return (
      <div className="bg-gray-800 rounded-xl p-3 h-16 flex items-center justify-center gap-2">
        <span className="material-symbols-outlined text-red-400 text-sm">location_off</span>
        <span className="text-red-400 text-xs">{gpsError}</span>
      </div>
    );
  }

  if (!lat && !lng && !ready) {
    return (
      <div className="bg-gray-800 rounded-xl p-3 h-16 flex items-center justify-center gap-2">
        <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-500 text-xs">A obter localizacao GPS...</span>
      </div>
    );
  }

  const cycleMapType = () => {
    setMapType((t) => t === 'hybrid' ? 'terrain' : t === 'terrain' ? 'roadmap' : 'hybrid');
  };

  const mapTypeLabel = mapType === 'hybrid' ? 'Satelite' : mapType === 'terrain' ? 'Terreno' : 'Mapa';

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden relative">
      <div ref={mapRef} className="h-36 w-full" />
      <button
        onClick={cycleMapType}
        className="absolute top-2 right-2 bg-gray-900/80 text-[9px] text-gray-300 px-2 py-1 rounded font-bold active:scale-95"
      >
        {mapTypeLabel}
      </button>
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-emerald-400 text-xs">my_location</span>
          <span className="text-[9px] text-gray-500 tabular-nums">
            {lat ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'A localizar...'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {alt !== null && (
            <span className="text-[9px] text-gray-400">
              <span className="text-gray-300 font-bold">{Math.round(alt)}</span>m
            </span>
          )}
          {accuracy < 500 && (
            <span className="text-[9px] text-gray-600">±{Math.round(accuracy)}m</span>
          )}
        </div>
      </div>
    </div>
  );
}
