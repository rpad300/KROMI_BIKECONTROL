# KROMI Drive Storage — Architecture & Conventions

> **Status:** Production (Session 16, 2026-04-06)
> **Backend:** Google Drive (`KROMI PLATFORM` folder)
> **Frontend abstraction:** `src/services/storage/KromiFileStore.ts`
> **Edge function:** `supabase/functions/drive-storage`
> **Metadata table:** `kromi_files` (Supabase)

---

## Goal

Move all KROMI files (photos, GPX, FIT, exports, receipts) out of Supabase Storage and into a single central Google Drive (`KROMI PLATFORM`). Supabase only holds metadata + access links. Result: zero Supabase Storage cost, ~32 TB available quota, single source of truth for the file taxonomy.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│                                                             │
│   Component (PhotoUploader, BikePhotoCard, etc.)            │
│        │                                                    │
│        ▼                                                    │
│   KromiFileStore.uploadFile()    ← single entry point       │
│        │                                                    │
│        │   1. resolveFolderPath(category, opts)             │
│        │      → ['users', userSlug, 'bikes', slug, 'photos']│
│        │                                                    │
│        ▼                                                    │
│   driveClient.uploadFileToDrive() (HTTP)                    │
│        │                                                    │
└────────┼────────────────────────────────────────────────────┘
         │ POST /functions/v1/drive-storage?action=upload
         │ headers: x-kromi-session, x-kromi-meta
         │ body: raw file bytes
         ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase Edge Function (Deno)                               │
│                                                             │
│   1. authenticate(req)                                      │
│      ├── device:{id} → device_tokens lookup                 │
│      └── otherwise   → SHA-256 → user_sessions.token_hash   │
│                                                             │
│   2. getAccessToken()                                       │
│      ├── cached? return                                     │
│      └── POST oauth2.googleapis.com/token                   │
│            grant_type=refresh_token                         │
│            (refresh token in Edge Function secrets)         │
│                                                             │
│   3. ensureFolderPath(['users','rdias300-gmail-com',        │
│                        'bikes','giant-trance','photos'])    │
│      ├── For each segment: findFolderByName or create       │
│      └── Returns final folder ID                            │
│                                                             │
│   4. uploadFile(token, bytes, {name, mimeType, parentId})   │
│      → multipart upload to Drive API v3                     │
│      → returns {id, name, webViewLink, thumbnailLink, ...}  │
│                                                             │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
   Google Drive (acts as rdias300@gmail.com)
   KROMI PLATFORM/users/rdias300-gmail-com/bikes/giant-trance/photos/IMG_1234.jpg
         │
         │ Response: {file: {id, webViewLink, ...}, folder_id, folder_path}
         ▼
┌─────────────────────────────────────────────────────────────┐
│ Browser (back in KromiFileStore.uploadFile)                 │
│                                                             │
│   2. INSERT INTO kromi_files (REST)                         │
│      drive_file_id, drive_view_link, drive_thumbnail_link,  │
│      drive_folder_path, owner_user_id, category,            │
│      entity_type, entity_id, ...                            │
│                                                             │
│   Returns: KromiFile row                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Folder Taxonomy

```
KROMI PLATFORM/                              ← root (id: 1fjb2tKtZ14PaofV573ScoeZDra95ubua)
├── users/                                   ← per-user (auto-bootstrapped on login)
│   └── {user-slug}/                         ← user-slug = slugify(email)
│       ├── bikes/
│       │   └── {bike-slug}/
│       │       ├── photos/                  ← bike profile/showcase photos
│       │       ├── components/              ← part-specific photos
│       │       └── services/
│       │           └── {service-id}/
│       │               ├── before/
│       │               ├── after/
│       │               ├── damage/
│       │               └── receipts/
│       ├── bikefits/
│       │   └── {bike-slug}/
│       │       └── {YYYY-MM-DD}/            ← per-fit-session photos/measurements
│       ├── activities/                      ← rides
│       │   └── {YYYY-MM}/
│       │       └── {ride-id}/               ← FIT, GPX, JSON exports, photos
│       ├── routes/                          ← imported GPX files
│       ├── profile/                         ← athlete photo, FTP test exports
│       └── other/                           ← uncategorised
│           └── {YYYY-MM}/
└── shops/                                   ← shared (multiple users access one shop)
    └── {shop-slug}/                         ← shop logos, photos, docs
```

### Why per-user nesting?
In a central-Drive model, two users can have bikes with identical slugs (e.g. both have "Giant Trance"). Without the `users/{slug}/` prefix they would collide on the same Drive path. The user prefix gives **collision-free namespacing** and makes admin Drive browsing scannable ("show me everything by user X").

