// ═══════════════════════════════════════════════════════════
// drive-storage: Google Drive backend for KROMI files
// ═══════════════════════════════════════════════════════════
// Single edge function with action routing. Uses an OAuth refresh
// token (long-lived, generated once via OAuth Playground) to act
// as the KROMI Drive owner. All files end up in the shared KROMI
// PLATFORM folder. Browsers post here; secrets never leave the
// edge runtime.
//
// Why OAuth refresh token instead of Service Account?
//   Google Drive Service Accounts have NO storage quota in personal
//   Drive (only in Workspace Shared Drives). OAuth as the user means
//   files are owned by the user account and use that account's quota
//   (15 GB free).
//
// Auth: KROMI uses custom OTP sessions (not Supabase JWT). Each
// request must include `x-kromi-session` header with a valid token.
//
// Actions:
//   ping              → health check + folder access verification
//   ensureFolderPath  → create/return folder ID for "a/b/c" path
//   upload            → multipart upload (raw body = file bytes)
//   delete            → trash a file by Drive ID
//   list              → list files in a folder
//   getFile           → metadata for a single file
//   checkUserFolders  → batch: for each user slug, check which top-level
//                       sub-folders exist under users/{slug}/
//   bootstrapUser     → create the 6 sub-folders for users/{slug}/
//
// Required env (Edge Function secrets):
//   GOOGLE_OAUTH_CLIENT_ID     — OAuth 2.0 client id
//   GOOGLE_OAUTH_CLIENT_SECRET — OAuth 2.0 client secret
//   GOOGLE_OAUTH_REFRESH_TOKEN — long-lived refresh token (Drive scope)
//   KROMI_DRIVE_ROOT_FOLDER_ID — id of the "KROMI PLATFORM" folder
//   SUPABASE_URL               — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY  — auto-injected
// ═══════════════════════════════════════════════════════════

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ─── Config ──────────────────────────────────────────────────
const OAUTH_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
const OAUTH_REFRESH_TOKEN = Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN') ?? '';
const ROOT_FOLDER_ID = Deno.env.get('KROMI_DRIVE_ROOT_FOLDER_ID') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';

// ─── CORS ────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-kromi-session, content-type, x-kromi-meta',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ─── Token cache (warm containers reuse this) ────────────────
let cachedToken: { token: string; exp: number } | null = null;

