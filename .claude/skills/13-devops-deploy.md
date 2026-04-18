# Skill 13 -- DevOps & Deployment

## Role

You are a DevOps and deployment specialist for KROMI BikeControl. You handle
Vercel PWA deployments, Android APK builds, GitHub Actions CI pipelines,
release management, and pre-deploy verification.

## Deployment Targets

| Target     | Method            | URL / Output                              |
|------------|-------------------|-------------------------------------------|
| PWA        | Vercel            | HTTPS (required for Web Bluetooth)        |
| APK        | Gradle + GH Release | ble-bridge.apk via GitHub Releases      |
| Edge Fns   | Supabase CLI      | supabase functions deploy                 |

## Vercel PWA Deployment

### Prerequisites

- Node.js 18+
- Vercel CLI (`npm i -g vercel`)
- Environment variables configured in Vercel dashboard

### Environment Variables

| Variable                   | Description                    | Required |
|----------------------------|--------------------------------|----------|
| `VITE_SUPABASE_URL`        | Supabase project URL           | Yes      |
| `VITE_SUPABASE_ANON_KEY`   | Supabase anon/public key       | Yes      |
| `VITE_GOOGLE_MAPS_KEY`     | Google Maps JavaScript API key | Yes      |
| `VITE_SIMULATION_MODE`     | Enable simulation (dev only)   | No       |

### Deploy Commands

```bash
# Production deploy
npm run build && vercel --prod

# Preview deploy (for PR review)
vercel

# Check deployment status
vercel ls
```

### Build Command

```bash
npm run build
# Runs: vite build
# Output: dist/
# Includes: PWA manifest, service worker, all assets
```

### HTTPS Requirement

Web Bluetooth API requires a secure context (HTTPS). Vercel provides HTTPS
by default. For local development, `npm run dev` runs with HTTPS via Vite
configuration.

### Post-Deploy Verification

1. Open deployed URL in Chrome Android.
2. Check PWA install prompt appears.
3. Verify BLE connection works (or simulation mode).
4. Check service worker registration in DevTools > Application.
5. Verify Wake Lock activates (screen stays on).

## APK Build Workflow

The APK is a native Android wrapper for BLE bridge functionality.

### Version Strategy

**Tag FIRST, then build.** Version is auto-extracted from git tags.

```bash
# 1. Tag the release
git tag v1.2.3
git push origin v1.2.3

# 2. Build APK (version auto-extracted from tag)
cd ble-bridge-android/
./gradlew assembleDebug

# 3. Create GitHub release with APK
gh release create v1.2.3 \
  app/build/outputs/apk/debug/app-debug.apk \
  --title "v1.2.3" \
  --notes "Release notes here"
```

### Build Requirements

| Requirement     | Version     |
|-----------------|-------------|
| Java JDK        | 21          |
| Android SDK     | 34+         |
| Gradle          | 8.x        |
| Android Studio  | Optional    |

### APK Signing

- Debug APK: auto-signed with debug keystore (for testing).
- Release APK: requires release keystore (stored securely, not in repo).

```bash
# Release build (requires keystore config in gradle.properties)
./gradlew assembleRelease
```

## GitHub Actions CI Pipeline

Location: `.github/workflows/ci.yml`

### 4-Job Pipeline

```
Job 1: lint-typecheck
  |
  v
Job 2: build
  |
  v
Job 3: rls-smoke-tests
  |
  v
Job 4: db-drift-check
```

### Job 1: Lint + Type-Check

```yaml
- name: Lint
  run: npm run lint

- name: Type check
  run: npm run type-check
  # Runs: tsc --noEmit --strict
```

Uses ESLint flat config (eslint.config.js). TypeScript strict mode enforced.

### Job 2: Build

```yaml
- name: Build
  run: npm run build
  env:
    VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
    VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
    VITE_GOOGLE_MAPS_KEY: ${{ secrets.VITE_GOOGLE_MAPS_KEY }}
```

Verifies the production build completes without errors.

### Job 3: RLS Smoke Tests

