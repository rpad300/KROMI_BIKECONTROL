# KROMI Impersonation

> **Status:** Production (Session 18, 2026-04-07)
> **Frontend:** `src/store/authStore.ts`, `src/components/Admin/AdminUserDetail.tsx`, `src/components/shared/ImpersonationBanner.tsx`
> **Backend:** `impersonation_log` table, `notify-impersonation` edge function

---

## The problem

A super admin needs to see the KROMI app exactly as another user sees it — same dashboard, same bikes, same rides, same broken setting — to triage support tickets. But:

1. The admin must NOT lose their own session in the process. If "Sair" logs them out fully, every reproduction trip costs an OTP round-trip.
2. The admin's own data (especially the Super Admin panel) must NOT bleed into the impersonated view, otherwise the panel itself shows the target's RBAC and gets confusing fast.
3. Conversely, the target's data must NOT leak back into the admin's tab — persisted Zustand stores live in `localStorage`, which is shared per-origin.
4. There must be an audit trail that survives the admin closing the browser before "ending" the session.

---

## The solution — new tab + URL params + sessionStorage swap

Impersonation opens in a **new browser tab** scoped to the target via `?as=<uuid>&log=<log_id>` query params. The admin's original tab is untouched. Closing the impersonation tab is the canonical way to exit.

```
admin tab (localStorage)              impersonation tab (sessionStorage for user data)
─────────────────────────             ───────────────────────────────────────────────
useAuthStore.user = admin             useAuthStore.user = target
useIsSuperAdmin() === true            useIsSuperAdmin() === false (panel hidden)
settingsStore → localStorage          settingsStore → sessionStorage (clean exit on close)
LocalRideStore sync → ON              LocalRideStore sync → OFF (would 403 on RLS)
```

---

## Flow

1. **Trigger.** Super admin opens `AdminUserDetail` for the target, clicks "Entrar como", optionally types a reason.
2. **Audit + notify.** `authStore.beginImpersonation(target, reason)` immediately:
   - inserts a row into `impersonation_log` (`logImpersonationStart` in `RBACService.ts`) and grabs the row id;
   - fires `notify-impersonation` edge function with admin + target emails (fail-soft: the edge function failure does NOT block the flow).
3. **New tab.** Builds a URL of the form `${origin}${pathname}?as=<target_id>&log=<log_id>&reason=<text>` and calls `window.open(url, '_blank')`. The admin's tab is **not mutated** at all.
4. **Bootstrap.** In the new tab, App startup runs `authStore.applyImpersonationFromUrl()` after the device auto-login completes. It:
   - validates the real user is a super admin (otherwise scrubs the URL and ignores);
   - fetches the target via `getUserById(targetId)`;
   - sets `impersonatedUser = target`, `user = target`, `impersonationLogId = log`;
   - calls `window.history.replaceState({}, '', pathname)` so a refresh doesn't re-trigger the apply step.
5. **Settings reload.** `settingsStore` detects `?as=` at module init and swaps its persist storage to `sessionStorage`, then on viewer change reloads the target user's row from `user_settings`.
6. **UI gating.** `useIsSuperAdmin()` returns false inside the impersonation tab (it reads the viewer, which is now the target). The Super Admin panel is therefore hidden. The persistent orange `ImpersonationBanner` is shown at the App root.
7. **Exit.** "Sair" calls `endImpersonation()`, which:
   - patches `impersonation_log.ended_at`;
   - if `isImpersonationTab()` returns true, calls `window.close()` and stops;
   - otherwise (legacy same-tab path) restores `user = realUser`.
8. **Hard exit.** Just closing the tab is equivalent to "Sair" minus the `ended_at` patch — the audit row stays open until a future session reaper or the next impersonation. Acceptable: the row's `started_at` is what matters for compliance.

---

## Tab isolation rules for future code

If you add a NEW persisted Zustand store that holds user-specific data, you MUST detect the impersonation tab and swap its persist target to `sessionStorage`. Otherwise the target's data will overwrite the admin's `localStorage` (or vice versa) and corrupt one of the two views.

```ts
import { persist, createJSONStorage } from 'zustand/middleware';

const IS_IMPERSONATION_TAB =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('as');

export const useMyStore = create<State>()(
  persist(
    (set) => ({ /* ... */ }),
    {
      name: 'my-store',
      ...(IS_IMPERSONATION_TAB
        ? { storage: createJSONStorage(() => sessionStorage) }
        : {}),
    },
  ),
);
```

**Pitfall:** do NOT write `storage: cond ? x : undefined`. Zustand treats explicit `undefined` as "broken storage" and silently disables persistence — the store will lose its state on every reload even outside impersonation. Always **spread** the option in conditionally, as shown above.

`LocalRideStore` follows a stricter rule: its background sync loop is **disabled entirely** in impersonation tabs. Sessions in IndexedDB belong to the real admin, not the target — pushing them with the target's JWT would 403 against `ride_sessions` RLS. Reads still work because they filter on `currentViewerId()` (dynamic import of authStore).

---

## Known limitations

- **IndexedDB is per-origin, not per-tab.** `LocalRideStore` keeps a single store across both tabs and disambiguates reads via the active viewer id. There is no per-tab namespace. This is fine because rides are user-scoped and the read filter is enforced at every call site.
- **`impersonation_log.reason` has no index.** Full-text search over reasons is unsupported, but the audit volume is small (hundreds, not millions) and the panel filters by admin / target / date range, all of which use existing indexes.
- **Audit rows for tabs that close without "Sair" never get `ended_at` set.** Acceptable for GDPR / compliance: the start event is the load-bearing one. A future cron could close stale rows after, say, 24 h.
- **The notify email is fire-and-forget.** A failed SMTP run is logged but does NOT block the impersonation. The admin's audit row still exists.

---

## Audit trail

Every `beginImpersonation` call inserts into `impersonation_log` BEFORE the new tab is opened, so even if the tab fails to load or the user closes it instantly, the row exists. Schema:

```
impersonation_log
  id                    uuid pk
  admin_user_id         uuid → app_users(id)
  impersonated_user_id  uuid → app_users(id)
  started_at            timestamptz default now()
  ended_at              timestamptz null
  reason                text null
  user_agent            text null
```

A restrictive RLS policy added in Session 17 blocks ALL `DELETE` against this table (even for super admins). The only way to remove rows is via a direct service-role connection in SQL editor, which is intentional — the audit log is supposed to be append-only.

The admin panel surfaces this via `listImpersonationLog()` in `RBACService.ts` (filterable by admin, target, date range, active-only).
