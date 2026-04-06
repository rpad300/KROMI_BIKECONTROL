/**
 * LightsPanel — full-screen lights control tab in Dashboard.
 *
 * Shows each connected light (front/rear) with:
 *   - Current mode + mode picker grid
 *   - Battery level
 *   - Smart light status (auto ON/OFF, brake flash, radar flash)
 *   - Turn signal buttons
 *   - Add light button
 */

import { useState } from 'react';
import { useBikeStore, type LightInfo } from '../../store/bikeStore';
import { LightMode, LIGHT_MODE_LABELS } from '../../services/bluetooth/iGPSportLightService';
import { accessoriesManager } from '../../services/accessories/AccessoriesManager';
import * as BLE from '../../services/bluetooth/BLEBridge';

/** All useful modes for the full picker */
const ALL_MODES = [
  LightMode.OFF,
  LightMode.LOW_STEADY, LightMode.MID_STEADY, LightMode.HIGH_STEADY, LightMode.SUPER_HIGH,
  LightMode.LOW_BLINK, LightMode.HIGH_BLINK,
  LightMode.GRADIENT, LightMode.ROTATION,
  LightMode.COMET_FLASH, LightMode.WATERFALL_FLASH, LightMode.PINWHEEL,
  LightMode.SOS,
];

export function LightsPanel() {
  const lights = useBikeStore((s) => s.lights);
  const lightConnected = useBikeStore((s) => s.ble_services.light);
  const legacyBattery = useBikeStore((s) => s.light_battery_pct);
  const legacyMode = useBikeStore((s) => s.light_mode);
  const legacyName = useBikeStore((s) => s.light_device_name);

  // Build display list: multi-light or legacy fallback
  const displayLights: LightInfo[] = lights.length > 0
    ? lights.filter((l) => l.connected)
    : lightConnected
      ? [{ id: 'legacy', name: legacyName || 'Light', position: 'rear', brand: 'unknown', battery_pct: legacyBattery, mode: legacyMode, connected: true }]
      : [];

  const smartOutput = accessoriesManager.lightOutput;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-sm font-bold text-white">Luzes</h2>
        <button
          onClick={() => BLE.connectLight()}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-[#262626] text-[#fbbf24] text-[10px] font-bold active:scale-95"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Adicionar Luz
        </button>
      </div>

      {displayLights.length === 0 ? (
        <div className="bg-[#1a1919] rounded p-6 text-center">
          <span className="material-symbols-outlined text-4xl text-[#494847]">flashlight_off</span>
          <p className="text-[#777575] text-xs mt-2">Nenhuma luz ligada</p>
          <button
            onClick={() => BLE.connectLight()}
            className="mt-3 px-4 py-2 rounded bg-[#fbbf24] text-black text-xs font-bold active:scale-95"
          >
            Ligar Luz
          </button>
        </div>
      ) : (
        <>
          {/* Per-light cards */}
          {displayLights.map((light) => (
            <LightCard key={light.id} light={light} />
          ))}

          {/* Add second light prompt */}
          {displayLights.length === 1 && (
            <button
              onClick={() => BLE.connectLight()}
              className="flex items-center justify-center gap-2 p-3 rounded border border-dashed border-[#494847] text-[#777575] text-xs active:bg-[#1a1919]"
            >
              <span className="material-symbols-outlined text-base">add</span>
              Adicionar {displayLights[0]!.position === 'front' ? 'luz traseira' : 'luz frontal'}
            </button>
          )}

          {/* Turn Signals */}
          <div className="bg-[#1a1919] rounded p-3">
            <div className="text-[10px] text-[#777575] uppercase tracking-wider mb-2">Sinais de Mudanca de Direcao</div>
            <div className="grid grid-cols-2 gap-2">
              <TurnButton direction="left" />
              <TurnButton direction="right" />
            </div>
          </div>

          {/* Smart Light Status */}
          {smartOutput && (
            <div className="bg-[#1a1919] rounded p-3">
              <div className="text-[10px] text-[#777575] uppercase tracking-wider mb-2">Smart Light</div>
              <div className="flex flex-wrap gap-2">
                <StatusChip label="Auto" active={smartOutput.reason.startsWith('auto_')} />
                <StatusChip label="Brake" active={smartOutput.braking} color="#ff716c" />
                <StatusChip label="Radar" active={smartOutput.radarAlert} color="#fbbf24" />
                <StatusChip label="Override" active={smartOutput.reason === 'manual_override'} color="#6e9bff" />
              </div>
              <div className="text-[9px] text-[#494847] mt-1">{smartOutput.reason}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Individual light control card */
function LightCard({ light }: { light: LightInfo }) {
  const [expanded, setExpanded] = useState(false);

  const handleMode = (mode: LightMode) => {
    if (BLE.bleMode === 'websocket') {
      import('../../services/bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
        wsClient.send({ type: 'lightSetMode', mode, target: light.position });
      });
    } else {
      import('../../services/bluetooth/LightRegistry').then(({ lightRegistry }) => {
        lightRegistry.setMode(light.position, mode);
      });
    }
  };

  const handleDisconnect = () => {
    BLE.disconnectLight(light.id);
  };

  const posLabel = light.position === 'front' ? 'Frontal' : 'Traseira';
  const posIcon = light.position === 'front' ? 'flashlight_on' : 'light';
  const isOn = light.mode > 0;

  return (
    <div className="bg-[#1a1919] rounded p-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => handleMode(isOn ? LightMode.OFF : LightMode.MID_STEADY)}
          className="active:scale-90 transition-transform"
        >
          <span className={`material-symbols-outlined text-3xl ${isOn ? 'text-[#fbbf24]' : 'text-[#494847]'}`}>
            {isOn ? posIcon : (light.position === 'front' ? 'flashlight_off' : 'light_off')}
          </span>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white">{posLabel}</span>
            <span className="text-[9px] text-[#494847]">{light.name}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-sm font-bold ${isOn ? 'text-[#fbbf24]' : 'text-[#777575]'}`}>
              {LIGHT_MODE_LABELS[light.mode] ?? (isOn ? 'ON' : 'OFF')}
            </span>
            {light.battery_pct > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-10 h-1.5 bg-[#262626] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      light.battery_pct > 30 ? 'bg-[#fbbf24]' : light.battery_pct > 15 ? 'bg-orange-400' : 'bg-[#ff716c]'
                    }`}
                    style={{ width: `${light.battery_pct}%` }}
                  />
                </div>
                <span className="text-[9px] text-[#777575] tabular-nums">{light.battery_pct}%</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 active:scale-90"
          >
            <span className="material-symbols-outlined text-lg text-[#777575]">
              {expanded ? 'expand_less' : 'tune'}
            </span>
          </button>
          <button
            onClick={handleDisconnect}
            className="p-1 active:scale-90"
          >
            <span className="material-symbols-outlined text-lg text-[#ff716c]">link_off</span>
          </button>
        </div>
      </div>

      {/* Expanded mode grid */}
      {expanded && (
        <div className="mt-3 pt-2 border-t border-[#333]">
          <div className="grid grid-cols-4 gap-1">
            {ALL_MODES.map((mode) => (
              <button
                key={mode}
                onClick={() => handleMode(mode)}
                className={`h-9 rounded text-[10px] font-bold active:scale-95 transition-transform ${
                  light.mode === mode
                    ? 'bg-[#fbbf24] text-black'
                    : 'bg-[#262626] text-[#adaaaa]'
                }`}
              >
                {LIGHT_MODE_LABELS[mode] ?? `#${mode}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Turn signal button */
function TurnButton({ direction }: { direction: 'left' | 'right' }) {
  const [active, setActive] = useState(false);

  const handleClick = () => {
    if (active) {
      accessoriesManager.cancelTurnSignal();
      setActive(false);
    } else {
      accessoriesManager.triggerTurnSignal(direction);
      setActive(true);
      // Auto-deactivate after duration
      setTimeout(() => setActive(false), 5000);
    }
  };

  const icon = direction === 'left' ? 'turn_left' : 'turn_right';
  const label = direction === 'left' ? 'Esquerda' : 'Direita';

  return (
    <button
      onClick={handleClick}
      className={`h-12 rounded flex items-center justify-center gap-2 font-bold text-xs active:scale-95 transition-all ${
        active ? 'bg-[#fbbf24] text-black animate-pulse' : 'bg-[#262626] text-[#adaaaa]'
      }`}
    >
      <span className="material-symbols-outlined text-xl">{icon}</span>
      {label}
    </button>
  );
}

/** Status indicator chip */
function StatusChip({ label, active, color = '#3fff8b' }: { label: string; active: boolean; color?: string }) {
  return (
    <div className={`px-2 py-0.5 rounded text-[9px] font-bold ${
      active ? 'border' : 'bg-[#262626] text-[#494847]'
    }`} style={active ? { borderColor: color, color, backgroundColor: `${color}15` } : undefined}>
      {label}
    </div>
  );
}
