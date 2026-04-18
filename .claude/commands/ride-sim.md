# /ride-sim — Simulation Mode Manager

Manage KROMI BikeControl simulation mode for development without the physical bike.

## Usage
- `/ride-sim on` — enable simulation: set `VITE_SIMULATION_MODE=true` in `.env`
- `/ride-sim off` — disable simulation: set `VITE_SIMULATION_MODE=false`
- `/ride-sim status` — show current simulation state
- `/ride-sim scenario <name>` — describe available ride scenarios (climb, descent, flat, mixed)

## What Simulation Mode Does
- BLE services return mock data instead of real Bluetooth connections
- GPS returns simulated route coordinates
- Elevation profile uses pre-built data
- Auto-assist engine processes simulated sensor data
- Motor commands are logged but not sent

## Simulated Data Sources
- Speed: 0-45 km/h cycling pattern
- Power: 50-350W with cadence correlation
- Heart Rate: 90-175 bpm effort curve
- Battery: 100% → slow drain
- Elevation: configurable route profile
- Di2 gear: 1-12 shifting pattern
