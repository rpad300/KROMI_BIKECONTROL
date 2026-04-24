/**
 * Vercel Edge Middleware — serves professional OG meta tags to social media crawlers.
 *
 * Intercepts ride.html requests from bots (WhatsApp, Facebook, Telegram, etc.)
 * and returns HTML with rich og:title, og:description, og:image.
 * Real users pass through to the normal ride.html.
 */

const SB_URL = 'https://ctsuupvmmyjlrtjnxagv.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3V1cHZtbXlqbHJ0am54YWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg3MTgsImV4cCI6MjA5MDU0NDcxOH0.VgpKrjxYirb9Gc7OZX-aHGJmGJ3QdDM5I7iXaWDmBXQ';

const BOT_UA = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|Applebot|Googlebot|bot|crawl|spider/i;

export default async function middleware(req) {
  const url = new URL(req.url);

  // Only intercept ride.html
  if (!url.pathname.match(/^\/ride(\.html)?$/) && !url.pathname.match(/^\/ride$/)) {
    return;
  }
  const rideId = url.searchParams.get('ride') || url.searchParams.get('id');
  if (!rideId) return;

  const ua = req.headers.get('user-agent') || '';
  if (!BOT_UA.test(ua)) return; // Real user — pass through

  // Fetch ride data for rich meta tags
  let title = 'Pedalada KROMI';
  let description = '';
  let clubName = '';
  let clubColor = '#3fff8b';
  let distance = '';
  let elevGain = '';
  let maxEle = '';
  let date = '';
  let narrative = '';
  let difficulty = '';
  let segmentCount = 0;
  let poiCount = 0;

  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/club_rides?id=eq.${encodeURIComponent(rideId)}&select=name,description,scheduled_at,status,ride_data,clubs(name,color)&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) {
      const r = rows[0];
      title = r.name || title;
      clubName = r.clubs?.name || '';
      clubColor = r.clubs?.color || clubColor;

      const rd = r.ride_data || {};
      const ai = rd.ai_enrichment || {};

      // Stats
      if (rd.distance_km) distance = Number(rd.distance_km).toFixed(1) + ' km';
      if (rd.elevation_gain) elevGain = Math.round(rd.elevation_gain) + 'm D+';
      if (rd.max_ele) maxEle = Math.round(rd.max_ele) + 'm alt. max';

      // AI content
      if (ai.narrative) narrative = ai.narrative.split('\n')[0].slice(0, 200);
      if (ai.difficulty_text) difficulty = ai.difficulty_text;
      if (ai.segments) segmentCount = ai.segments.length;
      if (ai.pois) poiCount = ai.pois.length;

      // Date
      if (r.scheduled_at) {
        const d = new Date(r.scheduled_at);
        date = d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }

      // Build rich description
      const stats = [distance, elevGain, maxEle].filter(Boolean).join(' · ');
      const extras = [];
      if (segmentCount > 0) extras.push(`${segmentCount} segmentos`);
      if (poiCount > 0) extras.push(`${poiCount} pontos de interesse`);

      if (narrative) {
        description = narrative;
        if (stats) description += ` — ${stats}`;
      } else if (r.description) {
        description = r.description;
        if (stats) description += ` · ${stats}`;
      } else if (stats) {
        description = stats;
      }
      if (date) description = `${date} · ${description}`;
      if (extras.length && !description.includes('segmento')) {
        description += ` · ${extras.join(', ')}`;
      }
    }
  } catch (e) {
    console.error('Middleware OG fetch error:', e);
  }

  if (!description) description = 'Relatorio editorial de pedalada com altimetria, segmentos, estatisticas e galeria — KROMI BikeControl';

  const ogImage = `${url.origin}/api/ride-hero?ride=${encodeURIComponent(rideId)}`;
  const canonical = `${url.origin}/ride.html?ride=${encodeURIComponent(rideId)}`;
  const fullTitle = clubName ? `${title} — ${clubName}` : `${title} — KROMI BikeControl`;
  const shortDesc = description.length > 300 ? description.slice(0, 297) + '...' : description;

  const html = `<!DOCTYPE html>
<html lang="pt" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="utf-8">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(shortDesc)}">

<!-- Open Graph -->
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(shortDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="${esc(title)} — percurso BTT">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="KROMI BikeControl">
<meta property="og:locale" content="pt_PT">
<meta property="article:section" content="BTT">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(shortDesc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="twitter:image:alt" content="${esc(title)} — percurso BTT">

<!-- Theme -->
<meta name="theme-color" content="${esc(clubColor)}">

<link rel="canonical" href="${esc(canonical)}">
<meta http-equiv="refresh" content="0;url=${esc(canonical)}">
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const config = {
  matcher: ['/ride.html', '/ride'],
};
