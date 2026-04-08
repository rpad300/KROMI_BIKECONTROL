#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Shop feature end-to-end smoke test (Session 20, Goal 1).
// ═══════════════════════════════════════════════════════════
//
// Walks the full oficina lifecycle against real Supabase using
// real user JWTs minted with KROMI_JWT_SECRET — the same secret
// the verify-otp / login-by-device edge functions use. No
// service role anywhere: every insert, read, update, and delete
// goes through RLS as an authenticated user. If a policy is
// wrong, the test fails; if a trigger is wrong, the test fails;
// if a status transition is unprotected, the test fails.
//
// Phases:
//   0. Preflight     — env + two test users resolved by email
//   1. Shop owner    — create shop, seed services, hours, slot
//   2. Customer      — ensure bike, create service request + items
//   3. Shop owner    — read back, walk status transitions, comment
//   4. Customer      — leave review, assert trigger recomputed rating
//   X. Security probes — things that SHOULD be blocked
//   Z. Cleanup       — reverse-order delete of every tracked row
//
// Run locally with:
//
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   KROMI_JWT_SECRET=<the same secret your edge fns use> \
//   node tests/shop-e2e.mjs
//
// Optional overrides (defaults are the production user IDs I
// looked up while writing this script):
//   E2E_ADMIN_USER_ID    — owner/admin (defaults to rdias300)
//   E2E_CUSTOMER_USER_ID — customer    (defaults to amandio.6)
//
// Exit code is 0 only if every assertion AND every cleanup
// succeeded. Partial failures still run cleanup.
// ═══════════════════════════════════════════════════════════

import { createHmac } from 'node:crypto';

// ── Config ────────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const JWT_SECRET = process.env.KROMI_JWT_SECRET;
const ADMIN_USER_ID =
  process.env.E2E_ADMIN_USER_ID || '622e1c56-72cb-47d3-be9d-cd9c5520fc4e'; // rdias300@gmail.com
const CUSTOMER_USER_ID =
  process.env.E2E_CUSTOMER_USER_ID || '325ffc51-a74d-41af-9248-fbd57aefed50'; // amandio.6@gmail.com
const CUSTOMER_ATHLETE_ID = '679bb631-b649-4f76-9e63-9a20bc824745';

const TAG = `E2E-SHOP-${new Date().toISOString().replace(/[:.]/g, '-')}`;

if (!SB_URL || !SB_ANON || !JWT_SECRET) {
  console.error(
    '❌ Missing env: SUPABASE_URL, SUPABASE_ANON_KEY, KROMI_JWT_SECRET are all required.',
  );
  process.exit(2);
}

// ── JWT signer (HS256, same claim shape as _shared/jwt.ts) ──
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(userId, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'kromi-bikecontrol',
    iat: now,
    exp: now + ttlSeconds,
  };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(
    createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest(),
  );
  return `${h}.${p}.${sig}`;
}

const ADMIN_JWT = signJwt(ADMIN_USER_ID);
const CUSTOMER_JWT = signJwt(CUSTOMER_USER_ID);

