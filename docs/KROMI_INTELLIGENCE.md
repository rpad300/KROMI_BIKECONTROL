# KROMI Intelligence — Motor Calibration Engine

## Version: v0.6.0-b34 (2026-04-01)

---

## 1. Visão Geral

O KROMI Intelligence é o cérebro do sistema BikeControl. Calcula continuamente a calibração óptima do motor da Giant Trance X E+ 2 (2023), ajustando 5 parâmetros independentes do SyncDrive Pro a cada 2 segundos.

**Princípio fundamental**: O KROMI não "escolhe presets" — calcula uma intensidade contínua (0-100%) para cada parâmetro e envia a calibração mais próxima que o motor aceita.

### Quando está activo
- **Apenas em POWER mode** — o utilizador controla o modo via RideControl físico
- Nos outros modos (ECO, TOUR, ACTIVE, SPORT, SMART) o KROMI é passivo
- Mostra telemetria em todos os modos, mas só envia comandos em POWER

### Arquitectura
```
┌─────────────────────────────────────────────────────────┐
│                    SENSORES (input)                      │
│  GPS + Elevation API → gradiente, altitude, antecipação  │
│  Motor telemetry     → speed, SOC, assist mode           │
│  CSC sensor          → cadence RPM                       │
│  Power meter         → rider watts                       │
│  HR sensor           → heart rate BPM                    │
│  Barometer           → altitude (backup)                 │
│  Bike config         → battery Wh, motor specs, weight   │
│  Athlete profile     → HR max, age, weight               │
└────────────────────┬────────────────────────────────────┘
                     │ a cada 2 segundos
                     ▼
┌─────────────────────────────────────────────────────────┐
│              TUNING INTELLIGENCE                         │
│  8 factores → 3 intensidades (support, torque, launch)   │
│  Intensidade 0-100% → wire value 0/1/2 por ASMO          │
│  Smoothing: 3 amostras estáveis para mudar               │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                SET_TUNING (cmd 0x2D)                     │
│  byte[2] = (ASMO1+1) | ((ASMO2+1) << 4)                 │
│  byte[3] = (ASMO3+1) | ((ASMO4+1) << 4)                 │
│  byte[4] = (ASMO5+1)                                    │
│  → AES encrypt key 3 → BLE write → SyncDrive Pro        │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Os 5 Parâmetros do Motor (ASMO)

Baseado no decompilado do RideControl APK v1.33 (TuningData.java).
O motor DU7 (SyncDrive Pro) aceita 5 parâmetros, cada um com 3 valores.

| ASMO | Parâmetro | Wire 0 (max) | Wire 1 (mid) | Wire 2 (min) | Função |
|------|-----------|:---:|:---:|:---:|--------|
| ASMO1 | **Support %** | 360% | 350% | 300% | Multiplicador do input do rider |
| ASMO2 | **Torque** | 300 | 250 | 200 | Torque high-range (Nm equivalente) |
| ASMO3 | **Mid Torque** | 250 | 200 | 175 | Torque mid-range |
| ASMO4 | **Low Torque** | 175 | 150 | 125 | Torque low-range |
| ASMO5 | **Launch** | 100 | 75 | 50 | Resposta/agressividade inicial |

### Combinações
- 3^5 = **243 combinações** possíveis
- SET_TUNING empacota os 5 em 3 bytes
- Cada parâmetro é controlado independentemente

### Encoding
```
Exemplo: Support=MAX, Torque=MID, MidTorque=MID, LowTorque=MIN, Launch=MAX

Wire values: [0, 1, 1, 2, 0]
byte[2] = (0+1) | ((1+1) << 4) = 0x21  (Support + Torque)
byte[3] = (1+1) | ((2+1) << 4) = 0x32  (MidTorque + LowTorque)
byte[4] = (0+1) = 0x01                  (Launch)

