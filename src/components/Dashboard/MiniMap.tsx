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
  const accSamples = useMapStore((s) => s.accuracySamples);
  const accAvg = useMapStore((s) => s.accuracySamples > 0 ? s.accuracySum / s.accuracySamples : 0);
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
      <div className="bg-[#1a1919] rounded-sm p-3 h-16 flex items-center justify-center gap-2">
        <span className="material-symbols-outlined text-[#fbbf24] text-sm">map</span>
        <span className="text-[#777575] text-xs">Mapa indisponivel</span>
      </div>
    );
  }

  if (gpsError) {
    return (
      <div className="bg-[#1a1919] rounded-sm p-3 h-16 flex items-center justify-center gap-2">
        <span className="material-symbols-outlined text-[#ff716c] text-sm">location_off</span>
        <span className="text-[#ff716c] text-xs">{gpsError}</span>
      </div>
    );
  }

  if (!lat && !lng && !ready) {
    return (
      <div className="bg-[#1a1919] rounded-sm p-3 h-16 flex items-center justify-center gap-2">
        <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-[#777575] text-xs">A obter localizacao GPS...</span>
      </div>
    );
  }

  const cycleMapType = () => {
    setMapType((t) => t === 'hybrid' ? 'terrain' : t === 'terrain' ? 'roadmap' : 'hybrid');
  };

  const mapTypeLabel = mapType === 'hybrid' ? 'Satelite' : mapType === 'terrain' ? 'Terreno' : 'Mapa';

  return (
    <div className="bg-[#1a1919] rounded-sm overflow-hidden relative">
      <div ref={mapRef} className="h-36 w-full" />
      <button
        onClick={cycleMapType}
        className="absolute top-2 right-2 bg-[#131313]/80 text-[9px] text-[#adaaaa] px-2 py-1 rounded font-bold active:scale-95"
      >
        {mapTypeLabel}
      </button>
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[#3fff8b] text-xs">my_location</span>
          <span className="text-[9px] text-[#777575] tabular-nums">
            {lat ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'A localizar...'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {alt !== null && (
            <span className="text-[9px] text-[#adaaaa]">
              <span className="text-[#adaaaa] font-bold">{Math.round(alt)}</span>m
            </span>
          )}
          {accuracy < 500 && (
            <span className={`text-[9px] ${accuracy < 10 ? 'text-[#24f07e]' : accuracy < 30 ? 'text-[#d97706]' : 'text-[#d7383b]'}`}>
              ±{Math.round(accuracy)}m
            </span>
          )}
          {accSamples > 5 && (
            <span className="text-[9px] text-[#777575]">avg ±{Math.round(accAvg)}m</span>
          )}
        </div>
      </div>
    </div>
  );
}
