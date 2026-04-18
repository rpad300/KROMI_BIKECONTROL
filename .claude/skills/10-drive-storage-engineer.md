# Skill 10 -- Google Drive Storage Engineer

## Role

You are a Google Drive storage specialist for the KROMI BikeControl project.
You understand the full file storage pipeline: frontend upload via KromiFileStore,
Supabase edge function relay, Google Drive API operations, and metadata tracking
in the `kromi_files` table.

## Architecture Overview

```
React Component
  |
  v
KromiFileStore.uploadFile()          <-- ONLY entry point for uploads
  |
  v
supaFetch (src/lib/supaFetch.ts)     <-- injects KROMI JWT
  |
  v
Supabase Edge Function: drive-storage
  |
  v
Google Drive API (OAuth refresh token)
  |
  v
Google Drive folder: KROMI PLATFORM
  (id: 1fjb2tKtZ14PaofV573ScoeZDra95ubua)
```

## Authentication

- Google Drive auth uses an OAuth refresh token stored in Supabase edge function
  secrets (acts as `rdias300@gmail.com`).
- The refresh token is NEVER exposed to the frontend.
- The edge function exchanges the refresh token for a short-lived access token
  on each request.
- Frontend auth uses the KROMI custom JWT, injected by `supaFetch`.

## Edge Function: drive-storage

Location: `supabase/functions/drive-storage/`

### Actions

| Action            | Method | Description                                    |
|-------------------|--------|------------------------------------------------|
| `ping`            | POST   | Health check, returns `{ ok: true }`           |
| `ensureFolderPath`| POST   | Creates folder hierarchy if not exists         |
| `upload`          | POST   | Uploads file to specified folder               |
| `delete`          | POST   | Deletes file by Drive file ID                  |
| `list`            | POST   | Lists files in a folder                        |
| `getFile`         | POST   | Returns file metadata + download/view links    |

### Request Format

```typescript
// All actions use POST with JSON body
{
  action: 'upload',
  folderPath: 'users/rdias300/bikes/giant-trance-x/photos',
  fileName: 'front-view.jpg',
  fileBase64: '...base64 data...',
  mimeType: 'image/jpeg'
}
```

## Metadata Table: kromi_files

```sql
CREATE TABLE kromi_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES app_users(id),
  entity_type   TEXT NOT NULL,   -- 'bike', 'service', 'bikefit', 'ride', 'route', 'profile', 'shop'
  entity_id     UUID,            -- FK to the parent entity
  category      TEXT NOT NULL,   -- 'bike_photo', 'component_photo', 'service_before', etc.
  file_name     TEXT NOT NULL,
  mime_type     TEXT,
  file_size     BIGINT,
  drive_file_id TEXT NOT NULL,   -- Google Drive file ID
  drive_view_link   TEXT,
  drive_thumbnail_link TEXT,
  drive_folder_path TEXT,
  caption       TEXT,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

RLS policies use `kromi_uid()` -- users can only see/manage their own files.
Super admins bypass via `is_super_admin_jwt()`.

## Folder Taxonomy

All folders live under the root `KROMI PLATFORM` folder in Google Drive.

```
KROMI PLATFORM/
  users/{user-slug}/                          -- {user-slug} = slugify(email)
    bikes/{bike-slug}/
      photos/                                 -- bike photos
      components/                             -- component photos
    bikes/{bike-slug}/services/{service-id}/
      before/                                 -- pre-service photos
      after/                                  -- post-service photos
      damage/                                 -- damage documentation
      receipts/                               -- invoices, receipts
    bikefits/{bike-slug}/{YYYY-MM-DD}/        -- bikefit session photos
    activities/{YYYY-MM}/{ride-id}/            -- ride data exports
    routes/                                   -- GPX/route files
    profile/                                  -- profile photos
    other/{YYYY-MM}/                          -- uncategorized

  shops/{shop-slug}/                          -- shared shop folders
```

### Slug Generation

```typescript
import { slugify, userFolderSlug } from '../services/storage/KromiFileStore';

slugify('Giant Trance X E+ 2')  // -> 'giant-trance-x-e-2'
userFolderSlug(user)            // -> 'users/rdias300-gmail-com'
```

## KromiFileStore API

Location: `src/services/storage/KromiFileStore.ts`

### uploadFile()

The ONLY way to upload files. Never bypass this.

```typescript
import { uploadFile, slugify, userFolderSlug } from '../services/storage/KromiFileStore';
import { useAuthStore } from '../store/authStore';

const user = useAuthStore.getState().user!;
const file: File = inputRef.current.files[0];

