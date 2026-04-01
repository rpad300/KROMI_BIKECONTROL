# KROMI Intelligence — HR Zone Regulated Motor Calibration

## Version: v0.6.0-b34 final (2026-04-01)

---

## 1. Visão Geral

O KROMI Intelligence é um **regulador de zona cardíaca**. O motor mantém o rider na zona HR escolhida. Não reage ao terreno — antecipa-o.

**Arquitectura layered (não aditiva)**:
```
intensity = clamp(hrTarget + anticipationBias, 0, 100) × batteryConstraint
```

| Layer | Função | Range | Papel |
|-------|--------|-------|-------|
| **HR Target** | Define intensidade base | 0-100 | PRIMARY — regula |
| **Terrain Anticipation** | Ajusta timing | -20 a +25 | SECONDARY — antecipa |
| **Battery Constraint** | Limita output | ×0.4-1.0 | TERTIARY — constrange |

O HR não é um modificador do terreno. O terreno não é o driver. São layers independentes.

### Quando está activo
- **Apenas em POWER mode** — o rider controla o modo via RideControl físico
- Nos outros modos o KROMI é passivo (telemetria only)

---

## 2. Os 5 Parâmetros do Motor (ASMO)

Baseado no decompilado do RideControl APK v1.33 (TuningData.java).
Motor DU7 (SyncDrive Pro), 3^5 = 243 combinações.

| ASMO | Parâmetro | Wire 0 (max) | Wire 1 (mid) | Wire 2 (min) |
|------|-----------|:---:|:---:|:---:|
| ASMO1 | **Support %** | 360% | 350% | 300% |
| ASMO2 | **Torque** | 300 | 250 | 200 |
| ASMO3 | **Mid Torque** | 250 | 200 | 175 |
| ASMO4 | **Low Torque** | 175 | 150 | 125 |
| ASMO5 | **Launch** | 100 | 75 | 50 |

### SET_TUNING Encoding (cmd 0x2D, key 3)
```
byte[2] = (ASMO1+1) | ((ASMO2+1) << 4)
byte[3] = (ASMO3+1) | ((ASMO4+1) << 4)
byte[4] = (ASMO5+1)
```

---

## 3. LAYER 1 — HR Zone Target (PRIMARY)

O rider escolhe a zona alvo nas Settings. O motor regula para manter o HR nessa zona.

### Zonas HR (auto-calculadas do HR max observado)
| Zona | % HRmax | Para HRmax 163 | Descrição |
|------|---------|:---:|-----------|
| Z1 Recovery | 50-60% | 82-98 bpm | Recuperação activa |
| Z2 Endurance | 60-70% | 98-114 bpm | **Base aeróbica (default)** |
| Z3 Tempo | 70-80% | 114-130 bpm | Ritmo moderado |
| Z4 Threshold | 80-90% | 130-147 bpm | Limiar anaeróbico |
| Z5 VO2max | 90-100% | 147-163 bpm | Esforço máximo |

### HR → Target Intensity
```
HR acima da zona alvo:
  hrTarget = 55 + (bpm_above × 8)  →  capped at 100
  Ex: 10bpm acima = 55 + 80 = 100 → wire 0 (MAX assist)
  Ex: 3bpm acima = 55 + 24 = 79 → wire 0

HR dentro da zona alvo:
  hrTarget = 35 + (posição × 30)  →  35-65 range
  Ex: meio da zona = 50 → wire 1 (MID)
  Ex: topo da zona = 65 → wire 1 (quase MAX)

HR abaixo da zona alvo:
  hrTarget = 45 - (bpm_below × 5)  →  min 0
  Ex: 5bpm abaixo = 45 - 25 = 20 → wire 2 (MIN)
  Ex: 15bpm abaixo = 45 - 75 = 0 → wire 2 (motor quase off)
```

**Peso dos modificadores HR**: +8/bpm acima, -5/bpm abaixo.
Deliberadamente assimétrico — mais agressivo a ajudar do que a reduzir.