// ── REST helper ───────────────────────────────────────────
async function req(method, path, { jwt, body, prefer } = {}) {
  const url = `${SB_URL}/rest/v1${path}`;
  const headers = {
    apikey: SB_ANON,
    'Content-Type': 'application/json',
  };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

// ── Assertion + output ────────────────────────────────────
const failures = [];
let phase = 'init';

function setPhase(name) {
  phase = name;
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 50 - name.length))}`);
}

function ok(label) {
  console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
  failures.push({ phase, label, detail });
  console.log(`  ✗ ${label}`);
  if (detail) console.log(`      ${String(detail).slice(0, 280)}`);
}

function assert(label, cond, detail) {
  if (cond) ok(label);
  else fail(label, detail);
}

// ── Cleanup registry (reverse-FK order) ────────────────────
// Every row the test creates gets pushed here. On finally we
// walk the list in reverse and delete via whichever JWT has
// permission. If cleanup leaves orphans, the script reports
// them and exits non-zero so CI catches it.
const cleanup = {
  shop_reviews: [],
  service_photos: [],
  service_comments: [],
  service_items: [],
  service_requests: [],
  bike_configs: [],
  shop_calendar: [],
  shop_hours: [],
  shop_services: [],
  shop_members: [],
  shops: [],
};

// Helper: pick first row from PostgREST 201 Prefer: return=representation
function firstRow(res) {
  if (Array.isArray(res.body) && res.body.length > 0) return res.body[0];
  return null;
}

// ═══════════════════════════════════════════════════════════
// PHASE 0 — Preflight
// ═══════════════════════════════════════════════════════════
setPhase('Phase 0 — Preflight');

{
  // Verify both JWTs actually resolve to the intended users via PostgREST.
  // The cheapest check: hit /app_users?id=eq.<me>&select=id,email with our
  // own JWT. RLS should let you read your own row.
  const adminProbe = await req('GET', `/app_users?id=eq.${ADMIN_USER_ID}&select=id,email,is_super_admin`, { jwt: ADMIN_JWT });
  assert(
    'admin JWT resolves to admin user',
    adminProbe.ok && Array.isArray(adminProbe.body) && adminProbe.body[0]?.id === ADMIN_USER_ID,
    `status ${adminProbe.status}: ${JSON.stringify(adminProbe.body)?.slice(0, 200)}`,
  );
  assert(
    'admin is flagged is_super_admin',
    adminProbe.body?.[0]?.is_super_admin === true,
    `got ${JSON.stringify(adminProbe.body?.[0])}`,
  );

  const custProbe = await req('GET', `/app_users?id=eq.${CUSTOMER_USER_ID}&select=id,email`, { jwt: CUSTOMER_JWT });
  assert(
    'customer JWT resolves to customer user',
    custProbe.ok && Array.isArray(custProbe.body) && custProbe.body[0]?.id === CUSTOMER_USER_ID,
    `status ${custProbe.status}: ${JSON.stringify(custProbe.body)?.slice(0, 200)}`,
  );
}

if (failures.length > 0) {
  console.error('\n❌ Preflight failed — aborting before touching data.');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════
// PHASE 1 — Shop owner creates the shop
// ═══════════════════════════════════════════════════════════
setPhase('Phase 1 — Shop owner: create shop');

let shopId = null;

{
  const res = await req('POST', '/shops', {
    jwt: ADMIN_JWT,
    prefer: 'return=representation',
    body: {
      name: `${TAG} — KROMI Lab Demo`,
      city: 'Lisboa',
      country: 'PT',
      phone: '+351911111111',
      email: 'e2e-test@kromi.invalid',
      description: 'E2E test shop — safe to delete.',
      hourly_rate: 30,
      // shops_ins WITH CHECK (created_by = kromi_uid()) — PostgREST does
      // not auto-fill this; every caller must set it explicitly. The
      // frontend does so at ShopManagementPage.tsx:104. Keep convention.
      created_by: ADMIN_USER_ID,
    },
  });
  const row = firstRow(res);
  if (row) {
    shopId = row.id;
    cleanup.shops.push(shopId);
    ok(`shop created (id=${shopId.slice(0, 8)}…)`);
    assert('shop.created_by === admin', row.created_by === ADMIN_USER_ID, `got ${row.created_by}`);
    assert('shop.rating_avg defaults to 0', Number(row.rating_avg) === 0);
    assert('shop.review_count defaults to 0', Number(row.review_count) === 0);
  } else {
    fail('shop insert returned no row', `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
}

