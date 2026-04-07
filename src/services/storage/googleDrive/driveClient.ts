// ═══════════════════════════════════════════════════════════
// driveClient — thin browser client for the drive-storage edge function
// ═══════════════════════════════════════════════════════════
// All Drive operations go through Supabase Edge Function (drive-storage).
// Service Account credentials never reach the browser.

import { useAuthStore } from '../../../store/authStore';

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const FN_URL = SB_URL ? `${SB_URL}/functions/v1/drive-storage` : '';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  parents?: string[];
}

export interface UploadResult {
  file: DriveFile;
  folder_id: string;
  folder_path: string;
}

function authHeaders(): HeadersInit {
  const session = useAuthStore.getState().sessionToken;
  return {
    apikey: SB_KEY ?? '',
    Authorization: `Bearer ${SB_KEY ?? ''}`,
    'x-kromi-session': session ?? '',
  };
}

async function callJson<T>(action: string, body: unknown): Promise<T> {
  if (!FN_URL) throw new Error('Supabase URL not configured');
  const res = await fetch(`${FN_URL}?action=${action}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `drive-storage ${action} failed`);
  return data as T;
}

/** Health check + folder access verification (admin diagnostic). */
export async function pingDrive(): Promise<{
  ok: boolean;
  folder?: { id: string; name: string };
  acting_as?: {
    displayName: string | null;
    emailAddress: string | null;
    photoLink: string | null;
  } | null;
  storage?: {
    limit: string | null;
    usage: string | null;
    usageInDrive: string | null;
  } | null;
  error?: string;
}> {
  if (!FN_URL) return { ok: false, error: 'Supabase URL not configured' };
  const res = await fetch(`${FN_URL}?action=ping`, {
    method: 'POST',
    headers: { apikey: SB_KEY ?? '', Authorization: `Bearer ${SB_KEY ?? ''}` },
  });
  return await res.json();
}

/** Ensure a folder path exists under KROMI PLATFORM. Returns folder ID. */
export async function ensureFolderPath(path: string[]): Promise<string> {
  const r = await callJson<{ folder_id: string }>('ensureFolderPath', { path });
  return r.folder_id;
}

/** Upload a file. `path` is the folder hierarchy under KROMI PLATFORM. */
export async function uploadFileToDrive(
  file: File | Blob,
  meta: { name: string; mimeType: string; path: string[] },
): Promise<UploadResult> {
  if (!FN_URL) throw new Error('Supabase URL not configured');
  const res = await fetch(`${FN_URL}?action=upload`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': meta.mimeType,
      'x-kromi-meta': JSON.stringify(meta),
    },
    body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'upload failed');
  return data as UploadResult;
}

/** Move a file to Drive trash (recoverable for 30 days). */
export async function deleteFileFromDrive(fileId: string): Promise<void> {
  await callJson<{ ok: true }>('delete', { file_id: fileId });
}

/** List files in a folder. */
export async function listDriveFolder(folderId: string): Promise<DriveFile[]> {
  const r = await callJson<{ files: DriveFile[] }>('list', { folder_id: folderId });
  return r.files;
}

/** Fetch single file metadata. */
export async function getDriveFile(fileId: string): Promise<DriveFile> {
  const r = await callJson<{ file: DriveFile }>('getFile', { file_id: fileId });
  return r.file;
}

// ─── Admin: per-user folder status ──────────────────────────
export interface UserFolderStatus {
  exists: boolean;
  missing: string[];
}

/** Batch-check whether the 6 sub-folders exist for each user slug. */
export async function checkUserFolders(
  slugs: string[],
): Promise<Record<string, UserFolderStatus>> {
  const r = await callJson<{ result: Record<string, UserFolderStatus> }>('checkUserFolders', {
    slugs,
  });
  return r.result;
}

/** Force-create the 6 sub-folders for users/{slug}/. Idempotent. */
export async function bootstrapUserOnDrive(
  slug: string,
): Promise<{ folder: string; folder_id: string }[]> {
  const r = await callJson<{ created: { folder: string; folder_id: string }[] }>(
    'bootstrapUser',
    { slug },
  );
  return r.created;
}

/**
 * GDPR self-service: move the entire users/{slug}/ folder to Drive
 * trash. Used by deleteMyAccount BEFORE the DB RPC fires so binary
 * content stops being accessible via any drive_view_link before the
 * kromi_files metadata rows are deleted. Idempotent; returns
 * `{ trashed: false }` when the folder doesn't exist.
 */
export async function trashUserDriveFolder(
  slug: string,
): Promise<{ trashed: boolean; folder_id?: string; reason?: string }> {
  return await callJson<{ trashed: boolean; folder_id?: string; reason?: string }>(
    'trashUserFolder',
    { slug },
  );
}
