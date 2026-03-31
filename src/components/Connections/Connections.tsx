import { useState } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import * as BLE from '../../services/bluetooth/BLEBridge';

const GATEWAY_SERVICES = ['battery', 'csc', 'power', 'gev'] as const;

const SERVICE_META: Record<string, { name: string; icon: string; group: 'gateway' | 'standalone' }> = {
  battery:   { name: 'Battery',        icon: 'battery_full',      group: 'gateway' },
  csc:       { name: 'Speed/Cadence',  icon: 'speed',             group: 'gateway' },
  power:     { name: 'Power Meter',    icon: 'bolt',              group: 'gateway' },
  gev:       { name: 'Motor GEV',      icon: 'electric_bike',     group: 'gateway' },
  heartRate: { name: 'Heart Rate',     icon: 'monitor_heart',     group: 'standalone' },
  di2:       { name: 'Shimano Di2',    icon: 'settings_suggest',  group: 'standalone' },
  sram:      { name: 'SRAM AXS',      icon: 'swap_vert',         group: 'standalone' },
};

export function Connections() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const services = useBikeStore((s) => s.ble_services);
  const battery = useBikeStore((s) => s.battery_percent);
  const [scanning, setScanning] = useState(false);

  const connectedCount = Object.values(services).filter(Boolean).length;
  const totalSensors = Object.keys(services).length;

  const handleConnectBike = async () => {
    setScanning(true);
    try {
      await BLE.connectBike();
    } catch {
      // User cancelled or connection failed
    } finally {
      setScanning(false);
    }
  };

  const handleDisconnectBike = () => {
    BLE.disconnectBike();
  };

  const handleConnectHR = async () => {
    try {
      await BLE.connectHR();
    } catch {
      // User cancelled or no device found
    }
  };

  const handleConnectDi2 = async () => {
    try {
      await BLE.connectDi2();
    } catch {
      // User cancelled or no device found
    }
  };

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-emerald-400">Connections</h1>
        <button
          onClick={handleConnectBike}
          disabled={scanning}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            scanning ? 'bg-emerald-500/20' : 'bg-gray-800 active:bg-gray-700'
          }`}
        >
          <span className={`material-symbols-outlined text-emerald-400 ${scanning ? 'animate-spin' : ''}`}>
            refresh
          </span>
        </button>
      </div>

      {/* Main bike card */}
      <div className={`bg-gray-800 rounded-xl p-4 border ${
        bleStatus === 'connected' ? 'border-emerald-500/30' : 'border-gray-700'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500 uppercase">Giant Smart Gateway</div>
            <div className="text-lg font-bold text-white mt-0.5">
              {BLE.getDeviceName() ?? 'GBHA25704'}
            </div>
            <div className="text-xs text-gray-500 mt-1">Motor | Battery | Speed | Power</div>
          </div>
          <div className="text-right">
            {battery > 0 && (
              <>
                <div className="text-xs text-gray-500">Battery</div>
                <div className="text-2xl font-bold text-emerald-400">{battery}%</div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <StatusDot status={bleStatus === 'connected' ? 'connected' : bleStatus === 'connecting' || bleStatus === 'reconnecting' ? 'searching' : 'disconnected'} />
          <span className={`text-sm font-bold ${bleStatus === 'connected' ? 'text-emerald-400' : bleStatus === 'connecting' ? 'text-yellow-400' : 'text-gray-400'}`}>
            {bleStatus === 'connected' ? 'Connected' : bleStatus === 'connecting' ? 'Connecting...' : bleStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
          </span>
        </div>
        <button
          onClick={bleStatus === 'connected' ? handleDisconnectBike : handleConnectBike}
          className={`w-full h-12 rounded-xl font-bold text-base mt-3 active:scale-95 transition-transform ${
            bleStatus === 'connected'
              ? 'bg-red-600/20 text-red-400 border border-red-600/30'
              : 'bg-emerald-500 text-black'
          }`}
        >
          {bleStatus === 'connected' ? 'Disconnect' : scanning ? 'Scanning...' : 'Connect Bike'}
        </button>
      </div>

      {/* Gateway services (auto-detected) */}
      <div className="grid grid-cols-4 gap-2">
        {GATEWAY_SERVICES.map((key) => (
          <MiniServiceBadge
            key={key}
            name={SERVICE_META[key]!.name}
            icon={SERVICE_META[key]!.icon}
            connected={services[key]}
          />
        ))}
      </div>

      {/* Standalone devices */}
      <div className="space-y-2 flex-1">
        <StandaloneDevice
          name="Heart Rate Monitor"
          icon="monitor_heart"
          connected={services.heartRate}
          deviceName={BLE.getHRDeviceName()}
          onConnect={handleConnectHR}
          onDisconnect={() => BLE.disconnectHR()}
        />
        <StandaloneDevice
          name="Shimano Di2"
          icon="settings_suggest"
          connected={services.di2}
          deviceName={BLE.getDi2DeviceName()}
          onConnect={handleConnectDi2}
          onDisconnect={() => BLE.disconnectDi2()}
        />
      </div>

      {/* Status footer */}
      <div className="bg-gray-800 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-300 font-bold">{connectedCount} of {totalSensors} sensors</span>
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

function StandaloneDevice({
  name, icon, connected, deviceName, onConnect, onDisconnect,
}: {
  name: string; icon: string; connected: boolean; deviceName: string | null;
  onConnect: () => void; onDisconnect: () => void;
}) {
  return (
    <div className={`bg-gray-800/60 rounded-xl p-3 flex items-center gap-3 border ${
      connected ? 'border-emerald-500/20' : 'border-gray-700/50'
    }`}>
      <span className={`material-symbols-outlined text-2xl ${connected ? 'text-emerald-400' : 'text-gray-600'}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-white">{name}</div>
        <div className="text-xs text-gray-500 truncate">
          {connected ? deviceName ?? 'Connected' : 'Not connected'}
        </div>
      </div>
      <button
        onClick={connected ? onDisconnect : onConnect}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 transition-transform ${
          connected
            ? 'bg-red-600/20 text-red-400'
            : 'bg-emerald-500/20 text-emerald-400'
        }`}
      >
        {connected ? 'Off' : 'Pair'}
      </button>
    </div>
  );
}

function MiniServiceBadge({ name, icon, connected }: { name: string; icon: string; connected: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-1 py-2 rounded-lg ${
      connected ? 'bg-emerald-500/10' : 'bg-gray-800/40'
    }`}>
      <span className={`material-symbols-outlined text-lg ${connected ? 'text-emerald-400' : 'text-gray-600'}`}>
        {icon}
      </span>
      <span className="text-[10px] text-gray-500">{name.split('/')[0]}</span>
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
