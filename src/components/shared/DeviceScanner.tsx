import { useState, useEffect, useCallback } from 'react';
import { wsClient, type ScanResultDevice, type BondedDevice } from '../../services/bluetooth/WebSocketBLEClient';
import { connectDevice, saveDevice, saveSensorDevice, startScan, stopScan } from '../../services/bluetooth/BLEBridge';
import { identifyDevice, getCategoryGroup } from '../../services/bluetooth/DeviceBrandDetector';

export interface ScanConnectedInfo {
  name: string;
  address: string;
  sensorType: string | null; // 'hr', 'di2', 'sram', 'power', 'cadence', 'light', 'radar', or null for bike
  brand: string;
  brandColor: string;
}

interface DeviceScannerProps {
  onConnected: (info?: ScanConnectedInfo) => void;
  onCancel: () => void;
  /** Pre-selected role from ConnectionsPage — overrides auto-detection */
  pendingRole?: string | null;
}

/**
 * PWA-driven BLE device scanner.
 * Shows live scan results from the bridge, user taps to connect.
 * Saves selected device MAC for future auto-connect.
 */
export function DeviceScanner({ onConnected, onCancel, pendingRole }: DeviceScannerProps) {
  const [devices, setDevices] = useState<ScanResultDevice[]>([]);
  const [bondedDevices, setBondedDevices] = useState<BondedDevice[]>([]);
  const [scanning, setScanning] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    // Start scan + request bonded devices
    startScan();
    wsClient.requestBonded();

    // Listen for bonded list
    const unsubBonded = wsClient.onBondedList((bonded) => {
      setBondedDevices(bonded);
    });

    // Listen for results — deduplicate by address, keep strongest RSSI
    const unsubResult = wsClient.onScanResult((device) => {
      setDevices((prev) => {
        const existing = prev.findIndex((d) => d.address === device.address);
        if (existing >= 0) {
          // Update RSSI if stronger
          if (device.rssi > prev[existing]!.rssi) {
            const updated = [...prev];
            updated[existing] = device;
            return updated;
          }
          return prev;
        }
        return [...prev, device];
      });
    });

    const unsubDone = wsClient.onScanDone(() => {
      setScanning(false);
    });

    return () => {
      unsubBonded();
      unsubResult();
      unsubDone();
      stopScan();
    };
  }, []);

  const handleSelect = useCallback((device: ScanResultDevice) => {
    setConnecting(device.address);
    stopScan();
    ((window as unknown as Record<string, unknown>).__dlog as ((msg: string) => void) | undefined)?.(`Scanner: selected ${device.name} (${device.address}) tags=[${device.tags}]`);

    // Route to correct manager based on device identity
    const identity = identifyDevice(device.name, device.tags, device.uuids);

    // Use pendingRole if set (user pre-selected the device type)
    const roleMap: Record<string, string | null> = {
      di2: 'di2', sram_axs: 'sram', heart_rate: 'hr',
      power_meter: 'power', cadence: 'cadence',
      light_front: 'light', light_rear: 'light', radar: 'radar',
    };
    const sensorType = (pendingRole && roleMap[pendingRole] !== undefined)
      ? roleMap[pendingRole]!
      : device.tags.includes('HR') || identity.category === 'heart_rate' ? 'hr'
      : device.tags.includes('DI2') || (identity.category === 'drivetrain' && identity.brand === 'shimano') ? 'di2'
      : device.tags.includes('SRAM') || (identity.category === 'drivetrain' && identity.brand === 'sram') ? 'sram'
      : (device.tags.includes('POWER') && !device.tags.includes('GIANT')) || identity.category === 'power' ? 'power'
      : identity.category === 'cadence' ? 'cadence'
      : identity.category === 'light' ? 'light'
      : identity.category === 'radar' ? 'radar'
      : null;

    if (sensorType) {
      // External sensor — save for auto-connect (cadence uses bridge-only, no localStorage)
      if (sensorType !== 'cadence') {
        saveSensorDevice(sensorType as 'hr' | 'di2' | 'sram' | 'power' | 'light' | 'radar', { name: device.name, address: device.address });
      }
      if (sensorType === 'di2') {
        // Di2 → ShimanoProtocol (needs auth, not generic SensorManager)
        wsClient.send({ type: 'shimanoConnect', address: device.address });
      } else {
        wsClient.send({ type: 'connectSensor', sensor: sensorType, address: device.address });
      }
    } else {
      // Bike/gateway → BLEManager
      saveDevice({ name: device.name, address: device.address });
      connectDevice(device.address);
    }

    const info: ScanConnectedInfo = {
      name: device.name,
      address: device.address,
      sensorType,
      brand: identity.brandLabel || '',
      brandColor: identity.color || '',
    };
    setTimeout(() => onConnected(info), 500);
  }, [onConnected, pendingRole]);

  const handleSelectBonded = useCallback((device: BondedDevice) => {
    setConnecting(device.address);
    const identity = identifyDevice(device.name, [], device.uuids);

    // Use pendingRole if set (user already chose the type), otherwise auto-detect
    const roleMap: Record<string, string | null> = {
      di2: 'di2', sram_axs: 'sram', heart_rate: 'hr',
      power_meter: 'power', cadence: 'cadence',
      light_front: 'light', light_rear: 'light', radar: 'radar',
    };
    const sensorType = (pendingRole && roleMap[pendingRole] !== undefined)
      ? roleMap[pendingRole]!
      : identity.category === 'heart_rate' ? 'hr'
      : (identity.category === 'drivetrain' && identity.brand === 'shimano') ? 'di2'
      : (identity.category === 'drivetrain' && identity.brand === 'sram') ? 'sram'
      : identity.category === 'power' ? 'power'
      : identity.category === 'cadence' ? 'cadence'
      : identity.category === 'light' ? 'light'
      : identity.category === 'radar' ? 'radar'
      : null;

    if (sensorType) {
      if (sensorType !== 'cadence') {
        saveSensorDevice(sensorType as 'hr' | 'di2' | 'sram' | 'power' | 'light' | 'radar', { name: device.name, address: device.address });
      }
      if (sensorType === 'di2') {
        wsClient.send({ type: 'shimanoConnect', address: device.address });
      } else {
        wsClient.send({ type: 'connectSensor', sensor: sensorType, address: device.address });
      }
    } else {
      saveDevice({ name: device.name, address: device.address });
      connectDevice(device.address);
    }

    const info: ScanConnectedInfo = {
      name: device.name,
      address: device.address,
      sensorType,
      brand: identity.brandLabel || '',
      brandColor: identity.color || '',
    };
    setTimeout(() => onConnected(info), 500);
  }, [onConnected, pendingRole]);

  const handleRescan = useCallback(() => {
    setDevices([]);
    setScanning(true);
    startScan();
    wsClient.requestBonded();
  }, []);

  // Sort: bikes first, then by RSSI (strongest first)
  const sorted = [...devices].sort((a, b) => {
    const aIsBike = a.tags.includes('GIANT') || a.tags.includes('GEV') || a.tags.includes('BIKE') ? 1 : 0;
    const bIsBike = b.tags.includes('GIANT') || b.tags.includes('GEV') || b.tags.includes('BIKE') ? 1 : 0;
    if (aIsBike !== bIsBike) return bIsBike - aIsBike;
    return b.rssi - a.rssi;
  });

  return (
    <div className="fixed inset-0 bg-[#0e0e0e]/98 z-50 flex flex-col">
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-[#494847]">
        <button onClick={onCancel} className="p-1 active:scale-90">
          <span className="material-symbols-outlined text-[#adaaaa] text-xl">arrow_back</span>
        </button>
        <div className="flex-1 text-center">
          <h2 className="text-sm font-bold text-white">Seleccionar Dispositivo</h2>
          <p className="text-[10px] text-[#777575]">
            {scanning
              ? `A procurar... (${devices.length} encontrados)`
              : `${devices.length} dispositivos — toca para ligar`}
          </p>
        </div>
        {!scanning ? (
          <button
            onClick={handleRescan}
            className="bg-[#262626] text-white text-[11px] font-bold px-3 py-1.5 rounded active:scale-95"
          >
            Scan
          </button>
        ) : (
          <div className="w-12" />
        )}
      </div>

      {/* Scanning indicator */}
      {scanning && (
        <div className="flex-none flex items-center gap-2 px-4 py-2 bg-blue-900/30">
          <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#6e9bff]">A procurar dispositivos BLE...</span>
        </div>
      )}

      {/* Device list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {/* Bonded devices that aren't in scan results */}
        {bondedDevices.filter(b => !devices.some(d => d.address === b.address)).length > 0 && (
          <>
            <div className="flex items-center gap-2 px-1 py-1.5">
              <span className="material-symbols-outlined text-sm text-[#6e9bff]">link</span>
              <span className="text-[11px] font-bold text-[#6e9bff] uppercase tracking-wide">Emparelhados</span>
            </div>
            {bondedDevices
              .filter(b => !devices.some(d => d.address === b.address))
              .map((device) => (
                <BondedDeviceRow
                  key={device.address}
                  device={device}
                  connecting={connecting === device.address}
                  onSelect={() => handleSelectBonded(device)}
                />
              ))}
            <div className="border-t border-[#333] my-2" />
          </>
        )}

        {sorted.map((device) => (
          <DeviceRow
            key={device.address}
            device={device}
            connecting={connecting === device.address}
            onSelect={() => handleSelect(device)}
          />
        ))}

        {!scanning && devices.length === 0 && (
          <div className="text-center text-[#777575] py-12">
            <span className="material-symbols-outlined text-4xl">bluetooth_searching</span>
            <p className="mt-2 text-sm">Nenhum dispositivo encontrado</p>
            <button
              onClick={handleRescan}
              className="mt-4 bg-[#24f07e] text-white px-6 py-3 rounded-sm font-bold active:scale-95"
            >
              Tentar novamente
            </button>
          </div>
        )}
      </div>

      {/* Fixed bottom cancel button — always visible */}
      <div className="flex-none px-4 py-3 border-t border-[#262626] bg-[#0e0e0e]">
        <button
          onClick={onCancel}
          className="w-full h-12 rounded-lg bg-[#262626] text-[#adaaaa] text-sm font-bold active:scale-95 transition-transform"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function BondedDeviceRow({ device, connecting, onSelect }: {
  device: BondedDevice;
  connecting: boolean;
  onSelect: () => void;
}) {
  const identity = identifyDevice(device.name, [], device.uuids);

  return (
    <button
      onClick={onSelect}
      disabled={connecting}
      className={`w-full flex items-center gap-3 p-3 rounded-sm active:scale-[0.98] transition-transform
        bg-[#1a1919] border border-[#6e9bff]/20
        ${connecting ? 'opacity-60' : ''}
      `}
    >
      <span className="material-symbols-outlined text-2xl" style={{ color: identity.color }}>
        {identity.icon}
      </span>
      <div className="flex-1 text-left">
        <div className="text-white font-bold text-sm flex items-center gap-1.5">
          {device.name}
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-[#6e9bff] bg-[#6e9bff]/10">
            Paired
          </span>
          {identity.badge && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ color: identity.color, backgroundColor: `${identity.color}20` }}
            >
              {identity.badge}
            </span>
          )}
        </div>
        <div className="text-[#777575] text-[10px]">{device.address}</div>
      </div>
      <div className="text-right">
        {connecting ? (
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="material-symbols-outlined text-lg text-[#6e9bff]">bluetooth_connected</span>
        )}
      </div>
    </button>
  );
}