```yaml
- name: RLS smoke tests
  run: node tests/rls-smoke.mjs
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

Location: `tests/rls-smoke.mjs`

Tests bidirectional RLS policies:
- Authenticated user can read own data.
- Authenticated user cannot read other users' data.
- Anonymous cannot access protected tables.
- Super admin can access all data.

### Job 4: DB Drift Check

```yaml
- name: DB drift check
  run: node tools/db-drift.mjs
```

Location: `tools/db-drift.mjs`

Compares local migration files against the live Supabase schema to detect
drift (manual changes not captured in migrations).

## GitHub CLI Operations

### Releases

```bash
# Create release with APK
gh release create v1.2.3 \
  ble-bridge.apk \
  --title "v1.2.3" \
  --notes "Changelog here"

# List releases
gh release list

# Download latest APK
gh release download --pattern "*.apk"
```

### Pull Requests

```bash
# Create PR
gh pr create --title "feat: new widget" --body "Description"

# List open PRs
gh pr list

# Check PR status
gh pr checks 123
```

### Issues

```bash
# Create issue
gh issue create --title "Bug: X" --body "Steps to reproduce"

# List issues
gh issue list --label bug
```

## Pre-Deploy Checklist

Run this sequence before any production deploy:

```bash
# 1. Type-check (catches type errors)
npm run type-check

# 2. Lint (catches code quality issues)
npm run lint

# 3. Build (catches build errors)
npm run build

# 4. Test (catches logic errors)
npm run test

# 5. RLS smoke tests (catches permission errors)
node tests/rls-smoke.mjs

# 6. Deploy
vercel --prod
```

### Quick One-Liner

```bash
npm run type-check && npm run lint && npm run build && npm run test && vercel --prod
```

## Supabase Edge Function Deployment

```bash
# Deploy a specific function
supabase functions deploy drive-storage

# Deploy all functions
supabase functions deploy

# Set secrets for edge functions
supabase secrets set GOOGLE_REFRESH_TOKEN=xxx GOOGLE_CLIENT_ID=yyy
```

## Rollback Procedures

### Vercel Rollback

```bash
# List recent deployments
vercel ls

# Promote a previous deployment to production
vercel promote <deployment-url>
```

### Database Rollback

Supabase migrations are forward-only. To rollback:
1. Create a new migration that reverses the changes.
2. Apply with `supabase db push`.
3. Never delete migration files from the repo.

## Monitoring

| What              | Tool                       | How                          |
|-------------------|----------------------------|------------------------------|
| PWA errors        | Vercel dashboard           | Functions > Logs             |
| Edge fn errors    | Supabase dashboard         | Edge Functions > Logs        |
| BLE debug         | Remote debug logs          | `debug_logs` table           |
| Build status      | GitHub Actions             | Actions tab                  |
| Uptime            | Vercel                     | Analytics                    |

## Hard Rules

1. **Tag BEFORE APK build** -- version auto-extracted from git tags.
2. **HTTPS always** -- Web Bluetooth requires secure context.
3. **Never skip type-check** -- TypeScript strict mode is enforced.
4. **Never push secrets to repo** -- use Vercel/Supabase dashboards.
5. **RLS smoke tests before deploy** -- catches permission regressions.
6. **Forward-only migrations** -- never delete or modify existing migrations.
7. **Preview deploy for PRs** -- never push untested code to production.
8. **ESLint flat config** -- `eslint.config.js`, not `.eslintrc`.

## Key Files

```
.github/workflows/ci.yml                -- CI pipeline (4 jobs)
tests/rls-smoke.mjs                     -- RLS bidirectional smoke tests
tools/db-drift.mjs                      -- Schema drift detection
ble-bridge-android/                     -- Android APK source
  app/build.gradle                      -- APK build config
  gradle.properties                     -- Signing config
vite.config.ts                          -- Build + dev server config
vercel.json                             -- Vercel deployment config (if exists)
eslint.config.js                        -- ESLint flat config
tsconfig.json                           -- TypeScript strict config
```
