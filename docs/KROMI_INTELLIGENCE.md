# KROMI Intelligence — Continuous HR Zone Regulator

## Version: v0.7.9 session 3 (2026-04-02)

---

## 1. Princípio

O KROMI é um **regulador de zona cardíaca calibrado pelo motor**. O motor mantém o rider na zona HR escolhida. Usa dados do motor, terreno, weather e aprendizagem adaptativa.

**Arquitectura 5-layer**:
```
intensity = clamp(
  hrTarget              ← Layer 1: HR zone (20-42 in-zone, conservative)
  + anticipation        ← Layer 2: 6 sub-components × comfort scaling
  + contextPenalty      ← Layer 3: downhill/speed override
  + learnedAdj          ← Layer 4: adaptive learning from overrides
  + envAdj              ← Layer 5: terrain (OSM) + weather (Google)
  + stoppedPenalty + altitudeBoost
, 0, 100) × batteryConstraint × coldBatteryMod
```

**Novidades session 3 (v0.7.9)**:
- Consumo calibrado pelo motor (cmd 17): ECO≈3.2, POWER≈6.1 Wh/km (eram 6/35 hardcoded)
- Battery constraint baseado em range real do motor (km), não % SOC
- Polling cada 2min — motor recalcula range com condições actuais
- Terrain awareness (OSM Overpass): dirt +4, technical +8, torque ×0.8
- Weather awareness (Google): vento, calor, frio → ajuste automático
- Dual battery SOC individual: cmd 0x43 byte[4]=bat1, byte[5]=bat2
- Battery details: firmware, cycles, health via GEV cmd 13-57
- Auto-calibração: motor range → consumption Wh/km → settingsStore
- Physics model com rolling resistance por superfície (Crr 0.004-0.018)
- HR sensor: auto-connect via SensorManager (GATT independente)
- BikeProfileSync: hardware data auto-saved to Supabase

**Anteriores (session 2)**:
- HR Target conservador: 20-42 em zona (era 40-60)
- Context override: descida e velocidade crescente reduzem assist
- EMA smoothing (alpha 0.15) + hold time 15s
- ASMO values interpolados do score contínuo (não 3 presets)
- Adaptive learning: overrides por contexto (gradient×HR zone)

**Auxiliary modifiers** (outside anticipation):
- Stopped (<2km/h): -20 (save battery)
- Altitude >1500m: +4 to +10 (less O₂)

**Speed is NOT auxiliary** — it's Sub-component 6 in anticipation (predictive, not binary).

**Porquê watts, cadência e velocidade no anticipation**: o HR tem 30-60s de lag. Estes 3 são sinais imediatos do esforço que o HR vai confirmar depois. Sem eles, o sistema só reage quando o HR já subiu — tarde demais para prevenir.

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

### Fórmula HR → Target Intensity (v2 — Conservative Regulator)

Filosofia: motor ajusta **gradualmente** para **manter** HR na zona. Se rider confortavel, motor dá pouco. Se HR sobe, motor sobe proporcionalmente.

```
HR abaixo da zona (rider comfortable, minimal assist):
  hrTarget = 20 - (bpm_abaixo × 2), min 0

HR dentro da zona (regulate: low at bottom, rising toward top):
  hrTarget = 20 + (posição_na_zona × 22)
  Range: 20-42

HR acima da zona (gradual ramp, NOT aggressive):
  hrTarget = 42 + (bpm_acima × 2), cap 100
```

**Visualização**:
```
hrTarget
100 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╱ cap
 80                               ╱
 62 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╱     threshold MAX
 42 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╱──       ← topo da zona
 38 ─ ─ ─ ─ ─ ─ ─ ─ ─ ╱           threshold MID
 30                  ╱              ← meio da zona
 20 ─ ─ ─ ─ ─ ─ ╱──               ← fundo da zona → MIN
 10        ╱ ─ ─
  0 ─ ╱                            ← muito abaixo
    ──────|──────|──────|──────────── HR (bpm)
        -10    min    max    +10
              zona alvo
```

**Diferença v1→v2**: v1 dava hrTarget 40-60 em zona (MID sempre). v2 dá 20-42 (MIN→MID transição). O motor só sobe quando realmente precisa.

### Exemplos concretos (Z2 target, 111-130bpm, HRmax 185)

