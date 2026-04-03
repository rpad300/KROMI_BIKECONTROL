import { useEffect, useRef, useState } from 'react';
import { useMapStore } from '../../store/mapStore';
import { useBikeStore } from '../../store/bikeStore';
import { initGoogleMaps, isMapsLoaded } from '../../services/maps/GoogleMapsService';

interface LocationInfo {
  locality: string;
  address: string;
  country: string;
  countryCode: string;
}

const EMERGENCY_NUMBERS: Record<string, { label: string; numbers: { name: string; number: string }[] }> = {
  PT: { label: '🇵🇹 Portugal', numbers: [
    { name: 'Emergência', number: '112' },
    { name: 'INEM', number: '112' },
    { name: 'Bombeiros', number: '117' },
    { name: 'PSP / GNR', number: '112' },
  ]},
  ES: { label: '🇪🇸 Espanha', numbers: [
    { name: 'Emergencia', number: '112' },
    { name: 'Policía', number: '091' },
    { name: 'Bomberos', number: '080' },
    { name: 'Guardia Civil', number: '062' },
  ]},
  FR: { label: '🇫🇷 França', numbers: [
    { name: 'Urgences', number: '112' },
    { name: 'SAMU', number: '15' },
    { name: 'Pompiers', number: '18' },
    { name: 'Police', number: '17' },
  ]},
  DEFAULT: { label: '🌍 Europa', numbers: [
    { name: 'Emergency EU', number: '112' },
    { name: 'Police', number: '112' },
    { name: 'Fire', number: '112' },
    { name: 'Medical', number: '112' },
  ]},
};

export function MapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const altitude = useMapStore((s) => s.altitude);
  const accuracy = useMapStore((s) => s.accuracy);
  const gpsActive = useMapStore((s) => s.gpsActive);
  const battery = useBikeStore((s) => s.battery_percent);
  const temp = useBikeStore((s) => s.temperature_c);

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
        map: mapInstance.current,
        position,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#3fff8b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });
    } else {
      markerRef.current.setPosition(position);
    }
    mapInstance.current.panTo(position);
  }, [lat, lng]);

  // Reverse geocode for locality + country (throttled — max once per 10s)
  const lastGeocodeRef = useRef(0);
  useEffect(() => {
    if (!lat || !lng || !ready) return;
    if (Date.now() - lastGeocodeRef.current < 10000) return;
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
          address: results[0].formatted_address?.split(',').slice(0, 2).join(',') ?? '',
          country: get('country'),
          countryCode: getShort('country'),
        });
      });
    } catch { /* geocoding not available */ }
  }, [lat, lng, ready]);

  const emergencyInfo = EMERGENCY_NUMBERS[location?.countryCode ?? ''] ?? EMERGENCY_NUMBERS['DEFAULT']!;

  const shareLocation = () => {
    const text = `📍 ${location?.address ?? `${lat?.toFixed(6)}, ${lng?.toFixed(6)}`}\nAlt: ${Math.round(altitude ?? 0)}m\nCoords: ${lat?.toFixed(6)}, ${lng?.toFixed(6)}\nhttps://maps.google.com/?q=${lat},${lng}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
      {/* Map — 45% */}
      <div style={{ height: '45%', flexShrink: 0, position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        {!gpsActive && (
          <div style={{ position: 'absolute', top: '12px', left: '12px', backgroundColor: 'rgba(159,5,25,0.8)', padding: '4px 12px', fontSize: '12px', color: '#ff716c' }}>
            GPS inactivo
          </div>
        )}
        {/* Coordinates overlay */}
        <div style={{ position: 'absolute', bottom: '8px', left: '8px', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', padding: '6px 10px' }}>
          <span className="font-headline tabular-nums" style={{ fontSize: '10px', color: '#adaaaa' }}>
            {lat?.toFixed(5) ?? '--'}, {lng?.toFixed(5) ?? '--'}
          </span>
          {accuracy > 0 && <span style={{ fontSize: '9px', color: '#777575', marginLeft: '8px' }}>±{Math.round(accuracy)}m</span>}
        </div>
      </div>

      {/* Location info — 15% */}
      <div style={{ height: '15%', flexShrink: 0, padding: '8px 16px', backgroundColor: '#131313', borderTop: '2px solid #3fff8b', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="font-headline font-bold" style={{ fontSize: '18px', color: 'white' }}>
              {location?.locality ?? 'A localizar...'}
            </div>
            <div className="font-body" style={{ fontSize: '11px', color: '#adaaaa', marginTop: '2px' }}>
              {location?.address ?? `${lat?.toFixed(4)}, ${lng?.toFixed(4)}`}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="font-headline font-bold tabular-nums" style={{ fontSize: '16px' }}>{Math.round(altitude ?? 0)}m</div>
            <div style={{ fontSize: '9px', color: '#777575' }}>ALT</div>
          </div>
        </div>
      </div>

      {/* Quick stats row — 8% */}
      <div style={{ height: '8%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#1a1919', borderTop: '1px solid rgba(73,72,71,0.2)' }}>
        <QuickStat icon="battery_full" value={`${battery}%`} color="#3fff8b" />
        {temp > 0 && <QuickStat icon="thermostat" value={`${temp.toFixed(0)}°C`} color="#6e9bff" />}
        <QuickStat icon="landscape" value={`${Math.round(altitude ?? 0)}m`} color="#e966ff" />
        {accuracy > 0 && <QuickStat icon="gps_fixed" value={`±${Math.round(accuracy)}m`} color={accuracy < 10 ? '#3fff8b' : accuracy < 30 ? '#fbbf24' : '#ff716c'} />}
      </div>

      {/* Emergency numbers — 22% */}
      <div style={{ flex: 1, minHeight: 0, padding: '8px 12px', backgroundColor: '#0e0e0e', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#ff716c' }}>emergency</span>
            <span className="font-label" style={{ fontSize: '10px', color: '#ff716c', textTransform: 'uppercase', letterSpacing: '0.1em' }}>SOS — {emergencyInfo.label}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', flex: 1 }}>
          {emergencyInfo.numbers.map(({ name, number }) => (
            <a
              key={name}
              href={`tel:${number}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', backgroundColor: '#1a1919', textDecoration: 'none',
                borderLeft: '2px solid #ff716c',
              }}
            >
              <span style={{ fontSize: '11px', color: '#adaaaa' }}>{name}</span>
              <span className="font-headline font-bold" style={{ fontSize: '16px', color: '#ff716c' }}>{number}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Share location button — 10% */}
      <div style={{ height: '10%', flexShrink: 0, padding: '8px 12px', backgroundColor: '#131313' }}>
        <button
          onClick={shareLocation}
          style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            backgroundColor: copied ? '#24f07e' : '#262626', color: copied ? 'black' : 'white',
            border: 'none', fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: '13px',
            textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{copied ? 'check' : 'share_location'}</span>
          {copied ? 'COPIADO!' : 'PARTILHAR LOCALIZAÇÃO'}
        </button>
      </div>
    </div>
  );
}

function QuickStat({ icon, value, color }: { icon: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span className="material-symbols-outlined" style={{ fontSize: '14px', color }}>{icon}</span>
      <span className="font-headline font-bold tabular-nums" style={{ fontSize: '13px' }}>{value}</span>
    </div>
  );
}
