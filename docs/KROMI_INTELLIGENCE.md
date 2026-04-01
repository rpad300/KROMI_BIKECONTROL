# KROMI Intelligence — HR Zone Regulated Motor Calibration

## Version: v0.6.0-b34 reviewed (2026-04-01)

---

## 1. Princípio

O KROMI é um **regulador de zona cardíaca**. O motor mantém o rider na zona HR escolhida. Não reage ao terreno — antecipa-o.

**Arquitectura layered (não aditiva)**:
```
intensity = clamp(hrTarget + anticipationBias + speedLimitPenalty + altitudeBoost, 0, 100) × batteryConstraint
```

**Auxiliary modifiers** (small, situational):
- Speed near limit (>23km/h): -25 (motor cuts at 25, assist inútil)
- Stopped (<2km/h): -20 (save battery)
- Altitude >1500m: +4 to +10 (less O₂)

**Nota sobre speed limit**: o penalty de -25 só altera o wire value outcome quando hrTarget < 87. Se hrTarget=100 e penalty=-25, intensity=75 → ainda wire 0. O penalty é relevante principalmente quando HR está dentro ou ligeiramente acima da zona.

| Layer | Função | Range | Papel |
|-------|--------|-------|-------|
| **HR Target** | Define intensidade base | 0-100 | PRIMARY — regula |
| **Terrain Anticipation** | Ajusta timing | -20 a +25 | SECONDARY — antecipa |
| **Battery Constraint** | Hard cap no output | ×0.4-1.0 | TERTIARY — constrange |

**Porquê layered e não aditivo**: num modelo aditivo, terreno (0-100) dominava HR (+20 max). Um rider relaxado em subida recebia mais assist que um rider a sofrer no plano. Isso contradiz o princípio de regulação HR. No modelo layered, HR define o target e terreno apenas ajusta o timing.

### Quando está activo
- **Apenas em POWER mode** — rider controla via RideControl físico no guiador
- Nos outros modos (MANUAL, ECO, TOUR, ACTIVE, SPORT, SMART) o KROMI é passivo
- Mostra telemetria em todos os modos, só envia SET_TUNING em POWER

### Loop
- Executa a cada **2 segundos** via `useMotorControl` hook
- Lê: HR, speed, cadence, power, battery, GPS, elevation
- Calcula: 5 ASMO intensities independentes
- Envia: SET_TUNING (cmd 0x2D) se calibração mudou

---

## 2. Motor — 5 Parâmetros ASMO

Decompilado do RideControl APK v1.33 (`TuningData.java`).
Motor DU7 (SyncDrive Pro). Cada ASMO aceita wire values 0, 1, 2.
Total: 3^5 = **243 combinações**.

| ASMO | Parâmetro | Wire 0 (max) | Wire 1 (mid) | Wire 2 (min) | Função |
|------|-----------|:---:|:---:|:---:|--------|
| 1 | **Support %** | 360% | 350% | 300% | Multiplicador do input do rider |
| 2 | **Torque** | 300 | 250 | 200 | Torque high-range |
| 3 | **Mid Torque** | 250 | 200 | 175 | Torque mid-range |
| 4 | **Low Torque** | 175 | 150 | 125 | Torque low-range |
| 5 | **Launch** | 100 | 75 | 50 | Agressividade de resposta |

### SET_TUNING Encoding (cmd 0x2D, key 3)
```
plaintext[0] = 0x2D (command)
plaintext[1] = 0x03 (key)
plaintext[2] = (ASMO1_wire + 1) | ((ASMO2_wire + 1) << 4)
plaintext[3] = (ASMO3_wire + 1) | ((ASMO4_wire + 1) << 4)
plaintext[4] = (ASMO5_wire + 1)
plaintext[5..15] = zeros

→ AES encrypt com key 3
→ packet: [0xFB, 0x21, encrypted(16), keyIdx=0x03, CRC]
→ BLE write to SG char 0x0002
→ Motor responde: [2D, 01, 01, zeros] = SUCCESS
```

### Per-ASMO Intensity (não um único valor)
Cada ASMO recebe intensidade independente:

| ASMO | Calcula de | Particularidades |
|------|-----------|------------------|
| **Support** | overallIntensity directo | Segue HR target fielmente |
| **Torque** | overallIntensity | **Safety cap**: cadência<50 + gradient>8% → max 55% (previne roda a patinar) |
| **Mid Torque** | torqueI - 10 | Progressive: ligeiramente menos que main torque |
| **Low Torque** | torqueI - 20 | Progressive: ainda menos (curva suave) |
| **Launch** | (overallIntensity × 0.7) then +25/-15 | Multiply first, then add boosts. Ex: 100×0.7=70, +25=95 |