| HR | Situação | hrTarget | Score zone |
|:---:|----------|:---:|:---:|
| 90 bpm | 21 abaixo | 0 | MIN |
| 105 bpm | 6 abaixo | 8 | MIN |
| 111 bpm | Fundo Z2 | 20 | MIN |
| 120 bpm | Meio Z2 | 31 | MIN |
| 128 bpm | Topo Z2 | 40 | MID (borderline) |
| 135 bpm | 5 acima | 52 | MID |
| 145 bpm | 15 acima | 72 | MAX |
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

### Anticipation = terrainBias + transitionBias + weightBias + powerBias + cadenceTrendBias + speedBias

Seis sub-componentes. **Scaled by rider comfort** then hard capped [-20, +35].

### Anticipation Scaling (previne anticipation dominar HR)

O anticipation raw pode somar +85 no pior caso (todos os sub-components ao máximo). Isso inverteria a hierarquia: o secundário dominaria o primário.

**Solução**: escalar o anticipation pela posição do rider na zona HR.

```typescript
const zonePosition = (hr - zoneMin) / (zoneMax - zoneMin)  // 0 a 1
const anticipationScale = 0.3 + (zonePosition × 0.7)       // 0.3 a 1.0

anticipation = rawAnticipation × anticipationScale  // then cap [-20, +35]
```

| Posição HR | Scale | Efeito | Razão |
|:---:|:---:|--------|--------|
| Abaixo da zona | ×0.3 | Anticipation quase mudo | Rider confortável, HR manda |
| Fundo da zona | ×0.3 | Quase mudo | Confortável |
| Meio da zona | ×0.65 | Parcial | A aproximar-se do limite |
| Topo da zona | ×1.0 | Total | Perto do spike, anticipation ajuda |
| Acima da zona | ×1.0 | Total | Urgente, tudo conta |

**O pior caso recalculado**:
```
hrTarget = 40 (fundo da zona, confortável)
rawAnticipation = +85 (tudo ao máximo)
anticipationScale = 0.3 (fundo da zona)
scaledAnticipation = 85 × 0.3 = 25.5 → cap 35 → final 26

intensity = clamp(40 + 26) = 66 → wire 0 (borderline MAX)

SEM scaling: intensity = 100 → wire 0 (MAX total)
COM scaling: intensity = 66 → wire 0 (borderline, noise pode flip)
```

Muito melhor: o rider confortável na zona recebe assist moderado-alto em vez de MAX total. O HR continua a regular.

O HR tem 30-60s de lag. Watts e cadência são **sinais imediatos** do esforço que o HR vai reflectir em breve. A anticipation não é só terreno — é **effort anticipation** completa.

**Sub 1: Current gradient bias (0 a +15)**

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

**Sub 4: Power anticipation (watts = effort imediato, -10 a +15)**

Watts é o sinal mais directo de esforço. Cobre situações que o terreno não detecta: headwind, sprint, passagens técnicas no plano.

| W/kg | Bias | Razão |
|:---:|:---:|--------|
| > 3.0 | +15 | Esforço alto — HR vai subir em 30-60s |
| > 2.0 | +8 | Esforço moderado — HR a subir |
| < 0.8 | -10 | Quase sem esforço — HR vai baixar |

**Exemplo**: rider num plano com headwind a 260W (3.25 W/kg):
- Terrain anticipation: 0 (plano)
- Power anticipation: +15 (esforço alto)
- Sistema antecipa HR spike antes de acontecer

**Sub 5: Cadence trend bias (queda de cadência = fadiga, 0 a +10)**

Se a cadência caiu >15rpm nos últimos 10s, o rider está a perder ritmo. É um sinal de fadiga — o HR vai subir.

| Condição | Bias | Razão |
|----------|:---:|--------|
| Cadência caiu >15rpm em 10s (e era >55rpm) | +10 | Fadiga real — HR vai subir |

**Exemplo**: cadência cai de 75 para 55rpm em 10s numa subida → +10 bias → motor antecipa antes do HR confirmar.

**Floor >55rpm**: abaixo de 55rpm o rider já está em grinding extremo. Uma queda de 42→26rpm não acrescenta informação — o sistema já sabe pelo HR ou pelo terrain. O floor de 55 filtra ruído de singletrack técnico onde cadência é naturalmente errática.

**Sub 6: Speed context (predictive, -25 a +10)**

A velocidade no contexto do terreno prediz esforço futuro. Substituiu o penalty binário de -25.

