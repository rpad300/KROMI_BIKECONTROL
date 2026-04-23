# Ride Page v2 — Complete Redesign Spec

> **Date:** 2026-04-23
> **Status:** Draft
> **Scope:** Single sub-project (ride.html v2)
> **Depends on:** Club System (Session 23), existing Supabase schema

---

## Overview

Complete redesign of `public/ride.html` into a world-class editorial ride page with:
- Club-branded theming (colours, logo, banner, fonts)
- Dark/light mode following system preference with manual toggle
- Responsive design (mobile-first, tablet, desktop)
- SEO with JSON-LD structured data and dynamic OG meta
- Live tracking integration badge
- Split architecture: thin HTML template + external JS engine
- FIT-calibrated speed model with group/fast/slow estimates
- Google Maps satellite, SVG altimetry, segment mini-maps
- Weather (Open-Meteo), POIs (Google Places), chronogram with smart stops
- Photo gallery with lightbox
- Print-friendly layout

---

## 1. Architecture

### File structure
```
public/
  ride.html                    — thin HTML template (~150 lines)
  ride-engine.js               — all logic: data fetch, GPX parse, render, maps (~1800 lines)
  ride-styles.css              — all styles including dark/light themes (~500 lines)
```

### Why split
- `ride.html` is auto-generated for every ride — keep it minimal
- `ride-engine.js` is the reusable engine shared across all rides
- `ride-styles.css` is cacheable and avoids duplicating styles per ride
- Same deploy model (static files in `public/`), no build step needed
- Vite copies `public/` to `dist/` as-is

### Boot sequence
1. `ride.html` loads: CSS, Google Fonts, Google Maps (async + callback), then `ride-engine.js`
2. `ride-engine.js` reads URL params (`?ride=` or `?id=`), fetches Supabase data, renders sections
3. Club theme applied after club data loads (CSS custom properties override)

---

## 2. Club Theming

### Theme data (from `clubs` table)
```json
{
  "color": "#3fff8b",
  "avatar_url": "https://...",
  "banner_url": "https://...",
  "theme": {
    "font_heading": "Fraunces",
    "font_body": "Geist",
    "color_primary": "#3fff8b",
    "color_secondary": "#6366f1",
    "dark_bg": "#0e0e0e",
    "light_bg": "#f0ebe1"
  }
}
```

### How it applies
- `--accent` set from `club.color` or `club.theme.color_primary`
- `--accent-secondary` from `club.theme.color_secondary` (fallback: computed complement)
- `--font-heading` from `club.theme.font_heading` (fallback: Fraunces)
- `--font-body` from `club.theme.font_body` (fallback: system sans-serif)
- Club logo in header badge, club banner as hero background
- If `club.theme` is not set, use KROMI defaults

### DB change needed
Add `theme` jsonb column to `clubs` table (optional, nullable). Backoffice tab gets a "Tema" section to configure.

---

## 3. Dark/Light Mode

### Implementation
- Follow `prefers-color-scheme` media query as default
- Manual toggle button (sun/moon icon) in top bar, persists in `localStorage`
- Two sets of CSS custom properties:

```css
:root, [data-theme="dark"] {
  --bg: #0e0e0e; --bg-card: #1a1919; --bg-deep: #141414;
  --text: #e8e6e1; --text-muted: #777; --text-soft: #aaa;
  --border: #262626;
}
[data-theme="light"] {
  --bg: #f0ebe1; --bg-card: #ffffff; --bg-deep: #f9f6ef;
  --text: #1a1c18; --text-muted: #6b7280; --text-soft: #3a3d36;
  --border: #e5dcc4;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    /* same as [data-theme="light"] */
  }
}
```

### Theme-color meta
Update dynamically: `#0e0e0e` for dark, `#f0ebe1` for light.

### Google Maps
- Dark mode: use `styles` array with dark colour scheme
- Light mode: default hybrid satellite (already good in light)

### Charts/SVGs
All SVG colours reference CSS custom properties, so they adapt automatically.

---

## 4. Responsive Design

### Breakpoints
- **Mobile** (<640px): single column, stacked stats, collapsed meta
- **Tablet** (640-1024px): 2-column grids, side-by-side stats
- **Desktop** (>1024px): full 1400px width, 4-column KPI grids, segment 2-column layout (map + details)