### Wire Thresholds
```
intensity > 62 → wire 0 (máximo)
intensity 38-62 → wire 1 (médio)
intensity < 38 → wire 2 (mínimo)
```
**Margem de 2**: in-zone HR produz 40-60, que fica seguramente dentro de wire 1 (38-62). Evita flip de wire por ruído de 1bpm na fronteira.

---

## 3. LAYER 1 — HR Zone Target (PRIMARY)

### Zonas HR
Auto-calculadas do HR max observado. Rider escolhe zona alvo nas Settings.

| Zona | % HRmax | Para HRmax 163 | Descrição |
|------|---------|:---:|-----------|
| Z1 Recovery | 50-60% | 82-98 bpm | Recuperação activa |
| **Z2 Endurance** | **60-70%** | **98-114 bpm** | **Base aeróbica (default)** |
| Z3 Tempo | 70-80% | 114-130 bpm | Ritmo moderado |
| Z4 Threshold | 80-90% | 130-147 bpm | Limiar anaeróbico |
| Z5 VO2max | 90-100% | 147-163 bpm | Esforço máximo |

### Fórmula HR → Target Intensity

A função é **contínua** — sem saltos nas fronteiras da zona:

```
HR abaixo da zona (rider confortável, motor pode reduzir):
  hrTarget = 40 - (bpm_abaixo × 5), min 0
  Começa em 40 (= fundo da in-zone range), desce 5 por bpm

HR dentro da zona (manter — fine-tune pela posição):
  hrTarget = 40 + (posição_na_zona × 20)
  Range: 40-60
  posição = (HR - zona_min) / (zona_max - zona_min)

HR acima da zona (rider a esforçar-se, motor deve ajudar):
  hrTarget = 60 + (bpm_acima × 8), cap 100
  Começa em 60 (= topo da in-zone range), sobe 8 por bpm
```

**Visualização da função contínua**:
```
hrTarget
100 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╱ cap
 80                               ╱
 60 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╱───  ← topo da zona
 50                        ╱        ← meio da zona
 40 ─ ─ ─ ─ ─ ─ ─ ─ ───╱          ← fundo da zona
 20              ╱ ─ ─
  0 ─ ─ ─ ─ ╱                      ← muito abaixo
    ──────|──────|──────|──────────── HR (bpm)
        -10    min    max    +5
              zona alvo
```

**Assimetria deliberada**: +8/bpm acima vs -5/bpm abaixo. O motor é mais agressivo a ajudar (HR acima da zona é mais urgente que HR abaixo).

### Exemplos concretos (Z2 target, 98-114bpm)

| HR | Situação | hrTarget | Wire |
|:---:|----------|:---:|:---:|
| 80 bpm | 18 abaixo | 40-(18×5)=0 | wire 2 (MIN) |
| 90 bpm | 8 abaixo | 40-(8×5)=0 | wire 2 |
| 98 bpm | Fundo Z2 | 40+(0×20)=40 | wire 1 (MID) |
| 106 bpm | Meio Z2 | 40+(0.5×20)=50 | wire 1 |
| 114 bpm | Topo Z2 | 40+(1.0×20)=60 | wire 1 |
| 117 bpm | 3 acima | 60+(3×8)=84 | wire 0 (MAX) |
| 125 bpm | 11 acima | 60+(11×8)=100 | wire 0 |
| 140 bpm | 26 acima | cap 100 | wire 0 |

### Auto-calibração HRmax
Cada FIT import detecta o HR peak. Se superior ao HRmax configurado, actualiza automaticamente o perfil. Previne zonas erradas da fórmula 220-idade (pode ter 10-15bpm de erro).

### HR Dropout (sensor desliga a meio da ride)
Se HR era válido há <10 segundos, mantém último comportamento com aviso "HR sensor dropout" na UI. Se >10s, transita para terrain proxy com aviso claro.

### Sem HR Sensor (fallback degradado)
Sem sensor, terreno serve como proxy:
```
gradient > 12% → hrTarget 85
gradient > 8%  → 72
gradient > 5%  → 60
gradient > 3%  → 48
gradient > 1%  → 38
plano          → 25
descida        → 10
+ ajuste peso: ×(0.8 + 0.2 × peso/75) em gradientes > 2%
```
Claramente marcado no UI: "Sem HR — estimativa por terreno".

