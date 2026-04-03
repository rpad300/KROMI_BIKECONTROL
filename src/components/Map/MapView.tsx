import { useEffect, useRef, useState, useCallback } from 'react';
import { useMapStore } from '../../store/mapStore';
import { useBikeStore } from '../../store/bikeStore';
import { initGoogleMaps, isMapsLoaded } from '../../services/maps/GoogleMapsService';

interface LocationInfo {
  locality: string;
  address: string;
  country: string;
  countryCode: string;
}

interface NearbyService {
  name: string;
  type: 'hospital' | 'police' | 'fire_station';
  icon: string;
  color: string;
  address: string;
  phone: string;
  distance: string;
  placeId: string;
}

export function MapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [services, setServices] = useState<NearbyService[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [copied, setCopied] = useState(false);

  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const altitude = useMapStore((s) => s.altitude);
  const accuracy = useMapStore((s) => s.accuracy);
  const gpsActive = useMapStore((s) => s.gpsActive);
  const temp = useBikeStore((s) => s.temperature_c);
  const pressure = useBikeStore((s) => s.pressure_hpa);

  // Initialize Google Maps
  useEffect(() => {
    initGoogleMaps()
      .then(() => setReady(true))
      .catch((err) => setError(`Maps: ${err}`));
  }, []);

  // Create map
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstance.current) return;
    if (!isMapsLoaded()) return;
    mapInstance.current = new google.maps.Map(mapRef.current, {
      center: { lat: lat || 38.7, lng: lng || -9.14 },
      zoom: 15,
      mapTypeId: 'terrain',
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
      ],
    });
  }, [ready, lat, lng]);

  // Update marker
  useEffect(() => {
    if (!mapInstance.current || !lat || !lng) return;
    const position = { lat, lng };
    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({
        map: mapInstance.current, position,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#3fff8b', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
      });
    } else {
      markerRef.current.setPosition(position);
    }
    mapInstance.current.panTo(position);
  }, [lat, lng]);

  // Reverse geocode (throttled)
  const lastGeocodeRef = useRef(0);
  useEffect(() => {
    if (!lat || !lng || !ready) return;
    if (Date.now() - lastGeocodeRef.current < 15000) return;
    lastGeocodeRef.current = Date.now();
    try {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status !== 'OK' || !results?.[0]) return;
        const components = results[0].address_components;
        const get = (type: string) => components?.find((c) => c.types.includes(type))?.long_name ?? '';
        const getShort = (type: string) => components?.find((c) => c.types.includes(type))?.short_name ?? '';
        setLocation({
          locality: get('locality') || get('administrative_area_level_2') || get('administrative_area_level_1'),
          address: results[0].formatted_address?.split(',').slice(0, 3).join(',') ?? '',
          country: get('country'),
          countryCode: getShort('country'),
        });
      });
    } catch { /* geocoding not available */ }
  }, [lat, lng, ready]);

  // Find nearby emergency services
  const findNearbyServices = useCallback(() => {
    if (!mapInstance.current || !lat || !lng) return;
    setLoadingServices(true);
    const svc = new google.maps.places.PlacesService(mapInstance.current);
    const loc = new google.maps.LatLng(lat, lng);
    const results: NearbyService[] = [];
    let pending = 3;

    const done = () => { pending--; if (pending <= 0) { setServices(results.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance))); setLoadingServices(false); } };

    const typeMap: { type: string; icon: string; color: string; serviceType: NearbyService['type'] }[] = [
      { type: 'hospital', icon: 'local_hospital', color: '#ff716c', serviceType: 'hospital' },
      { type: 'police', icon: 'local_police', color: '#6e9bff', serviceType: 'police' },
      { type: 'fire_station', icon: 'fire_truck', color: '#fbbf24', serviceType: 'fire_station' },
    ];

    typeMap.forEach(({ type, icon, color, serviceType }) => {
      svc.nearbySearch({ location: loc, rankBy: google.maps.places.RankBy.DISTANCE, type }, (places, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && places) {
          places.slice(0, 2).forEach((place) => {
            const dist = place.geometry?.location
              ? (google.maps.geometry.spherical.computeDistanceBetween(loc, place.geometry.location) / 1000).toFixed(1)
              : '?';
            results.push({
              name: place.name ?? type, type: serviceType, icon, color,
              address: place.vicinity ?? '', phone: '', distance: dist,
              placeId: place.place_id ?? '',
            });
          });
        }
        done();
      });
    });
  }, [lat, lng]);

  // Get phone numbers for found services
  const getPhoneForService = useCallback((placeId: string, idx: number) => {
    if (!mapInstance.current || !placeId) return;
    const svc = new google.maps.places.PlacesService(mapInstance.current);
    svc.getDetails({ placeId, fields: ['formatted_phone_number', 'international_phone_number'] }, (place) => {
      if (place?.formatted_phone_number || place?.international_phone_number) {
        setServices((prev) => prev.map((s, i) =>
          i === idx ? { ...s, phone: place.international_phone_number || place.formatted_phone_number || '' } : s
        ));
      }
    });
  }, []);

  // Auto-search on first load when GPS is available
  const searchedRef = useRef(false);
  useEffect(() => {
    if (ready && lat && lng && !searchedRef.current && mapInstance.current) {
      searchedRef.current = true;
      setTimeout(findNearbyServices, 2000); // wait for map to render
    }
  }, [ready, lat, lng, findNearbyServices]);

  // Get phone details for services found
  useEffect(() => {
    services.forEach((s, i) => {
      if (s.placeId && !s.phone) getPhoneForService(s.placeId, i);
    });
  }, [services, getPhoneForService]);

  const shareLocation = () => {
    const text = `📍 ${location?.address ?? `${lat?.toFixed(6)}, ${lng?.toFixed(6)}`}\nAlt: ${Math.round(altitude ?? 0)}m\nCoords: ${lat?.toFixed(6)}, ${lng?.toFixed(6)}\nhttps://maps.google.com/?q=${lat},${lng}`;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4" style={{ backgroundColor: '#0e0e0e' }}>
        <div className="text-center">
          <div style={{ color: '#ff716c', fontSize: '18px', marginBottom: '8px' }}>Mapa indisponível</div>
          <div style={{ color: '#777575', fontSize: '13px' }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#0e0e0e', overflow: 'hidden' }}>
      {/* Map — 35% */}
      <div style={{ height: '35%', flexShrink: 0, position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        {!gpsActive && (
          <div style={{ position: 'absolute', top: '8px', left: '8px', backgroundColor: 'rgba(159,5,25,0.8)', padding: '4px 10px', fontSize: '11px', color: '#ff716c' }}>GPS inactivo</div>
        )}
        <div style={{ position: 'absolute', bottom: '6px', left: '6px', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', padding: '4px 8px' }}>
          <span className="font-headline tabular-nums" style={{ fontSize: '9px', color: '#adaaaa' }}>{lat?.toFixed(5)}, {lng?.toFixed(5)}</span>
          {accuracy > 0 && <span style={{ fontSize: '8px', color: '#777575', marginLeft: '6px' }}>±{Math.round(accuracy)}m</span>}
        </div>
      </div>

      {/* Location + Weather — 12% */}
      <div style={{ height: '12%', flexShrink: 0, padding: '6px 12px', backgroundColor: '#131313', borderTop: '2px solid #3fff8b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-headline font-bold" style={{ fontSize: '16px', color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {location?.locality ?? 'A localizar...'}
          </div>
          <div style={{ fontSize: '10px', color: '#adaaaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {location?.address ?? `${lat?.toFixed(4)}, ${lng?.toFixed(4)}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0, marginLeft: '8px' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="font-headline font-bold tabular-nums" style={{ fontSize: '14px' }}>{Math.round(altitude ?? 0)}m</div>
            <div style={{ fontSize: '7px', color: '#777575' }}>ALT</div>
          </div>
          {temp > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div className="font-headline font-bold tabular-nums" style={{ fontSize: '14px', color: '#6e9bff' }}>{temp.toFixed(0)}°</div>
              <div style={{ fontSize: '7px', color: '#777575' }}>TEMP</div>
            </div>
          )}
          {pressure > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div className="font-headline tabular-nums" style={{ fontSize: '12px', color: '#adaaaa' }}>{pressure.toFixed(0)}</div>
              <div style={{ fontSize: '7px', color: '#777575' }}>hPa</div>
            </div>
          )}
        </div>
      </div>

      {/* Emergency services — flex remaining */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#ff716c' }}>emergency</span>
            <span className="font-label" style={{ fontSize: '9px', color: '#ff716c', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Emergência Local</span>
          </div>
          <button onClick={findNearbyServices} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#777575' }}>refresh</span>
            <span style={{ fontSize: '8px', color: '#777575' }}>Atualizar</span>
          </button>
        </div>

        {/* Universal 112 */}
        <a href="tel:112" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#9f0519', textDecoration: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'white' }}>call</span>
            <span className="font-headline font-bold" style={{ fontSize: '14px', color: 'white' }}>Emergência Geral</span>
          </div>
          <span className="font-headline font-black" style={{ fontSize: '24px', color: 'white' }}>112</span>
        </a>

        {/* Nearby services */}
        {loadingServices && (
          <div style={{ textAlign: 'center', padding: '12px' }}>
            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: '#3fff8b', borderTopColor: 'transparent' }} />
            <span style={{ fontSize: '10px', color: '#777575', marginTop: '4px', display: 'block' }}>A procurar serviços...</span>
          </div>
        )}

        {services.map((svc, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', backgroundColor: '#1a1919', borderLeft: `3px solid ${svc.color}` }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: svc.color, flexShrink: 0 }}>{svc.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-headline font-bold" style={{ fontSize: '12px', color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.name}</div>
              <div style={{ fontSize: '9px', color: '#777575', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.address}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <span className="font-headline tabular-nums" style={{ fontSize: '10px', color: '#adaaaa' }}>{svc.distance}km</span>
              {svc.phone ? (
                <a href={`tel:${svc.phone.replace(/\s/g, '')}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', backgroundColor: svc.color, textDecoration: 'none' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'black' }}>call</span>
                </a>
              ) : (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(svc.name + ' ' + svc.address)}`} target="_blank" rel="noopener" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', backgroundColor: '#262626', textDecoration: 'none' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#adaaaa' }}>directions</span>
                </a>
              )}
            </div>
          </div>
        ))}

        {services.length === 0 && !loadingServices && (
          <div style={{ textAlign: 'center', padding: '12px', color: '#777575', fontSize: '11px' }}>
            Carrega "Atualizar" para procurar serviços de emergência próximos
          </div>
        )}
      </div>

      {/* Share location button — 8% */}
      <div style={{ height: '8%', flexShrink: 0, padding: '4px 8px', backgroundColor: '#131313' }}>
        <button
          onClick={shareLocation}
          style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            backgroundColor: copied ? '#24f07e' : '#262626', color: copied ? 'black' : 'white',
            border: 'none', fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: '12px',
            textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{copied ? 'check' : 'share_location'}</span>
          {copied ? 'COPIADO!' : 'PARTILHAR LOCALIZAÇÃO'}
        </button>
      </div>
    </div>
  );
}
