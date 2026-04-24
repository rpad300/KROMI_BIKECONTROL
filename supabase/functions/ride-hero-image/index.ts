// ride-hero-image v5 — Nano Banana + Google Drive storage
// Generates AI image, uploads to Drive, stores URL in ride_data

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const DRIVE_REFRESH = Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN') ?? '';
const DRIVE_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const DRIVE_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
const ROOT_FOLDER_ID = Deno.env.get('KROMI_DRIVE_ROOT_FOLDER_ID') ?? '1fjb2tKtZ14PaofV573ScoeZDra95ubua';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ── Google Drive helpers ─────────────────────────────────────────────────
async function getDriveToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: DRIVE_REFRESH,
      client_id: DRIVE_CLIENT_ID,
      client_secret: DRIVE_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Drive token refresh failed');
  return data.access_token;
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const created = await createRes.json();
  return created.id;
}

async function uploadToDrive(token: string, imageBytes: Uint8Array, fileName: string, mimeType: string, folderId: string) {
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const boundary = 'kromi_boundary_' + Date.now();

  // Convert bytes to base64
  let b64 = '';
  const chunk = 8192;
  for (let i = 0; i < imageBytes.length; i += chunk) {
    b64 += String.fromCharCode(...imageBytes.slice(i, i + chunk));
  }
  b64 = btoa(b64);

  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}\r\n--${boundary}--`;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,thumbnailLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  const file = await res.json();

  // Make publicly readable
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return {
    id: file.id,
    webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    thumbnailLink: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1200`,
  };
}

// ── Nano Banana image generation ────────────────────────────────────────
const IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview'];

async function generateImage(prompt: string): Promise<{ data: Uint8Array; mime: string; model: string }> {
  const errors: string[] = [];
  for (const model of IMAGE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      });
      if (!res.ok) { errors.push(`${model}: ${res.status}`); continue; }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          const b64 = part.inlineData.data;
          const bytes = Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0));
          return { data: bytes, mime: part.inlineData.mimeType, model };
        }
      }
      errors.push(`${model}: no image in response`);
    } catch (e) {
      errors.push(`${model}: ${(e as Error).message}`);
    }
  }
  throw new Error(`All models failed: ${errors.join('; ')}`);
}

function buildImagePrompt(rideName: string, maxEle: number, terrain: string): string {
  const isHigh = maxEle > 1000;
  const isMed = maxEle > 500;
  let landscape = 'Portuguese countryside';
  if (isHigh) landscape = 'dramatic Portuguese mountain serra with rocky granite peaks, heather and mist';
  else if (isMed) landscape = 'rolling Portuguese green hills with valleys and granite villages';
  let extra = '';
  if (terrain.includes('xisto')) extra = ', schist stone paths';
  if (terrain.includes('floresta')) extra = ', dense pine and eucalyptus forest';
  return `Create a photorealistic wide panoramic landscape photograph of ${landscape}${extra}. ` +
    `A mountain bike dirt trail winds through the foreground. ` +
    `Golden hour light, dramatic clouds, cinematic wide-angle composition. ` +
    `Ultra sharp details, no people, no text, no logos. ` +
    `Location: ${rideName}, Northern Portugal.`;
}

// ── Main handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    if (!GEMINI_KEY) return json({ error: 'GEMINI_API_KEY not configured' }, 500);
    const { ride_id, force } = await req.json();
    if (!ride_id) return json({ error: 'ride_id required' }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: existing } = await sb.from('club_rides').select('ride_data, name, club_id').eq('id', ride_id).maybeSingle();

    if (!force && existing?.ride_data?.hero_image_url) {
      return json({ cached: true, hero_image_url: existing.ride_data.hero_image_url });
    }

    const rideData = existing?.ride_data || {};
    const ai = rideData.ai_enrichment || {};
    const prompt = buildImagePrompt(existing?.name || 'Ride', rideData.max_ele || 0, ai.terrain_analysis?.summary || '');

    // 1. Generate image via Nano Banana
    const result = await generateImage(prompt);

    // 2. Upload to Google Drive (KROMI PLATFORM/rides/{ride_id}/)
    const driveToken = await getDriveToken();
    const ridesFolder = await findOrCreateFolder(driveToken, 'rides', ROOT_FOLDER_ID);
    const rideFolder = await findOrCreateFolder(driveToken, ride_id, ridesFolder);
    const ext = result.mime === 'image/jpeg' ? 'jpg' : 'png';
    const fileName = `hero-${Date.now()}.${ext}`;
    const driveFile = await uploadToDrive(driveToken, result.data, fileName, result.mime, rideFolder);

    // 3. Store URL in ride_data (NOT base64)
    const heroImageUrl = driveFile.thumbnailLink;
    const updatedRideData = {
      ...rideData,
      hero_image: heroImageUrl,
      hero_image_url: heroImageUrl,
      hero_image_drive_id: driveFile.id,
      hero_image_prompt: prompt,
    };

    await sb.from('club_rides').update({ ride_data: updatedRideData }).eq('id', ride_id);

    return json({
      cached: false,
      hero_image_url: heroImageUrl,
      drive_id: driveFile.id,
      model: result.model,
      prompt,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