| Condição | Bias | Razão |
|----------|:---:|--------|
| speed < 8km/h + gradient > 5% (e speed > 2) | max(0, 10 - terrainBias) | Só contribui o que terrainBias não capturou |
| speed caiu > 3km/h em 10s + gradient > 3% (era > 5km/h) | +8 | A perder força em subida = fadiga |
| speed (limit-5) a limit km/h | 0 a -25 (linear) | Curva gradual até ao corte do motor |

**Anti-overlap**: o speedBias climb usa `max(0, 10 - terrainBias)`. Se o terrainBias já deu +15 (gradient >8%), o speedBias climb = 0. Se terrainBias é +5 (gradient 3-5%), speedBias = 5. Previne dupla contagem do mesmo fenómeno.

**Speed limit dinâmico**: usa `bikeConfig.speed_limit_kmh` (default 25). Penalty inicia 5km/h antes do limite. Para mercados com limites diferentes (US: 32km/h), o valor ajusta automaticamente.

**Exemplo**: a 22km/h (limite 25km/h):
```
speedPenaltyStart = 25 - 5 = 20
progress = (22-20)/(25-20) = 0.4
speedPenalty = -round(0.4 × 25) = -10
```

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
Z2 target (98-114), HR 112bpm, gradient 6%, speed 14km/h, 150W, cadência 72rpm estável
```
HR: 112 está dentro de Z2
posição = (112-98)/(114-98) = 14/16 = 0.875
hrTarget = 40 + (0.875 × 20) = 57.5 ≈ 58

Anticipation:
  terrainBias:       6% → +10
  transitionBias:    0
  weightBias:        0
  powerBias:         150/80=1.9 W/kg → 0
  cadenceTrendBias:  0 (estável)
  speedBias:         14km/h (>8) → 0
  Total: +10
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
Z2 target (98-114), HR 135bpm (21 acima), gradient 10%, speed 7km/h, 220W, cadência 55rpm
```
hrTarget = 60 + (21 × 8) = 228 → cap 100

Anticipation:
  terrainBias:       10% → +15
  speedBias climb:   7km/h<8 + grad>5% → max(0, 10-15) = 0 (terrain já capturou)
  powerBias:         220/80=2.75 → +8
  cadenceTrendBias:  0 (estável)
  Total: +23
Battery: ×1.0

intensity = clamp(100 + 23, 0, 100) × 1.0 = 100 → wire 0 (clamped)

Support:  100 → wire 0 → S360%
Torque:   100 → wire 0 → T300
MidTorq:  90  → wire 0 → M250
LowTorq:  80  → wire 0 → L175
Launch:   100 × 0.7 = 70 → wire 0 → R100

Motor: S360% T300/250/175 R100 → ALL MAX
Smoothing: HR_ABOVE = 1 amostra → IMEDIATO
Explicação UI: "Motor MAX — HR 21bpm acima de Z2, a proteger"
```

### 7.3 Plano com HR baixa
Z2 target, HR 85bpm (13 abaixo), plano, speed 18km/h, 60W, cadência 82rpm
```
hrTarget = 40 - (13 × 5) = -25 → cap 0

Anticipation:
  terrainBias: 0, transitionBias: 0, weightBias: 0
  powerBias: 60/80=0.75 W/kg → -10 (coasting)
  cadenceTrendBias: 0, speedBias: 0
  Total: -10

intensity = clamp(0 + (-10), 0, 100) = 0 → wire 2 → S300% T200/175/125 R50

Smoothing: HR_BELOW = 3 amostras → 6s gradual
Explicação UI: "Motor reduzido — HR 13bpm abaixo de Z2, podes mais"
```

### 7.4 PLANO com HR ALTA (o cenário que diferencia o regulador)
Z2 target, HR 130bpm (16 acima), gradient 0%, speed 16km/h, 200W, cadência 75rpm
```
hrTarget = 60 + (16 × 8) = 188 → cap 100

Anticipation:
  terrainBias: 0, transitionBias: 0, weightBias: 0
  powerBias: 200/80=2.5 W/kg → +8
  cadenceTrendBias: 0, speedBias: 0
  Total: +8

intensity = clamp(100 + 8, 0, 100) = 100 → wire 0 → S360% T300 R100 → MAX NO PLANO

