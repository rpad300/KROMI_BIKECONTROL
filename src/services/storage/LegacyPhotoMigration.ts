// ═══════════════════════════════════════════════════════════
// LegacyPhotoMigration — re-upload Supabase Storage photos to Drive
// ═══════════════════════════════════════════════════════════
//
// Background:
// `service_photos` originally pointed at Supabase Storage via `storage_path`.
// After Session 16, all new uploads route through KromiFileStore (Google Drive
// + kromi_files registry) and store a `file_id`. This script walks the
// remaining "legacy" rows (storage_path set, file_id null), downloads each
// blob from the public Supabase URL, re-uploads it via KromiFileStore, and
// patches the row to point at the new `file_id`. The legacy `storage_path`
// stays in place so we can verify before deleting from Storage.
//
// Run from the Super Admin → Sistema panel. Idempotent — re-running picks up
// only the still-legacy rows.

import { uploadFile, slugify, userFolderSlug, type FileCategory } from './KromiFileStore';
import type { AuthUser } from '../auth/AuthService';
import { supaFetch, SUPABASE_URL } from '../../lib/supaFetch';

interface LegacyPhotoRow {
  id: string;
  service_id: string;
  uploaded_by: string;
  storage_path: string | null;
  file_id: string | null;
  file_name: string | null;
  caption: string | null;
  photo_type: string;
  // Joined from service_requests for slug context
  service_requests?: {
    bike_name: string | null;
    rider_id: string | null;
  } | null;
  // Joined from app_users
  app_users?: {
    email: string | null;
    name: string | null;
  } | null;
}

export interface MigrationProgress {
  total: number;
  done: number;
  failed: number;
  current: string | null;
}

export interface MigrationResult {
  total: number;
  migrated: number;
  failed: Array<{ id: string; error: string }>;
}

/** Count rows still on Supabase Storage. */
export async function countLegacyPhotos(): Promise<number> {
  try {
    const res = await supaFetch(
      '/rest/v1/service_photos?storage_path=not.is.null&file_id=is.null&select=id',
      { method: 'GET', headers: { Prefer: 'count=exact', Range: '0-0' } },
    );
    const range = res.headers.get('content-range') ?? '';
    const m = /\/(\d+|\*)$/.exec(range);
    if (!m || m[1] === '*') return 0;
    return parseInt(m[1] ?? '0', 10);
  } catch {
    return 0;
  }
}

async function fetchLegacyBatch(limit: number): Promise<LegacyPhotoRow[]> {
  const path =
    '/rest/v1/service_photos' +
    '?storage_path=not.is.null&file_id=is.null' +
    '&select=*,service_requests(bike_name,rider_id),app_users!service_photos_uploaded_by_fkey(email,name)' +
    `&order=created_at.asc&limit=${limit}`;
  try {
    const res = await supaFetch(path);
    return (await res.json()) as LegacyPhotoRow[];
  } catch (err) {
    throw new Error(`Falha ao listar fotos legadas: ${(err as Error).message}`);
  }
}

/** Convert a public Supabase Storage path into a downloadable URL. */
function publicUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${storagePath}`;
}

async function downloadAsFile(storagePath: string, fileName: string): Promise<File> {
  const res = await fetch(publicUrl(storagePath));
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  const blob = await res.blob();
  return new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
}

async function patchPhotoRow(
  photoId: string,
  patch: { file_id: string; file_name: string; file_size_bytes: number; mime_type: string },
): Promise<void> {
  try {
    await supaFetch(`/rest/v1/service_photos?id=eq.${photoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
  } catch (err) {
    throw new Error(`patch falhou: ${(err as Error).message}`);
  }
}

/**
 * Migrate every remaining legacy photo. Calls onProgress after each row so
 * the UI can show a progress bar. Errors are collected per-row instead of
 * aborting the whole batch.
 */
export async function migrateLegacyPhotos(
  onProgress?: (p: MigrationProgress) => void,
  batchSize = 25,
): Promise<MigrationResult> {
  const result: MigrationResult = { total: 0, migrated: 0, failed: [] };
  const total = await countLegacyPhotos();
  result.total = total;
  if (total === 0) return result;

  let processed = 0;
  // We re-fetch each batch because we patched the previous one, so the
  // legacy filter naturally drains.
  // Safety cap = total to avoid runaway loops if the patch silently fails.
  while (processed < total) {
    const batch = await fetchLegacyBatch(batchSize);
    if (batch.length === 0) break;

    for (const row of batch) {
      onProgress?.({
        total,
        done: result.migrated,
        failed: result.failed.length,
        current: row.file_name ?? row.id,
      });
      try {
        if (!row.storage_path) throw new Error('storage_path nulo');
        const fileName = row.file_name ?? `photo_${row.id}.jpg`;
        const file = await downloadAsFile(row.storage_path, fileName);

        // Reconstruct the owner context. Prefer the rider on the service;
        // fall back to the uploader.
        const ownerId = row.service_requests?.rider_id ?? row.uploaded_by;
        const ownerEmail = row.app_users?.email ?? null;
        const ownerStub: AuthUser = {
          id: ownerId,
          email: ownerEmail ?? `unknown-${ownerId}@kromi.local`,
          name: row.app_users?.name ?? null,
        } as AuthUser;
        const bikeSlug = slugify(row.service_requests?.bike_name ?? 'unknown');
        const category: FileCategory = row.photo_type === 'receipt' ? 'receipt' : 'service_photo';

        const kromiFile = await uploadFile(file, {
          ownerUserId: ownerId,
          ownerUserSlug: userFolderSlug(ownerStub),
          category,
          subcategory: row.photo_type,
          entityType: 'service_request',
          entityId: row.service_id,
          bikeSlug,
          serviceId: row.service_id,
          caption: row.caption ?? undefined,
        });

        await patchPhotoRow(row.id, {
          file_id: kromiFile.id,
          file_name: kromiFile.file_name,
          file_size_bytes: kromiFile.size_bytes ?? file.size,
          mime_type: kromiFile.mime_type ?? file.type ?? 'application/octet-stream',
        });
        result.migrated += 1;
      } catch (err) {
        result.failed.push({ id: row.id, error: (err as Error).message });
      }
      processed += 1;
    }

    onProgress?.({ total, done: result.migrated, failed: result.failed.length, current: null });
  }

  return result;
}