Plaintext: [0x2D, 0x03, 0x21, 0x32, 0x01, 0x00, ..., 0x00]
→ AES encrypt com key 3 → [0xFB, 0x21, encrypted(16), keyIdx=3, CRC]
```

---

## 3. Os 8 Factores de Decisão

### 3.1 Terreno + Peso (base score 0-100)

O factor principal. Gradiente actual do terreno, ajustado pelo peso do rider.

| Gradiente | Score base | Com 90kg (+20%) | Com 65kg (-13%) |
|-----------|:---:|:---:|:---:|
| > 12% (forte) | 100 | 100 | 87 |
| > 8% (dura) | 85 | 100 | 74 |
| > 5% (moderada) | 70 | 84 | 61 |
| > 3% (suave) | 55 | 66 | 48 |
| > 1% (inclinação) | 40 | 40 | 40 |
| > -2% (plano) | 25 | 25 | 25 |
| > -5% (descida suave) | 10 | 10 | 10 |
| < -5% (descida) | 0 | 0 | 0 |

**Fonte do gradiente**: Google Elevation API via GPS heading (300m lookahead, 15 pontos).
**Peso de referência**: 75kg. Acima = boost, abaixo = redução.
**Cálculo**: `base * (0.8 + 0.2 * peso/75)` para gradientes > 2%.

### 3.2 Bateria (multiplicador 0.4-1.0)

Reduz progressivamente o score quando a bateria baixa.

| SOC | Multiplicador | Efeito |
|-----|:---:|--------|
| > 60% | ×1.0 | Normal — sem restrição |
| 30-60% | ×0.7-1.0 | Conservação gradual |
| 15-30% | ×0.5-0.7 | Economia activa |
| < 15% | ×0.4 | Emergência — redução severa |

**Ajuste por capacidade**: Baterias maiores (1050Wh) conservam mais tarde que baterias menores (500Wh).
**Cálculo**: `threshold * min(totalWh/1050, 1.2)`

### 3.3 Velocidade + Limite Motor (-25 a +25)

| Condição | Modificador | Razão |
|----------|:---:|--------|
| > limite-2 km/h (ex: >23) | -25 | Motor corta a 25km/h, assist inútil |
| > limite-5 km/h (ex: >20) | -15 | A aproximar do corte |
| > 25 km/h | -20 | Rápido, não precisa de assist |
| < 5 km/h + gradient > 5% | +25 | Lento em subida — precisa muito |
| < 10 km/h + gradient > 3% | +15 | Esforço em subida |
| < 3 km/h | -10 | Quase parado, poupar bateria |

### 3.4 Heart Rate (-10 a +20)

Baseado no HR max do atleta (observado ou calculado: 220-idade).

| % HR Max | Modificador | Zona |
|----------|:---:|--------|
| > 92% | +20 | Perto do máximo — ajuda urgente |
| > 85% | +15 | Limiar — boost |
| > 75% | +5 | Tempo — ligeiro boost |
| 55-75% | 0 | Endurance — normal |
| < 55% | -10 | Recovery — poupar bateria |

### 3.5 Cadência (-10 a +20)

| RPM | Modificador | Situação |
|-----|:---:|--------|
| > 90 | -10 | Spinning livre — reduzir |
| < 40 + gradient > 3% | +20 | Grinding em subida — boost |
| < 60 | +10 | Abaixo do óptimo |
| 60-90 | 0 | Zona óptima |
| 0 | 0 | Sem pedalar — ignorar |

### 3.6 Potência do Rider (W/kg) (-15 a +15)

| W/kg | Modificador | Esforço |
|------|:---:|--------|
| > 3.5 | +15 | Esforço máximo — ajuda máxima |
| > 2.5 | +10 | Esforço forte |
| 1.0-2.5 | 0 | Normal |
| < 1.0 | -5 | Passeio |
| < 0.5 | -15 | Quase sem pedalar — poupar |

### 3.7 Altitude (0 a +10)

| Metros | Modificador | Razão |
|--------|:---:|--------|
| > 2500m | +10 | Muito menos O₂ |
| > 2000m | +7 | Menos O₂ |
| > 1500m | +4 | Ligeiramente menos O₂ |
| < 1500m | 0 | Nível do mar — normal |

### 3.8 Antecipação (-15 a +20)

Detecta mudanças de terreno nos próximos 100m.

| Transição | Modificador | Acção |
|-----------|:---:|--------|
| Plano → Subida > 5% | +20 | Pré-activar motor ANTES da subida |
| Subida → Descida | -15 | Reduzir antecipadamente |
| Gradient sobe > 5pp | +15 | Preparar para gradient mais duro |

**Fonte**: Google Elevation API lookahead (300m à frente, heading GPS).
**Timing**: A 15km/h, 100m = ~24s de antecipação. Motor tem ~2s de lag. Resultado: transição suave.

---

## 4. De Factores a Calibração

### 4.1 Cálculo das Intensidades

Cada parâmetro ASMO recebe uma intensidade diferente dos mesmos factores:

```
SUPPORT intensity:
  = terrain_base × weight_factor × battery_mult + hr_mod + preemptive_mod
  - speed_limit_penalty (perto de 25km/h)

