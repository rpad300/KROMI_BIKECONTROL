#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// RLS smoke test — verifies the lockdown is still intact
//                  AND that the intentionally-public tables
//                  stay reachable to anon.
// ═══════════════════════════════════════════════════════════
//
// Two assertions, both enforced, both fail CI on drift:
//
// 1. LOCKDOWN_TABLES — hit PostgREST as anon (no Authorization,
//    just the anon apikey). Each table must return either:
//      (a) an empty array [] — RLS policy filtered everything out
//      (b) a 401/403 error — the endpoint is fully closed
//    If any table returns rows as anon, the script exits non-zero.
//
// 2. PUBLIC_READ_TABLES — same anon request, but this time we
//    require HTTP 200 AND Array.isArray(body). These tables are
//    *intentionally* public-readable (shop directory, price lists,
//    reviews). If they ever get locked down by accident, we catch
//    the regression before logged-out browse breaks.
//
// Why both directions matter:
//   - Before S20 this script had `shops`, `shop_hours`, and
//     `shop_services` in LOCKDOWN_TABLES by mistake. It passed
//     only because the tables were empty — the first real shop
//     insert would have broken CI. Goal 2 of S20 caught this.
//   - Asymmetric treatment ("we only check one direction") lets
//     drift accumulate. Every RLS change should be a deliberate
//     act: update the migration AND the relevant array in the
//     same commit.
//
// Run locally with:
//
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   node tests/rls-smoke.mjs
//
// This is the test that would have caught the shop_members
// recursion bug and the ride_summaries permissive gap in S18.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;

if (!SB_URL || !SB_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_ANON_KEY env vars required');
  process.exit(1);
}

// Every table we expect to be locked down as of Session 20.
// If you add a new user-data table, add it here too.
const LOCKDOWN_TABLES = [
  'kromi_files',
  'ride_sessions',
  'ride_snapshots',
  'ride_summaries',
  'ride_override_events',
  'service_requests',
  'service_items',
  'service_comments',
  'service_photos',
  'bike_configs',
  'bike_fits',
  'bike_fit_changes',
  'bike_qr_codes',
  'athlete_profiles',
  'emergency_profiles',
  'user_settings',
  'user_sessions',
  'device_tokens',
  'otp_codes',
  'rescue_requests',
  'rescue_responses',
  'rider_presence',
  'maintenance_schedules',
  'club_members',
  'club_rides',
  'club_ride_participants',
  'clubs',
  // Shop sub-tables that hold private shop operational data.
  // `shops`, `shop_hours`, `shop_services`, `shop_reviews`, and
  // `shop_services_templates` are PUBLIC_READ_TABLES — see below.
  'shop_members',
  'shop_calendar',
  'shop_calendar_shares',
  'routes',
  'admin_audit_log',
  'account_deletion_log',
  'impersonation_log',
  // Added 2026-04-08 after a full policy audit caught 4 more leaks
  // (app_users, user_suspensions, user_roles, user_feature_flags).
  'app_users',
  'user_suspensions',
  'user_roles',
  'user_feature_flags',
];

// Tables that are intentionally public-readable (SELECT policy
// `qual = true`). Before S20 these were wrongly in LOCKDOWN_TABLES
// and the test only passed because the tables were empty — the
// first real shop insert would have broken CI.
//
// For each entry, anon must get HTTP 200 + an array body. If a
// future migration locks one of these down, logged-out browse
// (ShopSearchPage, ShopPublicProfilePage) breaks silently. Catch
// it here instead.
//
// NOTE: `bike_components` is also public-read by design (shared
// brand/model catalog) but is not actively exercised by the smoke
// test — leaving it out to avoid coupling this script to catalog
// migrations.
const PUBLIC_READ_TABLES = [
  'shops',                   // public shop directory
  'shop_hours',              // opening hours on shop profile
  'shop_services',           // price list on shop profile
  'shop_reviews',            // reviews feed on shop profile
  'shop_services_templates', // global service catalog (seeding)
];

const failures = [];

async function anonFetch(table) {
  const url = `${SB_URL}/rest/v1/${table}?select=*&limit=3`;
  return fetch(url, {
    headers: {
      apikey: SB_KEY,
      // NO Authorization header — we're testing the anon path.
    },
  });
}

console.log('── LOCKDOWN check ─────────────────────────────');
for (const table of LOCKDOWN_TABLES) {
  try {
    const res = await anonFetch(table);

    // 401/403 is a valid "locked down" response.
    if (res.status === 401 || res.status === 403) {
      console.log(`✓ ${table.padEnd(30)} → ${res.status} (fully closed)`);
      continue;
    }

    if (!res.ok) {
      // A 42P17 recursion or similar would surface here — mark as failure.
      const text = await res.text();
      failures.push({ table, reason: `HTTP ${res.status}: ${text.slice(0, 200)}` });
      console.log(`✗ ${table.padEnd(30)} → HTTP ${res.status} ${text.slice(0, 80)}`);
      continue;
    }

    const body = await res.json();
    if (!Array.isArray(body)) {
      failures.push({ table, reason: `expected array, got ${typeof body}` });
      console.log(`✗ ${table.padEnd(30)} → unexpected response shape`);
      continue;
    }

    if (body.length > 0) {
      failures.push({ table, reason: `anon saw ${body.length} rows` });
      console.log(`✗ ${table.padEnd(30)} → LEAK: anon saw ${body.length} rows`);
    } else {
      console.log(`✓ ${table.padEnd(30)} → [] (RLS filtered)`);
    }
  } catch (err) {
    failures.push({ table, reason: err.message });
    console.log(`✗ ${table.padEnd(30)} → ${err.message}`);
  }
}

console.log('');
console.log('── PUBLIC_READ check ──────────────────────────');
for (const table of PUBLIC_READ_TABLES) {
  try {
    const res = await anonFetch(table);

    if (!res.ok) {
      const text = await res.text();
      failures.push({
        table,
        reason: `public-read expected, got HTTP ${res.status}: ${text.slice(0, 200)}`,
      });
      console.log(`✗ ${table.padEnd(30)} → LOCKED: HTTP ${res.status} ${text.slice(0, 60)}`);
      continue;
    }

    const body = await res.json();
    if (!Array.isArray(body)) {
      failures.push({
        table,
        reason: `public-read expected array body, got ${typeof body}`,
      });
      console.log(`✗ ${table.padEnd(30)} → unexpected response shape`);
      continue;
    }

    console.log(`✓ ${table.padEnd(30)} → 200 + array (${body.length} rows)`);
  } catch (err) {
    failures.push({ table, reason: err.message });
    console.log(`✗ ${table.padEnd(30)} → ${err.message}`);
  }
}

const totalChecks = LOCKDOWN_TABLES.length + PUBLIC_READ_TABLES.length;

console.log('');
if (failures.length > 0) {
  console.error(`❌ ${failures.length} / ${totalChecks} RLS checks FAILED:`);
  for (const f of failures) {
    console.error(`   - ${f.table}: ${f.reason}`);
  }
  process.exit(1);
}

console.log(
  `✅ All ${totalChecks} checks passed ` +
    `(${LOCKDOWN_TABLES.length} locked, ${PUBLIC_READ_TABLES.length} public-read).`,
);
process.exit(0);