function DeviceRow({ device, connecting, onSelect }: {
  device: ScanResultDevice;
  connecting: boolean;
  onSelect: () => void;
}) {
  const identity = identifyDevice(device.name, device.tags, device.uuids);
  const group = getCategoryGroup(identity.category);
  const isBike = identity.category === 'bike';

  const rssiColor =
    device.rssi > -60 ? 'text-[#3fff8b]' :
    device.rssi > -80 ? 'text-[#fbbf24]' : 'text-[#ff716c]';

  const rssiLabel =
    device.rssi > -60 ? 'Forte' :
    device.rssi > -80 ? 'Medio' : 'Fraco';

  return (
    <button
      onClick={onSelect}
      disabled={connecting}
      className={`w-full flex items-center gap-3 p-3 rounded-sm active:scale-[0.98] transition-transform
        ${isBike ? 'bg-[#3fff8b]/10 border border-[#3fff8b]/30' : 'bg-[#1a1919]'}
        ${connecting ? 'opacity-60' : ''}
      `}
    >
      {/* Icon */}
      <span className="material-symbols-outlined text-2xl" style={{ color: identity.color }}>
        {identity.icon}
      </span>

      {/* Info */}
      <div className="flex-1 text-left">
        <div className="text-white font-bold text-sm flex items-center gap-1.5">
          {device.name}
          {identity.badge && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ color: identity.color, backgroundColor: `${identity.color}20` }}
            >
              {identity.badge}
            </span>
          )}
        </div>
        <div className="text-[#777575] text-[10px] flex items-center gap-2">
          <span>{device.address}</span>
          {identity.categoryLabel && identity.categoryLabel !== identity.badge && (
            <span style={{ color: group.color }}>{identity.categoryLabel}</span>
          )}
        </div>
      </div>

      {/* RSSI + connecting */}
      <div className="text-right">
        {connecting ? (
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            <div className={`text-xs font-bold ${rssiColor}`}>{device.rssi} dB</div>
            <div className="text-[10px] text-[#777575]">{rssiLabel}</div>
          </>
        )}
      </div>
    </button>
  );
}