---

## 4. LAYER 2 — Terrain Anticipation (SECONDARY)

O terreno **não define magnitude** — define **timing**. Antecipa mudanças futuras de HR.

### Anticipation = currentGradientBias + transitionBias + weightBias

Três sub-componentes, somados e capped a [-20, +40]:

**Sub 1: Current gradient bias (0 a +15)**
O gradiente actual indica esforço contínuo, mesmo sem transição à frente.

| Gradiente actual | Bias | Razão |
|:---:|:---:|--------|
| > 8% | +15 | Subida forte — HR vai continuar alto |
| > 5% | +10 | Subida moderada |
| > 3% | +5 | Subida suave |
| < -5% | -10 | Descida — HR vai baixar |

**Sub 2: Transition bias (lookahead, -15 a +25)**

| Transição detectada | Bias | Razão |
|-----------|:---:|--------|
| Plano → Subida > 5% (dentro do lookahead) | +25 | Pre-boost ANTES do HR subir |
| Subida → Descida (dentro do lookahead) | -15 | Pre-reduce ANTES do HR baixar |

**Sub 3: Weight bias (com HR, 0 a +10)**

| Condição | Bias | Razão |
|----------|:---:|--------|
| Peso > 75kg em gradient > 8% | +3 per 10kg | Riders pesados precisam mais |

### Lookahead Dinâmico (baseado em velocidade)
```
> 10 km/h: 100m   (estrada/trail rápido — heading GPS fiável)
5-10 km/h:  60m   (trail técnico — heading menos fiável)
< 5 km/h:   30m   (subida lenta/singletrack — heading impreciso)
```

**Porquê dinâmico**: a 5km/h em singletrack, o heading GPS pode apontar para uma descida quando o trail sobe (viragens apertadas). Lookahead curto minimiza este risco.

### Risco de Cascata (mitigado)
```
SEM lookahead dinâmico:
  GPS errado → antecipa descida → HR cai → sistema reduz → rider perde assist na subida

COM lookahead dinâmico a 30m:
  GPS errado → antecipação limitada a 30m → efeito mínimo → HR continua a regular
```

### Edge cases não cobertos (documentados)
- **Heading variance**: a 8km/h numa estrada recta vs singletrack com 180° — mesmo lookahead (60m). Futuro: usar variância do heading nos últimos 10-15s.
- **Descida técnica**: HR pode estar alto por esforço upper body. Sistema reduz assist prematuramente. Futuro: combinar com acelerómetro/inclinação.

---

## 5. LAYER 3 — Battery Constraint (TERTIARY)

A bateria **não contribui para o score**. É um **hard constraint** que caps o output.

### Fórmula (linear explícita, com ajuste por capacidade)
```typescript
// Lacuna 6: capacidade ajusta thresholds
const capacityFactor = min(totalWh / 1050, 1.2);
const conserveAt = 30 * capacityFactor;   // ~30% para 1050Wh, ~36% para 500Wh
const emergencyAt = 15 * capacityFactor;  // ~15% para 1050Wh, ~18% para 500Wh

// Lacuna 5: interpolação explicitamente linear
if (soc > 60%)        return 1.0;                                           // sem restrição
if (soc > conserveAt) return 0.7 + (soc - conserveAt)/(60 - conserveAt) × 0.3;   // linear 0.7→1.0
if (soc > emergencyAt) return 0.5 + (soc - emergencyAt)/(conserveAt - emergencyAt) × 0.2; // linear 0.5→0.7
return 0.4;                                                                  // emergência
```

**Baterias maiores conservam mais tarde**: 1050Wh começa a conservar a 30%, 500Wh a 36%.

| SOC (1050Wh) | Multiplicador | Efeito no motor |
|:---:|:---:|--------|
| > 60% | ×1.0 | Sem restrição |
| 45% | ×0.85 | Ligeira conservação |
| 30% | ×0.7 | Conservação activa |
| 20% | ×0.57 | Economia forte |
| 15% | ×0.5 | Limite |
| < 15% | ×0.4 | Emergência |

---

## 6. Smoothing Assimétrico

Um regulador que demora 6s a proteger um rider em esforço excessivo **não está a regular**.

### Nomenclatura: pela experiência do rider

