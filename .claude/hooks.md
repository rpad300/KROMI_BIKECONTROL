# KROMI BikeControl — Claude Code Hooks

## PreToolUse Hooks

### 1. supaFetch Guard
**Trigger:** Write/Edit containing raw `fetch` to `/rest/v1/` or `supabase.co`
**Action:** BLOCK — forces use of `supaFetch`/`supaGet`/`supaRpc` from `src/lib/supaFetch.ts`
**Why:** Raw fetch goes out with the anon key, bypassing KROMI JWT injection. RLS policies see anonymous user → data leak or silent failure.

### 2. KromiFileStore Guard
**Trigger:** Write/Edit importing `supabase.storage` or `storage-js`
**Action:** BLOCK — forces use of `KromiFileStore.uploadFile()`
**Why:** KROMI uses Google Drive (not Supabase Storage) as file backend. The `KromiFileStore` handles Drive API + `kromi_files` metadata table.

### 3. BLE Encapsulation Guard
**Trigger:** Write/Edit using `navigator.bluetooth` in components/hooks/pages
**Action:** BLOCK — forces use of `GiantBLEService`
**Why:** All BLE subscriptions must go through the service layer for proper connection management, reconnection, and state updates.

### 4. Auth Function Guard
**Trigger:** Write/Edit using `auth.uid()`
**Action:** BLOCK — forces use of `kromi_uid()`
**Why:** KROMI uses custom HS256 JWTs, not Supabase Auth. `auth.uid()` hits `auth.users` which KROMI doesn't populate.

## CI/CD Hooks (PreToolUse)

### 5. Pre-Push Build Gate
**Trigger:** Bash containing `git push`
**Action:** BLOCK if `npm run type-check` or `npm run build` fails
**Why:** Vercel auto-deploys from main. A broken push = broken production. This hook runs type-check + build before allowing any push. If either fails, the push is blocked with the error output.

### 6. APK Tag Gate
**Trigger:** Bash containing `gradlew assemble`
**Action:** BLOCK if no git tag exists
**Why:** APK version is auto-extracted from git tags. Building without a tag produces an unversioned APK. Forces `git tag vX.Y.Z` before build.

## PostToolUse Hooks

### 7. Build Notification
**Trigger:** Bash running `npm run build`
**Action:** Info message reminding to check TypeScript errors

### 8. Post-Push Deploy Status
**Trigger:** Bash containing `git push` to main/origin
**Action:** Shows deploy status dashboard:
- PWA: Vercel auto-deploys (link to dashboard)
- APK: Reminder to tag + build if needed
- Edge Functions: Reminder to deploy separately via Supabase MCP

### 9. APK Build Success
**Trigger:** Bash containing `gradlew assemble` with exit code 0
**Action:** Shows APK path and `gh release create` command ready to copy

## Stop Hooks

### 10. Session Wrap-Up (OBRIGATÓRIO)
**Trigger:** Quando a conversa está a terminar
**Action:** Mostra checklist obrigatório:
1. **CLAUDE.md** — Verificar se Project Structure, Conventions, ou secções específicas precisam de update
2. **Memory** — Guardar feedback, decisões, referências aprendidas na sessão
3. **kromi-doc** — Verificar se git hooks estão instalados (auto-sync)
4. **Resumo** — Apresentar ao utilizador o que foi feito

**Skill de referência:** `.claude/skills/15-session-documentation.md` — processo completo com templates e anti-patterns.

**Why:** Sem este hook, o CLAUDE.md fica desactualizado e a próxima sessão começa com contexto errado. A memory system perde aprendizagens. A documentação Obsidian dessincroniza.
