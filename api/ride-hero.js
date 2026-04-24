/**
 * Serves the AI-generated hero image for a ride.
 * Proxies from Google Drive to avoid crawler blocks on Drive URLs.
 * Used as og:image URL for social media previews (WhatsApp, Facebook, etc).
 *
 * Usage: /api/ride-hero?ride={ride_id}
 * Returns: PNG/JPEG image, cached 24h.
 */

const SB_URL = 'https://ctsuupvmmyjlrtjnxagv.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3V1cHZtbXlqbHJ0am54YWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg3MTgsImV4cCI6MjA5MDU0NDcxOH0.VgpKrjxYirb9Gc7OZX-aHGJmGJ3QdDM5I7iXaWDmBXQ';

export default async function handler(req) {
  const url = new URL(req.url, `https://${req.headers.get('host') || 'kromi.online'}`);
  const rideId = url.searchParams.get('ride');
  if (!rideId) return new Response('ride param required', { status: 400 });

  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/club_rides?id=eq.${encodeURIComponent(rideId)}&select=ride_data&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rows = await res.json();
    const rd = rows?.[0]?.ride_data || {};
    const heroUrl = rd.hero_image_url || rd.hero_image;

    // Case 1: Drive URL — proxy the image to avoid crawler blocks
    if (heroUrl && heroUrl.startsWith('https://')) {
      const imgRes = await fetch(heroUrl, { redirect: 'follow' });
      if (imgRes.ok) {
        const contentType = imgRes.headers.get('content-type') || 'image/png';
        return new Response(imgRes.body, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          },
        });
      }
    }

    // Case 2: base64 data URL (legacy)
    if (heroUrl && heroUrl.startsWith('data:')) {
      const match = heroUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            'Content-Type': match[1],
            'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          },
        });
      }
    }

    // Case 3: No hero image — fallback to SVG OG card
    const fallbackUrl = `${url.origin}/api/ride-og?ride=${encodeURIComponent(rideId)}`;
    return Response.redirect(fallbackUrl, 302);
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}

export const config = { runtime: 'edge' };