// Register admin as shop_members owner (the UI does this, not a trigger)
if (shopId) {
  const res = await req('POST', '/shop_members', {
    jwt: ADMIN_JWT,
    prefer: 'return=representation',
    body: {
      shop_id: shopId,
      user_id: ADMIN_USER_ID,
      role: 'owner',
      display_name: 'E2E Owner',
      active: true,
    },
  });
  const row = firstRow(res);
  if (row) {
    cleanup.shop_members.push(row.id);
    ok('admin registered as shop_members owner');
  } else {
    fail('shop_members insert failed', `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
}

// Seed a minimal price list (we'd ordinarily call seedShopDefaults; here
// we inline 2 rows so the test doesn't depend on the template catalog).
if (shopId) {
  const res = await req('POST', '/shop_services', {
    jwt: ADMIN_JWT,
    prefer: 'return=representation',
    body: [
      { shop_id: shopId, category: 'maintenance', name: 'Revisão geral', price_default: 45, estimated_minutes: 60 },
      { shop_id: shopId, category: 'repair', name: 'Substituir corrente', price_default: 25, estimated_minutes: 30 },
    ],
  });
  if (res.ok && Array.isArray(res.body)) {
    for (const r of res.body) cleanup.shop_services.push(r.id);
    ok(`shop_services seeded (${res.body.length} rows)`);
  } else {
    fail('shop_services seed failed', `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
}

// Opening hours (Mon-Fri 09:00-18:00)
if (shopId) {
  const hours = [1, 2, 3, 4, 5].map((d) => ({
    shop_id: shopId,
    day_of_week: d,
    open_time: '09:00',
    close_time: '18:00',
  }));
  const res = await req('POST', '/shop_hours', {
    jwt: ADMIN_JWT,
    prefer: 'return=representation',
    body: hours,
  });
  if (res.ok && Array.isArray(res.body)) {
    for (const r of res.body) cleanup.shop_hours.push(r.id);
    ok(`shop_hours seeded (${res.body.length} days)`);
  } else {
    fail('shop_hours insert failed', `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
}

// One calendar slot. shop_calendar splits date/time — NOT a timestamptz.
// Columns: slot_date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
//          duration_min INT NOT NULL, title TEXT NOT NULL.
if (shopId) {
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const slotDate = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD
  const res = await req('POST', '/shop_calendar', {
    jwt: ADMIN_JWT,
    prefer: 'return=representation',
    body: {
      shop_id: shopId,
      slot_date: slotDate,
      start_time: '10:00',
      end_time: '11:00',
      duration_min: 60,
      title: `${TAG} — demo slot`,
      status: 'scheduled',
    },
  });
  const row = firstRow(res);
  if (row) {
    cleanup.shop_calendar.push(row.id);
    ok('shop_calendar slot inserted');
  } else {
    fail('shop_calendar insert failed', `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
}

// Public-read sanity: anon must be able to see shop + hours + services
if (shopId) {
  {
    const res = await req('GET', `/shops?id=eq.${shopId}&select=id,name,rating_avg`, {});
    assert(
      'anon can read the shop (public directory)',
      res.ok && Array.isArray(res.body) && res.body.length === 1,
      `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`,
    );
  }
  {
    const res = await req('GET', `/shop_services?shop_id=eq.${shopId}&select=id`, {});
    assert(
      'anon can read shop_services (public price list)',
      res.ok && Array.isArray(res.body) && res.body.length >= 2,
      `status ${res.status}: len=${Array.isArray(res.body) ? res.body.length : 'n/a'}`,
    );
  }
} else {
  console.log('  ⚠ skipping public-read sanity (no shopId)');
}

// ═══════════════════════════════════════════════════════════
// PHASE 2 — Customer creates a service request
// ═══════════════════════════════════════════════════════════
setPhase('Phase 2 — Customer: bike + service request');

let bikeId = null;

// Ensure the customer owns a bike. Re-use if one exists; create otherwise.
{
  const existing = await req(
    'GET',
    `/bike_configs?user_id=eq.${CUSTOMER_USER_ID}&is_active=eq.true&select=id,name&limit=1`,
    { jwt: CUSTOMER_JWT },
  );
  if (Array.isArray(existing.body) && existing.body[0]) {
    bikeId = existing.body[0].id;
    ok(`customer bike re-used (id=${bikeId.slice(0, 8)}…)`);
  } else {
    const create = await req('POST', '/bike_configs', {
      jwt: CUSTOMER_JWT,
      prefer: 'return=representation',
      body: {
        name: `${TAG} — test bike`,
        athlete_id: CUSTOMER_ATHLETE_ID,
        user_id: CUSTOMER_USER_ID,
        config_data: { test: true, tag: TAG },
        is_active: true,
        bike_type: 'ebike',
        model_name: 'E2E Test Bike',
      },
    });
    const row = firstRow(create);
    if (row) {
      bikeId = row.id;
      cleanup.bike_configs.push(bikeId);
      ok(`customer bike created (id=${bikeId.slice(0, 8)}…)`);
    } else {
      fail('bike_configs insert failed', `status ${create.status}: ${JSON.stringify(create.body)?.slice(0, 200)}`);
    }
  }
}

let requestId = null;

if (bikeId && shopId) {
  const res = await req('POST', '/service_requests', {
    jwt: CUSTOMER_JWT,
    prefer: 'return=representation',
    body: {
      bike_id: bikeId,
      rider_id: CUSTOMER_USER_ID,
      shop_id: shopId,
      title: `${TAG} — Revisão de Verão`,
      description: 'Teste E2E. Seguro apagar.',
      urgency: 'normal',
      request_type: 'maintenance',
      status: 'requested',
    },
  });
  const row = firstRow(res);
  if (row) {
    requestId = row.id;
    cleanup.service_requests.push(requestId);
    ok(`service_request created (status=${row.status})`);
  } else {
    fail('service_request insert failed', `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
}

// Two line items — trigger should recompute totals
if (requestId) {
  const res = await req('POST', '/service_items', {
    jwt: CUSTOMER_JWT,
    prefer: 'return=representation',
    body: [
      { service_id: requestId, item_type: 'labor', description: 'Mão-de-obra', quantity: 1, unit_cost: 45, total_cost: 45 },
      { service_id: requestId, item_type: 'part', description: 'Corrente nova', quantity: 1, unit_cost: 25, total_cost: 25 },
    ],
  });
  if (res.ok && Array.isArray(res.body) && res.body.length === 2) {
    for (const r of res.body) cleanup.service_items.push(r.id);
    ok('service_items inserted (2 rows)');
  } else {
    fail('service_items insert failed', `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }

  // Verify update_service_totals trigger fired
  const recheck = await req(
    'GET',
    `/service_requests?id=eq.${requestId}&select=total_cost,total_parts_cost,total_labor_cost`,
    { jwt: CUSTOMER_JWT },
  );
  const row = Array.isArray(recheck.body) ? recheck.body[0] : null;
  assert(
    'trigger update_service_totals computed total_cost=70',
    row && Number(row.total_cost) === 70,
    `got ${JSON.stringify(row)}`,
  );
  assert(
    'trigger computed total_parts_cost=25',
    row && Number(row.total_parts_cost) === 25,
    `got ${JSON.stringify(row)}`,
  );
  assert(
    'trigger computed total_labor_cost=45',
    row && Number(row.total_labor_cost) === 45,
    `got ${JSON.stringify(row)}`,
  );
}

// ═══════════════════════════════════════════════════════════
// PHASE 3 — Shop owner reads + progresses the request
// ═══════════════════════════════════════════════════════════
setPhase('Phase 3 — Shop owner: read, comment, transition');

if (requestId) {
  // Owner must see the request via is_shop_member(shop_id) RLS branch.
  const res = await req('GET', `/service_requests?id=eq.${requestId}&select=id,status,title,rider_id`, {
    jwt: ADMIN_JWT,
  });
  assert(
    'shop owner sees the customer request via RLS',
    res.ok && Array.isArray(res.body) && res.body[0]?.id === requestId,
    `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`,
  );

  // Walk status transitions: requested → accepted → in_progress → pending_approval → completed
  const statuses = ['accepted', 'in_progress', 'pending_approval', 'completed'];
  for (const s of statuses) {
    const upd = await req('PATCH', `/service_requests?id=eq.${requestId}`, {
      jwt: ADMIN_JWT,
      prefer: 'return=representation',
      body: { status: s },
    });
    const row = firstRow(upd);
    assert(
      `owner transitions status → ${s}`,
      row && row.status === s,
      `status ${upd.status}: ${JSON.stringify(upd.body)?.slice(0, 200)}`,
    );
  }

  // Owner posts a comment
  const c = await req('POST', '/service_comments', {
    jwt: ADMIN_JWT,
    prefer: 'return=representation',
    body: {
      service_id: requestId,
      author_id: ADMIN_USER_ID,
      author_role: 'mechanic',
      body: 'Trabalho concluído — pode levantar.',
    },
  });
  const row = firstRow(c);
  if (row) {
    cleanup.service_comments.push(row.id);
    ok('shop owner posted comment');
  } else {
    fail('service_comment insert failed', `status ${c.status}: ${JSON.stringify(c.body)?.slice(0, 200)}`);
  }
}

// ═══════════════════════════════════════════════════════════
// PHASE 4 — Customer leaves a review
// ═══════════════════════════════════════════════════════════
setPhase('Phase 4 — Customer: review + rating aggregation');

if (shopId && requestId) {
  const res = await req('POST', '/shop_reviews', {
    jwt: CUSTOMER_JWT,
    prefer: 'return=representation',
    body: {
      shop_id: shopId,
      service_id: requestId,
      user_id: CUSTOMER_USER_ID,
      rating: 5,
      comment: 'E2E review — serviço impecável.',
    },
  });
  const row = firstRow(res);
  if (row) {
    cleanup.shop_reviews.push(row.id);
    ok('shop_review inserted (rating=5)');
  } else {
    fail('shop_review insert failed', `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }

  // Trigger update_shop_rating must recompute shops.rating_avg and review_count
  const recheck = await req('GET', `/shops?id=eq.${shopId}&select=rating_avg,review_count`, {});
  const shop = Array.isArray(recheck.body) ? recheck.body[0] : null;
  assert(
    'trigger update_shop_rating set review_count=1',
    shop && Number(shop.review_count) === 1,
    `got ${JSON.stringify(shop)}`,
  );
  assert(
    'trigger update_shop_rating set rating_avg=5.00',
    shop && Number(shop.rating_avg) === 5,
    `got ${JSON.stringify(shop)}`,
  );
}

// ═══════════════════════════════════════════════════════════
// PHASE X — Security probes (things that SHOULD be blocked)
// ═══════════════════════════════════════════════════════════
setPhase('Phase X — Security probes');

if (shopId) {
  {
    // X1. Anon must NOT be able to read a shop_calendar row.
    const res = await req('GET', `/shop_calendar?shop_id=eq.${shopId}&select=id`, {});
    assert(
      'anon is blocked from shop_calendar',
      (res.ok && Array.isArray(res.body) && res.body.length === 0) || res.status === 401 || res.status === 403,
      `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`,
    );
  }

  {
    // X2. A *different* logged-in user (customer) should NOT be able to read
    //     shop_calendar for a shop they're not a member of.
    const res = await req('GET', `/shop_calendar?shop_id=eq.${shopId}&select=id`, {
      jwt: CUSTOMER_JWT,
    });
    assert(
      'customer (non-member) is blocked from shop_calendar',
      res.ok && Array.isArray(res.body) && res.body.length === 0,
      `status ${res.status}: saw ${Array.isArray(res.body) ? res.body.length : 'n/a'} rows`,
    );
  }

  {
    // X3. Customer must NOT be able to create a shop_review spoofing another user.
    const res = await req('POST', '/shop_reviews', {
      jwt: CUSTOMER_JWT,
      prefer: 'return=representation',
      body: {
        shop_id: shopId,
        user_id: ADMIN_USER_ID, // spoofing another user
        rating: 1,
        comment: 'should be rejected',
      },
    });
    assert(
      'customer cannot insert a shop_review spoofing another user_id',
      !res.ok || res.status === 403 || res.status === 401,
      `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`,
    );
    // If it somehow went through, track for cleanup.
    const row = firstRow(res);
    if (row) cleanup.shop_reviews.push(row.id);
  }

  {
    // X4. Customer must NOT be able to set a service_request to 'completed'
    //     directly — that's a shop-owner transition. If they can, the RLS
    //     UPDATE policy doesn't discriminate on fields and status becomes
    //     forgeable. This is an active security probe, not a setup step.
    if (requestId) {
      // First roll the request back to requested via admin so we can probe.
      await req('PATCH', `/service_requests?id=eq.${requestId}`, {
        jwt: ADMIN_JWT,
        body: { status: 'requested' },
      });
      const res = await req('PATCH', `/service_requests?id=eq.${requestId}`, {
        jwt: CUSTOMER_JWT,
        prefer: 'return=representation',
        body: { status: 'completed' },
      });
      const row = firstRow(res);
      const customerJumpedToCompleted = row?.status === 'completed';
      assert(
        'customer cannot jump status directly to completed',
        !customerJumpedToCompleted,
        customerJumpedToCompleted
          ? 'SECURITY: customer forged status=completed via UPDATE — no field-level guard'
          : `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`,
      );
      // Restore to completed so Phase Z can DELETE cleanly.
      await req('PATCH', `/service_requests?id=eq.${requestId}`, {
        jwt: ADMIN_JWT,
        body: { status: 'completed' },
      });
    }
  }
} else {
  console.log('  ⚠ skipping security probes (no shopId)');
}

// ═══════════════════════════════════════════════════════════
// PHASE Z — Cleanup (reverse FK order, through RLS)
// ═══════════════════════════════════════════════════════════
setPhase('Phase Z — Cleanup');

// Delete order matters: children before parents. We use whichever JWT
// has permission on each table (usually admin, since they own the shop).
const deletePlan = [
  ['shop_reviews',       cleanup.shop_reviews,       ADMIN_JWT],
  ['service_photos',     cleanup.service_photos,     ADMIN_JWT],
  ['service_comments',   cleanup.service_comments,   ADMIN_JWT],
  ['service_items',      cleanup.service_items,      ADMIN_JWT],
  ['service_requests',   cleanup.service_requests,   ADMIN_JWT],
  ['shop_calendar',      cleanup.shop_calendar,      ADMIN_JWT],
  ['shop_hours',         cleanup.shop_hours,         ADMIN_JWT],
  ['shop_services',      cleanup.shop_services,      ADMIN_JWT],
  ['shop_members',       cleanup.shop_members,       ADMIN_JWT],
  ['shops',              cleanup.shops,              ADMIN_JWT],
  // bike_configs we only created if the customer had none
  ['bike_configs',       cleanup.bike_configs,       CUSTOMER_JWT],
];

for (const [table, ids, jwt] of deletePlan) {
  if (ids.length === 0) continue;
  const inList = ids.map((id) => `"${id}"`).join(',');
  const res = await req('DELETE', `/${table}?id=in.(${inList})`, { jwt });
  if (res.status === 204 || res.ok) {
    ok(`deleted ${ids.length}× ${table}`);
  } else {
    fail(`cleanup failed for ${table}`, `status ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
}

// ═══════════════════════════════════════════════════════════
// Final report
// ═══════════════════════════════════════════════════════════
console.log('');
if (failures.length > 0) {
  console.error(`❌ ${failures.length} assertion(s) failed:`);
  for (const f of failures) {
    console.error(`   [${f.phase}] ${f.label}`);
    if (f.detail) console.error(`       ${String(f.detail).slice(0, 280)}`);
  }
  process.exit(1);
}

console.log(`✅ Shop E2E: all phases green. Tag=${TAG}`);
process.exit(0);
