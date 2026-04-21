/**
 * OG Image Generator — dynamic social preview for live tracking links.
 *
 * Vercel Serverless Function that fetches rider data from Supabase
 * and returns an HTML page that renders as an image via og:image.
 *
 * Usage: /api/og?t={token}
 * Returns: SVG image (1200x630) with rider name, speed, distance, battery.
 */

const SB_URL = 'https://ctsuupvmmyjlrtjnxagv.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3V1cHZtbXlqbHJ0am54YWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg3MTgsImV4cCI6MjA5MDU0NDcxOH0.VgpKrjxYirb9Gc7OZX-aHGJmGJ3QdDM5I7iXaWDmBXQ';

const MODE_LABELS = { 1: 'ECO', 2: 'TOUR', 3: 'ACTIVE', 4: 'SPORT', 5: 'KROMI', 6: 'SMART' };

export default async function handler(req) {
  const url = new URL(req.url, `https://${req.headers.get('host') || 'kromi.online'}`);
  const token = url.searchParams.get('t');

  let riderName = 'Ciclista KROMI';
  let speed = '--';
  let distance = '--';
  let battery = '--';
  let mode = '';
  let isLive = false;
  let routeName = '';

  if (token) {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/tracking_sessions?token=eq.${encodeURIComponent(token)}&order=started_at.desc&limit=1&select=*`,
        { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
      );
      const sessions = await res.json();
      if (Array.isArray(sessions) && sessions.length > 0) {
        const s = sessions[0];
        riderName = s.rider_name || riderName;
        speed = s.speed_kmh != null ? Math.round(s.speed_kmh) + ' km/h' : '--';
        distance = s.distance_km != null ? s.distance_km.toFixed(1) + ' km' : '--';
        battery = s.battery_pct != null ? s.battery_pct + '%' : '--';
        mode = MODE_LABELS[s.assist_mode] || '';
        isLive = s.is_active === true;
        routeName = s.route_name || '';
      }
    } catch (e) {
      console.error('OG fetch error:', e);
    }
  }

  const statusText = isLive ? 'LIVE' : 'ULTIMA SESSAO';
  const statusColor = isLive ? '#3fff8b' : '#fbbf24';
  const trackingType = routeName ? `ROTA: ${routeName}` : 'EXPLORACAO LIVRE';

  const svg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#111111"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Top bar -->
  <rect x="0" y="0" width="1200" height="4" fill="${statusColor}"/>

  <!-- KROMI branding -->
  <text x="60" y="70" font-family="system-ui,sans-serif" font-size="18" font-weight="900" letter-spacing="4" fill="#3fff8b">KROMI LIVE TRACKING</text>

  <!-- Status badge -->
  <rect x="400" y="48" width="${isLive ? 80 : 180}" height="30" rx="15" fill="${statusColor}" opacity="0.15"/>
  <circle cx="418" cy="63" r="5" fill="${statusColor}"/>
  <text x="430" y="68" font-family="system-ui,sans-serif" font-size="13" font-weight="800" letter-spacing="1" fill="${statusColor}">${statusText}</text>

  <!-- Rider name -->
  <text x="60" y="130" font-family="system-ui,sans-serif" font-size="42" font-weight="900" fill="#ffffff">${escSvg(riderName)}</text>

  <!-- Tracking type -->
  <text x="60" y="165" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="#888888">${escSvg(trackingType)}</text>

  <!-- Divider -->
  <line x1="60" y1="195" x2="1140" y2="195" stroke="#262626" stroke-width="1"/>

  <!-- KPIs -->
  <!-- Speed -->
  <rect x="60" y="220" width="250" height="120" rx="12" fill="#1a1919"/>
  <rect x="60" y="220" width="4" height="120" rx="2" fill="#3fff8b"/>
  <text x="82" y="255" font-family="system-ui,sans-serif" font-size="12" font-weight="700" letter-spacing="1" fill="#666666">VELOCIDADE</text>
  <text x="82" y="310" font-family="monospace" font-size="48" font-weight="900" fill="#3fff8b">${escSvg(speed)}</text>

  <!-- Distance -->
  <rect x="340" y="220" width="250" height="120" rx="12" fill="#1a1919"/>
  <rect x="340" y="220" width="4" height="120" rx="2" fill="#3fff8b"/>
  <text x="362" y="255" font-family="system-ui,sans-serif" font-size="12" font-weight="700" letter-spacing="1" fill="#666666">DISTANCIA</text>
  <text x="362" y="310" font-family="monospace" font-size="48" font-weight="900" fill="#ffffff">${escSvg(distance)}</text>

  <!-- Battery -->
  <rect x="620" y="220" width="250" height="120" rx="12" fill="#1a1919"/>
  <rect x="620" y="220" width="4" height="120" rx="2" fill="${parseInt(battery) > 30 ? '#3fff8b' : parseInt(battery) > 15 ? '#fbbf24' : '#ff716c'}"/>
  <text x="642" y="255" font-family="system-ui,sans-serif" font-size="12" font-weight="700" letter-spacing="1" fill="#666666">BATERIA</text>
  <text x="642" y="310" font-family="monospace" font-size="48" font-weight="900" fill="${parseInt(battery) > 30 ? '#3fff8b' : parseInt(battery) > 15 ? '#fbbf24' : '#ff716c'}">${escSvg(battery)}</text>

  <!-- Mode -->
  ${mode ? `
  <rect x="900" y="220" width="250" height="120" rx="12" fill="#1a1919"/>
  <rect x="900" y="220" width="4" height="120" rx="2" fill="#6e9bff"/>
  <text x="922" y="255" font-family="system-ui,sans-serif" font-size="12" font-weight="700" letter-spacing="1" fill="#666666">MODO</text>
  <text x="922" y="310" font-family="monospace" font-size="48" font-weight="900" fill="#6e9bff">${escSvg(mode)}</text>
  ` : ''}

  <!-- Bottom bar -->
  <rect x="0" y="580" width="1200" height="50" fill="#131313"/>
  <text x="60" y="612" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#494847">kromi.online</text>
  <text x="1140" y="612" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#494847" text-anchor="end">BikeControl</text>

  <!-- Bike icon -->
  <text x="1060" y="130" font-size="80" fill="#1a1919">&#128690;</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
}

function escSvg(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const config = { runtime: 'edge' };
