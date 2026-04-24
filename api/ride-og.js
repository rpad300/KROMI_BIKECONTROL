/**
 * Ride OG Image Generator — dynamic social preview for ride share links.
 *
 * Vercel Edge Function that fetches ride data from Supabase
 * and returns an SVG image (1200x630) for og:image.
 *
 * Usage: /api/ride-og?ride={ride_id}
 * Returns: SVG image with ride name, stats, mini elevation profile.
 */

const SB_URL = 'https://ctsuupvmmyjlrtjnxagv.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3V1cHZtbXlqbHJ0am54YWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg3MTgsImV4cCI6MjA5MDU0NDcxOH0.VgpKrjxYirb9Gc7OZX-aHGJmGJ3QdDM5I7iXaWDmBXQ';

export default async function handler(req) {
  const url = new URL(req.url, `https://${req.headers.get('host') || 'kromi.online'}`);
  const rideId = url.searchParams.get('ride');

  let name = 'Pedalada KROMI';
  let distance = '--';
  let elevGain = '--';
  let elevMax = '--';
  let date = '';
  let clubName = '';
  let clubColor = '#3fff8b';
  let status = 'PLANEADA';
  let elevPoints = [];

  if (rideId) {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/club_rides?id=eq.${encodeURIComponent(rideId)}&select=name,status,scheduled_at,route_gpx,ride_data,club_id,clubs(name,color)&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const r = rows[0];
        name = r.name || name;
        status = r.status === 'active' ? 'ATIVA' : 'PLANEADA';
        if (r.clubs) {
          clubName = r.clubs.name || '';
          clubColor = r.clubs.color || clubColor;
        }
        if (r.scheduled_at) {
          const d = new Date(r.scheduled_at);
          date = d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
        }

        // Extract stats from ride_data.ai_enrichment or GPX
        const rd = r.ride_data || {};
        const ai = rd.ai_enrichment || {};
        if (rd.distance_km) distance = Number(rd.distance_km).toFixed(1) + ' km';
        if (rd.elevation_gain) elevGain = Math.round(rd.elevation_gain) + ' m';
        if (rd.max_ele) elevMax = Math.round(rd.max_ele) + ' m';

        // Parse GPX for mini elevation profile (sample 60 points)
        if (r.route_gpx) {
          elevPoints = parseGpxElevation(r.route_gpx, 60);
          if (!rd.distance_km && elevPoints.length >= 2) {
            const stats = computeStats(elevPoints);
            distance = stats.dist.toFixed(1) + ' km';
            elevGain = Math.round(stats.gain) + ' m';
            elevMax = Math.round(stats.maxEle) + ' m';
          }
        }
      }
    } catch (e) {
      console.error('Ride OG fetch error:', e);
    }
  }

  // Build mini elevation profile SVG path
  const profileSvg = buildElevationPath(elevPoints, 1080, 140, 60, 430);

  const svg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#0e0e0e"/>
      <stop offset="100%" stop-color="#1a1919"/>
    </linearGradient>
    <linearGradient id="elev-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${clubColor}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${clubColor}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Top accent bar -->
  <rect x="0" y="0" width="1200" height="4" fill="${clubColor}"/>

  <!-- KROMI branding -->
  <text x="60" y="56" font-family="system-ui,sans-serif" font-size="13" font-weight="900" letter-spacing="4" fill="#555">KROMI BIKECONTROL</text>

  <!-- Club name -->
  ${clubName ? `<text x="60" y="86" font-family="system-ui,sans-serif" font-size="16" font-weight="700" letter-spacing="1" fill="${clubColor}">${esc(clubName.toUpperCase())}</text>` : ''}

  <!-- Ride name -->
  <text x="60" y="${clubName ? '145' : '120'}" font-family="Georgia,serif" font-size="52" font-weight="400" fill="#ffffff">${esc(name)}</text>

  <!-- Date -->
  ${date ? `<text x="60" y="${clubName ? '180' : '155'}" font-family="system-ui,sans-serif" font-size="16" font-weight="500" fill="#777">${esc(date)}</text>` : ''}

  <!-- Status badge -->
  <rect x="1020" y="36" width="120" height="30" rx="15" fill="${status === 'ATIVA' ? '#3fff8b' : '#6e9bff'}" opacity="0.15"/>
  <text x="1080" y="56" font-family="system-ui,sans-serif" font-size="12" font-weight="800" letter-spacing="1" fill="${status === 'ATIVA' ? '#3fff8b' : '#6e9bff'}" text-anchor="middle">${status}</text>

  <!-- KPI cards -->
  <!-- Distance -->
  <rect x="60" y="210" width="320" height="100" rx="12" fill="#141414"/>
  <rect x="60" y="210" width="4" height="100" rx="2" fill="${clubColor}"/>
  <text x="82" y="242" font-family="system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="2" fill="#555">DISTANCIA</text>
  <text x="82" y="290" font-family="monospace" font-size="42" font-weight="900" fill="#ffffff">${esc(distance)}</text>

  <!-- Elevation gain -->
  <rect x="410" y="210" width="320" height="100" rx="12" fill="#141414"/>
  <rect x="410" y="210" width="4" height="100" rx="2" fill="${clubColor}"/>
  <text x="432" y="242" font-family="system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="2" fill="#555">DESNIVEL D+</text>
  <text x="432" y="290" font-family="monospace" font-size="42" font-weight="900" fill="${clubColor}">${esc(elevGain)}</text>

  <!-- Max altitude -->
  <rect x="760" y="210" width="380" height="100" rx="12" fill="#141414"/>
  <rect x="760" y="210" width="4" height="100" rx="2" fill="${clubColor}"/>
  <text x="782" y="242" font-family="system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="2" fill="#555">ALTITUDE MAX</text>
  <text x="782" y="290" font-family="monospace" font-size="42" font-weight="900" fill="#a78bfa">${esc(elevMax)}</text>

  <!-- Elevation profile -->
  ${profileSvg}

  <!-- Bottom bar -->
  <rect x="0" y="590" width="1200" height="40" fill="#0a0a0a"/>
  <text x="60" y="616" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#444">kromi.online/ride</text>
  <text x="1140" y="616" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#444" text-anchor="end">BikeControl</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseGpxElevation(gpxText, sampleCount) {
  const points = [];
  const regex = /<(?:trkpt|rtept)\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/(?:trkpt|rtept)>/gi;
  let m;
  while ((m = regex.exec(gpxText)) !== null) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    const eleM = m[3].match(/<ele>([^<]+)<\/ele>/);
    const ele = eleM ? parseFloat(eleM[1]) : 0;
    if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, ele });
  }
  if (points.length <= sampleCount) return points;
  // Downsample
  const step = (points.length - 1) / (sampleCount - 1);
  const sampled = [];
  for (let i = 0; i < sampleCount; i++) {
    sampled.push(points[Math.round(i * step)]);
  }
  return sampled;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function computeStats(points) {
  let dist = 0, gain = 0, anchor = points[0].ele, maxEle = points[0].ele;
  for (let i = 1; i < points.length; i++) {
    dist += haversineKm(points[i - 1], points[i]);
    if (points[i].ele > maxEle) maxEle = points[i].ele;
    const diff = points[i].ele - anchor;
    if (diff > 3) { gain += diff; anchor = points[i].ele; }
    else if (diff < -3) { anchor = points[i].ele; }
  }
  return { dist, gain, maxEle };
}

