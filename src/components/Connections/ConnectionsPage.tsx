/**
 * ConnectionsPage — unified device management.
 *
 * Shows "My Devices" list (only added devices) + "Add Device" flow.
 * Replaces the old Connections.tsx with its per-type sections.
 */

import { useState } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import {
  useDeviceStore,
  DEVICE_CATEGORIES,
  CATEGORY_ROLES,
  type DeviceCategory,
  type DeviceRole,
  type SavedDevice,
} from '../../store/deviceStore';
import * as BLE from '../../services/bluetooth/BLEBridge';
import { DeviceScanner, type ScanConnectedInfo } from '../shared/DeviceScanner';
import { webSensorService } from '../../services/sensors/WebSensorService';

// ── Helpers ────────────────────────────────────────────────────

/** Map scanner sensorType string to DeviceRole */
function sensorTypeToRole(sensorType: string | null, name: string): DeviceRole {
  switch (sensorType) {
    case 'hr': return 'heart_rate';
    case 'di2': return 'di2';
    case 'sram': return 'sram_axs';
    case 'power': return 'power_meter';
    case 'cadence': return 'cadence';
    case 'light': return /^VS\d/i.test(name) || /front/i.test(name) ? 'light_front' : 'light_rear';
    case 'radar': return 'radar';
    default: return 'motor';
  }
}

/** Map DeviceRole to DeviceCategory */
function roleToCategory(role: DeviceRole): DeviceCategory {
  switch (role) {
    case 'motor': return 'bike';
    case 'di2': case 'sram_axs': return 'drivetrain';
    case 'heart_rate': case 'cadence': return 'body';
    case 'power_meter': return 'performance';
    case 'light_front': case 'light_rear': return 'light';
    case 'radar': return 'radar';
    case 'tpms_front': case 'tpms_rear': return 'tpms';
  }
}

// ── Role → BLE connect/disconnect mapping ──────────────────────

function connectByRole(role: DeviceRole, address?: string): Promise<void> {
  // If we have an address and are in websocket mode, use the bridge
  if (BLE.bleMode === 'websocket' && address) {
    const sensorMap: Partial<Record<DeviceRole, string>> = {
      heart_rate: 'hr', cadence: 'cadence', power_meter: 'power',
      light_front: 'light', light_rear: 'light',
      radar: 'radar', tpms_front: 'tpmsFront', tpms_rear: 'tpmsRear',
    };
    const sensor = sensorMap[role];
    if (sensor) {
      import('../../services/bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
        wsClient.send({ type: 'connectSensor', sensor, address });
      });
      return Promise.resolve();
    }
  }

  // Role-specific connect functions
  switch (role) {
    case 'motor': return BLE.connectBike();
    case 'di2': return BLE.connectDi2();
    case 'sram_axs': return BLE.connectSRAM();
    case 'heart_rate': return BLE.connectHR();
    case 'cadence': return BLE.connectExtCadence();
    case 'power_meter': return BLE.connectExtPower();
    case 'light_front':
    case 'light_rear': return BLE.connectLight();
    case 'radar': return BLE.connectRadar();
    case 'tpms_front': return BLE.connectFrontTPMS();
    case 'tpms_rear': return BLE.connectRearTPMS();
    default: return Promise.resolve();
  }
}

function disconnectByRole(role: DeviceRole): void {
  switch (role) {
    case 'motor': BLE.disconnectBike(); break;
    case 'di2': BLE.disconnectDi2(); break;
    case 'sram_axs': BLE.disconnectSRAM(); break;
    case 'heart_rate': BLE.disconnectHR(); break;
    case 'cadence': BLE.disconnectExtCadence(); break;
    case 'power_meter': BLE.disconnectExtPower(); break;
    case 'light_front':
    case 'light_rear': BLE.disconnectLight(); break;
    case 'radar': BLE.disconnectRadar(); break;
    case 'tpms_front': BLE.disconnectFrontTPMS(); break;
    case 'tpms_rear': BLE.disconnectRearTPMS(); break;
  }
}

/** Check if a role is currently connected */
function isRoleConnected(role: DeviceRole, services: Record<string, boolean>, bleStatus: string): boolean {
  switch (role) {
    case 'motor': return bleStatus === 'connected';
    case 'di2': return !!services.di2;
    case 'sram_axs': return !!services.sram;
    case 'heart_rate': return !!services.heartRate;
    case 'cadence': return !!services.cadence;
    case 'power_meter': return !!services.power;
    case 'light_front':
    case 'light_rear': return !!services.light;
    case 'radar': return !!services.radar;
    case 'tpms_front':
    case 'tpms_rear': return false; // TPMS uses psi > 0
    default: return false;
  }
}

