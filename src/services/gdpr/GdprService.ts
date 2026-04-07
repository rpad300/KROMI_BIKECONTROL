// ═══════════════════════════════════════════════════════════
// GdprService — user-facing data export + account deletion
// ═══════════════════════════════════════════════════════════
//
// Everything here runs client-side with the user's own JWT, so
// each REST call is RLS-filtered to the current viewer. No admin
// privileges are required.
//
// EXPORT — bundles every table row the user owns into a zip with
// one JSON file per table + a small `manifest.json` listing what
// was included. Large binary files (photos, fit imports) are NOT
// downloaded — only their `kromi_files` metadata rows with the
// Drive links, so the user can re-download them on demand.
//
// DELETE — calls `kromi_delete_my_account` RPC after the user
// types their own email to confirm. Frontend also invokes the
// drive-storage edge function to trash the user's Drive folder
// before calling the RPC; failures in the Drive step are logged
// and do NOT block the DB delete (GDPR compliance is measured on
// data inaccessibility, not physical erasure).

import JSZip from 'jszip';
import { supaGet, supaRpc } from '../../lib/supaFetch';
import { useAuthStore } from '../../store/authStore';
import type { AuthUser } from '../auth/AuthService';

// ── Types ──────────────────────────────────────────────────
export interface ExportProgress {
  table: string;
  status: 'pending' | 'fetching' | 'done' | 'failed';
  rows?: number;
  error?: string;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  tables: ExportProgress[];
  total_rows: number;
}

// Tables to include in the export. Each entry describes:
//   • `table` — REST endpoint name
//   • `filter` — how to scope to the current user
//   • `select` — columns to fetch
const EXPORT_TABLES: Array<{
  table: string;
  filter: (userId: string) => string;
  select: string;
  /** JSON file name inside the zip (defaults to `<table>.json`) */
  file?: string;
}> = [
  { table: 'app_users',          filter: (u) => `id=eq.${u}`,        select: 'id,email,name,created_at,last_login_at' },
  { table: 'user_settings',      filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'bike_configs',       filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'bike_fits',          filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'bike_qr_codes',      filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'athlete_profiles',   filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'emergency_profiles', filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'ride_sessions',      filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'maintenance_schedules', filter: (u) => `user_id=eq.${u}`, select: '*' },
  { table: 'routes',             filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'club_members',       filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'shop_reviews',       filter: (u) => `user_id=eq.${u}`,   select: '*' },
  { table: 'kromi_files',        filter: (u) => `owner_user_id=eq.${u}`, select: 'id,category,subcategory,entity_type,entity_id,file_name,mime_type,size_bytes,drive_file_id,drive_view_link,drive_download_link,caption,created_at' },
  { table: 'login_history',      filter: (u) => `user_id=eq.${u}`,   select: 'id,created_at,user_agent' },
];

/**
 * Build and download a zip bundle of the current user's data.
 *
 * @param onProgress optional callback to drive a progress UI.
 *                   Called once per table with the evolving state.
 */
export async function exportMyData(
  onProgress?: (progress: ExportProgress[]) => void,
): Promise<ExportResult> {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error('not authenticated');

  const progress: ExportProgress[] = EXPORT_TABLES.map((t) => ({
    table: t.table,
    status: 'pending',
  }));
  const report = () => onProgress?.([...progress]);
  report();

  const zip = new JSZip();
  let total_rows = 0;

  // Fetch each table sequentially so the progress callback makes
  // sense to the UI. The volumes are small (one user) so there's
  // no wall-time benefit to parallelising.
  for (let i = 0; i < EXPORT_TABLES.length; i++) {
    const spec = EXPORT_TABLES[i]!;
    progress[i] = { ...progress[i]!, status: 'fetching' };
    report();

    try {
      const rows = await supaGet<unknown[]>(
        `/rest/v1/${spec.table}?${spec.filter(user.id)}&select=${spec.select}`,
      );
      const safeRows = Array.isArray(rows) ? rows : [];
      zip.file(spec.file ?? `${spec.table}.json`, JSON.stringify(safeRows, null, 2));
      total_rows += safeRows.length;
      progress[i] = { ...progress[i]!, status: 'done', rows: safeRows.length };
    } catch (err) {
      progress[i] = {
        ...progress[i]!,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
      // Still put an empty file so the manifest counts line up.
      zip.file(spec.file ?? `${spec.table}.json`, '[]');
    }
    report();
  }

  // Also include ride_snapshots — they're keyed by session_id so
  // we fetch them per-session and dump into a sub-folder. Skipped
  // on error (snapshots are derived data and can be regenerated
  // from the original FIT/GPX by the user).
  try {
    const sessions = await supaGet<Array<{ id: string }>>(
      `/rest/v1/ride_sessions?user_id=eq.${user.id}&select=id`,
    );
    for (const sess of sessions ?? []) {
      const snaps = await supaGet<unknown[]>(
        `/rest/v1/ride_snapshots?session_id=eq.${sess.id}&select=*&order=elapsed_s.asc`,
      ).catch(() => []);
      const safeSnaps = Array.isArray(snaps) ? snaps : [];
      if (safeSnaps.length > 0) {
        zip.file(`ride_snapshots/${sess.id}.json`, JSON.stringify(safeSnaps));
        total_rows += safeSnaps.length;
      }
    }
  } catch {
    // ignore — snapshots are best-effort
  }

  // Manifest
  const manifest = {
    version: 1,
    exported_at: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    tables: progress,
    total_rows,
    notes: [
      'This export contains all structured data KROMI stores about you.',
      'Binary files (photos, FIT imports) are referenced by their Drive links in kromi_files.json.',
      'To request full deletion of your account, use the "Delete my account" action in Settings → Privacidade.',
    ],
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: 'blob' });
  const filename = `kromi-data-${user.id}-${new Date()
    .toISOString()
    .slice(0, 10)}.zip`;

  return { blob, filename, tables: progress, total_rows };
}

/**
 * Trigger a browser download of an export result.
 */
export function downloadExport(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
// Delete my account
// ═══════════════════════════════════════════════════════════

export interface DeleteAccountResult {
  success: boolean;
  log_id?: string;
  error?: string;
}

/**
 * Self-service account deletion. Requires the user to type their
 * own email for confirmation (checked server-side as well). The
 * RPC is SECURITY DEFINER and takes the current session token.
 *
 * After success the caller should:
 *   1. useAuthStore.getState().logout()
 *   2. navigate to the login page
 */
export async function deleteMyAccount(
  confirmationEmail: string,
): Promise<DeleteAccountResult> {
  const { user, sessionToken } = useAuthStore.getState();
  if (!user || !sessionToken) {
    return { success: false, error: 'not authenticated' };
  }
  if (lower(confirmationEmail) !== lower(user.email)) {
    return { success: false, error: 'email confirmation does not match' };
  }

  try {
    const logId = await supaRpc<string>('kromi_delete_my_account', {
      p_session_token: sessionToken,
      p_confirmation_email: confirmationEmail,
    });
    return { success: true, log_id: logId ?? undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** Convenience type for consumers. */
export type { AuthUser };