### Key responsive rules
- Hero: `clamp(36px, 10vw, 96px)` for title
- Stats strip: `repeat(3, 1fr)` on mobile, `repeat(5, 1fr)` on desktop
- Map: full-width all breakpoints, height 350px mobile / 500px tablet / 600px desktop
- Segments: single column on mobile (map above details), 2-col on desktop
- Timeline: time column collapses to smaller width on mobile
- KPI cards: 2x2 grid on mobile, 4x1 on desktop
- POI cards: 1 column mobile, 2 tablet, 3 desktop
- Gallery: 2 columns mobile, 3 tablet, 4 desktop
- Touch targets: minimum 44px for all interactive elements

### Orientation
- Portrait-first (mobile on handlebars)
- Landscape works but not optimised (it's a read page, not a ride UI)

---

## 5. SEO + Social Sharing

### JSON-LD Structured Data
```json
{
  "@context": "https://schema.org",
  "@type": "SportsEvent",
  "name": "Marao Sobrado",
  "description": "Travessia BTT de 75.6 km...",
  "startDate": "2026-04-25T08:30:00+01:00",
  "endDate": "2026-04-25T16:11:00+01:00",
  "location": {
    "@type": "Place",
    "name": "Serra do Marao",
    "geo": { "@type": "GeoCoordinates", "latitude": 41.248, "longitude": -7.887 }
  },
  "organizer": {
    "@type": "SportsTeam",
    "name": "Cai na Lama & friends",
    "url": "https://www.kromi.online/club.html?s=cai-na-lama-friends"
  },
  "maximumAttendeeCapacity": 20,
  "eventStatus": "https://schema.org/EventScheduled",
  "image": "https://...",
  "url": "https://www.kromi.online/ride.html?ride=..."
}
```

Injected as `<script type="application/ld+json">` after data loads.

### OG Meta (dynamic)
- `og:title` — ride name + club name
- `og:description` — distance, D+, duration, participant count
- `og:image` — first ride photo, or club banner, or KROMI default
- `og:url` — canonical URL
- `og:type` — `article` (for ride reports) or `event` (for planned rides)
- `twitter:card` — `summary_large_image`

### Additional meta
- `<meta name="robots" content="index, follow">` (public rides)
- `<link rel="canonical" href="...">` (dynamic)
- `<meta name="description">` (dynamic, 155 chars max)

---

## 6. Live Tracking Integration

### When to show
- Ride status is `active` (from `club_rides.status`)
- Or ride `scheduled_at` is within ±2 hours of now

### UI
- **Pulsing red "LIVE" badge** in the hero section, next to the club badge
- **Sticky bottom bar** (mobile) or **floating card** (desktop) with:
  - "Acompanhar em tempo real" CTA
  - Number of riders currently tracking
  - Link: `https://www.kromi.online/live.html?ride={ride_id}`
- Badge pulses with CSS animation (red dot + ring)

### Data check
```javascript
// Check if ride is active
if (data.status === 'active') showLiveBadge();
// Or if ride is upcoming within 2h
if (data.scheduled_at) {
  var diff = new Date(data.scheduled_at) - Date.now();
  if (diff > -7200000 && diff < 7200000) showLiveBadge();
}
```

---

## 7. Sections (render order)

### 7.1 Top Bar (sticky)
- KROMI logo (left)
- Club name (center, truncated)
- Theme toggle (sun/moon) + "Abrir App" button (right)
- Glassmorphism: `backdrop-filter: blur(16px)`

### 7.2 Hero (full viewport)
- Club banner as background with gradient overlay
- Live badge (if active)
- Club badge (link to club.html)
- Ride name in serif font (clamp 36-96px)
- Date, meeting time, departure time, meeting point
- Stats bar: distance, D+, D-, duration, avg speed

### 7.3 Stats Strip
- 5-6 large numbers in serif font
- Accent-coloured gradient top border
- Values from ride stats or GPX computation

### 7.4 Map (full-width)
- Google Maps hybrid satellite
- GPX track (white outline + accent polyline)
- Start/End markers
- Section header "01 . Rota"

### 7.5 Elevation Profile
- SVG in grid-paper container
- Gradient fill by slope
- Interactive hover tooltip
- Caption with D+, D-, min/max altitude
- Section header "02 . Altimetria"

### 7.6 Segments
- Auto-detected from GPX (sustained >50m gain/loss)
- 2-column: mini Google Maps (left) + details (right)
- Each: gradient bar, difficulty badge, stats, fast/slow/group estimates with speed
- Section header "03 . Segmentos"

### 7.7 Chronogram KPI Cards
- 4 cards: Total Time, Moving Time, Stopped Time, Distance
- Moving = riding + regroups; Stopped = lunch, cafe, water
- Each with effective speed

### 7.8 Chronogram Timeline
- Vertical timeline with dots, times, descriptions
- Smart stops from waypoint name analysis
- Group penalty factor (1.19x)
- Section header "04 . Cronograma"

### 7.9 Weather Forecast
- Open-Meteo for 3 zones (start, mid, end)
- Only for future rides within 16 days
- Reliability note
- Section header "05 . Meteorologia"

### 7.10 Points of Interest
- Auto-generated (start, summit, valley, midpoint, end) + GPX waypoints
- Enriched with Google Places (name, rating, photo)
- Section header "06 . Pontos"

### 7.11 Rider Stats (post-ride only)
- Table with per-rider km, D+, speed, HR, power
- Top rider highlighted
- Section header "07 . Participantes"

### 7.12 Photo Gallery (post-ride only)
- CSS grid masonry
- Lightbox with caption
- Section header "08 . Galeria"

### 7.13 CTA Section
- "Junta-te a esta ride" or "Abre a app KROMI"
- Gradient background
- Download GPX button
- Share: Copy Link + WhatsApp

### 7.14 Footer
- KROMI logo
- Club social links
- Copyright
- "Powered by kromi.online"

---

## 8. Speed Model (FIT-calibrated)

### Bands (from real data analysis — 5 rides, 362 km)
| Gradient | Group (median) | Fast (p90) | Slow (p10) |
|---|---|---|---|
| >12% | 8 km/h | 11 km/h | 4 km/h |
| 8-12% | 10 km/h | 14 km/h | 7 km/h |
| 5-8% | 13 km/h | 20 km/h | 8 km/h |
| 2-5% | 16 km/h | 23 km/h | 9 km/h |
| flat ±2% | 18 km/h | 26 km/h | 10 km/h |
| -2% to -5% | 22 km/h | 34 km/h | 12 km/h |
| -5% to -10% | 28 km/h | 42 km/h | 14 km/h |
| <-10% | 28 km/h | 45 km/h | 10 km/h |

### Group penalty
1.19x applied to avg profile (micro-stops: GPS, water, photos, regrouping).

### Smart stop estimation
Keywords in waypoint names: restaurante/tasca (75/25 min), agua/fonte (12 min), atencao/travessia (12 min), viragem (10 min). Lunch guaranteed for rides >50km at ~45% distance.

---

## 9. Print Support

- `@media print` hides: navigation, live badge, share buttons, lightbox, sticky bars
- Forces light theme colours
- `break-inside: avoid` on sections
- Map renders as static (already rendered to canvas by Google Maps)

---

## 10. Accessibility

- `prefers-reduced-motion`: disable all animations, transitions, parallax
- `prefers-color-scheme`: auto dark/light
- Semantic HTML: `<header>`, `<main>`, `<section>`, `<footer>`, `<nav>`
- `aria-label` on interactive elements
- Alt text on images
- Focus-visible styles on buttons/links
- Keyboard navigation: Escape closes lightbox, Tab cycles through sections

---

## 11. Implementation Notes

### Files to create
```
public/ride-styles.css         — all CSS (dark/light themes, responsive, print, accessibility)
public/ride-engine.js          — all JS (data fetch, GPX parse, render, maps, weather, places)
```

### Files to modify
```
public/ride.html               — rewrite to thin template that loads CSS + JS
supabase/migrations/           — add theme jsonb to clubs table
src/components/Club/ClubBackofficeTab.tsx — add "Tema" section
```

### External dependencies (CDN)
- Google Fonts: Fraunces, Geist (if club uses it), JetBrains Mono
- Google Maps JS API (async + callback)
- Open-Meteo API (free, no key)
- Google Places API (via Maps library)

### No dependencies on
- React, Vite, or any build tool
- Leaflet (replaced by Google Maps)
- Any npm package
