# KROMI BikeControl — Session 20: Oficina (Workshop) Track

> **Focus:** dedicated session on the shop / service-book / oficina feature
> **Hardware needed:** No
> **Out of scope:** 2FA, BLE/hardware, large refactors
> **Estimated effort:** 4-6 hours of focused work

---

## Context — current state of the oficina feature

Surprise: **the feature is mostly built but never used.** All the database tables exist, the React pages exist, the services exist — but there are zero shops, zero service requests, zero photos in production. Nothing has been exercised end-to-end with real data.

That's the most important thing to know. The session shouldn't start with "build feature X" — it should start with "create a shop, walk a service request through the full lifecycle, find what breaks."

### What's already built (verified 2026-04-08)

**Database (Supabase)**
- `shops` — name, city, address, phone, email, lat/lng, hourly_rate, rating_avg, review_count, drive_folder_id
- `shop_members` — staff with roles (`owner`, `mechanic`, etc.)
- `shop_calendar` — booking slots (start_time, end_time, status, bike_name, rider_name, duration_min)
- `shop_calendar_shares` — calendar sharing tokens
- `shop_hours` — opening hours per day_of_week
- `shop_services` — per-shop price list (category, name, price_default)
- `shop_services_templates` — global template catalog (seeded by `seedShopDefaults`)
- `shop_reviews` — public reviews (rating, comment)
- `service_requests` — service jobs (status: `draft|requested|accepted|in_progress|pending_approval|completed|closed`, urgency, preferred_date)
- `service_items` — line items (part / labor / consumable + cost)
- `service_comments` — comments thread
- `service_photos` — photo references (links to `kromi_files` via `file_id`)

**Frontend pages already built**
| File | LOC | What it does |
|---|---|---|
| `src/components/Shop/ShopManagementPage.tsx` | 616 | Shop owner panel: 6 tabs (Dashboard, Services, Calendar, Staff, Profile, Share). Includes shop creation flow. |
| `src/components/ServiceBook/ServiceBookPage.tsx` | 214 | Customer-side: list services per bike, navigate to detail / new / shop search / maintenance / QR |
| `src/components/ServiceBook/NewServicePage.tsx` | 258 | Create a service request: title, description, type, urgency, shop selection, suggested dates, line items |
| `src/components/ServiceBook/ServiceDetailPage.tsx` | 418 | Full service detail: items, comments, status changes |
| `src/components/ServiceBook/ShopSearchPage.tsx` | 120 | List + search shops, sort by GPS distance, expand to see services |
| `src/components/ServiceBook/MaintenancePage.tsx` | 145 | Maintenance schedule per bike |

**Backend services**
- `src/services/maintenance/MaintenanceService.ts` (267 lines) — CRUD for shops, members, services
- `src/services/maintenance/ShopService.ts` (204 lines) — `seedShopDefaults`, `getShopServices`, `getCalendarSlots`, `getShopAvailability`, `suggestAvailableDates`, `createCalendarShare`, etc.
- `src/services/maintenance/ServiceNotificationService.ts` (132 lines) — notification helpers
- `src/store/serviceStore.ts` (69 lines) — shop + services state

### Current data in production
```
shops              0
shop_members       0
shop_calendar      0
shop_services      0
shop_reviews       0
service_requests   0
service_items      0
service_comments   0
service_photos     0
```
**Zero rows in every shop/service table.** Nothing has been tested end-to-end with real data yet.

### Permission gating
- `features.shop_management` — required to see the shop owner panel
- The `mechanic` role grants this by default per RBAC setup
- Check `src/config/navigation.ts` for the menu entry visibility

---

## Goals for this session

### 🎯 Goal 1 (HIGHEST PRIORITY) — End-to-end smoke test with a real shop

Don't write a single new component until you've walked the existing flow end-to-end and identified what breaks. The pattern in S18/S19 was: **find latent bugs first, then build features**.

**The walkthrough:**

1. **Login as `rdias300@gmail.com` (super admin)** in the deployed PWA
2. **Create a shop** via Settings → Gestão de Oficina (or wherever the link is)
   - Name: "KROMI Lab Demo"
   - City: "Lisboa"
   - Phone: "+351 911 111 111"
3. **Verify `seedShopDefaults` ran** — go to Services tab, you should see ~30 default services across 10 categories
4. **Add a staff member** — invite a second user (or impersonate amandio) as `mechanic`
5. **Set shop_hours** — add Mon-Fri 09:00-18:00
6. **Create a calendar slot** for tomorrow 10:00-11:00
7. **Switch to a different user (amandio)** via impersonation
8. **Create a service request** as that user via `ServiceBook → Encontrar Oficina → KROMI Lab Demo → Solicitar`
   - Title: "Revisão geral antes de Verão"
   - Pick 2-3 line items from the price list
   - Pick a preferred date from the suggested dates
