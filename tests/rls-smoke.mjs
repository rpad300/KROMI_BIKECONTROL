#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// RLS smoke test — verifies the lockdown is still intact.
// ═══════════════════════════════════════════════════════════
//
// For each table in LOCKDOWN_TABLES, hit PostgREST as the anon
// role (no Authorization header, just the anon apikey) and
// assert that the response is either:
//   (a) an empty array [] — the RLS policy filtered everything out
//   (b) a 401/403 error — the endpoint is fully closed
//
// If any table returns rows as anon, the script exits non-zero
// and the CI job fails. Run locally with:
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

// Every table we expect to be locked down as of Session 19.
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
  // NOTE: bike_components is a shared catalog (brand + model + specs) —
  // intentionally readable by anyone. Not a user-owned table. Do NOT add.
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
  'shops',
  'shop_members',
  'shop_calendar',
  'shop_calendar_shares',
  'shop_hours',
  'shop_services',
  'routes',
  'admin_audit_log',
  'account_deletion_log',
  'impersonation_log',
];

const failures = [];

for (const table of LOCKDOWN_TABLES) {
  const url = `${SB_URL}/rest/v1/${table}?select=*&limit=3`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SB_KEY,
        // NO Authorization header — we're testing the anon path.
      },
    });

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
if (failures.length > 0) {
  console.error(`❌ ${failures.length} / ${LOCKDOWN_TABLES.length} RLS checks FAILED:`);
  for (const f of failures) {
    console.error(`   - ${f.table}: ${f.reason}`);
  }
  process.exit(1);
}

console.log(`✅ All ${LOCKDOWN_TABLES.length} lockdown tables return 0 rows or 4xx to anon.`);
process.exit(0);
