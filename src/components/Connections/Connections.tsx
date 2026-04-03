import { useState, useEffect } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import * as BLE from '../../services/bluetooth/BLEBridge';
import { webSensorService } from '../../services/sensors/WebSensorService';
import { DeviceScanner } from '../shared/DeviceScanner';

// ── Section 2: Gateway services (auto-detected) ──────────────
const GATEWAY_SERVICES = [
  { key: 'battery' as const, name: 'Battery', icon: 'battery_full' },
  { key: 'csc' as const, name: 'Speed', icon: 'speed' },
  { key: 'power' as const, name: 'Power', icon: 'bolt' },
  { key: 'gev' as const, name: 'GEV', icon: 'electric_bike' },
] as const;

// ── Section 3: External sensors ──────────────────────────────
import type { BLEServiceStatus } from '../../types/bike.types';

interface ExternalSensor {
  key: string;
  name: string;
  icon: string;
  serviceKey: keyof BLEServiceStatus;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  getDeviceName: () => string | null;
}

const EXTERNAL_SENSORS: ExternalSensor[] = [
  {
    key: 'hr',
    name: 'Heart Rate Monitor',
    icon: 'monitor_heart',
    serviceKey: 'heartRate',
    onConnect: () => BLE.connectHR(),
    onDisconnect: () => BLE.disconnectHR(),
    getDeviceName: () => BLE.getHRDeviceName(),
  },
  {
    key: 'di2',
    name: 'Shimano Di2',
    icon: 'settings_suggest',
    serviceKey: 'di2',
    onConnect: () => BLE.connectDi2(),
    onDisconnect: () => BLE.disconnectDi2(),
    getDeviceName: () => BLE.getDi2DeviceName(),
  },
  {
    key: 'sram',
    name: 'SRAM AXS',
    icon: 'swap_vert',
    serviceKey: 'sram',
    onConnect: () => BLE.connectSRAM(),
    onDisconnect: () => BLE.disconnectSRAM(),
    getDeviceName: () => BLE.getSRAMDeviceName(),
  },
  {
    key: 'extPower',
    name: 'External Power Meter',
    icon: 'bolt',
    serviceKey: 'power',
    onConnect: () => BLE.connectExtPower(),
    onDisconnect: () => BLE.disconnectExtPower(),
    getDeviceName: () => BLE.getExtPowerDeviceName(),
  },
];

