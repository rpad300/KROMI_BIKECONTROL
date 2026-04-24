import { Loader } from '@googlemaps/js-api-loader';

let mapsLoaded = false;

export async function initGoogleMaps(): Promise<void> {
  if (mapsLoaded) return;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
  if (!apiKey || apiKey === 'your_google_maps_api_key_here') {
    console.warn('[Maps] No Google Maps API key configured');
    return;
  }

  const loader = new Loader({
    apiKey,
    version: 'weekly',
    libraries: ['geometry', 'places'],
    language: 'pt',
  });

  // Detect Maps auth/billing failures
  (window as any).gm_authFailure = () => {
    const msg = '[Maps] gm_authFailure — billing not enabled or API key invalid';
    console.error(msg);
    if ((window as any).__dlog) (window as any).__dlog(msg, 'error');
  };

  await loader.load();
  mapsLoaded = true;
}

export function isMapsLoaded(): boolean {
  return mapsLoaded;
}

/** Calculate a point at a given distance and heading from origin */
export function destinationFromHeading(
  origin: { lat: number; lng: number },
  headingDeg: number,
  distanceM: number
): { lat: number; lng: number } {
  const R = 6371000;
  const h = (headingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lon1 = (origin.lng * Math.PI) / 180;
  const d = distanceM / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(h) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lon2 * 180) / Math.PI,
  };
}
