# KROMI BikeControl -- Claude Code Skills Index

## Overview

This directory contains specialized Claude Code skills for the KROMI BikeControl
project -- a PWA bike computer for the Giant Trance X E+ 2 (2023) eBike.

## Tech Stack Quick Reference

| Layer        | Technology                                          |
|--------------|-----------------------------------------------------|
| Framework    | React 18 + Vite + TypeScript                        |
| Styling      | Tailwind CSS (dark-first, portrait, 64px targets)   |
| State        | Zustand (6 stores)                                  |
| Auth         | Custom HS256 JWT (NOT Supabase Auth)                 |
| REST         | supaFetch (src/lib/supaFetch.ts) -- mandatory        |
| Files        | Google Drive via KromiFileStore                      |
| BLE          | Web Bluetooth API (Chrome Android)                   |
| Maps         | Google Maps JS + Elevation + Directions API          |
| Charts       | Recharts                                            |
| PWA          | Vite PWA Plugin + Service Worker + Wake Lock         |
| Deploy       | Vercel (PWA) + APK from git tags                     |
| Docs         | Obsidian vault auto-synced via kromi-doc             |

## Skills Index

| #  | Filename                        | Role                      | Description                                                        |
|----|---------------------------------|---------------------------|--------------------------------------------------------------------|
| 00 | 00-project-architect.md         | Project Architect         | Project structure, conventions, CLAUDE.md, env vars                |
| 01 | 01-frontend-react-engineer.md   | Frontend Engineer         | React 18 + Zustand + Tailwind dark-first + impersonation           |
| 02 | 02-database-supabase-engineer.md| Database Engineer         | Supabase + RLS + edge functions + custom JWT                       |
| 03 | 03-auth-security-specialist.md  | Auth & Security           | KROMI JWT + RBAC + impersonation + GDPR + rate limits              |
| 04 | 04-ble-protocol-engineer.md     | BLE Protocol Engineer     | 7 BLE services: GEV, CSC, Power, Di2, SRAM, HR, Battery           |
| 05 | 05-auto-assist-engine.md        | Auto-Assist Specialist    | 7-layer intelligence, elevation lookahead, override rules          |
| 06 | 06-motor-torque-engineer.md     | Motor & Torque Engineer   | GEV torque protocol, smoothing, launch control, terrain mapping    |
| 07 | 07-heart-rate-biometrics.md     | HR & Biometrics           | HR zones, fatigue model, W', TSS, biometric assist                 |
| 08 | 08-di2-sram-integration.md      | Di2/SRAM Integration      | Shift motor inhibit, gear efficiency, SRAM AXS suspension          |
| 09 | 09-pwa-configuration.md         | PWA Specialist            | Service worker, wake lock, offline, manifest, HTTPS                |
| 10 | 10-drive-storage-engineer.md    | Drive Storage Engineer    | Google Drive file storage, folder taxonomy, KromiFileStore API     |
| 11 | 11-ride-data-learning.md        | Ride Data & Learning      | Ride data collection, adaptive learning, TSS, fatigue model        |
| 12 | 12-dashboard-widgets.md         | Dashboard Widget Builder  | 9 MTB dashboard widgets, dark theme, touch-friendly layout         |
| 13 | 13-devops-deploy.md             | DevOps & Deploy           | Vercel deploy, APK build, GitHub Actions CI, pre-deploy checklist  |
| 14 | 14-documentation-obsidian.md    | Documentation & Obsidian  | kromi-doc CLI, Obsidian vault, git hooks, auto-sync                |
| 15 | 15-session-documentation.md     | Session Documentation     | CLAUDE.md maintenance, memory updates, session wrap-up (Stop hook) |
| 16 | 16-reverse-engineering.md       | Reverse Engineering       | APK decompilation, BLE protocol discovery, JADX, nRF validation    |
| 17 | 17-design-system.md             | STEALTH-EV Design System  | Colors, typography, layout, components, brand rules, dark-first    |

## Usage

Claude Code auto-selects skills via the routing table in CLAUDE.md.
Skills are matched by keywords in the user's request. Examples:

- **"Adiciona componente BLE"** -> skills 04, 01
- **"Nova tabela com RLS"** -> skills 02, 03
- **"Widget de battery"** -> skill 12
- **"Deploy para produção"** -> skill 13
- **"Upload de fotos"** -> skill 10
- **"Fim de sessão"** -> skill 15 (automático via Stop hook)

## Dependency Tree

```
00-project-architect (base para tudo)
  |
  +-- 01-frontend (UI + Zustand + Tailwind)
  |     +-- 12-dashboard-widgets (9 widgets)
  |
  +-- 02-database (Supabase + RLS)
  |     +-- 03-auth-security (JWT + RBAC)
  |     +-- 10-drive-storage (kromi_files table)
  |
  +-- 04-ble-protocol (7 BLE services)
  |     +-- 05-auto-assist (elevation + battery + learning)
  |     +-- 06-motor-torque (GEV torque commands)
  |     +-- 07-heart-rate (HR zones + fatigue)
  |     +-- 08-di2-sram (gear + shift inhibit)
  |
  +-- 09-pwa (service worker + wake lock)
  |
  +-- 11-ride-data-learning (IndexedDB + sync)
  |     +-- 10-drive-storage (ride file uploads)
  |
  +-- 13-devops-deploy (Vercel + APK + CI)
  |
  +-- 14-documentation-obsidian (kromi-doc + vault)
  |
  +-- 15-session-documentation (Stop hook, depende de TUDO)
```

## Which Skill for Which Task?

| Task                                          | Skill |
|-----------------------------------------------|-------|
| Setup projecto / CLAUDE.md / conventions      | 00    |
| Novo componente React / pagina / layout       | 01    |
| Nova tabela / migration / RLS policy          | 02    |
| Auth / JWT / RBAC / permissions / GDPR        | 03    |
| BLE connection / protocolo / novo sensor      | 04    |
| Auto-assist / elevação / override             | 05    |
| Motor torque / support level / launch ctrl    | 06    |
| Heart rate / zonas / fadiga / TSS             | 07    |
| Di2 / SRAM / gear shifting / cassette         | 08    |
| PWA / offline / wake lock / service worker    | 09    |
| Upload ficheiro / Google Drive / fotos        | 10    |
| Ride recording / learning / athlete profile   | 11    |
| Dashboard widget / dark UI / touch targets    | 12    |
| Deploy Vercel / APK build / CI / release      | 13    |
| Obsidian docs / kromi-doc / vault sync        | 14    |
| Fim sessão / actualizar CLAUDE.md / memory    | 15    |
| Decompilar APK / descobrir protocolo BLE      | 16    |
| Analisar source JADX / extrair UUIDs          | 16    |
| Validar pacotes com nRF Connect               | 16    |
| Design UI / cores / tipografia / mockup       | 17    |
| Brand STEALTH-EV / layout / components        | 17    |

## Conventions (apply to ALL skills)

- ALL Supabase REST calls via `supaFetch` -- never raw `fetch`
- ALL file uploads via `KromiFileStore.uploadFile()` -- never direct Drive API
- State management via Zustand stores only -- never React Context for real-time
- BLE subscriptions via `GiantBLEService` -- never direct `navigator.bluetooth`
- CSS: Tailwind dark-first, min 24px text, 64px touch targets, portrait layout
- PWA: request Wake Lock on mount, re-request on visibilitychange
- Auth: custom HS256 JWT, `kromi_uid()` for RLS -- never `auth.uid()`
