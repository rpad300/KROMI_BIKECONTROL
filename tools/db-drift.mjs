#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// db-drift — warn when the DB has applied migrations that
// don't exist as files in supabase/migrations/.
// ═══════════════════════════════════════════════════════════
//
// This catches the S18 gap: migrations applied via the MCP or
// Supabase Dashboard SQL editor never got saved as files in
// the repo, so a fresh clone couldn't reproduce the DB state.
//
// Strategy:
//   1. Read supabase/migrations/*.sql → extract version prefix
//      (leading digits before first underscore)
//   2. Query supabase_migrations.schema_migrations via the REST
//      API using the anon key — this table is usually readable.
//      If it's not, fail soft (exit 0) so local dev doesn't break.
//   3. Compare both lists. Report:
//        - versions in DB not in repo → DRIFT (needs dump)
//        - versions in repo not in DB → pending (expected pre-push)
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   node tools/db-drift.mjs
//
// Or via npm script: `npm run db:drift`.
//
// Exit codes:
//   0  no drift
//   1  drift detected (DB has migrations not in repo)
//   2  unreachable — treat as warning, not failure

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

async function getRepoVersions() {
  const files = await readdir(MIGRATIONS_DIR);
  const versions = new Set();
  for (const f of files) {
    if (!f.endsWith('.sql')) continue;
    // Extract leading digits (e.g. "20260407_foo.sql" → "20260407")
    const match = f.match(/^(\d+)/);
    if (match) versions.add(match[1]);
  }
  return versions;
}

async function getDbVersions() {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY) {
    console.warn('⚠ SUPABASE_URL / SUPABASE_ANON_KEY not set — skipping drift check.');
    return null;
  }
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/rpc/db_migration_versions`,
      {
        method: 'POST',
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );
    if (!res.ok) {
      // The RPC doesn't exist — we'll fall back to a direct query
      // on the schema_migrations table via PostgREST's "rpc/" alias
      // isn't possible, so we return null and warn.
      console.warn(`⚠ db_migration_versions RPC not available (HTTP ${res.status}).`);
      console.warn('  Create it with:');
      console.warn('    CREATE FUNCTION public.db_migration_versions()');
      console.warn('    RETURNS setof text LANGUAGE sql SECURITY DEFINER AS');
      console.warn("    $$ SELECT version FROM supabase_migrations.schema_migrations $$;");
      return null;
    }
    const rows = await res.json();
    return new Set(rows.map((r) => (typeof r === 'string' ? r : r.version)));
  } catch (err) {
    console.warn(`⚠ drift check network error: ${err.message}`);
    return null;
  }
}

const repoVersions = await getRepoVersions();
const dbVersions = await getDbVersions();

if (!dbVersions) {
  console.log(`(skipped — have ${repoVersions.size} files in supabase/migrations/)`);
  process.exit(2);
}

const inDbNotRepo = [...dbVersions].filter((v) => !repoVersions.has(v)).sort();
const inRepoNotDb = [...repoVersions].filter((v) => !dbVersions.has(v)).sort();

console.log(`Repo migrations:   ${repoVersions.size}`);
console.log(`DB migrations:     ${dbVersions.size}`);
console.log('');

if (inDbNotRepo.length > 0) {
  console.error('❌ DRIFT — DB has migrations not in repo:');
  for (const v of inDbNotRepo) console.error(`   - ${v}`);
  console.error('');
  console.error('Fix: dump them as files into supabase/migrations/.');
  process.exit(1);
}

if (inRepoNotDb.length > 0) {
  console.log('⏳ Pending (in repo, not yet applied to DB):');
  for (const v of inRepoNotDb) console.log(`   - ${v}`);
}

console.log('');
console.log('✅ No drift — repo and DB are in sync.');
process.exit(0);
