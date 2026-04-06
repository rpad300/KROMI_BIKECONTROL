# Session 15 Resume Prompt — Hardware Testing

Sessão 14 entregou **v1.5.6** com Unified Device Manager, multi-light, lights dashboard tab, e vários fixes. O que ficou pendente precisa de **hardware físico** para testar.

## Estado Actual

**Ultimo commit:** Session 14 — v1.5.6 + bridge APK fix2 (scan-then-connect)
**Release:** https://github.com/rpad300/KROMI_BIKECONTROL/releases/tag/v1.5.6
- `kromi-bridge-1.5.6-fix2.apk` — bridge com scan-then-connect para BLE private addresses

**Ultima hipotese de bug (NAO CONFIRMADO):**
- iGPSPORT VS1800S não conectava porque o bridge usava `getRemoteDevice(MAC).connectGatt()` directo
- Fix implementado: `AccessoryService.kt` agora faz scan com `setDeviceAddress` filter primeiro (5s timeout), usa o BluetoothDevice do ScanResult, fallback para direct connect

## Session 14 Entregue

**Unified Device Manager:**
- `deviceStore` (novo) — Zustand persisted com categories/roles/devices
- `ConnectionsPage.tsx` (novo) — lista unificada + flow Adicionar → Categoria → Role → Scan
- Substitui o antigo Connections.tsx com 7+ secções separadas

**Multi-Light Support:**
- `LightRegistry.ts` (novo) — gere múltiplas instâncias front + rear
- `bikeStore.lights[]` array com LightInfo (position, brand, battery, mode, connected)
- AccessoriesManager routing: brake→rear, headlight→front, turns→all

**Dashboard Lights Tab:**
- `LightsPanel.tsx` (novo) — control panel com mode grid, turn signals, smart status
- Nova tab "Luzes" no Dashboard ExpandedView

**Outros fixes:**
- Vite build version (Vercel fallback chain git→ENV→package.json)
- Settings dynamic version (era hardcoded v0.9.5)
- Trip share button Web Share API
- W' τ calibração: 5% CP dead zone + τ 300→400s
- Motor brand selector em BikesPage
- VS1800S debug logging (iGPSportLightService)
- Scanner UX: arrow back + fixed bottom cancel
- Bridge scan-then-connect para private BLE addresses

## Tarefas para Session 15

### 1. VS1800S Light Connection Test (PRIORIDADE)
```
1. Instalar kromi-bridge-1.5.6-fix2.apk
2. Ligar VS1800S (botão físico ON)
3. PWA → Dispositivos → Adicionar → Luzes → Luz Frontal → seleccionar VS1800S
4. Verificar logs via MCP Supabase:
   SELECT id, message, created_at FROM debug_logs
   WHERE created_at > now() - interval '5 minutes'
   ORDER BY created_at DESC LIMIT 30;
5. Procurar "sensorConnected: light" ou "sensorError: light"
```

**Se ainda não funciona:**
- Verificar logcat do Android: `adb logcat | grep -E "AccessoryService|BLEBridge"`
- Procurar "onConnectionStateChange: status=" para ver GATT status code
- GATT status 133 = generic error, 22 = GATT_CONN_TERMINATE_LOCAL_HOST, 8 = GATT_CONN_TIMEOUT
- Pode precisar de bonding prévio (emparelhar no Android settings primeiro)

### 2. Multi-Light (Front + Rear)
- Testar adicionar 2ª luz enquanto 1ª ligada
- Verificar que `bikeStore.lights[]` tem 2 entradas
- Dashboard Lights tab mostra ambas
- Testar comandos: brake flash só na rear, headlight só na front, turn signals em ambas

### 3. Lights Dashboard Control Panel
- Dashboard → expandir → tab "Luzes"
- Testar mode grid, turn signals, smart status chips
- Testar disconnect via botão link_off

### 4. Garmin Varia Radar Test
- Adicionar Radar via ConnectionsPage
- Verificar scan-then-connect funciona também para Garmin
- Testar RadarPanel no Dashboard tab "Radar"

### 5. Long Ride Validation (1h+)
- W' estabilidade (não drena sem esforço intenso graças ao 5% CP dead zone)
- τ 400s feel
- Terrain cache (2ª volta)
- Nutrition alerts timing
- Trip share no fim do ride

### 6. Multi-Brand Motor Tests (se hardware disponível)
- Bosch, Shimano STEPS, Specialized Flow/TurboConnect
- Fazua/Brose/Yamaha só detection

### 7. Bugs pendentes
- Vite chunk size warning (1.4MB) — precisa code splitting
- Old `Connections.tsx` remover após confirmar ConnectionsPage funciona
- `useEffect` dependency warning no ConnectionsPage:177

## Ferramentas

**Debug logs via MCP Supabase:**
```typescript
mcp__claude_ai_Supabase__execute_sql({
  project_id: "ctsuupvmmyjlrtjnxagv",
  query: "SELECT id, message, created_at FROM debug_logs WHERE created_at > now() - interval '5 minutes' ORDER BY created_at DESC LIMIT 30"
})
```

**Adicionar dlog:**
```ts
((window as unknown as Record<string, unknown>).__dlog as ((msg: string) => void) | undefined)?.('mensagem');
```

**Bridge APK rebuild:**
```bash
cd ble-bridge-android
./gradlew assembleDebug
gh release upload v1.5.6 "app/build/outputs/apk/debug/app-debug.apk#kromi-bridge-X.apk" --clobber
```

**PWA deploy:** `git push` → Vercel auto-deploy (~1 min)

## Ficheiros Session 14

**Novos:**
- `src/store/deviceStore.ts`
- `src/components/Connections/ConnectionsPage.tsx`
- `src/components/Dashboard/LightsPanel.tsx`
- `src/services/bluetooth/LightRegistry.ts`

**Modificados (importantes):**
- `src/services/bluetooth/WebSocketBLEClient.ts` — dlog + sensorError + lights[] sync
- `src/components/shared/DeviceScanner.tsx` — ScanConnectedInfo callback + UX
- `src/store/bikeStore.ts` — LightInfo + lights[] + multi-light actions
- `ble-bridge-android/.../AccessoryService.kt` — scan-then-connect + debounce + errors
- `vite.config.ts` — fallback version chain

## Memória Claude (ler primeiro)

- `memory/project_overview.md` — estado v1.5.6
- `memory/reference_device_manager.md` — arquitectura Device Manager
- `memory/feedback_ble_scan_connect.md` — BLE private addresses lesson
- `memory/reference_debug_logs.md` — dlog + MCP Supabase
- `memory/feedback_road_test_lessons.md` — road test lessons anteriores
- `memory/feedback_motor_control.md` — estratégia motor control