### Why shops at top-level?
Shops are explicitly **shared resources**. A single shop can have many users (mechanics, owners, members) and a single user can be member of many shops. Nesting them under a single user would imply ownership where there is none.

---

## Database Schema

### `kromi_files` — central registry
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_user_id` | uuid → app_users | Filtering at app layer |
| `drive_file_id` | text NOT NULL | Google Drive file ID |
| `drive_view_link` | text | `https://drive.google.com/file/d/.../view` |
| `drive_download_link` | text | direct download |
| `drive_thumbnail_link` | text | image thumbnail (Drive auto-generates) |
| `drive_folder_id` | text | parent folder Drive ID |
| `drive_folder_path` | text | human-readable, e.g. `users/rdias.../bikes/.../photos` |
| `file_name` | text | |
| `mime_type` | text | |
| `size_bytes` | bigint | |
| `category` | text | bike_photo / service_photo / bikefit_photo / ride_export / route / shop_logo / shop_photo / profile / receipt / bike_component / other |
| `subcategory` | text | e.g. before / after / damage for service photos |
| `entity_type` | text | bike / bike_fit / service_request / service_item / shop / ride / route / user |
| `entity_id` | uuid | polymorphic FK |
| `caption` | text | |
| `metadata` | jsonb | free-form |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** owner, (entity_type, entity_id), category, drive_file_id

**RLS:** Open at DB level (custom OTP auth bypasses Supabase Auth RLS). Filtering happens at app layer.

### Linking columns added to existing tables
| Table | Column | Purpose |
|---|---|---|
| `app_users` | `drive_root_folder_id`, `drive_email`, `drive_connected_at` | per-user state (currently unused, reserved for future per-user OAuth) |
| `bike_configs` | `drive_folder_id` | cache `users/.../bikes/{slug}/` folder ID |
| `bike_fits` | `drive_folder_id` | cache `users/.../bikefits/{slug}/` folder ID |
| `shops` | `drive_folder_id` | cache `shops/{slug}/` folder ID |
| `service_requests` | `drive_folder_id` | cache service folder |
| `service_photos` | `file_id` (FK → kromi_files) | new column; `storage_path` retained for legacy backward compat |

---

## Authentication: OAuth refresh token (NOT service account)

### Why NOT service account
Google Drive Service Accounts have **no storage quota** in personal Drive. They can create folders inside a shared folder, but uploads return:
```
"Service Accounts do not have storage quota.
Leverage shared drives, or use OAuth delegation instead."
```

Shared drives require Google Workspace ($6/user/month). For KROMI we use OAuth instead.

