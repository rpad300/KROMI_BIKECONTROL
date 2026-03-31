# KROMI BikeControl

PWA computador de bordo para Giant Trance X E+ 2 (2023) com Smart Gateway.

Liga via Web Bluetooth ao motor, bateria, sensores de velocidade/cadencia/potencia, monitor de FC, Shimano Di2 e SRAM AXS Flight Attendant. Inclui algoritmo de auto-assist inteligente baseado em elevacao, frequencia cardiaca e gear, com aprendizagem adaptativa.

## Requisitos

- Chrome Android (Web Bluetooth)
- HTTPS (obrigatorio para BLE)
- Google Maps API Key (Elevation + Directions)
- Giant Trance X E+ 2 com Smart Gateway (device GBHA25704)

## Setup

```bash
npm install
cp .env.example .env
# Editar .env com a tua Google Maps API Key
npm run dev
```

Aceder no telemovel via `https://[ip-computador]:5173` (aceitar certificado auto-assinado).

## Modo Simulacao

Para desenvolvimento sem a bike:

```bash
VITE_SIMULATION_MODE=true npm run dev
```

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS (dark-first, touch-friendly)
- Zustand (state management)
- Web Bluetooth API
- Google Maps + Elevation API
- Recharts (elevation profile)
- Vite PWA Plugin

## Protocolos BLE

| Servico | UUID | Dados |
|---------|------|-------|
| Battery | 0x180F | % bateria (0-100) |
| CSC | 0x1816 | Velocidade + cadencia (roda 2290mm) |
| Power | 0x1818 | Potencia instantanea (watts) |
| GEV Giant | F0BA3012 | Controlo motor (AES encrypted) |
| SRAM AXS | 4D500001 | Suspensao Flight Attendant |
| Heart Rate | 0x180D | FC (qualquer monitor BLE) |
| Di2 E-Tube | 6e40fec1 | Mudancas Shimano Di2 |
