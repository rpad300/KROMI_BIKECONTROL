// ═══════════════════════════════════════════════════════════
// driveStore — central state for KROMI Drive backend health
// ═══════════════════════════════════════════════════════════
// Tracks whether the drive-storage edge function is reachable and
// the underlying Google Drive folder is accessible. Settings UI
// reads this; uploaders bail out early if backend is offline.

import { create } from 'zustand';
import { pingDrive } from '../services/storage/googleDrive/driveClient';

export type DriveStatus = 'unknown' | 'checking' | 'online' | 'offline' | 'error';

interface DriveStorageQuota {
  limit: string | null;        // bytes (Drive API returns strings)
  usage: string | null;        // total bytes used by acting account
  usageInDrive: string | null; // bytes used in Drive (excludes Gmail/Photos)
}

interface DriveActingUser {
  displayName: string | null;
  emailAddress: string | null;
  photoLink: string | null;
}

interface DriveState {
  status: DriveStatus;
  rootFolderId: string | null;
  rootFolderName: string | null;
  actingAs: DriveActingUser | null;
  quota: DriveStorageQuota | null;
  lastChecked: number | null;
  lastError: string | null;

  /** Verify connection to Drive backend. Updates status + folder + quota. */
  refresh: () => Promise<void>;
}

export const useDriveStore = create<DriveState>()((set) => ({
  status: 'unknown',
  rootFolderId: null,
  rootFolderName: null,
  actingAs: null,
  quota: null,
  lastChecked: null,
  lastError: null,

  refresh: async () => {
    set({ status: 'checking', lastError: null });
    try {
      const r = await pingDrive();
      if (r.ok && r.folder) {
        set({
          status: 'online',
          rootFolderId: r.folder.id,
          rootFolderName: r.folder.name,
          actingAs: r.acting_as ?? null,
          quota: r.storage ?? null,
          lastChecked: Date.now(),
          lastError: null,
        });
      } else {
        set({
          status: 'offline',
          lastChecked: Date.now(),
          lastError: r.error ?? 'Drive backend offline',
        });
      }
    } catch (err) {
      set({
        status: 'error',
        lastChecked: Date.now(),
        lastError: (err as Error).message,
      });
    }
  },
}));
