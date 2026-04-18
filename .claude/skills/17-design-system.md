# 17 — STEALTH-EV Design System

> **Skill type:** Claude Code Skill
> **Role:** Design System Specialist — aplica o design system STEALTH-EV/KROMI a todos os componentes, paginas e mockups.
> **Brand:** STEALTH-EV (nome no ecra) / KROMI (nome interno/codebase)
> **Source:** Extraido do codigo-fonte por Claude Code Design

---

## Identidade

| Aspecto | Valor |
|---------|-------|
| **Nome no ecra** | STEALTH-EV |
| **Nome interno** | KROMI, KROMI BikeControl, KROMI PLATFORM |
| **Produto** | Bike computer PWA (mobile) + companion (desktop) |
| **Lingua** | Portugues (PT-PT). Ingles para jargao tecnico e unidades SI |
| **Voz** | Informal, segunda pessoa singular (`tu`). Sem fluff, sem exclamacoes |
| **Emoji** | NUNCA. Icons = Material Symbols Outlined |
| **Numeros** | Tabular, precisos: `24.32 KM/H`, `0:00`, `--` para vazio |

---

## Palette de Cores (CSS Variables `--ev-*`)

### Backgrounds (dark-first, SEMPRE)
```
--ev-bg:                  #0e0e0e    ← base (nao pure black, evita OLED crush)
--ev-surface:             #131313    ← cards nivel 1
--ev-surface-container:   #1a1919    ← cards nivel 2
--ev-surface-container-high: #201f1f ← cards nivel 3
--ev-surface-variant:     #262626    ← separadores, wells
--ev-surface-bright:      #2c2c2c    ← hover, active states
#000000                              ← RESERVADO para hero surfaces (Speed, Assist bar)
```

### Accents (economia de cor — cada cor tem funcao unica)
```
--ev-primary:    #3fff8b   ← electric mint: active, connected, CTA primario, auto-assist
--ev-blue:       #6e9bff   ← power/data, CTA secundario
--ev-magenta:    #e966ff   ← cadence, metricas terciarias, W' balance
--ev-amber:      #fbbf24   ← warnings, torque, HR zone 3-4
--ev-red:        #ff716c   ← critical, errors, HR zone 5
```

### Text
```
--ev-on-surface:          #ffffff    ← texto primario
--ev-on-surface-variant:  #a0a0a0   ← texto secundario
--ev-outline-variant:     #494847   ← borders, dividers (@ 10-30% alpha)
```

### Regra: NUNCA usar cores fora desta palette. NUNCA light theme.

---

## Tipografia

### Familias (apenas 2)
| Familia | Uso | Pesos |
|---------|-----|-------|
| **Space Grotesk** | Numeros, display, labels, sidebar, CTAs, TUDO numerico | 700-900 |
| **Inter** | Body copy, input text, long-form | 400-600 |

### Carregamento
```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

### Tracking
```
Headlines:     letter-spacing: -0.02em
Speed number:  letter-spacing: -0.04em
Eyebrow labels: letter-spacing: 0.15em-0.2em
```

### Casing
| Contexto | Estilo |
|----------|--------|
| Unidades (`KM/H`, `W`, `RPM`) | ALL CAPS |
| Mode pills (`ECO`, `TOUR`, `SPRT`, `PWR`) | ALL CAPS |
| Eyebrows (`TRIP`, `GR`, `AUTO`) | ALL CAPS |
| Sidebar sections | ALL CAPS |
| CTAs em hero buttons (`COMI`, `BEBI`) | ALL CAPS |
| Body copy, instrucoes | Sentence case |

---

## Iconografia

- **UNICO sistema:** Material Symbols Outlined (webfont, CDN)
- **Outline** (`FILL 0`) por defeito
- **Filled** (`FILL 1`) = active/on (nav, BLE connected, battery full)
- **Tamanhos:** 14px (info), 16px (nav labels), 18px (sidebar), 20px (tab), 24px (bottom nav, cells)
- **Cor:** `--ev-primary` active, `--ev-on-surface-variant` inactive, `--ev-outline-variant` disabled
- **NUNCA:** PNG icons, emoji, unicode glyphs

### Icons frequentes
```
speed, map, terrain, settings, settings_bluetooth   — bottom nav
pedal_bike, electric_bike, directions_bike          — brand/device
bluetooth, location_on, battery_full, favorite      — top bar
bolt, electric_bolt, battery_5_bar, timer           — metrics
expand_more, expand_less, arrow_forward, login      — motion
admin_panel_settings, lock, widgets, construction   — settings
flashlight_on, radar, phone_iphone                  — accessories
```

---

## Geometria e Layout

### Corner Radii
| Uso | Radius |
|-----|--------|
| Quase tudo | `0` (rectangulos, NAO pills) |
| Hero buttons, chips | `2px` |
| Logo containers, inputs | `0-4px` |
| Focus rings, dots, progress | Full pill/circle |

### Cards
- Background: um nivel acima do parent (`--ev-surface-container` em `--ev-bg`)
- Borda: nenhuma, ou 1px low-alpha hairline
- Padding: 12-16px (tight)
- Formato: Icon + label + numero tabular (stacked ou side-by-side)
- Icon: 14-18px, label: 8-10px, valor: 16-32px

### Mobile Layout (ride view)
```
Top bar:     10%    — brand + status icons
Speed:       15%    — hero number, fullscreen #000
Map:         30%    — dark Google Maps + overlay cards
Metrics:     12%    — grid de metricas
Assist:      10%    — mode selector
Info:         8%    — strip informativa
Elevation:   fills  — perfil de elevacao
Bottom nav:  80px   — 5 botoes iguais, h-16 x w-16 hit area
```

### Desktop Layout
```
Sidebar:     240px fixed, 10-12px font, 18px icons
Main pane:   flex, 16-24px padding
```

### Touch Targets
- NUNCA < 44px
- Botoes primarios: 56-64px
- Bottom nav: 64px (h-16)

---

## Animacao e Interacao

### Principios
- **Minimal e funcional.** Sem bounces, sem elastic, sem page transitions.
- Press: `active:scale-95` (normal) ou `active:scale-90` (nav)
- Transitions: `duration-150` / `duration-200` / `duration-300`
- Loading: spinner mint 2px (`border-t-transparent rounded-full animate-spin`)
- Live indicator: `animate-pulse` dot no chip "KROMI Auto"

### Hover/Press States
| Estado | Mobile | Desktop |
|--------|--------|---------|
| Press | `active:scale-95`, cor mantem | — |
| Hover | raro | texto → white/mint, bg → nivel acima |
| Active tab | 2px mint border bottom/left + texto lighter + bold | idem |
| Focus input | 2px mint ring + underline animado (cresce do centro) | idem |

---

## Sombras e Glows

```css
/* Cards */
box-shadow: 0 4px 12px rgba(0,0,0,0.4);