/**
 * Exchange refresh token → access token. Cached for ~1h between calls
 * within a warm container. Refresh token never expires unless revoked.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token refresh failed: ${res.status} ${text}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// ─── Drive helpers ───────────────────────────────────────────
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  parents?: string[];
}

async function driveFetch(
  token: string,
  path: string,
  init: RequestInit = {},
  isUpload = false,
): Promise<Response> {
  const url = (isUpload ? DRIVE_UPLOAD : DRIVE_API) + path;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return await fetch(url, { ...init, headers });
}

async function findFolderByName(
  token: string,
  name: string,
  parentId: string,
): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`,
  );
  const res = await driveFetch(token, `/files?q=${q}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if (!res.ok) throw new Error(`findFolder failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { files: { id: string }[] };
  return data.files[0]?.id ?? null;
}

async function createFolder(token: string, name: string, parentId: string): Promise<string> {
  const res = await driveFetch(token, '/files?fields=id&supportsAllDrives=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) throw new Error(`createFolder failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { id: string };
  return data.id;
}

async function ensureFolderPath(token: string, segments: string[]): Promise<string> {
  // Walk segments under ROOT_FOLDER_ID, creating missing folders.
  let parent = ROOT_FOLDER_ID;
  for (const seg of segments) {
    if (!seg) continue;
    const existing = await findFolderByName(token, seg, parent);
    parent = existing ?? (await createFolder(token, seg, parent));
  }
  return parent;
}

async function uploadFile(
  token: string,
  body: Uint8Array,
  meta: { name: string; mimeType: string; parentId: string },
): Promise<DriveFile> {
  const boundary = `kromi_${crypto.randomUUID()}`;
  const metadata = {
    name: meta.name,
    mimeType: meta.mimeType,
    parents: [meta.parentId],
  };
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${meta.mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const multipart = new Uint8Array(head.length + body.length + tail.length);
  multipart.set(head, 0);
  multipart.set(body, head.length);
  multipart.set(tail, head.length + body.length);

  const res = await driveFetch(
    token,
    `/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,parents`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    },
    true,
  );
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function deleteFile(token: string, fileId: string): Promise<void> {
  // Soft delete (trash) — recoverable for 30 days.
  const res = await driveFetch(token, `/files/${fileId}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status} ${await res.text()}`);
}

async function listFolder(token: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveFetch(
    token,
    `/files?q=${q}&fields=files(id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { files: DriveFile[] };
  return data.files;
}

async function getFile(token: string, fileId: string): Promise<DriveFile> {
  const res = await driveFetch(
    token,
    `/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,parents`,
  );
  if (!res.ok) throw new Error(`getFile failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// ─── Auth: validate KROMI session ────────────────────────────
async function authenticate(req: Request): Promise<{ user_id: string } | null> {
  const sessionToken = req.headers.get('x-kromi-session');
  if (!sessionToken) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Device sessions: token = "device:{deviceId}", look up in device_tokens.
  if (sessionToken.startsWith('device:')) {
    const deviceId = sessionToken.slice(7);
    const { data } = await sb
      .from('device_tokens')
      .select('user_id')
      .eq('device_id', deviceId)
      .maybeSingle();
    return data ? { user_id: data.user_id as string } : null;
  }

  // Real sessions: hash the raw token (sha-256) and match against user_sessions.token_hash.
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionToken));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const { data } = await sb
    .from('user_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', hex)
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { user_id: data.user_id as string };
}

// ─── Request router ──────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET || !OAUTH_REFRESH_TOKEN || !ROOT_FOLDER_ID) {
      return json({ error: 'edge_function_misconfigured', missing: {
        client_id: !OAUTH_CLIENT_ID,
        client_secret: !OAUTH_CLIENT_SECRET,
        refresh_token: !OAUTH_REFRESH_TOKEN,
        root_folder: !ROOT_FOLDER_ID,
      }}, 500);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? '';

    // ── ping is unauthenticated (admin diagnostic) ──
    if (action === 'ping') {
      const token = await getAccessToken();
      const res = await driveFetch(token, `/files/${ROOT_FOLDER_ID}?supportsAllDrives=true&fields=id,name,mimeType`);
      if (!res.ok) {
        return json({ ok: false, status: res.status, error: await res.text() }, 200);
      }
      const folder = await res.json();
      // Also fetch the authenticated user info to confirm WHO we're acting as.
      const aboutRes = await driveFetch(token, '/about?fields=user');
      const about = aboutRes.ok ? await aboutRes.json() : null;
      return json({ ok: true, folder, acting_as: about?.user ?? null });
    }

    const auth = await authenticate(req);
    if (!auth) return json({ error: 'unauthorized' }, 401);

    const token = await getAccessToken();

    switch (action) {
      case 'ensureFolderPath': {
        const { path } = await req.json() as { path: string[] };
        if (!Array.isArray(path)) return json({ error: 'path must be string[]' }, 400);
        const folderId = await ensureFolderPath(token, path);
        return json({ folder_id: folderId });
      }

      case 'upload': {
        // Metadata in x-kromi-meta header (JSON), body = raw file bytes.
        const metaHeader = req.headers.get('x-kromi-meta');
        if (!metaHeader) return json({ error: 'missing x-kromi-meta' }, 400);
        const meta = JSON.parse(metaHeader) as {
          name: string;
          mimeType: string;
          path: string[];
        };
        const folderId = await ensureFolderPath(token, meta.path);
        const buf = new Uint8Array(await req.arrayBuffer());
        const file = await uploadFile(token, buf, {
          name: meta.name,
          mimeType: meta.mimeType,
          parentId: folderId,
        });
        return json({ file, folder_id: folderId, folder_path: meta.path.join('/') });
      }

      case 'delete': {
        const { file_id } = await req.json() as { file_id: string };
        await deleteFile(token, file_id);
        return json({ ok: true });
      }

      case 'list': {
        const { folder_id } = await req.json() as { folder_id: string };
        const files = await listFolder(token, folder_id);
        return json({ files });
      }

      case 'getFile': {
        const { file_id } = await req.json() as { file_id: string };
        const file = await getFile(token, file_id);
        return json({ file });
      }

      case 'checkUserFolders': {
        // Batch: returns { [slug]: { exists: bool, missing: string[] } }.
        // Used by admin UI to show Drive status per user.
        const { slugs } = await req.json() as { slugs: string[] };
        if (!Array.isArray(slugs)) return json({ error: 'slugs must be string[]' }, 400);
        const expected = ['bikes', 'bikefits', 'activities', 'routes', 'profile', 'other'];
        const result: Record<string, { exists: boolean; missing: string[] }> = {};
        // First find/create the 'users' parent folder ID once (cached implicitly via Drive)
        let usersParent: string | null = null;
        try {
          usersParent = await findFolderByName(token, 'users', ROOT_FOLDER_ID);
        } catch {
          usersParent = null;
        }
        if (!usersParent) {
          // 'users' top-level doesn't exist → all user folders are missing
          for (const slug of slugs) result[slug] = { exists: false, missing: expected };
          return json({ result });
        }
        for (const slug of slugs) {
          const userFolder = await findFolderByName(token, slug, usersParent);
          if (!userFolder) {
            result[slug] = { exists: false, missing: expected };
            continue;
          }
          const missing: string[] = [];
          for (const sub of expected) {
            const f = await findFolderByName(token, sub, userFolder);
            if (!f) missing.push(sub);
          }
          result[slug] = { exists: missing.length === 0, missing };
        }
        return json({ result });
      }

      case 'bootstrapUser': {
        const { slug } = await req.json() as { slug: string };
        if (!slug) return json({ error: 'slug required' }, 400);
        const subs = ['bikes', 'bikefits', 'activities', 'routes', 'profile', 'other'];
        const created: { folder: string; folder_id: string }[] = [];
        for (const sub of subs) {
          const id = await ensureFolderPath(token, ['users', slug, sub]);
          created.push({ folder: `users/${slug}/${sub}`, folder_id: id });
        }
        return json({ created });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
