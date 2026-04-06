import { useEffect, useRef, useState } from 'react';
import { useMapStore } from '../../store/mapStore';
import { useRouteStore } from '../../store/routeStore';
import { useBikeStore } from '../../store/bikeStore';
import { initGoogleMaps, isMapsLoaded } from '../../services/maps/GoogleMapsService';

/**
 * MiniMap — compact Google Map for the Dashboard.
 * Shows current position with a marker, auto-follows rider.
 */
export function MiniMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
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

  // Draw route polyline when active route changes
  const routePoints = useRouteStore((s) => s.activeRoutePoints);
  const navActive = useRouteStore((s) => s.navigation.active);
  const navProgress = useRouteStore((s) => s.navigation.currentIndex);

  useEffect(() => {
    if (!mapInstance.current || !isMapsLoaded()) return;

    // Remove old polyline
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (routePoints.length < 2) return;

    // Draw route polyline
    const path = routePoints.map(p => ({ lat: p.lat, lng: p.lng }));
    polylineRef.current = new google.maps.Polyline({
      path,
      map: mapInstance.current,
      strokeColor: '#3fff8b',
      strokeOpacity: 0.7,
      strokeWeight: 3,
    });

    // Fit map to route bounds
    const bounds = new google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    mapInstance.current.fitBounds(bounds, 20);
  }, [routePoints, ready]);

  // Highlight completed portion of route
  useEffect(() => {
    if (!polylineRef.current || !navActive || navProgress <= 0) return;
    // Change color of completed portion — use a second polyline overlay
    // For simplicity, just update opacity to show progress
    polylineRef.current.setOptions({
      strokeColor: '#3fff8b',
      strokeOpacity: 0.5,
    });
  }, [navProgress, navActive]);

  // Radar threat — hooks MUST be before any conditional returns
  const radarThreat = useBikeStore((s) => s.radar_threat_level);
  const radarDistance = useBikeStore((s) => s.radar_distance_m);
  const radarSpeed = useBikeStore((s) => s.radar_speed_kmh);
  const radarConnected = useBikeStore((s) => s.ble_services.radar);

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

  const threatColor = radarThreat >= 3 ? '#ff4444' : radarThreat >= 2 ? '#fbbf24' : '#ff9f43';

  return (
    <div className="bg-[#1a1919] rounded-sm overflow-hidden relative">
      <div ref={mapRef} className="h-36 w-full" />

      {/* Radar threat overlay */}
      {radarConnected && radarThreat > 0 && (
        <div className={`absolute bottom-10 left-0 right-0 flex justify-center z-10 ${radarThreat >= 3 ? 'animate-pulse' : ''}`}>
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md"
            style={{ backgroundColor: `${threatColor}33`, border: `1px solid ${threatColor}66` }}
          >
            <span className="material-symbols-outlined text-base" style={{ color: threatColor }}>radar</span>
            <span className="text-xs font-bold" style={{ color: threatColor }}>
              {radarDistance > 0 ? `${radarDistance.toFixed(0)}m` : 'CLOSE'}
            </span>
            {radarSpeed > 0 && (
              <span className="text-[10px]" style={{ color: `${threatColor}cc` }}>
                {radarSpeed} km/h
              </span>
            )}
            <div className="flex gap-0.5">
              {[1, 2, 3].map((l) => (
                <div
                  key={l}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: radarThreat >= l ? threatColor : '#333' }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

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