9. **Switch back to admin/owner** of the shop
10. **Accept the request** → set status `accepted`
11. **Add a comment** "Trazer a bike segunda às 10h"
12. **Upload a photo** via the service detail page (tests the `service_photos` + `kromi_files` integration)
13. **Mark in_progress** then `pending_approval` then `completed`
14. **As the customer**, leave a 5-star review on the shop
15. **Verify the rating shows up** in Shop Search

**Expected discovery:** at least 3-5 bugs in the flow. Common categories:
- RLS leaks or 403s on tables touched but not in S19's lockdown audit (`shop_calendar`, `shop_hours`, `shop_reviews` — were any of these in `LOCKDOWN_TABLES`? No — add them)
- Photo upload not actually working (`service_photos.file_id` linking to `kromi_files` may have a broken FK or wrong category)
- Rating aggregation not running (`shops.rating_avg` is computed how? trigger? on read? probably not at all)
- Suggested dates query returning weirdness when there are no `shop_hours`
- Status transitions not enforced (can a customer set `completed` themselves?)
- Calendar slot conflicts not validated
- Notification system never wired (`ServiceNotificationService` exists but probably not called anywhere)

**Acceptance:** the full lifecycle runs without manual SQL fixes, every status transition emits the right side effects, and at least one bug is fixed per "phase" of the walkthrough.

### 🎯 Goal 2 — Add shop tables to the RLS smoke test

The S19 audit covered most user-data tables but the shop sub-tables (`shop_calendar`, `shop_hours`, `shop_calendar_shares`, `shop_services`, `shop_reviews`, `shop_services_templates`) need verification. Some of them are intentionally public-read (`shops`, `shop_hours`, `shop_services`, `shop_reviews`, `shop_services_templates`) but others should be locked down (`shop_calendar`, `shop_calendar_shares`).

**Acceptance:**
- Run `npm run rls-smoke` against production with an extended LOCKDOWN_TABLES that includes the genuinely-locked shop tables
- Document explicitly in the file's comment which shop tables are public-by-design
- Catch any leaks with the same pattern used in S19 (drop permissive `*_all` policy, replace with proper `_sel`/`_ins`/`_upd`/`_del` set)

### 🎯 Goal 3 — Photo upload integration via KromiFileStore

This is the highest-value feature gap. Customers need to upload photos when they describe a problem ("look at this scratch on the frame") and mechanics need to upload before/after photos.

**What needs to happen:**
1. Verify `service_photos` schema — confirm `file_id` references `kromi_files.id`
2. In `ServiceDetailPage.tsx`, replace any `<input type="file">` placeholder with a `<PhotoUploader>` (the existing shared component) that calls `KromiFileStore.uploadFile()`
3. Use category `bike_service_photo`, entityType `service_request`, entityId `serviceId`
4. The owner_user_id should be the **service owner (rider_id)** so the file lives in their Drive folder, not the shop's
5. Display thumbnails in the service detail page using `drive_thumbnail_link`
6. Allow categorization: `before`, `after`, `damage`, `receipt` (already exists in folder taxonomy per CLAUDE.md)

**Acceptance:**
- Create a service request, upload 2 photos, see them in the detail page
- Verify a row exists in `kromi_files` and `service_photos` with matching `file_id`
- Verify the file is in `users/<rider-slug>/bikes/<bike-slug>/services/<service-id>/before/` in Drive (or wherever `KromiFileStore` puts it)

### 🎯 Goal 4 — Shop public profile page

Currently, customers find a shop via `ShopSearchPage` (a list with expand) but there's no dedicated public profile page. This matters for:
- Sharing a shop link to a friend ("hey, vai a esta oficina")
- SEO (when KROMI eventually has a public site)
- Reviews UI (no current way to read other reviews of a shop, only see the average rating)

**What needs to happen:**
1. New route: `/shop/:shopId` — `ShopPublicProfilePage.tsx`
2. Sections:
   - Header (logo, name, city, address, rating with star count, hourly rate)
   - Opening hours (`shop_hours` formatted Mon-Sun)
   - Services price list (`shop_services` grouped by category)
   - Recent reviews (last 10 from `shop_reviews`, with star + comment + author display name)
   - "Pedir orçamento" CTA → opens `NewServicePage` pre-filled with this shop
3. Public — no auth required to view (uses anon key, relies on RLS being public-read on those tables)
4. Image: shop logo from `kromi_files` (category `shop_logo`)

**Acceptance:**
- Open `/shop/<id>` in incognito → page loads with no errors
- All tabs of data render correctly
- "Pedir orçamento" button only shows if logged in (otherwise → login)

### 🎯 Goal 5 — Reviews flow (write + read + aggregate)

`shop_reviews` table exists, the rating shows on `ShopSearchPage`, but there's **no UI to write a review** anywhere I can find. Verify and build if missing.