| Situação | Amostras | Tempo | Acção |
|----------|:---:|:---:|--------|
| **HR acima da zona** (motor SOBE assist) | 1 | 2s | Urgente — ajudar JÁ |
| **HR abaixo da zona** (motor DESCE assist) | 3 | 6s | Gradual — evitar perda súbita |
| **Sem HR** (proxy por terreno) | 2 | 4s | Moderado |

### Dwell Time (previne cycling)

**Problema**: HR sobe → motor vai a MAX → HR baixa → motor reduz → HR sobe → MAX → ciclo infinito.

**Solução**: após um evento "HR acima da zona", o motor mantém a calibração actual durante **15 segundos** antes de permitir redução. Isto dá tempo ao HR para estabilizar.

```
t=0s:  HR 130bpm (acima Z2) → motor sobe a MAX → 1 amostra
t=2s:  HR 125bpm (ainda acima) → mantém MAX
t=6s:  HR 112bpm (dentro Z2) → motor quer descer → BLOQUEADO (dwell 15s)
t=10s: HR 108bpm → quer descer → BLOQUEADO
t=15s: dwell expira → motor pode descer
t=17s: HR 105bpm → 1ª amostra para descer
t=19s: HR 103bpm → 2ª amostra
t=21s: HR 100bpm → 3ª amostra → DESCE para MID
```

### Dwell Override
Se o rider parar de pedalar (cadência=0 + speed<3km/h), o dwell cancela imediatamente. Motor em MAX sem rider a pedalar é desperdício de bateria.

---

## 7. Cenários Reais (recalculados com fórmulas corrigidas)

### 7.1 Subida com HR controlada
Z2 target (98-114), HR 112bpm, gradient 6%
```
HR: 112 está dentro de Z2
posição = (112-98)/(114-98) = 14/16 = 0.875
hrTarget = 40 + (0.875 × 20) = 57.5 ≈ 58

Anticipation: currentGradient 6% → +10, no transition → +0 = +10
Battery: 90% → ×1.0

intensity = clamp(58 + 10, 0, 100) × 1.0 = 68

Support: 68 → wire 0 (>62)      → S360%
Torque:  68 → wire 0             → T300
MidTorq: 68-10=58 → wire 1      → M200
LowTorq: 68-20=48 → wire 1      → L150
Launch:  68 × 0.7 = 48 → wire 1 → R75 (deliberado: mid-climb não precisa de launch agressivo)

Motor: S360% T300/200/150 R75
Explicação UI: "A manter Z2 — HR controlada ✓"
```
**Nota**: Support MAX porque HR está no topo da zona em subida — sem MAX, HR subiria. Launch em wire 1 (R75) é deliberado: a meio de uma subida o rider já tem momentum, não precisa de launch agressivo. Se fosse arranque de parado, Launch seria MAX.

### 7.2 Subida com HR alta
Z2 target (98-114), HR 135bpm (21 acima), gradient 10%
```
hrTarget = 60 + (21 × 8) = 228 → cap 100

Anticipation: currentGradient 10% (>8%) → +15
Battery: ×1.0

intensity = clamp(100 + 15, 0, 100) × 1.0 = 100 → wire 0

Support:  100 → wire 0 → S360%
Torque:   100 → wire 0 → T300
MidTorq:  90  → wire 0 → M250
LowTorq:  80  → wire 0 → L175
Launch:   100 × 0.7 = 70 → wire 0 → R100

Motor: S360% T300/250/175 R100 → ALL MAX
Smoothing: HR_ABOVE = 1 amostra → IMEDIATO
Explicação UI: "Motor a ajudar — HR 21bpm acima de Z2"
```

### 7.3 Plano com HR baixa
Z2 target, HR 85bpm (13 abaixo), plano
```
hrTarget = 40 - (13 × 5) = -25 → cap 0

Anticipation: 0 (plano)
Battery: ×1.0

intensity = 0 → wire 2 → S300% T200/175/125 R50

Smoothing: HR_BELOW = 3 amostras → 6s gradual
Explicação UI: "Motor reduzido — HR 13bpm abaixo de Z2, podes mais"
```

### 7.4 PLANO com HR ALTA (o cenário que diferencia o regulador)
Z2 target, HR 130bpm (16 acima), gradient 0%
```
hrTarget = 60 + (16 × 8) = 188 → cap 100

Anticipation: 0 (plano!)
Battery: ×1.0

intensity = 100 → wire 0 → S360% T300 R100 → MAX NO PLANO

Explicação UI: "Motor MAX — HR 16bpm acima de Z2, a proteger"
```
**Este é O cenário**: ANTES o terreno mandava (plano=25→MIN). AGORA o HR manda (alto=100→MAX). O rider precisa de ajuda e recebe-a, independentemente do terreno.