export function Connections() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const services = useBikeStore((s) => s.ble_services);
  const battery = useBikeStore((s) => s.battery_percent);
  const pressure = useBikeStore((s) => s.pressure_hpa);
  const baroAlt = useBikeStore((s) => s.barometric_altitude_m);
  const leanAngle = useBikeStore((s) => s.lean_angle_deg);
  const temperature = useBikeStore((s) => s.temperature_c);
  const tpmsFront = useBikeStore((s) => s.tpms_front_psi);
  const tpmsRear = useBikeStore((s) => s.tpms_rear_psi);

  const [scanning, setScanning] = useState(false);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [sensorScanning, setSensorScanning] = useState<string | null>(null);
  const [phoneSensorsOn, setPhoneSensorsOn] = useState(webSensorService.isRunning);

  // Clear scanning state when sensor actually connects
  useEffect(() => {
    if (sensorScanning === 'hr' && services.heartRate) setSensorScanning(null);
    if (sensorScanning === 'di2' && services.di2) setSensorScanning(null);
    if (sensorScanning === 'sram' && services.sram) setSensorScanning(null);
  }, [services, sensorScanning]);

  const connectedCount = Object.values(services).filter(Boolean).length;
  const totalSensors = Object.keys(services).length;
  const bleModeBadge = BLE.getBLEModeDescription();

  const handleConnectBike = async () => {
    if (BLE.bleMode === 'websocket') {
      // WebSocket mode: open device scanner for user to pick
      setShowDevicePicker(true);
      return;
    }
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

  const handleSensorConnect = async (sensor: ExternalSensor) => {
    if (BLE.bleMode === 'websocket') {
      // WebSocket mode: open the DeviceScanner (shows all devices with tags)
      // Routing in DeviceScanner handles HR→SensorManager, bike→BLEManager
      setShowDevicePicker(true);
      return;
    }
    // Web BLE mode: use browser picker
    setSensorScanning(sensor.key);
    try {
      await sensor.onConnect();
    } catch {
      // User cancelled or no device found
    }
    setSensorScanning(null);
  };

  const togglePhoneSensors = async () => {
    if (phoneSensorsOn) {
      webSensorService.stop();
      setPhoneSensorsOn(false);
    } else {
      const ok = await webSensorService.start();
      setPhoneSensorsOn(ok);
    }
  };

  if (showDevicePicker) {
    return (
      <DeviceScanner
        onConnected={() => setShowDevicePicker(false)}
        onCancel={() => setShowDevicePicker(false)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-emerald-400">Connections</h1>
        <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-400 font-medium">
          {bleModeBadge}
        </span>
      </div>

      {/* ── Section 1: Giant Smart Gateway ──────────────────── */}
      <div
        className={`bg-gray-800 rounded-xl p-4 border ${
          bleStatus === 'connected' ? 'border-emerald-500/30' : 'border-gray-700'
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Giant Smart Gateway</div>
            <div className="text-lg font-bold text-white mt-0.5">
              {BLE.getDeviceName() ?? 'GBHA25704'}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500">
                Mode: {BLE.bleMode === 'websocket' ? 'Bridge' : BLE.bleMode === 'native' ? 'Native' : 'Web'}
              </span>
            </div>
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
          <StatusDot
            status={
              bleStatus === 'connected'
                ? 'connected'
                : bleStatus === 'connecting' || bleStatus === 'reconnecting'
                  ? 'searching'
                  : 'disconnected'
            }
          />
          <span
            className={`text-sm font-bold ${
              bleStatus === 'connected'
                ? 'text-emerald-400'
                : bleStatus === 'connecting' || bleStatus === 'reconnecting'
                  ? 'text-yellow-400'
                  : 'text-gray-400'
            }`}
          >
            {bleStatus === 'connected'
              ? 'Connected'
              : bleStatus === 'connecting'
                ? 'Connecting...'
                : bleStatus === 'reconnecting'
                  ? 'Reconnecting...'
                  : 'Disconnected'}
          </span>
        </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={bleStatus === 'connected' ? handleDisconnectBike : handleConnectBike}
            className={`flex-1 h-12 rounded-xl font-bold text-base active:scale-95 transition-transform ${
              bleStatus === 'connected'
                ? 'bg-red-600/20 text-red-400 border border-red-600/30'
                : 'bg-emerald-500 text-black'
            }`}
          >
            {bleStatus === 'connected' ? 'Disconnect' : scanning ? 'Scanning...' : 'Connect Bike'}
          </button>
          {BLE.bleMode === 'websocket' && (
            <button
              onClick={() => setShowDevicePicker(true)}
              className="h-12 px-4 rounded-xl font-bold text-sm bg-gray-700 text-gray-300 active:scale-95 transition-transform"
            >
              Mudar
            </button>
          )}
        </div>
        {/* Saved device info */}
        {(() => {
          const saved = BLE.getSavedDevice();
          return saved ? (
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-gray-600">
                Guardado: {saved.name} ({saved.address})
              </span>
              <button
                onClick={() => { BLE.clearSavedDevice(); }}
                className="text-[10px] text-red-500"
              >
                Esquecer
              </button>
            </div>
          ) : null;
        })()}
      </div>

      {/* ── Section 2: Gateway Services ─────────────────────── */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-2 px-1">Gateway Services</div>
        <div className="grid grid-cols-4 gap-2">
          {GATEWAY_SERVICES.map((svc) => (
            <div
              key={svc.key}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg ${
                services[svc.key] ? 'bg-emerald-500/10' : 'bg-gray-800/40'
              }`}
            >
              <div className="relative">
                <span
                  className={`material-symbols-outlined text-lg ${
                    services[svc.key] ? 'text-emerald-400' : 'text-gray-600'
                  }`}
                >
                  {svc.icon}
                </span>
                <div
                  className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                    services[svc.key] ? 'bg-emerald-400' : 'bg-gray-600'
                  }`}
                />
              </div>
              <span className="text-[10px] text-gray-500">{svc.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 3: External Sensors ─────────────────────── */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-2 px-1">External Sensors</div>
        <div className="space-y-2">
          {EXTERNAL_SENSORS.map((sensor) => {
            const connected = services[sensor.serviceKey as keyof typeof services];
            const isScanning = sensorScanning === sensor.key;

            return (
              <div
                key={sensor.key}
                className={`bg-gray-800/60 rounded-xl p-3 flex items-center gap-3 border ${
                  connected ? 'border-emerald-500/20' : 'border-gray-700/50'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-2xl ${
                    connected ? 'text-emerald-400' : 'text-gray-600'
                  }`}
                >
                  {sensor.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white">{sensor.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {connected
                      ? sensor.getDeviceName() ?? 'Connected'
                      : isScanning
                        ? 'Scanning...'
                        : (() => {
                            const sensorType = sensor.key === 'extPower' ? 'power' : sensor.key;
                            const saved = BLE.getSavedSensorDevice(sensorType as 'hr' | 'di2' | 'sram' | 'power');
                            return saved ? `Auto: ${saved.name}` : 'Not connected';
                          })()}
                  </div>
                </div>
                <div className="flex gap-1">
                  {!connected && (() => {
                    const sType = sensor.key === 'extPower' ? 'power' : sensor.key;
                    const saved = BLE.getSavedSensorDevice(sType as 'hr' | 'di2' | 'sram' | 'power');
                    return saved ? (
                      <button
                        onClick={() => BLE.clearSensorDevice(sType as 'hr' | 'di2' | 'sram' | 'power')}
                        className="h-10 px-2 rounded-lg text-[10px] font-bold bg-gray-700 text-gray-500 active:scale-95"
                        title="Esquecer"
                      >
                        X
                      </button>
                    ) : null;
                  })()}
                  <button
                    onClick={() =>
                      connected ? sensor.onDisconnect() : handleSensorConnect(sensor)
                    }
                    disabled={isScanning}
                    className={`h-10 px-4 rounded-lg text-xs font-bold active:scale-95 transition-transform ${
                      connected
                        ? 'bg-red-600/20 text-red-400'
                        : isScanning
                          ? 'bg-gray-700 text-gray-500'
                          : 'bg-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    {connected ? 'Off' : isScanning ? '...' : 'Scan'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Section 3b: TPMS Sensors ──────────────────────────── */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-2 px-1">Tire Pressure (TPMS)</div>
        <div className="space-y-2">
          <TPMSSensorCard
            label="TPMS Front"
            icon="tire_repair"
            psi={tpmsFront}
            onConnect={() => BLE.connectFrontTPMS()}
            onDisconnect={() => BLE.disconnectFrontTPMS()}
            getDeviceName={() => BLE.getFrontTPMSDeviceName()}
            scanning={sensorScanning === 'tpmsFront'}
            onScanStart={() => setSensorScanning('tpmsFront')}
            onScanEnd={() => setSensorScanning(null)}
          />
          <TPMSSensorCard
            label="TPMS Rear"
            icon="tire_repair"
            psi={tpmsRear}
            onConnect={() => BLE.connectRearTPMS()}
            onDisconnect={() => BLE.disconnectRearTPMS()}
            getDeviceName={() => BLE.getRearTPMSDeviceName()}
            scanning={sensorScanning === 'tpmsRear'}
            onScanStart={() => setSensorScanning('tpmsRear')}
            onScanEnd={() => setSensorScanning(null)}
          />
        </div>
      </div>

      {/* ── Section 4: Phone Sensors ────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Phone Sensors</span>
          <button
            onClick={togglePhoneSensors}
            className={`h-8 px-3 rounded-lg text-xs font-bold active:scale-95 transition-transform ${
              phoneSensorsOn
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-gray-700 text-gray-400'
            }`}
          >
            {phoneSensorsOn ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="bg-gray-800/60 rounded-xl p-3 space-y-3 border border-gray-700/50">
          <PhoneSensorRow
            icon="air"
            label="Barometer"
            value={
              pressure > 0
                ? `${pressure.toFixed(1)} hPa  →  ${baroAlt.toFixed(0)}m`
                : '—'
            }
            active={phoneSensorsOn && pressure > 0}
          />
          <PhoneSensorRow
            icon="screen_rotation"
            label="Lean angle"
            value={phoneSensorsOn ? `${leanAngle.toFixed(1)}\u00B0` : '—'}
            active={phoneSensorsOn && leanAngle !== 0}
          />
          <PhoneSensorRow
            icon="thermostat"
            label="Temperature"
            value={temperature > 0 ? `${temperature.toFixed(1)}\u00B0C` : '—'}
            active={phoneSensorsOn && temperature > 0}
          />
        </div>
      </div>

      {/* ── Section 5: Connection Summary ───────────────────── */}
      <div className="bg-gray-800 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-300 font-bold">
            {connectedCount} of {totalSensors} sensors
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">
            {BLE.bleMode === 'websocket' ? 'Bridge' : BLE.bleMode === 'native' ? 'Native' : 'Web BLE'}
          </span>
        </div>
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${totalSensors > 0 ? (connectedCount / totalSensors) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* ── Section 6: Device Details ─────────────────────── */}
      <DeviceDetails />
    </div>
  );
}

// ── Device Details panel ────────────────────────────────────
function DeviceDetails() {
  const fwVersion = useBikeStore((s) => s.firmware_version);
  const hwVersion = useBikeStore((s) => s.hardware_version);
  const swVersion = useBikeStore((s) => s.software_version);
  const motorOdo = useBikeStore((s) => s.motor_odo_km);
  const motorHours = useBikeStore((s) => s.motor_total_hours);
  const bleStatus = useBikeStore((s) => s.ble_status);

  const savedBike = BLE.getSavedDevice();
  const savedHR = BLE.getSavedSensorDevice('hr');
  const savedDi2 = BLE.getSavedSensorDevice('di2');
  const savedSRAM = BLE.getSavedSensorDevice('sram');
  const savedPower = BLE.getSavedSensorDevice('power');

  const [phoneInfo, setPhoneInfo] = useState<{ userAgent: string; platform: string; language: string } | null>(null);
  useEffect(() => {
    setPhoneInfo({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
    });
  }, []);

  // Connection log from localStorage
  const [connLog, setConnLog] = useState<{ ts: string; event: string }[]>([]);
  useEffect(() => {
    const raw = localStorage.getItem('kromi_conn_log');
    if (raw) try { setConnLog(JSON.parse(raw).slice(-20)); } catch { /* ignore */ }
  }, []);

  // Log connection state changes
  useEffect(() => {
    const entry = { ts: new Date().toISOString(), event: `BLE → ${bleStatus}` };
    setConnLog((prev) => {
      const updated = [...prev, entry].slice(-20);
      localStorage.setItem('kromi_conn_log', JSON.stringify(updated));
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleStatus]);

  const allSaved = [
    savedBike && { label: 'Giant Gateway', ...savedBike },
    savedHR && { label: 'Heart Rate', ...savedHR },
    savedDi2 && { label: 'Shimano Di2', ...savedDi2 },
    savedSRAM && { label: 'SRAM AXS', ...savedSRAM },
    savedPower && { label: 'Power Meter', ...savedPower },
  ].filter(Boolean) as { label: string; name: string; address: string }[];

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 uppercase tracking-wide px-1">Device Details</div>

      {/* Firmware / Hardware / Software versions */}
      {(fwVersion || hwVersion || swVersion) && (
        <div className="bg-gray-800/60 rounded-xl p-3 space-y-2 border border-gray-700/50">
          <div className="text-xs font-bold text-[#6e9bff]">Giant Smart Gateway</div>
          <div className="grid grid-cols-3 gap-2">
            {fwVersion && <InfoCell label="Firmware" value={fwVersion} />}
            {hwVersion && <InfoCell label="Hardware" value={hwVersion} />}
            {swVersion && <InfoCell label="Software" value={swVersion} />}
          </div>
          {motorOdo > 0 && (
            <div className="flex gap-4 mt-1">
              <InfoCell label="Motor ODO" value={`${motorOdo.toFixed(0)} km`} />
              {motorHours > 0 && <InfoCell label="Motor Hours" value={`${motorHours.toFixed(0)}h`} />}
            </div>
          )}
        </div>
      )}

      {/* Saved devices with MAC addresses */}
      {allSaved.length > 0 && (
        <div className="bg-gray-800/60 rounded-xl p-3 space-y-2 border border-gray-700/50">
          <div className="text-xs font-bold text-[#6e9bff]">Dispositivos guardados</div>
          {allSaved.map((d) => (
            <div key={d.address} className="flex items-center justify-between py-1">
              <div>
                <div className="text-xs text-white">{d.label}</div>
                <div className="text-[10px] text-gray-500">{d.name}</div>
              </div>
              <div className="text-[10px] text-gray-500 font-mono">{d.address}</div>
            </div>
          ))}
        </div>
      )}

      {/* Phone info */}
      {phoneInfo && (
        <div className="bg-gray-800/60 rounded-xl p-3 space-y-2 border border-gray-700/50">
          <div className="text-xs font-bold text-[#6e9bff]">Dispositivo (phone)</div>
          <InfoCell label="Platform" value={phoneInfo.platform} />
          <InfoCell label="Language" value={phoneInfo.language} />
          <div>
            <div className="text-[9px] text-gray-600">User Agent</div>
            <div className="text-[10px] text-gray-400 break-all leading-tight mt-0.5">{phoneInfo.userAgent}</div>
          </div>
        </div>
      )}

      {/* Connection log */}
      {connLog.length > 0 && (
        <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-[#6e9bff]">Connection Log</div>
            <button
              onClick={() => { localStorage.removeItem('kromi_conn_log'); setConnLog([]); }}
              className="text-[9px] text-gray-600 hover:text-gray-400"
            >
              Limpar
            </button>
          </div>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {connLog.slice().reverse().map((entry, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="text-gray-600 font-mono tabular-nums">
                  {new Date(entry.ts).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={entry.event.includes('connected') && !entry.event.includes('disconnected') ? 'text-emerald-400' : 'text-gray-400'}>
                  {entry.event}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] text-gray-600">{label}</div>
      <div className="text-xs text-white font-medium">{value}</div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────

function PhoneSensorRow({
  icon,
  label,
  value,
  active,
}: {
  icon: string;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`material-symbols-outlined text-xl ${active ? 'text-emerald-400' : 'text-gray-600'}`}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-500">{label}</div>
        <div className={`text-sm font-medium truncate ${active ? 'text-white' : 'text-gray-600'}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

function TPMSSensorCard({
  label,
  icon,
  psi,
  onConnect,
  onDisconnect,
  getDeviceName,
  scanning,
  onScanStart,
  onScanEnd,
}: {
  label: string;
  icon: string;
  psi: number;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  getDeviceName: () => string | null;
  scanning: boolean;
  onScanStart: () => void;
  onScanEnd: () => void;
}) {
  const connected = psi > 0;

  const handleConnect = async () => {
    onScanStart();
    try {
      await onConnect();
    } catch {
      // User cancelled or no device found
    } finally {
      onScanEnd();
    }
  };

  return (
    <div
      className={`bg-gray-800/60 rounded-xl p-3 flex items-center gap-3 border ${
        connected ? 'border-emerald-500/20' : 'border-gray-700/50'
      }`}
    >
      <span
        className={`material-symbols-outlined text-2xl ${
          connected ? 'text-emerald-400' : 'text-gray-600'
        }`}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-white">{label}</div>
        <div className="text-xs text-gray-500 truncate">
          {connected
            ? `${psi.toFixed(1)} PSI${getDeviceName() ? ` — ${getDeviceName()}` : ''}`
            : scanning
              ? 'Scanning...'
              : 'Not connected'}
        </div>
      </div>
      <button
        onClick={() => (connected ? onDisconnect() : handleConnect())}
        disabled={scanning}
        className={`h-10 px-4 rounded-lg text-xs font-bold active:scale-95 transition-transform ${
          connected
            ? 'bg-red-600/20 text-red-400'
            : scanning
              ? 'bg-gray-700 text-gray-500'
              : 'bg-emerald-500/20 text-emerald-400'
        }`}
      >
        {connected ? 'Off' : scanning ? '...' : 'Scan'}
      </button>
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