// ── Main Component ─────────────────────────────────────────────

export function ConnectionsPage() {
  const devices = useDeviceStore((s) => s.devices);
  const removeDevice = useDeviceStore((s) => s.removeDevice);
  const bleStatus = useBikeStore((s) => s.ble_status);
  const services = useBikeStore((s) => s.ble_services) as unknown as Record<string, boolean>;
  const addDevice = useDeviceStore((s) => s.addDevice);
  const [view, setView] = useState<'list' | 'add-category' | 'add-role' | 'scanner'>('list');
  const [selectedCategory, setSelectedCategory] = useState<DeviceCategory | null>(null);
  const [pendingRole, setPendingRole] = useState<DeviceRole | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [phoneSensorsOn, setPhoneSensorsOn] = useState(webSensorService.isRunning);

  // Show scanner for websocket mode
  if (view === 'scanner') {
    return (
      <DeviceScanner
        onConnected={(info?: ScanConnectedInfo) => {
          // Add device to deviceStore when selected from scanner
          if (info) {
            const role = pendingRole ?? sensorTypeToRole(info.sensorType, info.name);
            const category = pendingRole ? (selectedCategory ?? roleToCategory(role)) : roleToCategory(role);
            addDevice({
              name: info.name,
              address: info.address,
              category,
              role,
              brand: info.brand,
              brandColor: info.brandColor,
            });
          }
          setPendingRole(null);
          setView('list');
        }}
        onCancel={() => { setPendingRole(null); setView('list'); }}
      />
    );
  }

  // ── Add Device: Category Picker ──────────────────────────────
  if (view === 'add-category') {
    return (
      <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
        <div className="flex items-center gap-2">
          <button onClick={() => setView('list')} className="p-1">
            <span className="material-symbols-outlined text-[#777575]">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-white">Adicionar Dispositivo</h1>
        </div>
        <p className="text-xs text-[#777575] px-1">Que tipo de dispositivo queres adicionar?</p>
        <div className="flex flex-col gap-2">
          {DEVICE_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setSelectedCategory(cat.id);
                const roles = CATEGORY_ROLES[cat.id];
                if (roles.length === 1) {
                  // Single role — skip role picker
                  setPendingRole(roles[0]!.role);
                  handleStartScan(roles[0]!.role);
                } else {
                  setView('add-role');
                }
              }}
              className="flex items-center gap-3 p-4 bg-[#1a1919] rounded-lg active:bg-[#262626] transition-colors"
            >
              <span className="material-symbols-outlined text-2xl" style={{ color: cat.color }}>{cat.icon}</span>
              <div className="flex-1 text-left">
                <div className="text-sm font-bold text-white">{cat.label}</div>
                <div className="text-[10px] text-[#777575]">
                  {CATEGORY_ROLES[cat.id].map((r) => r.label).join(' · ')}
                </div>
              </div>
              <span className="material-symbols-outlined text-lg text-[#494847]">chevron_right</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Add Device: Role Picker ──────────────────────────────────
  if (view === 'add-role' && selectedCategory) {
    const cat = DEVICE_CATEGORIES.find((c) => c.id === selectedCategory)!;
    const roles = CATEGORY_ROLES[selectedCategory];
    return (
      <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
        <div className="flex items-center gap-2">
          <button onClick={() => setView('add-category')} className="p-1">
            <span className="material-symbols-outlined text-[#777575]">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-white">{cat.label}</h1>
        </div>
        <p className="text-xs text-[#777575] px-1">Escolhe a posicao ou tipo:</p>
        <div className="flex flex-col gap-2">
          {roles.map((r) => {
            const existing = devices.find((d) => d.role === r.role);
            return (
              <button
                key={r.role}
                onClick={() => {
                  setPendingRole(r.role);
                  handleStartScan(r.role);
                }}
                className="flex items-center gap-3 p-4 bg-[#1a1919] rounded-lg active:bg-[#262626] transition-colors"
              >
                <span className="material-symbols-outlined text-2xl" style={{ color: cat.color }}>{r.icon}</span>
                <div className="flex-1 text-left">
                  <div className="text-sm font-bold text-white">{r.label}</div>
                  {existing && (
                    <div className="text-[10px] text-[#777575]">Actual: {existing.name} — sera substituido</div>
                  )}
                </div>
                <span className="material-symbols-outlined text-lg text-[#494847]">chevron_right</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Start scan for a role ────────────────────────────────────
  function handleStartScan(role: DeviceRole) {
    setPendingRole(role);
    if (BLE.bleMode === 'websocket') {
      // WebSocket mode — show device scanner
      setView('scanner');
    } else {
      // Web BLE — use browser picker directly
      setConnecting(role);
      connectByRole(role).finally(() => {
        setConnecting(null);
        setView('list');
      });
    }
  }

  // ── Handle connect for existing device ───────────────────────
  async function handleConnect(device: SavedDevice) {
    setConnecting(device.id);
    try {
      await connectByRole(device.role, device.address);
    } catch { /* cancelled */ }
    setConnecting(null);
  }

  function handleDisconnect(device: SavedDevice) {
    disconnectByRole(device.role);
  }

  function handleRemove(device: SavedDevice) {
    disconnectByRole(device.role);
    removeDevice(device.id);
  }

  const togglePhoneSensors = async () => {
    if (phoneSensorsOn) {
      webSensorService.stop();
      setPhoneSensorsOn(false);
    } else {
      const ok = await webSensorService.start();
      setPhoneSensorsOn(ok);
    }
  };

  // Group devices by category
  const grouped = DEVICE_CATEGORIES
    .map((cat) => ({
      ...cat,
      devices: devices.filter((d) => d.category === cat.id),
    }))
    .filter((g) => g.devices.length > 0);

  const connectedCount = Object.values(services).filter(Boolean).length + (bleStatus === 'connected' ? 1 : 0);

  // ── Main List View ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-[#3fff8b]">Dispositivos</h1>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-1 rounded-full bg-[#262626] text-[#777575]">
            {BLE.bleMode === 'websocket' ? 'Bridge' : 'Web BLE'}
          </span>
          <button
            onClick={() => setView('add-category')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#3fff8b] text-black text-xs font-bold active:scale-95"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            Adicionar
          </button>
        </div>
      </div>

      {/* No devices */}
      {devices.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-12">
          <span className="material-symbols-outlined text-5xl text-[#494847]">bluetooth_searching</span>
          <p className="text-sm text-[#777575]">Nenhum dispositivo adicionado</p>
          <button
            onClick={() => setView('add-category')}
            className="px-4 py-2 rounded-lg bg-[#3fff8b] text-black text-sm font-bold active:scale-95"
          >
            Adicionar Primeiro Dispositivo
          </button>
        </div>
      )}

      {/* Device list grouped by category */}
      {grouped.map((group) => (
        <div key={group.id}>
          <div className="flex items-center gap-1.5 mb-2 px-1">
            <span className="material-symbols-outlined text-sm" style={{ color: group.color }}>{group.icon}</span>
            <span className="text-[10px] text-[#777575] uppercase tracking-wider font-bold">{group.label}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {group.devices.map((device) => {
              const connected = isRoleConnected(device.role, services, bleStatus);
              const isConnecting = connecting === device.id;
              return (
                <DeviceCard
                  key={device.id}
                  device={device}
                  connected={connected}
                  connecting={isConnecting}
                  onConnect={() => handleConnect(device)}
                  onDisconnect={() => handleDisconnect(device)}
                  onRemove={() => handleRemove(device)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Phone Sensors */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-[#6e9bff]">smartphone</span>
            <span className="text-[10px] text-[#777575] uppercase tracking-wider font-bold">Sensores do Telemovel</span>
          </div>
          <button
            onClick={togglePhoneSensors}
            className={`h-7 px-3 rounded text-[10px] font-bold active:scale-95 ${
              phoneSensorsOn ? 'bg-[#3fff8b]/20 text-[#3fff8b]' : 'bg-[#262626] text-[#777575]'
            }`}
          >
            {phoneSensorsOn ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="bg-[#1a1919] rounded-lg p-3 text-[10px] text-[#777575]">
          Barometro · Angulo de inclinacao · Temperatura · Lux
        </div>
      </div>

      {/* Connection summary */}
      <div className="bg-[#1a1919] rounded-lg px-4 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[#adaaaa] font-bold">
            {connectedCount} ligados · {devices.length} guardados
          </span>
        </div>
        <div className="h-1 bg-[#262626] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#3fff8b] rounded-full transition-all"
            style={{ width: `${devices.length > 0 ? (connectedCount / devices.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}

// ── Device Card ────────────────────────────────────────────────

function DeviceCard({
  device,
  connected,
  connecting,
  onConnect,
  onDisconnect,
  onRemove,
}: {
  device: SavedDevice;
  connected: boolean;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  const [showActions, setShowActions] = useState(false);

  // Get live data for specific roles
  const battery = useBikeStore((s) => s.battery_percent);
  const lightBattery = useBikeStore((s) => s.light_battery_pct);
  const hrBpm = useBikeStore((s) => s.hr_bpm);
  const power = useBikeStore((s) => s.power_watts);

  const roleLabels: Record<DeviceRole, string> = {
    motor: 'Motor', di2: 'Di2', sram_axs: 'AXS',
    heart_rate: 'HR', cadence: 'Cadencia', power_meter: 'Power',
    light_front: 'Frontal', light_rear: 'Traseira',
    radar: 'Radar', tpms_front: 'Frontal', tpms_rear: 'Traseiro',
  };

  // Live value based on role
  let liveValue = '';
  if (connected) {
    switch (device.role) {
      case 'motor': liveValue = battery > 0 ? `${battery}%` : ''; break;
      case 'heart_rate': liveValue = hrBpm > 0 ? `${hrBpm} bpm` : ''; break;
      case 'power_meter': liveValue = power > 0 ? `${power}W` : ''; break;
      case 'light_front':
      case 'light_rear': liveValue = lightBattery > 0 ? `${lightBattery}%` : ''; break;
    }
  }

  const catColor = DEVICE_CATEGORIES.find((c) => c.id === device.category)?.color ?? '#777575';

  return (
    <div
      className={`bg-[#1a1919] rounded-lg p-3 border ${
        connected ? 'border-[#3fff8b]/20' : 'border-[#262626]'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Status dot */}
        <div className="relative">
          <span className={`material-symbols-outlined text-2xl ${connected ? 'text-[#3fff8b]' : 'text-[#494847]'}`}>
            {DEVICE_CATEGORIES.find((c) => c.id === device.category)?.icon ?? 'bluetooth'}
          </span>
          <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#1a1919] ${
            connected ? 'bg-[#3fff8b]' : 'bg-[#494847]'
          }`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white truncate">{device.name}</span>
            {device.brand && (
              <span
                className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0"
                style={{ color: device.brandColor || catColor, backgroundColor: `${device.brandColor || catColor}20` }}
              >
                {device.brand}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#777575]">
            <span>{roleLabels[device.role] ?? device.role}</span>
            {connected && liveValue && (
              <>
                <span>·</span>
                <span className="text-[#3fff8b] font-bold">{liveValue}</span>
              </>
            )}
            {!connected && !connecting && <span>Desligado</span>}
            {connecting && <span className="text-[#fbbf24]">A ligar...</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {connected ? (
            <button
              onClick={onDisconnect}
              className="h-9 px-3 rounded text-[10px] font-bold bg-[#ff716c]/10 text-[#ff716c] active:scale-95 border border-[#ff716c]/20"
            >
              Desligar
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={connecting}
              className="h-9 px-3 rounded text-[10px] font-bold bg-[#3fff8b]/10 text-[#3fff8b] active:scale-95 border border-[#3fff8b]/20"
            >
              {connecting ? '...' : 'Ligar'}
            </button>
          )}
          <button
            onClick={() => setShowActions(!showActions)}
            className="h-9 w-8 flex items-center justify-center rounded bg-[#262626] active:scale-95"
          >
            <span className="material-symbols-outlined text-sm text-[#777575]">more_vert</span>
          </button>
        </div>
      </div>

      {/* Expanded actions */}
      {showActions && (
        <div className="mt-2 pt-2 border-t border-[#262626] flex items-center justify-between">
          <div className="text-[9px] text-[#494847] font-mono">{device.address}</div>
          <button
            onClick={() => { setShowActions(false); onRemove(); }}
            className="text-[10px] text-[#ff716c] font-bold px-2 py-1 rounded bg-[#ff716c]/10 active:scale-95"
          >
            Remover
          </button>
        </div>
      )}
    </div>
  );
}
