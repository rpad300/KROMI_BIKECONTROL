import { useState } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { giantBLEService } from '../../services/bluetooth/GiantBLEService';
import { GIANT_DEVICE_NAME } from '../../types/bike.types';

const SENSOR_CONFIG = {
  battery: { name: 'Battery', model: 'Built-in', icon: 'battery_full' },
  csc: { name: 'Speed/Cadence', model: 'Built-in CSC', icon: 'speed' },
  power: { name: 'Power Meter', model: 'Giant Power Pro', icon: 'bolt' },
  gev: { name: 'Motor GEV', model: 'SyncDrive Pro2', icon: 'electric_bike' },
  heartRate: { name: 'Heart Rate', model: 'Polar H10', icon: 'monitor_heart' },
  di2: { name: 'Shimano Di2', model: 'EW-WU111', icon: 'settings_suggest' },
  sram: { name: 'SRAM AXS', model: 'Flight Attendant', icon: 'swap_vert' },
} as const;

export function Connections() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const services = useBikeStore((s) => s.ble_services);
  const battery = useBikeStore((s) => s.battery_percent);
  const [scanning, setScanning] = useState(false);

  const connectedCount = Object.values(services).filter(Boolean).length;
  const totalSensors = Object.keys(services).length;

  const handleConnect = async () => {
    setScanning(true);
    try {
      await giantBLEService.connect();
    } catch (err) {
      console.error('Connection failed:', err);
    } finally {
      setScanning(false);
    }
  };

  const handleDisconnect = () => {
    giantBLEService.disconnect();
  };

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-emerald-400">Connections</h1>
        <button
          onClick={handleConnect}
          disabled={scanning}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            scanning ? 'bg-emerald-500/20 animate-spin' : 'bg-gray-800 active:bg-gray-700'
          }`}
        >
          <span className="material-symbols-outlined text-emerald-400">refresh</span>
        </button>
      </div>

      {/* Main bike card */}
      <div className={`bg-gray-800 rounded-xl p-4 border ${
        bleStatus === 'connected' ? 'border-emerald-500/30' : 'border-gray-700'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500 uppercase">Host Device</div>
            <div className="text-xl font-bold text-white mt-0.5">Giant {GIANT_DEVICE_NAME}</div>
            <div className="text-xs text-gray-500 mt-1">Motor | Gateway | Battery</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Battery</div>
            <div className="text-2xl font-bold text-emerald-400">{battery}%</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <StatusDot status={bleStatus === 'connected' ? 'connected' : bleStatus === 'connecting' ? 'searching' : 'disconnected'} />
          <span className={`text-sm font-bold ${bleStatus === 'connected' ? 'text-emerald-400' : 'text-gray-400'}`}>
            {bleStatus === 'connected' ? 'Connected' : bleStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>
        <button
          onClick={bleStatus === 'connected' ? handleDisconnect : handleConnect}
          className={`w-full h-12 rounded-xl font-bold text-base mt-3 active:scale-95 transition-transform ${
            bleStatus === 'connected'
              ? 'bg-red-600/20 text-red-400 border border-red-600/30'
              : 'bg-emerald-500 text-black'
          }`}
        >
          {bleStatus === 'connected' ? 'Disconnect' : scanning ? 'Scanning...' : 'Connect'}
        </button>
      </div>

      {/* Sensor grid */}
      <div className="flex-1 grid grid-cols-2 gap-2 min-h-0">
        {(Object.entries(SENSOR_CONFIG) as [keyof typeof SENSOR_CONFIG, typeof SENSOR_CONFIG[keyof typeof SENSOR_CONFIG]][]).map(
          ([key, cfg]) => (
            <SensorCard
              key={key}
              name={cfg.name}
              model={cfg.model}
              icon={cfg.icon}
              connected={services[key] ?? false}
            />
          )
        )}
      </div>

      {/* Status footer */}
      <div className="bg-gray-800 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-300 font-bold">{connectedCount} of {totalSensors} connected</span>
          <span className="text-xs text-gray-500">Auto-reconnect: ON</span>
        </div>
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${(connectedCount / totalSensors) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SensorCard({ name, model, icon, connected }: { name: string; model: string; icon: string; connected: boolean }) {
  return (
    <div className={`bg-gray-800/60 rounded-xl p-3 flex flex-col gap-1.5 border ${
      connected ? 'border-emerald-500/20' : 'border-gray-700/50'
    }`}>
      <div className="flex items-center justify-between">
        <span className={`material-symbols-outlined text-xl ${connected ? 'text-emerald-400' : 'text-gray-600'}`}>
          {icon}
        </span>
        <StatusDot status={connected ? 'connected' : 'disconnected'} />
      </div>
      <div>
        <div className="text-sm font-bold text-white truncate">{name}</div>
        <div className="text-xs text-gray-500 truncate">{model}</div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: 'connected' | 'searching' | 'disconnected' }) {
  const colors = {
    connected: 'bg-emerald-400',
    searching: 'bg-yellow-400 animate-pulse',
    disconnected: 'bg-gray-600',
  };
  return <div className={`w-2.5 h-2.5 rounded-full ${colors[status]}`} />;
}