**What needs to happen:**
1. After a service request reaches `completed`, the customer sees a "Avaliar oficina" button
2. Modal with: 1-5 star rating, free-text comment, optional "tags" (puntual/profissional/preço justo)
3. Server-side: a SECURITY DEFINER function `kromi_submit_shop_review(shop_id, service_id, rating, comment)` that:
   - Verifies the service is in `completed` status and belongs to the caller
   - Inserts into `shop_reviews`
   - Updates `shops.rating_avg` and `shops.review_count` atomically
4. Display all reviews in `ShopPublicProfilePage` (Goal 4)

**Acceptance:**
- Customer flow: complete a service → leave a review → see it on the shop's public profile + see the average rating update on `ShopSearchPage`
- Trying to leave 2 reviews for the same service is blocked
- Trying to leave a review on a service you don't own is blocked

### 🎯 Goal 6 (stretch) — Shop owner notification feed

When a customer creates a service request, the shop owner should know without having to refresh the page constantly.

**Minimum viable:**
1. Add a "Notificações" badge on the shop owner's nav menu showing pending count (`service_requests` where `shop_id = mine` and `status = 'requested'`)
2. Polling every 30s while the panel is open is fine for v1
3. (Stretch) Push via Resend email when a new request comes in — reuse the `notify-impersonation` pattern

### 🎯 Goal 7 (stretch) — Mechanic assignment

When there are 2+ staff members, the owner should be able to assign a service request to a specific mechanic. Currently the model has `service_requests.shop_id` but no `assigned_to` column.

**What needs to happen:**
1. ALTER TABLE: add `assigned_to_user_id uuid REFERENCES app_users(id)`
2. UI in service detail: dropdown to assign / re-assign
3. The mechanic's dashboard filters to `assigned_to = me` by default

---

## Anti-goals for this session

❌ **Don't refactor `ShopManagementPage.tsx`** — 616 lines is fine, it works, leave it. Inline styles too — no Tailwind migration this session.

❌ **Don't build a multi-shop UX** — current model assumes 1 shop per user (via `shop_members`). Keeping it that way for v1.

❌ **Don't build invoicing / PDF export** — that's v2 work. Tracking line items + total cost is enough.

❌ **Don't build inventory / parts tracking** — v2.

❌ **Don't touch the BLE / hardware code** — explicit user veto.

❌ **Don't touch 2FA** — explicit user veto.

❌ **Don't try to make the public profile page SSR/static** — it's a SPA route, that's fine for now.

---

## How to start the session

1. Boot the dev server: `npm run dev` (HTTPS for Web Bluetooth, but you don't need it for shop testing)
2. Pull the deployed PWA on a phone or use the dev URL on desktop
3. Have two browser tabs: one as super admin, one impersonating `amandio.6@gmail.com`
4. Run **Goal 1** end-to-end — write down every bug in a scratch file as you find them
5. Fix bugs in priority order (RLS / data corruption first, UI glitches last)
6. Only after Goal 1 + 2 are green, start Goals 3-5 (the actual feature work)

## Useful smoke commands

```sql
-- Reset shop test data between attempts
DELETE FROM shop_reviews;
DELETE FROM service_photos;
DELETE FROM service_comments;
DELETE FROM service_items;
DELETE FROM service_requests;
DELETE FROM shop_calendar_shares;
DELETE FROM shop_calendar;
DELETE FROM shop_hours;
DELETE FROM shop_services;
DELETE FROM shop_members;
DELETE FROM shops;

-- Verify a shop was created
SELECT * FROM shops;
SELECT * FROM shop_services WHERE shop_id = (SELECT id FROM shops LIMIT 1);

-- Watch service requests live (in psql with \watch)
SELECT id, status, title, urgency, created_at FROM service_requests ORDER BY created_at DESC LIMIT 10;
```

```bash
# After every backend change
npm run type-check && npm run lint && npm run rls-smoke

# Before push
npm run db:drift
```

## Reminders that still apply

- **All REST through `supaFetch`** — no raw `fetch()` calls
- **All file uploads through `KromiFileStore.uploadFile()`** — never direct Drive API or Supabase Storage
- **New zustand stores must detect impersonation `?as=`** and swap to sessionStorage
- **Step-up confirmation** for any new destructive RPC (matching pattern in `admin_set_super_admin`)
- **RLS recursion** — if you write `EXISTS (SELECT FROM same_table)` in a policy, it WILL recurse. Use the `is_shop_member(uuid)` SECURITY DEFINER helper pattern that already exists.
- **Add new tables to `tests/rls-smoke.mjs`** if they hold user data
- Commits should reference what they fix; small focused commits beat big bundles

## Don't forget

When the session ends, **manually run the walkthrough one more time** in production to verify nothing regressed. The smoke test catches RLS but not UX issues like "the comment box doesn't clear after submitting".

## Reference reading before starting

- `docs/RUNBOOK.md` — operational reference
- `memory/feedback_rls_patterns.md` — 5 rules for safe RLS
- `memory/reference_kromi_files.md` — Drive file upload patterns
- Existing files: `src/components/Shop/`, `src/components/ServiceBook/`, `src/services/maintenance/`
