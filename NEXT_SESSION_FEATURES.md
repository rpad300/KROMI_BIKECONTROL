# Session Features — Desenvolvimento PWA sem Hardware

Prompt para sessões que não envolvem testes com dispositivos físicos. Foco em features do sistema, intelligence engine, UI/UX, refactoring — tudo o que pode ser feito, commitado e deployado para Vercel sem precisar de ride/hardware.

## Estado Actual

**Versão:** v1.5.6 (Session 14)
**Ultimo commit:** Unified Device Manager + multi-light + lights dashboard tab
**Deploy:** https://github.com/rpad300/KROMI_BIKECONTROL (Vercel auto-deploy on push)

## Áreas de Trabalho (sem hardware)

### 1. Intelligence / Assistance Engine (PRIORIDADE)

**KromiEngine (`src/services/intelligence/KromiEngine.ts`):**
- Revisar os 7 layers e ver se há lógica que pode ser melhorada
- Verificar smoothing (alpha 0.15, hold time 15s) em cenários edge
- Adicionar mais flags ao decision tree

**PhysiologyEngine (`src/services/intelligence/PhysiologyEngine.ts`):**
- W' dead zone 5% já implementado — pode ficar configurável?
- IRC (Cardiac Recovery Index) — melhorar detecção de low-effort transitions
- Efficiency Factor degradation — adicionar mais granularidade

**RiderLearning (`src/services/autoAssist/RiderLearning.ts`):**
- Override learning por contexto (gradient × HR zone) — rever bucket granularity
- CP calibration — auto-detectar sustained efforts melhor
- Confidence score — quando a learning é "confiável" vs "exploratory"

**NutritionEngine:**
- Carbs ingested tracking — UI para registar gels/barras durante o ride
- Hydration reminders baseados em temperatura + duration
- Fuel window alerts (30-60min) — já implementado? Validar

**Auto-Assist Engine (`src/services/autoAssist/`):**
- ElevationPredictor — lookahead e pre-activation
- BatteryOptimizer — emergency mode < 15%
- Override detection — Ergo 3 físico + app button (60s pause)

### 2. Desktop UI (`src/components/Desktop/`)

**DesktopLiveView:**
- Layout para ecrã grande — mais widgets simultâneos
- Split view: map + dashboard + nutrition
- Keyboard shortcuts para controlo

**GlobalMapView:**
- Multi-ride heatmap
- Cluster analysis de zonas favoritas
- Integration com TerrainDiscovery cache

### 3. Dashboard Widgets

**Widgets existentes para melhorar:**
- `IntelligenceWidget` — mostrar decision reasoning
- `WPrimeWidget` — adicionar drift rate gauge
- `NutritionWidget` — fuel window countdown
- `WeatherWidget` — wind impact on assist
- `TrailWidget` — technical segments ahead
- `AutoAssistWidget` — override countdown

**Widgets novos a criar:**
- `FatigueWidget` — model de fatigue acumulada
- `EfficiencyWidget` — watts/HR ratio trend
- `TerrainLearnedWidget` — "já subi isto N vezes, tempo médio X min"

### 4. Settings / Configuration

**BikeFitPage** — expandir com:
- Cockpit position (handlebar drop, saddle setback)
- Power meter calibration
- Wheel circumference override

**AthleteProfile:**
- FTP test protocol wizard (via field test)
- HR zones recalculation
- Fitness level tracking over time

**AutoAssistSettings:**
- Profile presets (Comfortable / Balanced / Racing)
- Fine-tuning sliders para cada layer

### 5. Pre-Ride Planning

**RouteSearch + Elevation:**
- Route import (GPX)
- Pre-ride analysis preview (elevation, expected Wh, time, carbs)
- Multi-route comparison

**PreRideReport:**
- AI-generated recommendations
- Nutrition plan (how many gels, when)
- Equipment checklist

### 6. Post-Ride Analysis

**TripSummaryModal** — expandir:
- Mais charts (cadence, HR zones over time)
- Segment analysis (KOM attempts, personal bests)
- Efficiency comparison vs previous rides
- AI summary text (local, sem API externa)

**RideHistory:**
- Filtros avançados (distance, elevation, type)
- Stats aggregation (weekly/monthly totals)
- Trend graphs (fitness over time)

### 7. Social / Clubs (tables já existem)

**Clubs page:**
- Criar/joinar clubs
- Club rides calendar
- Member leaderboards

### 8. Maintenance System (tables já existem)

**ServiceRequests:**
- Criar pedido de manutenção
- Upload photos (before/after)
- Shop browser
- Booking slots