const kromiFile = await uploadFile(file, {
  ownerUserId: user.id,
  ownerUserSlug: userFolderSlug(user),   // MANDATORY for personal categories
  category: 'bike_photo',
  entityType: 'bike',
  entityId: bikeId,
  bikeSlug: slugify(bikeName),
  caption: 'Front view',
});

// Result contains:
// kromiFile.drive_view_link
// kromiFile.drive_thumbnail_link
// kromiFile.drive_file_id
// kromiFile.id (kromi_files row UUID)
```

### Parameters

| Param           | Required | Description                                    |
|-----------------|----------|------------------------------------------------|
| `ownerUserId`   | Yes      | app_users.id of the file owner                 |
| `ownerUserSlug` | Yes*     | userFolderSlug(user) -- required for personal  |
| `category`      | Yes      | File category (determines sub-folder)          |
| `entityType`    | Yes      | Parent entity type                             |
| `entityId`      | No       | Parent entity UUID                             |
| `bikeSlug`      | No       | Required for bike-related categories           |
| `serviceId`     | No       | Required for service-related categories        |
| `caption`       | No       | Human-readable description                     |

*ownerUserSlug is mandatory for ALL personal categories (everything except
`shop_*` categories). Without it, files get dumped at root level.

### Category to Folder Mapping

The `resolveFolderPath()` function maps categories to Drive folders:

| Category            | Folder Path                                              |
|---------------------|----------------------------------------------------------|
| `bike_photo`        | `users/{slug}/bikes/{bike-slug}/photos/`                 |
| `component_photo`   | `users/{slug}/bikes/{bike-slug}/components/`             |
| `service_before`    | `users/{slug}/bikes/{bike-slug}/services/{id}/before/`   |
| `service_after`     | `users/{slug}/bikes/{bike-slug}/services/{id}/after/`    |
| `service_damage`    | `users/{slug}/bikes/{bike-slug}/services/{id}/damage/`   |
| `service_receipt`   | `users/{slug}/bikes/{bike-slug}/services/{id}/receipts/` |
| `bikefit_photo`     | `users/{slug}/bikefits/{bike-slug}/{date}/`              |
| `ride_export`       | `users/{slug}/activities/{YYYY-MM}/{ride-id}/`           |
| `route_file`        | `users/{slug}/routes/`                                   |
| `profile_photo`     | `users/{slug}/profile/`                                  |
| `shop_photo`        | `shops/{shop-slug}/`                                     |

## useDriveBootstrap Hook

Mounted in `App.tsx`. On first login, creates the user's top-level folder
structure in Google Drive:

```typescript
// Automatically creates:
// KROMI PLATFORM/users/{user-slug}/
// KROMI PLATFORM/users/{user-slug}/bikes/
// KROMI PLATFORM/users/{user-slug}/profile/
// etc.
```

This runs once per user, after JWT is available. Subsequent logins skip creation
if folders already exist.

## Hard Rules

1. **NEVER use Supabase Storage** -- all files go through Google Drive.
2. **NEVER call Drive API directly** from frontend -- always via edge function.
3. **ALWAYS use `uploadFile()`** from KromiFileStore -- never raw `supaFetch`
   to the drive-storage function.
4. **ALWAYS provide `ownerUserSlug`** for personal file categories.
5. **ALWAYS use `supaFetch`** for any REST call -- never raw `fetch`.
6. Sub-folders are created lazily by `ensureFolderPath` in the edge function.
7. The folder taxonomy is defined in ONE place: `resolveFolderPath()` in
   KromiFileStore. Never hardcode paths elsewhere.
8. File deletion removes both the Drive file AND the `kromi_files` row.

## Adding a New File Category

1. Add the category string to the `FileCategory` type in KromiFileStore.
2. Add the folder mapping in `resolveFolderPath()`.
3. Add RLS policy if needed (most inherit from existing user_id check).
4. Update this skill document.

## Troubleshooting

| Symptom                          | Cause                              | Fix                                |
|----------------------------------|------------------------------------|------------------------------------|
| File at Drive root               | Missing `ownerUserSlug`            | Pass `userFolderSlug(user)`        |
| 401 from edge function           | Expired/missing JWT                | Check `supaFetch` is used          |
| Folder not created               | `ensureFolderPath` not called      | Check `useDriveBootstrap`          |
| Duplicate files                  | No dedup check                     | Check `kromi_files` before upload  |
| Large file timeout               | >10MB file                         | Compress before upload             |

## Key Files

```
src/services/storage/KromiFileStore.ts       -- uploadFile, slugify, resolveFolderPath
src/services/storage/googleDrive/driveClient.ts -- HTTP client to edge function
supabase/functions/drive-storage/index.ts    -- Edge function (server-side)
src/hooks/useDriveBootstrap.ts               -- Auto-create user folders on login
src/lib/supaFetch.ts                         -- REST helper (injects JWT)
```
