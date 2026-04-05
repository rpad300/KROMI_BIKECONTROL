# KROMI Intelligence v2 — Documentacao Tecnica Completa

> Giant Trance X E+ 2 (2023) | Shimano EP800 SyncDrive Pro | 135kg rider + 24kg bike = 159kg  
> PWA React 18 + TypeScript | BLE via WebSocket Bridge | Deploy: Vercel (HTTPS)

---

## Indice

1. [Visao Geral da Arquitectura](#1-visao-geral-da-arquitectura)
2. [Data Flow Completo](#2-data-flow-completo)
3. [Layer 1: Physics Engine](#3-layer-1-physics-engine-1s)
4. [Layer 2: Physiology Engine](#4-layer-2-physiology-engine-1s)
5. [Layer 3: Environment](#5-layer-3-environment-60s)
6. [Layer 4: Lookahead](#6-layer-4-lookahead-10s)
7. [Layer 5: Battery](#7-layer-5-battery-30s)
8. [Layer 6: Learning](#8-layer-6-learning-60s)
9. [Layer 7: Nutrition](#9-layer-7-nutrition-30s)
10. [Decision Tree](#10-decision-tree)
11. [Output para o Motor](#11-output-para-o-motor)
12. [Alertas ao Rider](#12-alertas-ao-rider)
13. [Stack de APIs Externas](#13-stack-de-apis-externas)
14. [Ficheiros e Dependencias](#14-ficheiros-e-dependencias)
15. [Constantes do Rider e Bike](#15-constantes-do-rider-e-bike)
16. [Output Pos-Ride](#16-output-pos-ride)

---

## 1. Visao Geral da Arquitectura

O KromiEngine e um singleton que corre dentro do hook `useMotorControl` da PWA React.  
So esta activo quando o modo de assistencia e **POWER** (modo 5).  
O metodo `tick()` e chamado a cada **1 segundo** e e **sincrono** — todas as chamadas a APIs externas sao feitas por servicos separados com cache. O tick le apenas valores cached.

```
BLE sensores → bikeStore (Zustand) → useMotorControl (setInterval 1s)
                                          │
                                    kromiEngine.tick()
                                     ├── Layer 1: Physics (1s)
                                     ├── Layer 2: Physiology (1s)
                                     ├── Layer 3: Environment (60s)
                                     ├── Layer 4: Lookahead (10s)
                                     ├── Layer 5: Battery (30s)
                                     ├── Layer 6: Learning (60s)
                                     └── Layer 7: Nutrition (30s)
                                          │
                                    toWire(0-15) → setAdvancedTuning()
                                          │
                                    WebSocket → BLEManager.kt → Motor
```

**TuningIntelligence** (o sistema antigo) continua a correr em paralelo — alimenta o IntelligenceWidget no dashboard para mostrar factores ao utilizador. Nao controla o motor.

---

## 2. Data Flow Completo

### Fontes de Dados (Inputs)

| Dado | Fonte | Store | Frequencia |
|------|-------|-------|------------|
| Velocidade (km/h) | BLE CSC (0x1816) wheel revolutions | bikeStore.speed_kmh | ~1s |
| Cadencia (rpm) | BLE CSC (0x1816) crank revolutions | bikeStore.cadence_rpm | ~1s |
| Potencia (W) | BLE Power (0x1818) int16 LE | bikeStore.power_watts | ~1s |
| Bateria (%) | BLE Battery (0x180F) ou GEV cmd 0x43 | bikeStore.battery_percent | ~2s |
| Heart Rate (bpm) | BLE HRM (0x180D) qualquer Polar/Garmin/Wahoo | bikeStore.hr_bpm | ~1s |
| Gear (1-12) | BLE Di2 (6e40fec1) byte[5] da characteristic 2AC1 | bikeStore.gear | ~0.3s |
| Assist Mode (0-6) | GEV Protocol notification | bikeStore.assist_mode | on change |
| GPS Latitude/Longitude | navigator.geolocation | mapStore.latitude/longitude | ~1s |
| GPS Heading | navigator.geolocation | mapStore.heading | ~1s |
| Altitude | mapStore.altitude ou bikeStore.barometric_altitude_m | fallback chain | ~1s |
| Distancia (km) | BLE CSC acumulado | bikeStore.distance_km | ~1s |
| Temperatura (C) | OpenMeteo API ou Google Weather API | cached no KromiEngine | 60s |
| Vento (km/h + dir) | OpenMeteo API ou Google Weather API | cached no KromiEngine | 60s |
| Superficie | OSM Overpass API | TerrainService cache | 30s |
| Elevacao ahead | Google Maps Elevation API | ElevationService cache | 3s |

### Outputs (para o motor)

| Parametro | Range Real | Wire | Step | Funcao |
|-----------|-----------|------|------|--------|
| Support | 50% - 350% | 0-15 | ~20%/step | % de assistencia maxima. Teto de potencia. |
| Torque | 20Nm - 85Nm | 0-15 | ~4.3Nm/step | Sensibilidade a forca nos pedais. Alto=agressivo. |
| Launch | 1 - 7 | 0-15 | ~0.4/step | Boost no arranque desde parado. |

Comando BLE: `0xE3 0x0C`, encriptado AES, via WebSocket para BLEManager.kt que monta o frame GEV.

---

## 3. Layer 1: Physics Engine (1s)

**Ficheiro:** `src/services/intelligence/PhysicsEngine.ts`  
**Funcao:** `computeForces(input) → PhysicsOutput`  
**Tipo:** Funcoes puras, sem estado.

### Tres forcas resistivas

**Forca gravitacional:**
```
Fg = massa_total × g × sin(arctan(gradiente% / 100))
```
- massa_total = 159 kg (rider 135 + bike 24)
- g = 9.81 m/s2
- Dominante com 159kg. Uma subida de 10% = ~153N so de gravidade.

**Forca de rolling (resistencia ao rolamento):**
```
Frr = Crr_effective × massa_total × g × cos(arctan(gradiente% / 100))
```
- Crr_effective vem da Layer 3 (superficie OSM) + calibracao Layer 6
- Tabela base:

| Superficie | Crr |
|-----------|-----|
| Asfalto (paved) | 0.004 |
| Gravel compacto | 0.006 |
| Terra/loose (dirt) | 0.009 |
| Singletrack tecnico | 0.011 |
| Desconhecido | 0.006 |

**Forca aerodinamica (com vento):**
```
v_efectiva = v_rider_ms + v_vento_frontal_ms
Faero = 0.5 × rho × CdA × v_efectiva × |v_efectiva|
```
- CdA = 0.6 m2 (posicao MTB upright)
- rho = densidade do ar (1.225 base, corrigida por temperatura)
- v_vento_frontal = projecao do vento no heading do rider (positivo = headwind)
- Usa `|v_efectiva|` para que tailwind forte crie forca positiva (push)

### Potencia total e split humano/motor

```
P_total = max(0, F_total × v_ms)    [Watts]
P_human = potencia_rider (power meter ou estimativa)
P_motor_gap = max(0, P_total - P_human)   [so quando motor activo]
```

### Estimativa de P_human (sem power meter)

Quando o power meter nao esta disponivel, estima a partir de cadencia + gear:
```
GR = 34 / sprocket[gear_actual]
torque_pedal = peso_rider × 0.015 × factor_cadencia × GR
P_human = torque_pedal × 2π × cadencia / 60
```
factor_cadencia: 1.2 se cad<60, 1.0 se 60-80, 0.85 se >80

Se power meter disponivel e plausivel (0-600W), usa esse valor directamente.

### Estimativa de cadencia (sem sensor)

Quando cadencia do sensor = 0 mas velocidade > 2 km/h e gear conhecido:
```
cadencia_rpm = (v_ms × 60) / (GR × 2.290)
```
Flag `inefficient_gear = true` se cadencia < 65 rpm.

### 3-Zone Speed Model (corte EU 25 km/h)

O motor SyncDrive Pro nao corta abruptamente a 25 km/h. Tem fade progressivo:

| Zona | Velocidade | fadeFactor | Estado Motor |
|------|-----------|------------|-------------|
| Active | 0 - 22 km/h | 1.0 | Totalmente activo |
| Fade | 22 - 25 km/h | (25 - v) / 3 | Reducao progressiva |
| Free | > 25 km/h | 0.0 | Motor desligado |

```
if v >= 25:    fadeFactor = 0, speedZone = 'free'
elif v > 22:   fadeFactor = (25 - v) / 3, speedZone = 'fade'
else:          fadeFactor = 1.0, speedZone = 'active'
```

Na zona Free: P_motor_gap = 0, consumo bateria = 0, rider faz tudo.  
Na zona Fade: Support e Torque sao multiplicados por fadeFactor.

---

## 4. Layer 2: Physiology Engine (1s)

**Ficheiro:** `src/services/intelligence/PhysiologyEngine.ts`  
**Classe:** `PhysiologyEngine` (instancia dentro do KromiEngine)  
**Estado:** Mantem historico HR 10 min, W' balance, EF baseline, IRC.

### HR Zone Tracking

```
zone_current = zona onde HR_actual cai (1-5, configurado no perfil do rider)
margin_bpm = teto_zona_actual - HR_actual
```

### Cardiac Drift (sinal de fadiga)

Compara HR actual vs HR de 10 minutos atras, **apenas em esforco constante** (gradiente e velocidade similares):
```
drift = (HR_agora - HR_10min_atras) / minutos_decorridos    [bpm/min]
```
- So calcula se tem >= 2 min de dados
- So calcula se diferenca de gradiente < 3% e velocidade < 5 km/h
- Se drift > 0.3 bpm/min: flag `cardiovascular_fatigue_emerging`

### Zone Breach Projection

```
t_breach_minutes = margin_bpm / drift_bpm_per_min
```
Se t_breach < 8 minutos: flag `zone_breach_imminent` → accao pre-emptiva.

### W' Balance (Modelo Skiba)

W' (W-prime) e a reserva anaerobica — a energia disponivel para esforcos acima do CP (Critical Power ≈ FTP).

**Deplecao** (quando P_human > CP):
```
W'_balance = W'_balance - (P_human - CP) × dt
```

**Recuperacao** (quando P_human <= CP):
```
recovery = (W'_total - W'_balance) × (1 - e^(-dt / tau))
W'_balance = W'_balance + recovery
```
- tau = constante de recuperacao (default 300s, calibrado progressivamente)
- W'_total = capacidade total (default 15000 J para recreativo)

**Estados:**

| W' Balance | Estado | Accao Motor |
|-----------|--------|-------------|
| > 70% | Green | Normal |
| 30-70% | Amber | Monitorizar |
| < 30% | Critical | Support MAX, proteger atleta |

### Efficiency Factor (EF)

```
EF = P_human / HR_bpm    [W/bpm]
```
- Baseline construido incrementalmente durante a ride
- So actualiza quando P_human > 50% do CP (esforco significativo)
- Se EF actual < 85% do baseline: flag `functional_efficiency_degraded`

### Cardiac Recovery Index (IRC)

Mede qualidade de recuperacao apos esforco:
```
IRC = HR_drop_60s / HR_drop_referencia
```
- HR_drop_referencia = 25 bpm em 60s (estado fresco, calibravel)
- Mede-se automaticamente quando: transicao de esforco alto (>70% CP) para baixo (<40% CP)
- Se IRC < 0.6: flag `residual_fatigue_significant`

### hrModifier (output para Layer 1)

| Condicao | hrModifier | Efeito |
|----------|-----------|--------|
| Sem HR | 1.0 | Neutro |
| Zone breach < 8 min | 0.6 | Proteccao pre-emptiva |
| Acima da zona alvo | 0.7 | Reducao urgente |
| Abaixo da zona alvo | 1.1 | Pode aumentar motor |
| Na zona alvo | 1.0 | Manter |

---

## 5. Layer 3: Environment (60s)

**Dados de:** WeatherService, OpenMeteoService, TerrainService  
**Cache:** Actualiza a cada 60 segundos

### Vento

Fonte primaria: Google Weather API (`weather.googleapis.com/v1/currentConditions:lookup`)  
Fallback gratuito: Open-Meteo (`api.open-meteo.com/v1/forecast`)

Projecao no heading do rider:
```
angulo = vento_direcao - rider_heading
v_vento_frontal = (vento_velocidade_kmh / 3.6) × cos(angulo)
```
- Positivo = headwind (mais resistencia)
- Negativo = tailwind (menos resistencia)

### Densidade do Ar

```
rho = 1.225 × (273.15 / (273.15 + temp_c))
```
A 35C: rho = 1.146 (-6.5%). A 5C: rho = 1.303 (+6.4%).

### Superficie (Crr)

Fonte: OSM Overpass API (`overpass-api.de/api/interpreter`)
```
Query: way(around:30, lat, lng)[highway]; out tags;
```
- Extrai tag `surface` e `highway`
- Categoriza: paved / gravel / dirt / technical
- Mapeia para Crr via tabela (ver Layer 1)
- Layer 6 (Learning) pode ajustar Crr com base em velocidade observada vs prevista

---

## 6. Layer 4: Lookahead (10s)

**Ficheiro:** `src/services/autoAssist/ElevationPredictor.ts`  
**Classe:** `LookaheadController` (stateful, instancia no KromiEngine)

### Tres Modos com Transicao Automatica

| Modo | Nome | Trigger | Horizonte |
|------|------|---------|-----------|
| A | GPX Known | `loadRoute()` com rota GPX | 4km desde posicao actual na rota |
| B | Discovery | Sem GPX, ou apos desvio | 4km por heading (Google Elevation API) |
| C | Hybrid | GPX carregado mas rider desviou | Discovery ate re-entrar no corredor |

### Transicao Automatica (Mode A ↔ C ↔ B)

```
Mode A (GPX):
  Se distancia_ao_track > 50m durante 20s consecutivos:
    → Switch para Mode C (Hybrid)

Mode C (Hybrid):
  Opera com Discovery lookahead
  Mantem GPX como referencia de destino
  Se distancia_ao_track < 30m:
    → Switch para Mode A (GPX)

Mode B (Discovery):
  Activo quando nao ha GPX carregado
  Projeta 4km a frente por heading + Google Elevation API
```

A deteccao de desvio usa haversine para distancia ao ponto mais proximo da rota, pesquisando ±50 pontos a volta da posicao actual (eficiente, nao varre a rota toda).

### Modo A: GPX Known

Quando rota GPX esta carregada:
1. Encontra ponto mais proximo na rota (haversine)
2. Extrai os proximos 4km de pontos da rota
3. Converte para ElevationPoint[] com distancia relativa
4. Alimenta o mesmo buildSegmentLookahead() que o Mode B usa
5. Tambem fornece `route_remaining_km` para o Battery Budget (Layer 5)

### Modo B: Discovery

A cada 10s, constroi horizonte de ate 4km a frente:

1. Le o perfil de elevacao do `ElevationService` (Google Elevation API, heading-based)
2. Agrupa em segmentos de 100m
3. Classifica cada segmento:

| Gradiente | Classificacao |
|----------|--------------|
| 0-5% | Gentle |
| 5-10% | Moderate |
| 10-15% | Demanding |
| > 15% | Extreme |

4. Estima velocidade por segmento (mais lento em subidas, mais rapido em descidas)
5. Calcula P_total e Wh_motor por segmento usando PhysicsEngine
6. Soma Wh_motor total do horizonte
7. Detecta proxima transicao de gradiente (> 3% de diferenca)
8. Calcula segundos ate transicao e sugere mudanca de gear

### Pre-Adjustment Ramp

Se uma transicao significativa (> 5% gradiente) esta a < 15s:
- Calcula Support e Torque alvo para o gradiente que vem
- Aplica blend progressivo nos 5s antes de chegar la:
```
blend = 1 - (countdown / 5)    // 0→1 ao longo de 5s
support = actual + (target - actual) × blend
```

### Sugestao de Gear

Para o proximo segmento demanding, calcula o gear que da cadencia mais proxima de 82 rpm:
```
cadencia = (v_estimada_ms × 60) / (GR × 2.290)
```
Testa todos os 12 gears (34T / [51,45,39,34,30,26,23,20,17,15,13,10]T).

---

## 7. Layer 5: Battery (30s)

**Ficheiro:** `src/services/autoAssist/BatteryOptimizer.ts`

### Rolling Consumption

Tracker de 5 minutos com dados reais:
```
consumo_wh_km = (Wh_acumulados_5min) / (km_percorridos_5min)
```
- Alimentado a cada 1s com `feedConsumption(motor_watts, distance_km)`
- Se nao ha dados suficientes (<50m), usa defaults do BatteryEstimationService

### Correccao de Temperatura (Li-ion)

| Temperatura | Factor |
|------------|--------|
| < 0 C | 0.75 |
| 0-10 C | 0.85 |
| > 10 C | 1.0 |

```
wh_efectivo = wh_restante × temp_correction
```

### Budget Ratio e 6 Niveis de Constraint

```
budget_ratio = wh_efectivo / (consumo_wh_km × km_restantes_rota)
```

| Budget Ratio | Constraint Factor | Significado |
|-------------|------------------|-------------|
| > 1.2 | 1.0 | Sem restricao |
| 1.0 - 1.2 | 1.0 | Monitorizacao ligeira |
| 0.7 - 1.0 | 0.85 | Restricao moderada |
| 0.5 - 0.7 | 0.65 | Restricao significativa |
| < 0.5 | 0.40 | Critico |
| Range < 5km | 0.20 | Emergencia |
| Sem rota | 1.0 | Sem constraint |

O constraint_factor multiplica Support e Torque na Layer 1.

---

## 8. Layer 6: Learning (60s)

**Ficheiro:** `src/services/autoAssist/RiderLearning.ts`  
**Classe:** `RiderLearning`

### Calibracao Progressiva de CP

- Detecta segmentos sustentados: P_human > 80% CP durante > 8 minutos
- Regista como datapoint (power_avg, duration_s, timestamp)
- Recalcula CP com media ponderada:
  - Peso recencia: half-life de 30 dias
  - Peso duracao: maximo a 20 minutos
  - Learning rate: 0.1 (conservador)
- Mantem 20 datapoints, mais recentes pesam mais

### Calibracao de W' e tau

- Quando W' atinge critico e HR confirma exaustao:
  - `W'_total` = blend com joules depletados observados
  - `tau` ≈ tempo_recuperacao / 1.2

### Auto-calibracao de Crr

Em segmentos planos (< 1% gradiente) com vento conhecido:
- Compara velocidade prevista vs actual
- Se modelo sobre-estima velocidade: Crr demasiado baixo → aumenta 0.001
- Se modelo sub-estima: Crr demasiado alto → reduz 0.001
- Precisa de >= 3 observacoes por superficie

### Protocolo de Campo CP/W' (3 + 12 minutos)

Teste estruturado para calibracao precisa:

**Protocolo:**
1. Warmup 15 min
2. Esforco maximo 12 minutos → registar potencia media (P12)
3. Descanso 30 min (recuperacao total)
4. Esforco maximo 3 minutos → registar potencia media (P3)

**Calculos (fisica pura):**
```
Work_12 = P12 × 720s
Work_3  = P3  × 180s
CP = (Work_12 - Work_3) / (720 - 180)
W' = 720 × (P12 - CP)         [joules]
tau = W' / (P3 - CP)           [segundos]
```

**Exemplo para rider 135kg com FTP ~150W:**
- P12 = 160W, P3 = 220W
- CP = (160×720 - 220×180) / 540 = 140W
- W' = 720 × (160 - 140) = 14400 J
- tau = 14400 / (220 - 140) = 180s

**Validacao:** CP 50-400W, W' 3000-40000J. Fora disto = teste invalido.  
**Confianca:** 0.9 (field test >> calibracao passiva de rides).

**Implementacao:** `RiderLearning.applyFieldTest(P12, P3)` — aplica imediatamente, regista como datapoints de alta qualidade.

### Override Detection

- Regista ultimo comando enviado (support, torque, launch, timestamp)
- Se rider muda modo dentro de 15s do comando: regista como override
- Apos 3 overrides consecutivos nas mesmas condicoes: ajusta base permanentemente

---

## 9. Layer 7: Nutrition (30s)

**Ficheiro:** `src/services/intelligence/NutritionEngine.ts`  
**Classe:** `NutritionEngine`

### Glicogenio

**Reservas iniciais:** 480-600g (depende se comeu carbos nas 3h anteriores)

**Calculo de queima:**
```
metabolismo_total_W = P_human / 0.24    (eficiencia mecanica 24%)
kcal_por_min = metabolismo_total_W / 69.7
queima_glicogenio_g_min = (kcal_por_min × fraccao_carbos) / 4.0
```

**Fraccao de carbos por zona HR:**

| Zona | Carbos | Gordura |
|------|--------|---------|
| Z1 | 35% | 65% |
| Z2 | 47% | 53% |
| Z3 | 70% | 30% |
| Z4 | 85% | 15% |
| Z5 | 95% | 5% |

### Ligacao Bidirecional: Glicogenio → CP_effective

Quando o glicogenio desce, o CP real do atleta contrai:

| Glicogenio | CP Factor | W' Factor | Efeito |
|-----------|-----------|-----------|--------|
| > 35% | 1.0 | 1.0 | Normal |
| 20-35% | 0.88 | 0.85 | CP reduzido, W' depletavel mais rapido |
| < 20% | 0.75 | 0.70 | Critico — motor compensa |

Isto altera directamente o W' Balance na Layer 2: com CP_effective mais baixo, qualquer esforco que antes estava abaixo do CP agora pode estar acima → W' depleta mais rapido → motor reage com mais assistencia.

### Hidratacao

```
taxa_suor_L_h = (0.5 + 0.015 × P_human/10 + 0.03 × max(0, temp - 15)) × factor_individual
```
- Deficit acumulado em ml
- Desidratacao = deficit / (peso × 10) × 100
- Amber: > 1.5% | Critical: > 3%

### Electrolitos (Sodio)

```
sodio_perdido_mg = 650 × taxa_suor_L_h × dt_horas
```
- 650 mg Na+ por litro de suor (midpoint 500-800)
- Amber: > 1200 mg | Critical: > 2000 mg

### Intake Recording

- `recordEat(product)` — repoe glicogenio, actualiza timestamp
- `recordDrink(product)` — reduz deficit hidrico, repoe electrolitos
- Produtos por defeito: barra (45g carbs), gel (22g), banana (25g), isotonica 500ml (30g + 350mg Na)

### Calibracao da Taxa de Suor

Protocolo peso antes/depois:
```
taxa_real = (peso_antes - peso_depois + fluido_ingerido_L) / horas_ride
factor = taxa_real / 0.9
```

---

## 10. Decision Tree

A cada tick (1s), o KromiEngine avalia por prioridade. O primeiro que aplica define Support/Torque/Launch:

```
Prioridade 1: W' balance < 30%
  → Support = MAX (350%), Torque = 68Nm, Launch = 5
  → Alerta: "Reserva anaerobica baixa. Mantem zona 2."
  → Razao: Atleta sem capacidade anaerobica. Motor TEM de compensar.

Prioridade 2: Zone breach < 8 min
  → Support = 280%, Torque = 65Nm, Launch = 4
  → Alerta: "Fadiga cardiaca detetada. Reduz ritmo X minutos."
  → Razao: Pre-emptivo. Reduz carga ANTES do rider ultrapassar zona.

Prioridade 3: Bateria emergencia < 5km
  → Support = 70%, Torque = 25Nm, Launch = 2
  → Alerta: "Bateria limitada. Modo emergencia."
  → Razao: Conservar os ultimos Wh para chegar a casa.

Prioridade 4: Cardiac drift > 0.4 bpm/min
  → Support = gap × 0.8 × batteryFactor
  → Torque = max 70% do normal (suaviza spikes)
  → Alerta: nenhum (ainda nao e critico)

Prioridade 5: Calculo fisico normal
  → Support = (P_gap / P_human) × 100 × hrMod × fadeFactor × batteryFactor × formMultiplier
  → Torque = F_total × raio_roda × hrMod × fadeFactor × batteryFactor
  → Launch = baseado em velocidade + gradiente (7=steep start, 1=cruise)
  → Boost: se cadencia < 50 e gradiente > 3% → torque × 1.3
  → Descida: se gradiente < -3% → support capped a 70%

Prioridade 6: Motor off (> 25 km/h)
  → Support = MIN, Torque = MIN, Launch = 1
  → Sem consumo bateria. W' recovery window.
```

### Pos-Decision Tree

1. **Pre-adjustment ramp** — se lookahead detectou transicao a < 5s, blend progressivo para valores alvo
2. **EMA Smoothing** — alpha = 0.3 para Support e Torque (previne saltos bruscos)
3. **Clamp** — Support [50, 350], Torque [20, 85], Launch [1, 7]
4. **Dedup** — so envia ao motor se wire values mudaram

---

## 11. Output para o Motor

### Wire Encoding

```typescript
function toWire(value: number, min: number, max: number): number {
  return Math.round(((clamp(value, min, max) - min) / (max - min)) * 15);
}
```

| Parametro | Min | Max | Wire 0 | Wire 8 | Wire 15 |
|-----------|-----|-----|--------|--------|---------|
| Support | 50% | 350% | 50% | 200% | 350% |
| Torque | 20Nm | 85Nm | 20Nm | 52.5Nm | 85Nm |
| Launch | 1 | 7 | 1 | 4 | 7 |

### Comando BLE

```
Formato: 0xE3 0x0C [reset] [power_s] [power_t<<4|power_l] [sport...] [active...] [tour...] [eco...]
```
- Encriptado com AES key do GEV
- Enviado via WebSocket → BLEManager.kt → `setAdvancedTuning()`
- Apenas POWER mode e alterado pelo KROMI. Outros modos ficam em defaults (wire 8).

### Logging (Supabase)

A cada 10s, via `dlog()`:
```
[KROMI v2] S=210%(10/15) T=45Nm(6/15) L=3(5/15) | zone=active grad=8.2 gear=4 spd=14 cad=72 hr=142 bat×1.00 W'=85% score=53 | Fisica: gap=180W hr×1.0 bat×1.00
```

---

## 12. Alertas ao Rider

Alertas sao strings em portugues, max 4 por tick. Provem de:

### Motor/Fisicos
- `"Subida de 12% a 600m. Support aumentado."`
- `"Bateria limitada. Reducao gradual nos proximos 15km."`
- `"Muda para relacao mais pequena."`
- `"Reserva anaerobica baixa. Mantem zona 2."`
- `"Fadiga cardiaca detetada. Reduz ritmo 5 minutos."`

### Nutricao
- `"Come agora. Barra ou banana. 40 minutos sem ingestao."`
- `"Bebe. Temperatura alta, transpiracao elevada."`
- `"Zona de esforco alta. Evita solidos. Usa gel."`
- `"Glicogenio estimado abaixo de 20%. Reduz intensidade ou come de imediato."`
- `"Eletrolitos. 2 horas de ride, perdas acumuladas elevadas."`

---

## 13. Stack de APIs Externas

| API | Endpoint | Key | Cache | Dados |
|-----|----------|-----|-------|-------|
| Google Maps Elevation | `maps.googleapis.com/maps/api/elevation` | VITE_GOOGLE_MAPS_API_KEY | 30s, throttle 3s | Perfil elevacao 500m ahead (heading-based) |
| Google Weather | `weather.googleapis.com/v1/currentConditions` | VITE_GOOGLE_MAPS_API_KEY | 10 min | Temp, vento, humidade (primario) |
| Open-Meteo | `api.open-meteo.com/v1/forecast` | Nenhuma (gratis) | 10 min | Temp, vento, humidade (fallback) |
| OSM Overpass | `overpass-api.de/api/interpreter` | Nenhuma (gratis) | 30s, min 10s entre queries | Surface type, highway, MTB scale |

### Fallback Chain Weather
```
1. getCachedWeather()      ← Google Weather (se API key disponivel)
2. getCachedOpenMeteo()    ← Open-Meteo (gratis, sempre disponivel)
3. fetchOpenMeteoWeather() ← Trigger async fetch (nao bloqueia tick)
```

---

## 14. Ficheiros e Dependencias

### Novos (Session 10)

| Ficheiro | Linhas | Funcao |
|----------|--------|--------|
| `src/services/intelligence/KromiEngine.ts` | ~600 | Orquestrador 7 layers, decision tree, singleton |
| `src/services/intelligence/PhysicsEngine.ts` | ~165 | Forcas puras, P_total, P_human, 3-zone speed |
| `src/services/intelligence/PhysiologyEngine.ts` | ~330 | W' Skiba, drift, EF, IRC, hrModifier |
| `src/services/intelligence/NutritionEngine.ts` | ~355 | Glicogenio, hidratacao, electrolitos, CP feedback |
| `src/services/weather/OpenMeteoService.ts` | ~60 | API gratis vento + temperatura |
| `src/services/autoAssist/BatteryOptimizer.ts` | ~150 | Rolling Wh/km, 6-level budget, cold correction |
| `src/services/autoAssist/ElevationPredictor.ts` | ~310 | 4km lookahead, Mode A/B/C, auto-transition, gear suggestion |
| `src/services/autoAssist/RiderLearning.ts` | ~280 | CP/W'/Crr calibracao, field test protocol, override detection |
| `src/services/intelligence/PostRideAnalysis.ts` | ~370 | Pos-ride: actual vs predicted, W' curve, HR adherence, calibration |

### Editados

| Ficheiro | Mudanca |
|----------|---------|
| `src/hooks/useMotorControl.ts` | Thin orchestrator. Chama kromiEngine.tick() em vez de computeKromiPhysics() |

### Servicos Existentes Consumidos

| Servico | Ficheiro | Dados Consumidos |
|---------|----------|-----------------|
| BatteryEstimationService | `src/services/battery/BatteryEstimationService.ts` | remaining_wh, consumption_wh_km |
| ConsumptionCalibration | `src/services/battery/ConsumptionCalibration.ts` | Wh/km calibrado do motor cmd 17 |
| ElevationService | `src/services/maps/ElevationService.ts` | Perfil elevacao (Google API) |
| TerrainService | `src/services/maps/TerrainService.ts` | Categoria superficie (OSM) |
| WeatherService | `src/services/weather/WeatherService.ts` | Vento, temperatura (Google) |
| AutoAssistEngine | `src/services/autoAssist/AutoAssistEngine.ts` | Terrain analysis, gradient |
| TuningIntelligence | `src/services/motor/TuningIntelligence.ts` | UI display only (IntelligenceWidget) |

### Stores Zustand Lidos

| Store | Dados |
|-------|-------|
| bikeStore | speed, cadence, power, battery, hr, gear, distance, altitude, assist_mode |
| mapStore | latitude, longitude, heading, altitude, gpsActive |
| settingsStore | riderProfile (weight, hr_max, zones, target_zone), bikeConfig (chainring, cassette, wheel) |
| intelligenceStore | Escrita apenas (setDecision, setActive) |
| autoAssistStore | Escrita apenas (setLastDecision, setTerrain) |

---

## 15. Constantes do Rider e Bike

Estas constantes vem do `settingsStore.riderProfile` e `settingsStore.bikeConfig`:

### Rider
| Constante | Valor | Fonte |
|-----------|-------|-------|
| Peso | 135 kg | settingsStore.riderProfile.weight_kg |
| Altura | 192 cm | settingsStore.riderProfile.height_cm |
| HR Max | observado (do perfil) | settingsStore.riderProfile.hr_max |
| HR Rest | do perfil | settingsStore.riderProfile.hr_rest |
| Target Zone | Z2 default | settingsStore.riderProfile.target_zone |
| FTP | calibrado (~150W default) | RiderLearning.cp_watts |
| W' | 15000 J default | RiderLearning.w_prime_joules |
| tau | 300s default | RiderLearning.tau_seconds |
| Glicogenio inicial | 480-600g | NutritionEngine config |

### Bike
| Constante | Valor | Fonte |
|-----------|-------|-------|
| Peso bike | 23.8 kg | settingsStore.bikeConfig.weight_kg |
| Motor | Shimano EP800 SyncDrive Pro | - |
| Max Torque | 85 Nm | bikeConfig.max_torque_nm |
| Potencia nominal | 250W | - |
| Bateria principal | 800 Wh | bikeConfig.main_battery_wh |
| Range extender | 250 Wh | bikeConfig.sub_battery_wh |
| Total | 1050 Wh | - |
| Speed limit | 25 km/h (EU) | bikeConfig.speed_limit_kmh |
| Chainring | 34T | bikeConfig.chainring_teeth |
| Cassete | 10-51T (12-speed) | bikeConfig.cassette_sprockets |
| Circunferencia roda | 2290 mm | bikeConfig.wheel_circumference_mm |
| CdA | 0.6 m2 | Hardcoded (MTB upright) |
| Crr base | 0.006 | Variavel por superficie |

### Massa Total
```
159 kg = 135 kg (rider) + 24 kg (bike)
```
Domina completamente a fisica. Uma subida de 10% com 159kg requer ~153N so de gravidade vs ~96N para um ciclista tipico de 100kg.

---

## 16. Output Pos-Ride

**Ficheiro:** `src/services/intelligence/PostRideAnalysis.ts`

Chamado quando a ride termina. Gera relatorio completo a partir de snapshots gravados durante a ride (1 snapshot a cada 5-10s).

### Consumo Real vs Previsto

Por cada segmento de 1km:
- **Wh previsto**: do Layer 4 (Lookahead) no momento em que o rider passou
- **Wh actual**: da telemetria de bateria (BLE)
- **Ratio**: actual/previsto. >1 = consumiu mais que esperado
- **Precisao global**: `(1 - |actual - previsto| / previsto) × 100%`

### Aderencia a Zonas de HR

- Tempo em cada zona (Z1-Z5) em segundos
- % do tempo na zona alvo
- % do tempo acima da zona alvo
- **Segmentos criticos**: onde HR excedeu zona alvo por >2 zonas durante >30s
  - Localizacao (km), duracao, zona maxima atingida

### Curva de W' Balance

- Pontos timestamp/balance para grafico (amostragem a cada 30s)
- Balance minimo atingido (%)
- Numero de eventos criticos (W' < 30%)
- Tempo total em estado critico (segundos)

### Resumo de Nutricao

- Glicogenio: inicio, fim, consumido, ingerido, balanco liquido
- Hidratacao: deficit acumulado, fluido ingerido
- Sodio perdido (mg)
- Taxa media de queima (g/min)
- Tempo em glicogenio baixo (<35%)

### Actualizacao de Parametros Calibrados

Compara antes vs depois da ride:
- **CP**: valor anterior → novo → delta (se esforcos sustentados detectados)
- **W'**: capacidade anterior → nova
- **tau**: constante recuperacao → nova
- **Crr**: ajustes por superficie acumulados
- **EF baseline**: anterior → novo

### Efficiency Score (0-100)

Pontuacao composta:
```
30% × aderencia_zona_HR
30% × precisao_consumo_bateria
20% × (1 - tempo_critico_W' / tempo_total)
20% × balanco_nutricional (positivo se net_glycogen > -100g)
```

### Texto de Resumo (Portugues)

Exemplo:
```
"18.5km em 72min, 420m D+. Consumo bateria: 95Wh (previsto 102Wh, 93% preciso).
Zona HR: 62% do tempo na Z2 alvo. W' critico 1× (min 22%). CP actualizado: 148→152W."
```

### Gravacao de Snapshots

Durante a ride, `recordSnapshot()` e chamado a cada 5-10s com:
- elapsed_s, km, speed, gradient, power, hr, hr_zone
- w_prime_pct, support_pct, torque_nm
- battery_soc, wh_consumed, predicted_wh_segment
- surface, glycogen_pct

`recordPrediction()` regista Wh previstos por segmento do Lookahead.  
`generateReport()` processa tudo no fim da ride.
