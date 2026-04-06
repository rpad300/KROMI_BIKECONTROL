// ═══════════════════════════════════════════════════════════
// KromiFileStore — unified file storage facade
// ═══════════════════════════════════════════════════════════
//
// ⚠️ MANDATORY: ALL file uploads in KROMI MUST go through this module.
//    NEVER call Supabase Storage REST, browser Drive API, or any other
//    storage backend directly. This is the single source of truth for
//    KROMI files. The taxonomy + folder routing lives here, in one place.
//
// Single entry point for all file uploads/downloads in KROMI.
// Backend: Google Drive (via drive-storage edge function).
// Metadata: Supabase `kromi_files` table (REST direct, no client lib).
//
// Folder taxonomy under KROMI PLATFORM:
//   users/{user-slug}/bikes/{bike-slug}/photos/
//   users/{user-slug}/bikes/{bike-slug}/components/
//   users/{user-slug}/bikes/{bike-slug}/services/{service-id}/{before|after|damage|receipts}/
//   users/{user-slug}/bikefits/{bike-slug}/{YYYY-MM-DD}/
//   users/{user-slug}/activities/{YYYY-MM}/{ride-id}/
//   users/{user-slug}/routes/
//   users/{user-slug}/profile/
//   shops/{shop-slug}/   ← shared across users (not nested under user)
//
// Storage backend is intentionally abstracted: if we ever swap
// Drive for R2/S3, only driveClient.ts changes.

import {
  uploadFileToDrive,
  deleteFileFromDrive,
  ensureFolderPath as ensureDriveFolderPath,
  type DriveFile,
} from './googleDrive/driveClient';

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// ─── Types ───────────────────────────────────────────────────
export type FileCategory =
  | 'bike_photo'
  | 'bike_component'
  | 'service_photo'
  | 'bikefit_photo'
  | 'ride_export'
  | 'route'
  | 'shop_logo'
  | 'shop_photo'
  | 'profile'
  | 'receipt'
  | 'other';

export type FileEntityType =
  | 'bike'
  | 'bike_fit'
  | 'service_request'
  | 'service_item'
  | 'shop'
  | 'ride'
  | 'route'
  | 'user'
  | null;

