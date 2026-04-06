// ═══════════════════════════════════════════════════════════
// useDriveBootstrap — auto-create the user's KROMI Drive folder tree
// ═══════════════════════════════════════════════════════════
// Mounted once at the App root. Watches the auth store and, on first
// successful login of a session, ensures `users/{userSlug}/{bikes,...}`
// exist in Drive. Idempotent and fire-and-forget — failures are logged
// but never block the UI.

import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { bootstrapUserFolders, userFolderSlug } from '../services/storage/KromiFileStore';

const SESSION_KEY = 'kromi-drive-bootstrap';

export function useDriveBootstrap(): void {
  const user = useAuthStore((s) => s.user);
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Only bootstrap once per (session × user). sessionStorage check survives
    // re-renders; the ref handles in-memory deduplication.
    if (ranFor.current === user.id) return;

    const slug = userFolderSlug(user);
    const cacheKey = `${SESSION_KEY}:${slug}`;
    if (sessionStorage.getItem(cacheKey) === '1') {
      ranFor.current = user.id;
      return;
    }

    ranFor.current = user.id;
    void bootstrapUserFolders(slug)
      .then((results) => {
        sessionStorage.setItem(cacheKey, '1');
        // eslint-disable-next-line no-console
        console.info('[Drive] Bootstrapped user folders:', results.length, 'for', slug);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[Drive] User folder bootstrap failed:', err);
        // Don't cache failure — retry next session
      });
  }, [user]);
}