### 9. Refactoring / Cleanup

**Code quality:**
- Vite chunk size warning (1.4MB) — manualChunks no vite.config
- Remover `Connections.tsx` antigo (após confirmar ConnectionsPage estável)
- Cleanup legacy localStorage keys (`kromi_saved_*`) — migration para deviceStore
- `useEffect` dependency warning no `ConnectionsPage:177`

**Pattern consistency:**
- Unificar loading states (alguns componentes usam spinners, outros texto)
- Error boundaries em mais sítios
- Toast notifications centralizadas

**Type safety:**
- Remover `any` e `unknown` casts desnecessários
- Stricter types no bikeStore actions

### 10. Stitch UI Designs

Stitch project: `1881497936854696524`
- Listar designs pendentes
- Aplicar ao que ainda não tem Stitch design
- Usar MCP `mcp__stitch__fetch_screen_code` para trazer código

### 11. Supabase Sync

**SettingsSyncService:**
- Verificar que tudo sync corretamente (riderProfile, bikes, accessories)
- Conflict resolution (último wins vs merge)
- Offline-first com SyncQueue

**RideHistory sync:**
- Background sync de snapshots
- Retry logic
- Purge old synced data (>30d)

### 12. Logging & Diagnostics

**Debug tools:**
- `/debug` page para ver state de todos os stores
- Log viewer (lê de `debug_logs` Supabase)
- Export logs para support

## Workflow Sugerido

1. **Ler memória primeiro:**
   - `memory/project_overview.md` — estado v1.5.6
   - `memory/feedback_motor_control.md` — filosofia de motor control
   - `memory/feedback_road_test_lessons.md` — lessons de testes anteriores

2. **Escolher 1-3 áreas por sessão:**
   - Não tentar fazer tudo de uma vez
   - Focar em 1 área grande OU 2-3 pequenas

3. **Desenvolvimento iterativo:**
   - Pequenos commits com mensagens descritivas
   - `git push` frequente para Vercel
   - Verificar PWA desktop no browser local com `npm run dev`

4. **Deploy:**
   - PWA: `git push` → Vercel auto-deploy (~1 min)
   - **Não precisa APK rebuild** para mudanças PWA — WebView carrega de Vercel

5. **Memória no fim da sessão:**
   - Actualizar `project_overview.md` com novas features
   - Adicionar feedback memories se houver decisões importantes
   - Actualizar `MEMORY.md` index

## Ferramentas MCP Úteis

**Supabase (para queries à base de dados):**
```typescript
mcp__claude_ai_Supabase__execute_sql({ project_id: "ctsuupvmmyjlrtjnxagv", query: "..." })
mcp__claude_ai_Supabase__list_tables({ project_id: "ctsuupvmmyjlrtjnxagv" })
```

**Stitch (para designs UI):**
```typescript
mcp__stitch__list_screens({ project_id: "1881497936854696524" })
mcp__stitch__fetch_screen_code({ screen_id: "..." })
```

**Obsidian (para notas do projecto):**
```typescript
mcp__obsidian__obsidian_list_files_in_dir({ dirpath: "KROMI" })
mcp__obsidian__obsidian_get_file_contents({ filepath: "KROMI/..." })
```

## Prompts de Exemplo

**Melhorar Intelligence:**
```
Quero melhorar o W' balance tracking — o dead zone de 5% funciona
mas quero adicionar hysteresis para evitar flickering entre green/amber.
Ler PhysiologyEngine.ts e propor.
```

**Novo widget:**
```
Criar FatigueWidget que mostra acumulação de fatigue baseada em
TSS + W' state + HR drift. Ler AdaptiveLearningEngine e PhysiologyEngine,
propor design antes de implementar.
```

**Refactor:**
```
Remover localStorage keys legacy (kromi_saved_hr, kromi_saved_di2, etc.)
e fazer migration para deviceStore. Manter backwards compat por 1 sessão.
```

**Cleanup:**
```
Remover Connections.tsx antigo, actualizar imports, verificar que
ConnectionsPage cobre todos os casos de uso. Fazer type check antes
de commit.
```

## Não Fazer Nesta Sessão

❌ **Testes com hardware** — usar `NEXT_SESSION_PROMPT.md` quando tiveres dispositivos
❌ **Alterações no bridge APK** — a menos que seja bug fix urgente
❌ **Alterações que precisam de BLE connection** — adiamento para sessão de testes

## Regra de Ouro

**"Posso testar no PWA desktop/mobile sem hardware?"**
- SIM → podes implementar
- NÃO → adicionar à lista do `NEXT_SESSION_PROMPT.md`