### 7.5 Subida com HR confortável
Z2 target (98-114), HR 100bpm (2 dentro da zona, fundo), gradient 12%, rider 85kg
```
posição = (100-98)/(114-98) = 2/16 = 0.125
hrTarget = 40 + (0.125 × 20) = 42.5 ≈ 43

Anticipation: currentGradient 12% → +15
             + weightBias 85kg grad>8% → +3
             = +18
Battery: ×1.0

intensity = clamp(43 + 18, 0, 100) = 61

Support:  61 → wire 1 (38-62) → S350%
Torque:   61 → wire 1          → T250
MidTorq:  61-10=51 → wire 1    → M200
LowTorq:  61-20=41 → wire 1    → L150
Launch:   61 × 0.7 = 43 → wire 1 → R75

Motor: S350% T250/200/150 R75 → MID
Explicação UI: "A manter Z2 — HR controlada ✓"
```
**ANTES**: subida 12% = score 100 = MAX sempre. **AGORA**: HR a 100bpm em subida de 12% significa que a condição física do rider aguenta esta subida com MID. O motor em MID é suficiente para manter Z2. Se o HR começar a subir, o motor responde em 2s (1 amostra). **Resultado**: mesma performance, menos bateria gasta.

### 7.6 Bateria baixa em subida com HR alta
Z2 target, HR 140bpm (26 acima), gradient 8%, SOC 20%
```
hrTarget = 100 (cap)
Anticipation: +15
Battery: SOC 20% → ×0.57

intensity = clamp(115, 0, 100) × 0.57 = 57

Support:  57 → wire 1     → S350% (not MAX — battery limiting)
Torque:   57 → wire 1     → T250
MidTorq:  57-10=47 → wire 1 → M200
LowTorq:  57-20=37 → wire 2 → L125 (below 38 threshold)
Launch:   57 × 0.7 = 40 → wire 1 → R75

Motor: S350% T250/200/125 R75 (LowTorque wire 2 because 37 < 38)
Explicação UI: "Motor limitado pela bateria — HR 26bpm acima de Z2 (SOC 20%)"
```

**Nota**: o sistema QUER dar MAX (hrTarget=100) mas a bateria LIMITA a MID (×0.57→57). A UI comunica o que o motor ESTÁ a fazer, não o que queria fazer. LowTorque cai para wire 2 (125) porque 37 está 1 ponto abaixo do threshold 38.

### 7.7 Subida técnica com cadência baixa
Z2 target, HR 120bpm (6 acima), gradient 10%, cadência 40rpm
```
hrTarget = 60 + (6 × 8) = 108 → cap 100
intensity = 100

Support: 100 → wire 0 → S360%
Torque: 100 → CAP por cadência<50 + gradient>8% → max 55 → wire 1 → T250 (not 300!)
MidTorque: 55-10=45 → wire 1 → M200
LowTorque: 55-20=35 → wire 2 → L125
Launch: 100 × 0.7 = 70 → wire 0 → R100

Motor: S360% T250/200/125 R100
Explicação UI: "Motor MAX — HR 6bpm acima de Z2" + "Torque cap — Cadência 40rpm em 10%"
```
**Safety feature**: max support mas torque limitado para não patinar a roda em subida técnica com cadência baixa.

---

## 8. Comparação: Terrain-Reactive vs HR-Regulated

| Cenário | ANTES (terreno) | DEPOIS (HR zone) | Porquê |
|---------|:---:|:---:|--------|
| Subida 12%, HR 100bpm (Z2 ok) | 100 → MAX | 61 → MID | HR ok, MID basta. Poupa bateria |
| Plano 0%, HR 135bpm (acima Z2) | 25 → MIN | 100 → MAX | HR alta, rider precisa de ajuda |
| Subida 5%, HR 80bpm (abaixo Z2) | 70 → MAX | 0 → MIN | HR baixa, rider aguenta |
| Pré-subida, HR 110bpm (Z2 ok) | 25+20=45 → MID | 55+25=80 → MAX | Antecipa subida |
| Subida técnica, cad 40rpm | 85 → MAX torque | 100 support, 55 torque | Safety: torque limitado |

**A diferença fundamental**: o motor agora serve o rider, não o terreno.

---

## 9. Comunicação BLE

