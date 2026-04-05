import { useState, useEffect, useCallback } from 'react';
import { wsClient, type ScanResultDevice } from '../../services/bluetooth/WebSocketBLEClient';
import { connectDevice, saveDevice, saveSensorDevice, startScan, stopScan } from '../../services/bluetooth/BLEBridge';

interface DeviceScannerProps {
  onConnected: () => void;
  onCancel: () => void;
}

/**
 * PWA-driven BLE device scanner.
 * Shows live scan results from the bridge, user taps to connect.
 * Saves selected device MAC for future auto-connect.
 */
export function DeviceScanner({ onConnected, onCancel }: DeviceScannerProps) {
  const [devices, setDevices] = useState<ScanResultDevice[]>([]);
  const [scanning, setScanning] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    // Start scan
    startScan();

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
      unsubResult();
      unsubDone();
      stopScan();
    };
  }, []);

  const handleSelect = useCallback((device: ScanResultDevice) => {
    setConnecting(device.address);
    stopScan();

    // Route to correct manager based on device tags
    const sensorType = device.tags.includes('HR') ? 'hr'
      : device.tags.includes('DI2') ? 'di2'
      : device.tags.includes('SRAM') ? 'sram'
      : device.tags.includes('POWER') && !device.tags.includes('GIANT') ? 'power'
      : null;

    if (sensorType) {
      // External sensor
      saveSensorDevice(sensorType, { name: device.name, address: device.address });
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

    setTimeout(() => onConnected(), 500);
  }, [onConnected]);

  const handleRescan = useCallback(() => {
    setDevices([]);
    setScanning(true);
    startScan();
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
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#494847]">
        <div>
          <h2 className="text-lg font-bold text-white">Seleccionar Dispositivo</h2>
          <p className="text-xs text-[#777575]">
            {scanning
              ? `A procurar... (${devices.length} encontrados)`
              : `${devices.length} dispositivos — toca para ligar`}
          </p>
        </div>
        <div className="flex gap-2">
          {!scanning && (
            <button
              onClick={handleRescan}
              className="bg-[#262626] text-white text-sm px-3 py-2 rounded-lg active:scale-95"
            >
              Scan
            </button>
          )}
          <button
            onClick={onCancel}
            className="bg-[#1a1919] text-[#adaaaa] text-sm px-3 py-2 rounded-lg active:scale-95"
          >
            Cancelar
          </button>
        </div>
      </div>

      {/* Scanning indicator */}
      {scanning && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-900/30">
          <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#6e9bff]">A procurar dispositivos BLE...</span>
        </div>
      )}

      {/* Device list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
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
    </div>
  );
}

function DeviceRow({ device, connecting, onSelect }: {
  device: ScanResultDevice;
  connecting: boolean;
  onSelect: () => void;
}) {
  const isBike = device.tags.includes('GIANT') || device.tags.includes('GEV') || device.tags.includes('BIKE');
  const isHR = device.tags.includes('HR');
  const isSRAM = device.tags.includes('SRAM');

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
      <span className={`material-symbols-outlined text-2xl ${
        isBike ? 'text-[#3fff8b]' : isHR ? 'text-[#ff716c]' : isSRAM ? 'text-[#fbbf24]' : 'text-[#777575]'
      }`}>
        {isBike ? 'pedal_bike' : isHR ? 'favorite' : 'bluetooth'}
      </span>

      {/* Info */}
      <div className="flex-1 text-left">
        <div className="text-white font-bold text-sm">
          {device.name}
          {isBike && <span className="ml-2 text-[#3fff8b] text-xs font-normal">BIKE</span>}
          {isHR && !isBike && <span className="ml-2 text-[#ff716c] text-xs font-normal">HR</span>}
          {isSRAM && <span className="ml-2 text-[#fbbf24] text-xs font-normal">SRAM</span>}
          {device.tags.includes('DI2') && <span className="ml-2 text-[#6e9bff] text-xs font-normal">Di2</span>}
          {device.tags.includes('POWER') && !isBike && <span className="ml-2 text-[#fbbf24] text-xs font-normal">POWER</span>}
        </div>
        <div className="text-[#777575] text-[10px]">{device.address}</div>
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