/* Bottom nav */
box-shadow: 0 -4px 24px rgba(0,0,0,0.8);

/* Assist mode activo — glow mint */
box-shadow: 0 0 20px rgba(63,255,139,0.3);

/* Login CTA */
box-shadow: 0 8px 16px rgba(14,109,243,0.2);
```

### Transparencia e Blur
```css
/* Overlay cards no mapa */
background: rgba(0,0,0,0.6);
backdrop-filter: blur(12px);   /* backdrop-blur-md */

/* Bottom nav */
background: rgba(14,14,14,0.9);
backdrop-filter: blur(24px);   /* backdrop-blur-xl */
```

---

## Borders

- Hairlines: 1px `rgba(73,72,71, 0.1-0.2)` — subtis, nao beams
- Accent borders: 2px no **lado esquerdo** de overlay cards (mint/magenta/red = tipo de metrica)
- Focus: 2px ring completo

---

## Componentes Padrao

### MetricCard
```tsx
<div className="bg-[#1a1919] p-3 border-l-2 border-[#3fff8b]">
  <span className="text-[8px] tracking-[0.15em] uppercase text-[#a0a0a0]">
    SPEED
  </span>
  <span className="font-['Space_Grotesk'] text-2xl font-bold tracking-[-0.02em] text-white">
    24.32
  </span>
  <span className="text-[10px] tracking-[0.15em] uppercase text-[#a0a0a0]">
    KM/H
  </span>
</div>
```

### BigButton (Assist Mode)
```tsx
<button className="h-16 min-w-[64px] bg-[#131313] border border-[#494847]/20
  text-white font-['Space_Grotesk'] font-bold uppercase tracking-wider
  active:scale-95 transition-all duration-150
  data-[active=true]:bg-[#3fff8b]/10 data-[active=true]:border-[#3fff8b]
  data-[active=true]:text-[#3fff8b] data-[active=true]:shadow-[0_0_20px_rgba(63,255,139,0.3)]">
  ECO
</button>
```

### StatusDot (BLE connected)
```tsx
<span className="w-2 h-2 rounded-full bg-[#3fff8b] animate-pulse" />
```

### Empty State
```tsx
<span className="text-[#a0a0a0] font-['Space_Grotesk']">--</span>
```

---

## Anti-Patterns (NUNCA fazer)

| Anti-pattern | Correcto |
|---|---|
| Light theme ou fundo branco | SEMPRE dark, `--ev-bg` #0e0e0e |
| Pure black `#000` como bg geral | Reservado para hero surfaces |
| Gradients em conteudo normal | Flat surfaces (gradients so no login glow) |
| Pills/rounded em cards | Rectangulos, radius 0-4px |
| PNG icons ou emoji | Material Symbols Outlined |
| Hardcoded colors fora da palette | SEMPRE usar `--ev-*` variables |
| Touch target < 44px | Minimo 44px, primarios 56-64px |
| Fonte que nao Space Grotesk/Inter | Apenas estas 2 familias |
| Animacoes bouncy/elastic | Minimal: scale + fade |
| "N/A" ou "No data" | `--` (dois en-dashes) |
| `voce` | `tu` |