### SET_TUNING (PWA → APK → Motor)
```
PWA WebSocket: {type:"setTuning", power:0, sport:1, active:1, tour:2, eco:0}
  power  = ASMO1 (Support) wire value
  sport  = ASMO2 (Torque)
  active = ASMO3 (MidTorque)
  tour   = ASMO4 (LowTorque)
  eco    = ASMO5 (Launch)

APK: BLEManager.setTuningLevels(0, 1, 1, 2, 0)
  → AES encrypt, BLE write → Motor aplica imediatamente
```

### READ_TUNING (verificação)
```
Response hex: 2c03XXYYZZ
  byte[2] = (ASMO1+1) | ((ASMO2+1) << 4)
  byte[3] = (ASMO3+1) | ((ASMO4+1) << 4)
  byte[4] = (ASMO5+1)
```

### Auto-Restore Safety (3 camadas)
```
Connect → READ_TUNING → store originalCalibration
Layer 1: WebSocket onDisconnect → SET_TUNING(original)
Layer 2: window.beforeunload → SET_TUNING(original)
Layer 3: APK bridge fallback
```

---

## 10. Mode Detection

FC23 cmd 0x41 byte[7]:

| Wire | Modo | KROMI |
|:---:|--------|--------|
| 0 | MANUAL | Passivo |
| 1 | ECO | Passivo |
| 2 | TOUR | Passivo |
| 3 | ACTIVE | Passivo |
| 4 | SPORT | Passivo |
| 5 | **POWER** | **ACTIVO** |
| 6 | SMART (startup) | Passivo |

Requer sessão GEV (CONNECT_GEV + enableRiding), auto-enviada após BLE subscribe.

---

## 11. Simulação (FIT Import)

O KromiSimulator replica a lógica HR-zone sobre rides passadas:
1. Parseia FIT → GPS + HR + speed + cadence
2. Enriquece com Google Elevation API (cached no Supabase)
3. Aplica mesma fórmula: hrTarget + anticipation × battery
4. 3-way battery comparison: KROMI vs config fixa do rider vs sempre MAX
5. Resultados persistidos em `ride_sessions.devices_connected.kromi_simulation`

### Auto-calibração HRmax
Cada FIT com HR peak > HRmax configurado → actualiza perfil automaticamente.

---

## 12. UI — IntelligenceWidget

O widget explica **porquê**, não só mostra barras:
```
"Motor MAX — HR 16bpm acima de Z2, a proteger"          ← vermelho
"Motor reduzido — HR 13bpm abaixo de Z2, podes mais"    ← azul
"A manter Z2 — HR controlada ✓"                          ← verde
"Sem sensor HR — a estimar pelo terreno"                  ← cinza
"HR sensor dropout — a usar último estado"                ← amarelo
```

3 barras de intensidade (Support, Torque, Launch) + factor breakdown.

---

## 13. Ficheiros

```
src/services/motor/TuningIntelligence.ts   — HR zone regulator (layered, reviewed)
src/types/tuning.types.ts                  — ASMO model, DU7 tables, encode/decode
src/types/athlete.types.ts                 — HR zones, calculateZones(), getTargetZone()
src/hooks/useMotorControl.ts               — 2s loop, POWER gate
src/store/intelligenceStore.ts             — State for UI
src/services/simulation/KromiSimulator.ts  — HR-zone replay over FIT imports
src/components/Dashboard/IntelligenceWidget.tsx — Explains decisions
```

---

## 14. Limitações Conhecidas

1. **3 wire values por ASMO** — motor aceita 0/1/2, não contínuo
2. **Sem HR sensor**: terreno como proxy degradado (menos preciso, marcado no UI)
3. **GPS heading em singletrack**: mitigado por lookahead dinâmico (30m a <5km/h). Futuro: heading variance.
4. **ASMO consumo estimado**: precisa calibração com rides reais
5. **2s intervalo**: não reage sub-segundo. HR above zone → 1 amostra = 2s (aceitável)
6. **HRmax 220-idade**: pode ter 10-15bpm erro. Auto-calibração via FIT imports resolve progressivamente
7. **Z2 em trail técnico**: HR cronicamente acima → motor cronicamente MAX. É correcto mas UI deve explicar porquê
8. **Descida técnica**: HR pode estar alto por upper body. Sistema reduz assist. Futuro: acelerómetro
9. **HR inertia**: 30-60s de lag natural. Dwell time de 15s mitiga cycling, mas não elimina completamente