function buildElevationPath(points, width, height, offsetX, offsetY) {
  if (!points || points.length < 2) return '';
  const eles = points.map(p => p.ele);
  const minE = Math.min(...eles);
  const maxE = Math.max(...eles);
  const range = maxE - minE || 1;
  const stepX = width / (points.length - 1);

  let linePts = '';
  let areaPts = `${offsetX},${offsetY + height} `;
  for (let i = 0; i < points.length; i++) {
    const x = offsetX + i * stepX;
    const y = offsetY + height - ((eles[i] - minE) / range) * height;
    linePts += `${x.toFixed(1)},${y.toFixed(1)} `;
    areaPts += `${x.toFixed(1)},${y.toFixed(1)} `;
  }
  areaPts += `${(offsetX + width).toFixed(1)},${offsetY + height}`;

  return `
    <polygon points="${areaPts}" fill="url(#elev-fill)"/>
    <polyline points="${linePts}" fill="none" stroke="${'#3fff8b'}" stroke-width="2" stroke-linejoin="round" opacity="0.8"/>
    <text x="${offsetX}" y="${offsetY + height + 18}" font-family="monospace" font-size="10" fill="#444">${Math.round(minE)}m</text>
    <text x="${offsetX + width}" y="${offsetY - 5}" font-family="monospace" font-size="10" fill="#555" text-anchor="end">${Math.round(maxE)}m</text>
  `;
}

export const config = { runtime: 'edge' };