TORQUE intensity:
  = terrain_base × battery_mult + cadence_mod + power_mod + altitude_mod
  CAP: se cadência < 50 + gradient > 8% → max 60% (prevenir roda a patinar)

LAUNCH intensity:
  = terrain_base × 0.7 + preemptive_mod
  + slow_on_climb_boost (< 5km/h + gradient > 3% → +25)
  - already_moving_reduction (> 20km/h → -20)
  × battery_mult
```

**A lógica chave**: cada parâmetro responde de forma diferente às condições:
- **Support** é o mais sensível a velocidade e limite motor
- **Torque** é o mais sensível a cadência e W/kg
- **Launch** é o mais sensível a velocidade e terrain transitions

### 4.2 Intensidade → Wire Value

```
Intensidade > 65% → wire 0 (máximo)
Intensidade 35-65% → wire 1 (médio)
Intensidade < 35% → wire 2 (mínimo)
```

### 4.3 Smoothing

Para evitar oscilação, é necessário que o wire value seja estável durante **3 amostras consecutivas** (6 segundos) antes de mudar. Isto previne:
- Flutuação em terrain boundaries
- Reacção a picos momentâneos de HR/power
- Ruído do sensor de cadência

### 4.4 Mid/Low Torque

ASMO3 (mid torque) e ASMO4 (low torque) seguem o ASMO2 (torque) com offset:
```
midTorque = intensityToWire(torque_intensity - 10)
lowTorque = intensityToWire(torque_intensity - 20)
```
Isto cria uma curva de torque progressiva em vez de abrupta.

---

## 5. Cenários Reais

### 5.1 Subida íngreme (12%, 7km/h, FC 155bpm, 65rpm, 220W)

```
Terreno:     12% × 80kg → score 100 × (0.8 + 0.2×80/75) = 100 × 1.013 = 100
Bateria:     75% → ×1.0
Velocidade:  7km/h + gradient 12% → +25 (lento em subida)
FC:          155/163 = 95% max → +20
Cadência:    65rpm → 0 (OK)
W/kg:        220/80 = 2.75 → +10

SUPPORT:  100 × 1.0 + 20 + 0 = 120 → clamped 100 → wire 0 → 360%
TORQUE:   100 × 1.0 + 0 + 10 = 110 → clamped 100 → wire 0 → 300/250/175
LAUNCH:   100 × 0.7 + 0 + 25 = 95 → wire 0 → 100

Motor: S360% T300/250/175 R100 — FULL POWER
```

### 5.2 Subida técnica (10%, 4km/h, 35rpm, 180W)

```
Terreno:     10% → score 85 × weight_factor
Cadência:    35rpm + gradient 10% → +20 (grinding)
TORQUE cap:  cadence < 50 + gradient > 8% → max 60%

SUPPORT:  ~95 → wire 0 → 360%
TORQUE:   capped at 60 → wire 1 → 250/200/150 (prevent spin!)
LAUNCH:   ~80 → wire 0 → 100 (need aggressive start)

Motor: S360% T250/200/150 R100 — max support, controlled torque
```

### 5.3 Plano (0%, 22km/h, FC 110bpm, 85rpm, 100W)

```
Terreno:     0% → score 25
Bateria:     85% → ×1.0
Velocidade:  22km/h (perto do limite 25) → -15
FC:          110/163 = 67% → 0 (endurance zone)
W/kg:        100/80 = 1.25 → 0