### How OAuth refresh token works
1. One-time setup via OAuth Playground:
   - Use your own OAuth client_id + secret (the same one used for browser OAuth)
   - Authorize scope `https://www.googleapis.com/auth/drive`
   - Exchange auth code for tokens, copy the **refresh_token** (long-lived, doesn't expire)
2. Store refresh token in **Supabase Edge Function secrets** (NEVER in browser, NEVER in repo)
3. Edge function exchanges refresh_token → access_token (cached ~1h in module-level variable while container is warm)
4. All Drive API calls authenticated with access_token, acting as the original user (`rdias300@gmail.com`)
5. Files are owned by `rdias300@gmail.com` and use that account's quota (~32 TB available)

### Required Edge Function secrets
| Secret | Source |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth Client (web application) in GCP Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same client (rotate after exposure) |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Generated via OAuth Playground (one-time) |
| `KROMI_DRIVE_ROOT_FOLDER_ID` | `1fjb2tKtZ14PaofV573ScoeZDra95ubua` (KROMI PLATFORM folder) |

---

## The Rule: ALL uploads via KromiFileStore

> ⚠️ Every feature in KROMI that handles files **must** call `KromiFileStore.uploadFile()`.
> Never call Supabase Storage REST or Drive API directly.

### Why
- Single source of truth for the folder taxonomy (`resolveFolderPath`)
- Single registry (`kromi_files` table) — joins, queries, deletes all consistent
- Cost savings (Supabase Storage replaced)
- Credential safety (refresh token never reaches browser)
- Easy backend swap (swap Drive → R2/S3, only `driveClient.ts` changes)

### How to upload
```typescript
import { uploadFile, slugify, userFolderSlug } from '../services/storage/KromiFileStore';
import { useAuthStore } from '../store/authStore';

const user = useAuthStore.getState().user!;

const kromiFile = await uploadFile(file, {
  ownerUserId: user.id,
  ownerUserSlug: userFolderSlug(user),  // ← MANDATORY for personal categories
  category: 'bike_photo',
  entityType: 'bike',
  entityId: bikeId,
  bikeSlug: slugify(bikeName),
  caption: 'Front view',
});

// kromiFile.drive_view_link / .drive_thumbnail_link
```

### How to display
```typescript
import { fileImageUrl } from '../services/storage/KromiFileStore';

<img src={fileImageUrl(kromiFile, 'thumbnail')} />
```

---

## User Folder Bootstrap

### Automatic on login (recommended)
The `useDriveBootstrap` hook in `App.tsx` runs once per session per user, after successful login. It calls `bootstrapUserFolders(slugify(user.email))` which creates:

```
users/{slug}/bikes/
users/{slug}/bikefits/
users/{slug}/activities/
users/{slug}/routes/
users/{slug}/profile/
users/{slug}/other/
```

The hook is **idempotent** (existing folders are reused, not duplicated) and **fire-and-forget** (doesn't block UI on failure). Three layers of caching prevent repeated work:
1. `useRef` for in-render dedup
2. `sessionStorage` for cross-render persistence
3. Edge function `findFolderByName` for Drive-side dedup

### Manual (admin)
Settings → Google Drive → "Inicializar estrutura" — calls `bootstrapFolderStructure()` which creates the top-level `users/` and `shops/` folders. Useful for the very first deploy.

---

## Edge Function Actions

| Action | Method | Auth | Body | Response |
|---|---|---|---|---|
| `ping` | POST | none | none | `{ok, folder, acting_as, storage}` |
| `ensureFolderPath` | POST | session | `{path: string[]}` | `{folder_id}` |
| `upload` | POST | session | raw file bytes + `x-kromi-meta: {name, mimeType, path}` header | `{file, folder_id, folder_path}` |
| `delete` | POST | session | `{file_id}` | `{ok}` (soft delete to trash) |
| `list` | POST | session | `{folder_id}` | `{files: DriveFile[]}` |
| `getFile` | POST | session | `{file_id}` | `{file: DriveFile}` |

---

## Health Check

### From the app
Settings → Google Drive page shows live status, acting-as user, quota, last-checked timestamp.

### From CLI
```bash
curl -X POST "https://ctsuupvmmyjlrtjnxagv.supabase.co/functions/v1/drive-storage?action=ping" \
  -H "apikey: <anon>" \
  -H "Authorization: Bearer <anon>"
```

Expected response:
```json
{
  "ok": true,
  "folder": {"id": "1fjb2t...", "name": "KROMI PLATFORM"},
  "acting_as": {"displayName": "Rui Dias", "emailAddress": "rdias300@gmail.com"},
  "storage": {"limit": "32985348833280", "usage": "1363788285062"}
}
```

---

## Migration from legacy Supabase Storage

`service_photos.storage_path` is retained as nullable for backwards compatibility. New uploads use `service_photos.file_id` → `kromi_files`.

`PhotoGrid` component handles **both** legacy (storage_path → public Supabase URL) and new (file_id → joined kromi_files row → drive_thumbnail_link). No data loss during transition.

A one-time migration script (download from Supabase Storage → re-upload via KromiFileStore → set file_id) can be written later. For now, legacy photos continue to display.

---

## Folder ID Cache (planned, not yet implemented)

`bike_configs.drive_folder_id` and similar columns exist but are unused. Future optimization: cache the folder ID after first upload so subsequent uploads skip `ensureFolderPath` (saves 2-5 Drive API calls). Not critical now because folder lookups are fast.

---

## Pending Refactor

Components still using direct uploads (or no uploads but should use `KromiFileStore`):
- [ ] `BikesPage.tsx` — bike profile photos
- [ ] `ShopManagementPage.tsx` — shop logos / photos
- [ ] `BikeFitPage.tsx` — bikefit photos
- [ ] `RideHistory` / `FitImport` — GPX/FIT exports
- [ ] `Connections.tsx` — scanner screenshots (if any)

Order of refactor: BikesPage → BikeFitPage → ShopManagement → ride exports.

---

## Security Notes

1. **OAuth client_secret was exposed** during this session's chat. Should be rotated:
   - GCP Console → Credentials → OAuth Client → "Reset Secret"
   - Update `GOOGLE_OAUTH_CLIENT_SECRET` in Supabase Edge Function secrets
2. **kromi-drive-sa.json** still exists on disk (gitignored). Can be deleted — service account model abandoned.
3. **Refresh token** is in Supabase secrets only. If compromised, revoke via Google Account → Security → Third-party access.
4. **`.gitignore`** patterns added to block: `client_secret_*.json`, `*-sa.json`, `service-account*.json`, etc.