export interface KromiFile {
  id: string;
  owner_user_id: string;
  drive_file_id: string;
  drive_view_link: string | null;
  drive_download_link: string | null;
  drive_thumbnail_link: string | null;
  drive_folder_id: string | null;
  drive_folder_path: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  category: FileCategory;
  subcategory: string | null;
  entity_type: FileEntityType;
  entity_id: string | null;
  caption: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FolderResolveOptions {
  category: FileCategory;
  subcategory?: string;
  entityType?: FileEntityType;
  entityId?: string | null;
  /**
   * Stable slug identifying the owning user (for nesting under users/{slug}/).
   * Required for personal categories. Compute via `userFolderSlug(user)`.
   */
  ownerUserSlug?: string;
  bikeSlug?: string;
  shopSlug?: string;
  serviceId?: string;
  date?: Date;
}

export interface UploadOptions extends FolderResolveOptions {
  /** Owning user UUID (for filtering kromi_files by owner). */
  ownerUserId: string;
  /** Caption / description. */
  caption?: string;
  /** Extra metadata (gear, geo, etc.). */
  metadata?: Record<string, unknown>;
  /** Override the file name. Defaults to original. */
  fileName?: string;
}

// ─── Slug helpers ────────────────────────────────────────────
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

/**
 * Stable folder slug for a user. Derived from email so the same user always
 * lands in the same Drive folder, even across logins. Falls back to UUID for
 * users without email (shouldn't happen in KROMI).
 */
export function userFolderSlug(user: { id: string; email?: string | null }): string {
  if (user.email) return slugify(user.email);
  return user.id.slice(0, 8);
}

/** Categories that get nested under users/{slug}/. Shops are shared. */
const PERSONAL_CATEGORIES = new Set<FileCategory>([
  'bike_photo',
  'bike_component',
  'service_photo',
  'bikefit_photo',
  'ride_export',
  'route',
  'profile',
  'receipt',
  'other',
]);

// ─── Folder routing ──────────────────────────────────────────
// Given category + entity, return the folder path under KROMI PLATFORM.
// This is the heart of the file taxonomy. Keep it in one place.
export function resolveFolderPath(opts: FolderResolveOptions): string[] {
  const d = opts.date ?? new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  // Personal categories live under users/{slug}/. Shops are shared and stay top-level.
  const isPersonal = PERSONAL_CATEGORIES.has(opts.category);
  const userPrefix: string[] =
    isPersonal && opts.ownerUserSlug ? ['users', opts.ownerUserSlug] : [];

  switch (opts.category) {
    case 'bike_photo':
      return [...userPrefix, 'bikes', opts.bikeSlug ?? 'unknown', 'photos'];

    case 'bike_component':
      return [...userPrefix, 'bikes', opts.bikeSlug ?? 'unknown', 'components'];

    case 'service_photo': {
      const sub = opts.subcategory ?? 'general';
      const sid = opts.serviceId ?? opts.entityId ?? 'unknown';
      return [...userPrefix, 'bikes', opts.bikeSlug ?? 'unknown', 'services', sid, sub];
    }

    case 'receipt': {
      const sid = opts.serviceId ?? opts.entityId ?? 'unknown';
      return [...userPrefix, 'bikes', opts.bikeSlug ?? 'unknown', 'services', sid, 'receipts'];
    }

    case 'bikefit_photo':
      return [...userPrefix, 'bikefits', opts.bikeSlug ?? 'unknown', `${yyyy}-${mm}-${dd}`];

    case 'ride_export':
      return [...userPrefix, 'activities', `${yyyy}-${mm}`, opts.entityId ?? 'unknown'];

    case 'route':
      return [...userPrefix, 'routes'];

    case 'profile':
      return [...userPrefix, 'profile'];

    case 'shop_logo':
    case 'shop_photo':
      return ['shops', opts.shopSlug ?? 'unknown'];

    case 'other':
    default:
      return [...userPrefix, 'other', `${yyyy}-${mm}`];
  }
}

// ─── Supabase REST helpers ───────────────────────────────────
function sbHeaders(): HeadersInit {
  return {
    apikey: SB_KEY ?? '',
    Authorization: `Bearer ${SB_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

async function insertKromiFile(record: Partial<KromiFile>): Promise<KromiFile | null> {
  if (!SB_URL || !SB_KEY) throw new Error('Supabase not configured');
  const res = await fetch(`${SB_URL}/rest/v1/kromi_files`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`kromi_files insert ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

async function selectKromiFiles(query: string): Promise<KromiFile[]> {
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(`${SB_URL}/rest/v1/kromi_files?${query}`, {
    headers: sbHeaders(),
  });
  const data = await res.json();
  return Array.isArray(data) ? (data as KromiFile[]) : [];
}

async function deleteKromiFile(fileId: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  await fetch(`${SB_URL}/rest/v1/kromi_files?id=eq.${fileId}`, {
    method: 'DELETE',
    headers: sbHeaders(),
  });
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Upload a file to Google Drive (via edge function) and register
 * its metadata in `kromi_files`. Returns the created row.
 */
export async function uploadFile(file: File, opts: UploadOptions): Promise<KromiFile> {
  const path = resolveFolderPath(opts);
  const fileName = opts.fileName ?? file.name;
  const mimeType = file.type || 'application/octet-stream';

  // 1. Bytes → Drive
  const result = await uploadFileToDrive(file, { name: fileName, mimeType, path });

  // 2. Metadata → Supabase
  try {
    const row = await insertKromiFile({
      owner_user_id: opts.ownerUserId,
      drive_file_id: result.file.id,
      drive_view_link: result.file.webViewLink ?? null,
      drive_download_link: result.file.webContentLink ?? null,
      drive_thumbnail_link: result.file.thumbnailLink ?? null,
      drive_folder_id: result.folder_id,
      drive_folder_path: result.folder_path,
      file_name: result.file.name,
      mime_type: result.file.mimeType,
      size_bytes: result.file.size ? Number(result.file.size) : file.size,
      category: opts.category,
      subcategory: opts.subcategory ?? null,
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
      caption: opts.caption ?? null,
      metadata: opts.metadata ?? {},
    });
    if (!row) throw new Error('insert returned null');
    return row;
  } catch (err) {
    // Drive upload succeeded but DB insert failed — clean up Drive.
    try {
      await deleteFileFromDrive(result.file.id);
    } catch {
      // best effort
    }
    throw err;
  }
}

/** Delete file from Drive and remove its row. */
export async function deleteFile(kromiFileId: string): Promise<void> {
  const rows = await selectKromiFiles(`id=eq.${kromiFileId}&select=drive_file_id`);
  const driveId = rows[0]?.drive_file_id;
  if (driveId) {
    try {
      await deleteFileFromDrive(driveId);
    } catch {
      // continue with DB delete even if Drive delete fails
    }
  }
  await deleteKromiFile(kromiFileId);
}

/** All files attached to an entity (e.g. all photos of a service request). */
export async function listFilesByEntity(
  entityType: NonNullable<FileEntityType>,
  entityId: string,
): Promise<KromiFile[]> {
  return selectKromiFiles(
    `entity_type=eq.${entityType}&entity_id=eq.${entityId}&order=created_at.desc`,
  );
}

/** All files of a given category for a user. */
export async function listFilesByCategory(
  ownerUserId: string,
  category: FileCategory,
): Promise<KromiFile[]> {
  return selectKromiFiles(
    `owner_user_id=eq.${ownerUserId}&category=eq.${category}&order=created_at.desc`,
  );
}

/** Best image URL: thumbnail when available, else view link. */
export function fileImageUrl(file: KromiFile, prefer: 'thumbnail' | 'view' = 'thumbnail'): string {
  if (prefer === 'thumbnail' && file.drive_thumbnail_link) return file.drive_thumbnail_link;
  return file.drive_view_link ?? file.drive_download_link ?? '';
}

// ─── Bootstrap ───────────────────────────────────────────────
//
// All ensureFolderPath calls below are idempotent — folders that
// already exist are matched (not duplicated). Safe to call repeatedly.

/** Top-level shared folders (not per-user). */
export const TOP_LEVEL_FOLDERS = ['users', 'shops'] as const;

/** Per-user sub-folders created when a user is bootstrapped. */
export const USER_SUBFOLDERS = ['bikes', 'bikefits', 'activities', 'routes', 'profile', 'other'] as const;

export interface BootstrapResult {
  folder: string;
  folder_id: string;
}

/**
 * Bootstrap the global KROMI PLATFORM structure. Creates `users/` and
 * `shops/` top-level. Run once via Settings → Drive admin button.
 */
export async function bootstrapFolderStructure(): Promise<BootstrapResult[]> {
  const results: BootstrapResult[] = [];
  for (const folder of TOP_LEVEL_FOLDERS) {
    const id = await ensureDriveFolderPath([folder]);
    results.push({ folder, folder_id: id });
  }
  return results;
}

/**
 * Bootstrap a single user's folder tree under users/{userSlug}/. Called
 * automatically when a user logs in (via useDriveBootstrap hook). Safe to
 * call repeatedly — existing folders are reused, not duplicated.
 *
 * Creates:
 *   users/{userSlug}/
 *   users/{userSlug}/bikes/
 *   users/{userSlug}/bikefits/
 *   users/{userSlug}/activities/
 *   users/{userSlug}/routes/
 *   users/{userSlug}/profile/
 *   users/{userSlug}/other/
 */
export async function bootstrapUserFolders(userSlug: string): Promise<BootstrapResult[]> {
  if (!userSlug) throw new Error('userSlug is required');
  const results: BootstrapResult[] = [];
  // Ensure parent first
  await ensureDriveFolderPath(['users', userSlug]);
  for (const sub of USER_SUBFOLDERS) {
    const id = await ensureDriveFolderPath(['users', userSlug, sub]);
    results.push({ folder: `users/${userSlug}/${sub}`, folder_id: id });
  }
  return results;
}

export type { DriveFile };