Explicação UI: "Motor MAX — HR 16bpm acima de Z2, a proteger"
```
**Este é O cenário**: ANTES o terreno mandava (plano=25→MIN). AGORA o HR manda (alto=100→MAX). O rider precisa de ajuda e recebe-a, independentemente do terreno.

### 7.5 Subida com HR confortável
Z2 target (98-114), HR 100bpm (2 dentro da zona, fundo), gradient 12%, speed 10km/h, rider 85kg, 180W, cadência 65rpm
```
posição = (100-98)/(114-98) = 2/16 = 0.125
hrTarget = 40 + (0.125 × 20) = 42.5 ≈ 43

Anticipation:
  terrainBias:       12% → +15
  transitionBias:    0
  weightBias:        85kg grad>8% → +3
  powerBias:         180/85=2.1 → +8
  cadenceTrendBias:  0 (estável)
  speedBias climb:   10km/h (>8) → 0
  Total: +26
Battery: ×1.0

intensity = clamp(43 + 26, 0, 100) = 69

Support:  69 → wire 0 (>62)     → S360%
Torque:   69 → wire 0            → T300
MidTorq:  69-10=59 → wire 1     → M200
LowTorq:  69-20=49 → wire 1     → L150
Launch:   69 × 0.7 = 48 → wire 1 → R75

Motor: S360% T300/200/150 R75
Explicação UI: "A manter Z2 — HR controlada ✓"
```
**ANTES**: subida 12% = score 100 = MAX sempre. **AGORA**: HR a 100bpm no fundo de Z2 em subida de 12% — o rider aguenta mas o powerBias (+8 para 2.1W/kg) e o terrainBias (+15) empurram para wire 0. O motor dá MAX support mas MID torque/launch. Se não houvesse power meter, anticipation seria +18 → intensity=61 → wire 1 (MID). O power meter acrescenta precisão.

### 7.6 Bateria baixa em subida com HR alta
Z2 target, HR 140bpm (26 acima), gradient 8%, speed 6km/h, SOC 20%, 250W, rider 80kg, cadência 48rpm
```
hrTarget = 100 (cap)

Anticipation:
  terrainBias:      8% → +15
  speedBias climb:  6km/h<8 + grad>5% → max(0, 10-15) = 0
  powerBias:        250/80=3.1 → +15
  cadenceTrendBias: 0 (sem trend data neste snapshot)
  Total: +30

Battery: SOC 20% → ×0.57

intensity = clamp(100 + 30, 0, 100) × 0.57 = 100 × 0.57 = 57

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
Z2 target (98-114), HR 120bpm (6 acima), gradient 10%, speed 5km/h, cadência 40rpm, 200W, rider 80kg
```
hrTarget = 60 + (6 × 8) = 108 → cap 100

Anticipation:
  terrainBias:      10% → +15
  speedBias climb:  5km/h<8 + grad>5% → max(0, 10-15) = 0
  powerBias:        200/80=2.5 → +8
  cadenceTrendBias: 0 (40rpm é baixa mas floor >55 não dispara)
  Total: +23

intensity = clamp(100 + 23, 0, 100) = 100

Support: 100 → wire 0 → S360%
Torque: 100 → CAP por cadência<50 + gradient>8% → max 55 → wire 1 → T250 (not 300!)
MidTorque: 55-10=45 → wire 1 → M200
LowTorque: 55-20=35 → wire 2 → L125
Launch: 100 × 0.7 = 70 → wire 0 → R100

Motor: S360% T250/200/125 R100
Explicação UI: "Motor MAX — HR 6bpm acima de Z2" + "Torque cap — Cadência 40rpm em 10%"
```
**Safety feature**: max support mas torque limitado para não patinar a roda em subida técnica com cadência baixa.