### Sem HR Sensor
Quando não há sensor HR, o terreno serve como **proxy degradado**:
```
gradient > 12% → hrTarget 85 (assume esforço alto)
gradient > 8%  → 72
gradient > 5%  → 60
gradient > 3%  → 48
plano          → 25
descida        → 10
```
Claramente marcado no UI como "Sem HR — estimativa por terreno".

---

## 4. LAYER 2 — Terrain Anticipation (SECONDARY)

O terreno **não define magnitude** — define **timing**. Antecipa mudanças de HR.

### Antecipação Pré-emptiva (-20 a +25)
| Transição | Bias | Razão |
|-----------|:---:|--------|
| Plano → Subida > 5% (dentro do lookahead) | +25 | Pre-boost antes do HR subir |
| Subida → Descida (dentro do lookahead) | -15 | Pre-reduce antes do HR baixar |
| Peso > 75kg em subida > 8% | +3 per 10kg | Riders pesados precisam mais |

### Lookahead Dinâmico (baseado em velocidade)
```
> 10 km/h: 100m lookahead (estrada/trail rápido)
5-10 km/h:  60m lookahead (trail técnico)
< 5 km/h:   30m lookahead (subida lenta/singletrack)
```
**Porquê**: a 5km/h em singletrack, o GPS heading é impreciso. 300m de lookahead numa curva pode apontar para uma descida quando o trail sobe. Lookahead curto previne erros cascata.

### Risco de Cascata (resolvido)
Sem lookahead dinâmico:
```
GPS heading errado → antecipa descida (+20) → HR cai → sistema interpreta como
"rider em recovery" → reduz assist → rider perde assistência na subida
```
Com lookahead dinâmico a 30m em singletrack lento, o risco é minimizado.

---

## 5. LAYER 3 — Battery Constraint (TERTIARY)

A bateria não contribui para o score — é um **hard constraint** que limita o output.

| SOC | Multiplicador | Efeito |
|-----|:---:|--------|
| > 60% | ×1.0 | Sem restrição |
| 30-60% | ×0.7-1.0 | Conservação gradual |
| 15-30% | ×0.5-0.7 | Economia activa |
| < 15% | ×0.4 | Emergência |

Ajustado pela capacidade total: baterias maiores (1050Wh) conservam mais tarde.

---

## 6. Smoothing Assimétrico

Um regulador que demora 6s a reagir quando o rider está em esforço excessivo **não está a regular**. O smoothing é assimétrico:

| Direcção | Amostras | Tempo | Razão |
|----------|:---:|:---:|--------|
| **Ramp DOWN** (reduzir assist) | 1 | 2s | Proteger rider — acção imediata |
| **Ramp UP** (aumentar assist) | 3 | 6s | Cauteloso — evitar oscilação |

```
HR dispara para 155bpm (acima de Z2):
  Amostra 1: target = wire 0 (MAX) → APLICA IMEDIATAMENTE
  Motor aumenta assist → HR começa a baixar

HR cai para 90bpm (abaixo de Z2):
  Amostra 1: target = wire 2 (MIN) → pendente
  Amostra 2: target = wire 2 (MIN) → pendente
  Amostra 3: target = wire 2 (MIN) → APLICA (estável 6s)
  Gradual para evitar perda súbita de assist
```

---

## 7. Cenários com HR Zone Regulation

### 7.1 Subida com HR controlada (Z2 target, HR 112bpm = dentro da zona)
```
hrTarget = 35 + (0.7 × 30) = 56 (posição 70% na zona)
anticipation = +10 (gradient 6%)
battery = ×1.0

intensity = clamp(56 + 10, 0, 100) × 1.0 = 66 → wire 0 (MAX)
Motor: S360% T300 → HR mantém-se em Z2
```

### 7.2 Subida com HR alta (Z2 target, HR 135bpm = 21bpm acima)
```
hrTarget = 55 + (21 × 8) = 100 (capped)
anticipation = +5 (já em subida)
battery = ×1.0

intensity = clamp(100 + 5, 0, 100) × 1.0 = 100 → wire 0
Motor: S360% T300 R100 → MAX para trazer HR de volta a Z2
Ramp down: 1 amostra → imediato
```

