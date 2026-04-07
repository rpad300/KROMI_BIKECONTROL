// ═══════════════════════════════════════════════════════════
// useReadOnlyGuard — block writes while impersonating a user
// ═══════════════════════════════════════════════════════════
//
// During impersonation, the super admin sees the platform "as" another
// user. We do NOT want admins to mutate that user's data by accident,
// so all write paths (saves, uploads, deletes) should call `guard()`
// before performing the operation.
//
// Usage:
//   const guard = useReadOnlyGuard();
//   const onSave = () => {
//     if (!guard('Não é possível guardar em modo impersonation.')) return;
//     // ... actually save
//   };
//
// `guard(message?)` returns true if the action is allowed, false otherwise.
// When blocked it pushes a toast via the read-only-toast bus so the UI
// can react (see ReadOnlyToast component below).

import { useCallback } from 'react';
import { useAuthStore } from '../store/authStore';

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

/** Push a read-only blocked-message to any subscribed UI. */
export function emitReadOnlyToast(message: string) {
  for (const fn of listeners) {
    try { fn(message); } catch { /* ignore listener errors */ }
  }
}

/** Subscribe to read-only blocked events (returns an unsubscribe fn). */
export function subscribeReadOnlyToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Returns a `guard()` function for write operations.
 * Call `guard()` at the top of any save/upload/delete handler — if it
 * returns `false`, abort the operation; the toast is automatically shown.
 */
export function useReadOnlyGuard() {
  const isImpersonating = useAuthStore((s) => s.isImpersonating());
  const readOnly = useAuthStore((s) => s.impersonationReadOnly);

  return useCallback(
    (message: string = 'Modo impersonation — sem permissão para alterar dados deste utilizador.') => {
      if (isImpersonating && readOnly) {
        emitReadOnlyToast(message);
        return false;
      }
      return true;
    },
    [isImpersonating, readOnly]
  );
}

/** Boolean variant for conditional rendering of disabled buttons / banners. */
export function useIsReadOnly(): boolean {
  const isImpersonating = useAuthStore((s) => s.isImpersonating());
  const readOnly = useAuthStore((s) => s.impersonationReadOnly);
  return isImpersonating && readOnly;
}