### 7.8 Plano com headwind — powerBias demonstra o valor (cenário diferenciador)
Z2 target (98-114), HR 108bpm (dentro da zona, meio), plano, 260W, rider 80kg, cadência 78rpm estável
```
posição = (108-98)/(114-98) = 10/16 = 0.625
hrTarget = 40 + (0.625 × 20) = 52.5 ≈ 53

Anticipation:
  terrainBias:      0 (plano)
  transitionBias:   0 (sem transição à frente)
  weightBias:       0 (plano, não aplica)
  powerBias:        260/80 = 3.25 W/kg → +15 ← rider a esforçar-se, HR vai subir
  cadenceTrendBias: 0 (78rpm estável)
  Total: +15

Battery: ×1.0

intensity = clamp(53 + 15, 0, 100) × 1.0 = 68

Support:  68 → wire 0 (>62)      → S360%
Torque:   68 → wire 0             → T300
MidTorq:  68-10=58 → wire 1      → M200
LowTorq:  68-20=48 → wire 1      → L150
Launch:   68 × 0.7 = 48 → wire 1 → R75

Motor: S360% T300/200/150 R75

SEM powerBias: intensity = 53 → wire 1 (MID) → S350%
COM powerBias: intensity = 68 → wire 0 (MAX) → S360%

Motor antecipa HR spike 30-60s antes de acontecer.
Explicação UI: "Motor MAX — Esforço alto (3.2 W/kg), a proteger"
```
**Este cenário justifica o powerBias**: o terreno diz "plano, tudo calmo". Mas o rider está a produzir 260W contra headwind. Sem powerBias, o motor ficaria em MID até o HR subir 30-60s depois. Com powerBias, o motor antecipa e previne o spike.

### 7.9 Fadiga em subida — cadenceTrendBias
Z2 target (98-114), HR 110bpm (dentro da zona), gradient 6%, cadência a cair de 72→54rpm em 10s, 180W
```
hrTarget = 40 + (0.75 × 20) = 55

Anticipation:
  terrainBias:      gradient 6% → +10
  transitionBias:   0
  weightBias:       0
  powerBias:        180/80 = 2.25 W/kg → +8
  cadenceTrendBias: 72→54 = queda 18rpm em 10s (>15, era >55) → +10
  Total: +28

intensity = clamp(55 + 28, 0, 100) × 1.0 = 83

Support: 83 → wire 0 → S360%

SEM cadenceTrendBias: intensity = 73 → wire 0 (mesmo resultado aqui)
SEM cadence + power:  intensity = 65 → wire 0 (borderline, com ruído flipa)
```
**Nota**: neste exemplo os 3 sinais convergem (terrain+power+cadence). Em casos borderline (intensity 60-68), os +10 do cadenceTrendBias fazem a diferença entre wire 0 e wire 1.

---

## 8. Comparação: Terrain-Reactive vs HR-Regulated

| Cenário | ANTES (terreno) | DEPOIS (HR zone) | Porquê |
|---------|:---:|:---:|--------|
| Subida 12%, HR 100bpm (Z2 ok) | 100 → MAX | 61 → MID | HR ok, MID basta. Poupa bateria |
| Plano 0%, HR 135bpm (acima Z2) | 25 → MIN | 100 → MAX | HR alta, rider precisa de ajuda |
| Subida 5%, HR 80bpm (abaixo Z2) | 70 → MAX | 0 → MIN | HR baixa, rider aguenta |
| Pré-subida, HR 110bpm (Z2 ok) | 25+20=45 → MID | 55+25=80 → MAX | Antecipa subida |
| Subida técnica, cad 40rpm | 85 → MAX torque | 100 support, 55 torque | Safety: torque limitado |
| **Plano + headwind 260W** | **25 → MIN** | **68 → MAX** | **powerBias antecipa HR spike** |
| **Fadiga, cad 72→54rpm** | **60 → MID** | **83 → MAX** | **cadenceTrend + power** |

**A diferença fundamental**: o motor agora serve o rider, não o terreno. E antecipa o que o HR vai fazer antes de acontecer.

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

O widget explica **porquê**, não só mostra barras. Padrão consistente baseado em wire value + HR state:

| Wire | HR state | Mensagem | Cor |
|:---:|----------|----------|-----|
| 0 | Acima zona | "Motor MAX — HR Xbpm acima de Z2, a proteger" | vermelho |
| 1 | Acima zona | "Motor a ajudar — HR Xbpm acima de Z2" | amarelo |
| 1 | Acima + bat. | "Motor limitado pela bateria — HR Xbpm acima (SOC Y%)" | laranja |
| 0/1 | Dentro zona | "A manter Z2 — HR controlada ✓" | verde |
| 2 | Abaixo zona | "Motor reduzido — HR Xbpm abaixo de Z2, podes mais" | azul |
| — | Sem HR | "Sem sensor HR — a estimar pelo terreno" | cinza |
| — | HR dropout | "HR sensor dropout — a usar último estado" | amarelo |

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