SUPPORT:  25 - 15 = 10 → wire 2 → 300%
TORQUE:   25 = 25 → wire 2 → 200/175/125
LAUNCH:   25 × 0.7 - 20 = -2 → wire 2 → 50

Motor: S300% T200/175/125 R50 — MINIMAL (save battery)
```

### 5.4 Bateria baixa em subida (8%, 10km/h, SOC 20%)

```
Terreno:     8% → score 85
Bateria:     20% → ×0.57
Velocidade:  10km/h + gradient 8% → +15

SUPPORT:  85 × 0.57 + 0 = 48 → wire 1 → 350%
TORQUE:   85 × 0.57 + 0 = 48 → wire 1 → 250/200/150
LAUNCH:   85 × 0.7 × 0.57 = 34 → wire 2 → 50

Motor: S350% T250/200/150 R50 — moderate help, save remaining battery
```

### 5.5 Pré-activação (plano, subida de 8% a 80m)

```
Terreno:     plano 0% → score 25
Antecipação: subida 8% em 80m → +20
Speed:       15km/h → 80m em ~19s

SUPPORT:  25 + 20 = 45 → wire 1 → 350% (já a preparar!)
TORQUE:   25 = 25 → wire 2 → 200 (mantém baixo por agora)
LAUNCH:   25 × 0.7 + 20 = 37 → wire 1 → 75 (prepara resposta)

Motor: S350% T200/175/125 R75 — pre-activated before climb arrives
19 segundos depois: gradient real sobe → FULL POWER transition suave
```

---

## 6. Fluxo Real-Time (cada 2 segundos)

```
┌─ useMotorControl hook (App.tsx) ──────────────────────────┐
│                                                            │
│  1. Gate: bike.assist_mode === POWER ?                     │
│     NÃO → setActive(false), return                         │
│     SIM → continua                                         │
│                                                            │
│  2. Gather inputs:                                         │
│     speed ← bikeStore.speed_kmh                            │
│     cadence ← bikeStore.cadence_rpm                        │
│     power ← bikeStore.power_watts                          │
│     hr ← bikeStore.hr_bpm                                  │
│     battery ← bikeStore.battery_percent                    │
│     altitude ← mapStore.altitude                           │
│                                                            │
│  3. Terrain (se GPS activo + autoAssist enabled):          │
│     AutoAssistEngine.tick(lat, lng, heading, speed)        │
│     → gradient ← terrain.current_gradient_pct              │
│     → upcoming ← terrain.next_transition                   │
│                                                            │
│  4. TuningIntelligence.evaluate(input)                     │
│     → supportIntensity, torqueIntensity, launchIntensity   │
│     → calibration: { support, torque, midTorque,           │
│                       lowTorque, launch } (wire values)    │
│     → factors: breakdown para UI                           │
│                                                            │
│  5. Compare com calibração actual                          │
│     Se mudou → encodeCalibration(cal) → 3 bytes            │
│     → setTuning via WebSocket → APK → BLE → Motor         │
│                                                            │
│  6. Update stores (para UI):                               │
│     intelligenceStore ← decision                           │
│     tuningStore ← current calibration                      │
│     autoAssistStore ← terrain viz                          │
│                                                            │
│  Loop: repete em 2 segundos                                │
└────────────────────────────────────────────────────────────┘
```

---

## 7. Comunicação BLE

### 7.1 SET_TUNING (PWA → APK → Motor)

```
PWA envia WebSocket:
  {type: "setTuning", power: 0, sport: 1, active: 1, tour: 2, eco: 0}
  (power=ASMO1, sport=ASMO2, active=ASMO3, tour=ASMO4, eco=ASMO5)

APK (BLEBridgeService) recebe → BLEManager.setTuningLevels(0, 1, 1, 2, 0):
  plaintext[0] = 0x2D (cmd SET_TUNING)
  plaintext[1] = 0x03 (key 3)
  plaintext[2] = (0+1) | ((1+1) << 4) = 0x21
  plaintext[3] = (1+1) | ((2+1) << 4) = 0x32
  plaintext[4] = (0+1) = 0x01
  → AES encrypt com key 3
  → packet: [0xFB, 0x21, encrypted(16), 0x03, CRC]
  → BLE write to SG characteristic 0x0002