### 7.3 Plano com HR baixa (Z2 target, HR 85bpm = 13bpm abaixo)
```
hrTarget = 45 - (13 × 5) = 0
anticipation = 0 (plano)
battery = ×1.0

intensity = clamp(0 + 0, 0, 100) × 1.0 = 0 → wire 2
Motor: S300% T200 R50 → MIN, rider pode mais
Ramp up para MIN: 3 amostras → gradual
```

### 7.4 Plano com HR alta (Z2 target, HR 130bpm = 16bpm acima)
```
hrTarget = 55 + (16 × 8) = 100
anticipation = 0 (plano)
battery = ×1.0

intensity = 100 → wire 0
Motor: S360% T300 → MAX MESMO NO PLANO porque HR está alta!
ANTES: plano = score 25 = MIN. AGORA: HR regula, não terreno.
```

### 7.5 Bateria baixa em subida com HR alta
```
hrTarget = 100 (HR acima da zona)
anticipation = +10
battery = ×0.5 (SOC 20%)

intensity = clamp(110, 0, 100) × 0.5 = 50 → wire 1
Motor: S350% T250 — bateria limita, mas ainda ajuda
```

---

## 8. Comparação: Antes vs Depois

| Cenário | ANTES (terreno) | DEPOIS (HR zone) |
|---------|:---:|:---:|
| Subida 12%, HR 100bpm (Z2) | 100 → MAX | 50 → MID (HR ok) |
| Plano, HR 135bpm (acima Z2) | 25 → MIN | 100 → MAX (HR alta!) |
| Subida 5%, HR 80bpm (abaixo Z2) | 70 → MAX | 20 → MIN (HR baixa) |
| Pré-subida, HR 110bpm (Z2) | 25+20=45 → MID | 50+25=75 → MAX (antecipa) |

**A diferença fundamental**: O KROMI agora dá MAX a um rider que está a sofrer no plano (HR alta) e dá MIN a um rider confortável em subida (HR baixa). É o oposto do terrain-reactive.

---

## 9. SET_TUNING Encoding

```
PWA → WebSocket: {type:"setTuning", power:0, sport:1, active:1, tour:2, eco:0}
(power=ASMO1, sport=ASMO2, active=ASMO3, tour=ASMO4, eco=ASMO5)

APK → BLE: plaintext[0]=0x2D, [1]=0x03, [2-4]=encoded bytes
→ AES key 3 → [0xFB, 0x21, encrypted(16), 0x03, CRC]
→ SyncDrive Pro applies immediately
```

---

## 10. Auto-Restore Safety (3 layers)

```
Connect → READ_TUNING → store originalCalibration
Disconnect / page close / crash → SET_TUNING(original)

Layer 1: WebSocket onDisconnect → autoRestore()
Layer 2: window.beforeunload → autoRestore()
Layer 3: APK bridge fallback
```

---

## 11. Simulation (FIT Import)

O KromiSimulator replica a lógica HR-zone sobre rides passadas:
- Usa HR real do FIT + zona alvo do perfil
- Calcula hrTarget por ponto (mesma fórmula)
- 3-way battery comparison: KROMI vs config fixa vs sempre MAX
- Resultados persistidos em ride_sessions.devices_connected.kromi_simulation

---

## 12. Ficheiros Chave

```
src/services/motor/TuningIntelligence.ts  — HR zone regulator (layered)
src/types/tuning.types.ts                 — ASMO model, DU7 tables, encode/decode
src/types/athlete.types.ts                — HR zones, target zone, calculateZones()
src/hooks/useMotorControl.ts              — 2s loop, POWER gate, executes calibration
src/store/intelligenceStore.ts            — State for UI
src/services/simulation/KromiSimulator.ts — Replays HR-zone logic over FIT imports
src/components/Dashboard/IntelligenceWidget.tsx — 3 intensity bars + factors
```

---

## 13. Limitações

1. **3 wire values por ASMO** — motor aceita 0/1/2, não contínuo
2. **Sem HR**: terreno como proxy (menos preciso)
3. **GPS heading em singletrack**: mitigado por lookahead dinâmico
4. **ASMO consumo estimado**: precisa calibração com rides reais
5. **2s intervalo**: não reage sub-segundo (mas ramp-down é 1 amostra = 2s)
