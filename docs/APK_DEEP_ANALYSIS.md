# Giant RideControl APK — Deep Analysis Results

## ALL BLE UUIDs Found

### Giant Proprietary — Motor/Gateway
| UUID | Role |
|------|------|
| `F0BA3012` | GEV Service (legacy binary protocol) |
| `F0BA3013` | GEV Notify/Write characteristic |
| `F0BA5201` | Protobuf Service (new protocol) |
| `F0BA5202` | Protobuf Write |
| `F0BA5203` | Protobuf Notify |
| `F0BA5204` | Protobuf Extra |

### Giant TPMS (Tire Pressure Monitoring) — ARSManger
| UUID | Role |
|------|------|
| `83C80001` | TPMS Front Service |
| `83C80002` | TPMS Front Write |
| `83C80003` | TPMS Front Notify |
| `84C80001` | TPMS Rear Service |
| `84C80002` | TPMS Rear Write |
| `84C80003` | TPMS Rear Notify |

### Nordic DFU (Firmware Update)
| UUID | Role |
|------|------|
| `00001530` | DFU Service |
| `00001531` | DFU Control Point |
| `00001532` | DFU Packet |
| `0000FE59` | Nordic DFU Trigger |

### Standard BLE
| UUID | Role |
|------|------|
| `0000180A` | Device Information Service |
| `00002A26` | Firmware Revision String |
| `00002A27` | Hardware Revision String |
| `00002A28` | Software Revision String |

### Unknown/Other
| UUID | Notes |
|------|-------|
| `0000FE51` | Unknown vendor service |
| `515D6767-01B7-49E5-8273-C8D11B0F331D` | Unknown |
| `D90500C0-90AA-4C7C-B036-1E01FB8EB7EE` | Unknown service |
| `D90500C1-90AA-4C7C-B036-1E01FB8EB7EE` | Unknown characteristic |
| `D861B25A-1EDF-11EB-ADC1-0242AC120002` | Unknown |

## GEV Mode Commands (enum index → name)
```
0 = INTO_UPDATE_MODE      — firmware update
1 = INTO_TUNING_MODE      — motor parameter tuning
2 = INTO_FITNESS_MODE     — fitness/training display
3 = INTO_NAVIGATION_MODE  — navigation display
4 = INTO_SERVICE_MODE     — service/maintenance
5 = INTO_NORMAL_MODE      — standard riding
```

## GEV General Commands (enum index → name)
```
 0 = CONNECT_GEV
 1 = DISCONNECT_GEV
 2 = TRIGGER_BUTTON_LIGHT          — toggle bike light!
 3 = TRIGGER_BUTTON_ASSISTANCE_UP  — assist up
 4 = TRIGGER_BUTTON_POWER          — power button
 5 = TRIGGER_BUTTON_ASSISTANCE_DOWN — assist down
 6 = DIAGNOSTIC_ENERGY_PAK
 7 = DIAGNOSTIC_SYNC_DRIVE
 8 = DIAGNOSTIC_RIDE_CONTROL_DISPLAY
 9 = DIAGNOSTIC_REMOTE_BUTTON
10 = READ_FACTORY_DATA
11 = READ_RIDING_DATA
12 = NOTIFY_CALL                    — forward phone call notification
13 = NOTIFY_SMS                     — forward SMS notification
14 = NOTIFY_MAIL                    — forward email notification
15 = READ_TUNING_DATA
```

## ARSManger — TPMS (Tire Pressure)
The ARS (Air Reporting System) manager handles Giant's proprietary TPMS sensors.

Methods:
- `sendPasskey` — authenticate with TPMS sensor
- `getStatesReport` / `setStatesReport` — read/set tire states
- `getNowAlarmMode` / `setNowAlarmMode` — pressure alarm config
- `statesReportAck` — acknowledge state report
- `generalCommand` / `generalCommandWithResponse` — send commands

Uses CSC service (0x1816) alongside TPMS — possibly for wheel speed calibration.

## ContinuumManger — Display Controller
Manages the Continuum display (Giant's handlebar display unit).

Methods:
- `readSetting` / `writeSetting` — display configuration
- `readSummary` / `clearSummary` — ride summary data
- `passthruPushData` — push data to display
- `getSystemResetNotification` / `setSystemResetNotification` — reset handling
- `SystemResetNotificationACK` — acknowledge reset

## Giant Cloud API Endpoints
```
https://api.giant-hpb.com/          — Main API (HPB = High Performance Bike)
https://files.giant-hpb.com/        — File storage (firmware, assets)
https://login.gid.giantcycling.com/ — Giant ID OAuth login
https://hpb-backend-ride-data.s3.ap-northeast-1.amazonaws.com/ — Ride data (prod)
```

## Komoot Integration
```
https://auth-api.main.komoot.net/oauth/authorize — OAuth login
https://external-api.komoot.de/v007/             — Routes API
https://api.live-sync-production.komoot.net/partner/v1/tours/ — Live sync
```

## Phone Notification Forwarding
RideControl can forward phone notifications to the bike display:
- `NOTIFY_CALL` (12) — incoming call alert
- `NOTIFY_SMS` (13) — SMS notification
- `NOTIFY_MAIL` (14) — email notification

These are sent via GEV General Commands to the Smart Gateway,
which then shows them on the connected display (EVO, Dash, etc.)

## GPX Route Support
Topografix GPX 1.0 and 1.1 — route import/export for navigation.