Motor responde: [0xFC, 0x21, encrypted → decrypt → 0x2D, 0x01, 0x01, ...] = SUCCESS
```

### 7.2 READ_TUNING (verificação)

```
PWA envia: {type: "readTuning"}
APK: plaintext = [0x2C, 0x00, zeros] → AES key 0

Motor responde: 0x2C, 0x03, byte[2], byte[3], byte[4]
PWA parseia hex: byte[2] → ASMO1 + ASMO2, byte[3] → ASMO3 + ASMO4, byte[4] → ASMO5
```

### 7.3 Auto-restore (segurança)

```
Connect → READ_TUNING → store as originalCalibration
Disconnect / page close / crash → SET_TUNING(originalCalibration)

3 camadas de protecção:
1. WebSocket onDisconnect → autoRestore()
2. window.beforeunload → autoRestore()
3. APK bridge fallback
```

---

## 8. Detecção de Modo

O modo actual do RideControl é lido do FC23 cmd 0x41 byte[7]:

| Wire | Modo | KROMI |
|:---:|--------|--------|
| 0 | MANUAL | Passivo |
| 1 | ECO | Passivo |
| 2 | TOUR | Passivo |
| 3 | ACTIVE | Passivo |
| 4 | SPORT | Passivo |
| 5 | **POWER** | **ACTIVO** |
| 6 | SMART (startup) | Passivo |

O FC23 telemetry requer sessão GEV activa (CONNECT_GEV + enableRiding), enviada automaticamente após BLE subscribe.

---

## 9. Simulação (FIT Import)

O KromiSimulator replica a lógica do TuningIntelligence sobre rides passadas:

1. Importa .FIT → parse records (GPS, HR, speed, cadence, power)
2. enrichWithElevation → Google ElevationService (cache no Supabase)
3. simulateKromi(records) → replica 8 factores ponto a ponto
4. Output: distribuição MAX/MID/MIN, score médio, bateria KROMI vs fixo

**Personalização**: usa rider weight, age, HR max, bike battery/motor specs das Settings.

---

## 10. Dados Persistidos

| Dados | Onde | Quando |
|-------|------|--------|
| Calibração actual | intelligenceStore (RAM) | Cada 2s |
| Original tuning | tuningStore (RAM) | No connect |
| Ride snapshots | Supabase ride_snapshots | Cada 30s (via SyncQueue) |
| Elevation cache | Supabase elevation_cache | No FIT import |
| Settings/bike config | Supabase user_settings | On change (2s debounce) |
| Athlete profile | Supabase athlete_profiles | Post-ride |
| Login history | Supabase login_history | Each session |

---

## 11. Limitações Conhecidas

1. **3 valores por ASMO** — motor aceita wire 0/1/2, não contínuo
2. **2s intervalo** — não reage a mudanças sub-segundo
3. **Smoothing 6s** — leva 3 amostras para mudar (evita oscilação mas atrasa)
4. **GPS dependency** — sem GPS, terreno score = 0 (funciona só com speed/cadence/HR/battery)
5. **Elevation API** — throttled a 3s, cache 30s, max 15 pontos por lookahead
6. **FC21 não funciona** — não podemos ler riding data do motor directamente
7. **ASSIST UP/DOWN bloqueado** — não podemos mudar o modo, só o tuning dentro do modo

---

## 12. Ficheiros Chave

```
src/services/motor/TuningIntelligence.ts  — O cérebro (8 factores → 5 ASMOs)
src/types/tuning.types.ts                 — Modelo ASMO, DU7 tables, encode/decode
src/hooks/useMotorControl.ts              — Loop 2s, gate POWER mode, executa
src/store/intelligenceStore.ts            — Estado para UI
src/store/tuningStore.ts                  — Calibração actual + original
src/services/simulation/KromiSimulator.ts — Replica intelligence sobre FIT imports
src/components/Dashboard/IntelligenceWidget.tsx — 3 barras + factores
src/components/Dashboard/TuningWidget.tsx — Override manual (MAX/MIN/RESTORE)
src/services/bluetooth/WebSocketBLEClient.ts — Comunicação WS + parse responses
src/services/bluetooth/BLEBridge.ts       — Facade setTuning/readTuning
```
