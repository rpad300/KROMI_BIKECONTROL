import { useState } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { LightMode, LIGHT_MODE_LABELS } from '../../services/bluetooth/iGPSportLightService';
import * as BLE from '../../services/bluetooth/BLEBridge';

/** Quick light modes for the inline picker */
const QUICK_MODES = [
  LightMode.OFF, LightMode.LOW_STEADY, LightMode.MID_STEADY,
  LightMode.HIGH_STEADY, LightMode.LOW_BLINK, LightMode.SOS,
];

export function LightRadarWidget() {
  const lightConnected = useBikeStore((s) => s.ble_services.light);
  const radarConnected = useBikeStore((s) => s.ble_services.radar);
  const lights = useBikeStore((s) => s.lights);
  const radarThreat = useBikeStore((s) => s.radar_threat_level);
  const radarDistance = useBikeStore((s) => s.radar_distance_m);
  const radarSpeed = useBikeStore((s) => s.radar_speed_kmh);

  // Legacy fallback for single light (before multi-light migration)
  const legacyBattery = useBikeStore((s) => s.light_battery_pct);
  const legacyMode = useBikeStore((s) => s.light_mode);

  const [showModes, setShowModes] = useState(false);

  // Don't render if neither accessory is connected
  if (!lightConnected && !radarConnected) return null;

  const handleSwitchMode = (mode: LightMode, position?: 'front' | 'rear') => {
    if (BLE.bleMode === 'websocket') {
      import('../../services/bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
        wsClient.send({ type: 'lightSetMode', mode, target: position ?? 'all' });
      });
    } else {
      import('../../services/bluetooth/LightRegistry').then(({ lightRegistry }) => {
        if (position) {
          lightRegistry.setMode(position, mode);
        } else {
          lightRegistry.setModeAll(mode);
        }
      });
    }
    setShowModes(false);
  };

  const handleToggle = () => {
    const currentMode = lights.length > 0 ? lights[0]!.mode : legacyMode;
    handleSwitchMode(currentMode === LightMode.OFF ? LightMode.LOW_STEADY : LightMode.OFF);
  };

  const threatColor = radarThreat >= 3 ? 'text-[#ff716c]' : radarThreat >= 2 ? 'text-[#fbbf24]' : radarThreat >= 1 ? 'text-[#ff9f43]' : 'text-[#3fff8b]';
  const threatBg = radarThreat >= 3 ? 'bg-[#9f0519]' : radarThreat >= 2 ? 'bg-yellow-900' : '';

  // Use multi-light data if available, fallback to legacy
  const displayLights = lights.length > 0
    ? lights.filter((l) => l.connected)
    : lightConnected ? [{ id: 'legacy', name: '', position: 'rear' as const, brand: 'unknown' as const, battery_pct: legacyBattery, mode: legacyMode, connected: true }] : [];

  return (
    <div className="bg-[#1a1919] rounded-sm p-3">
      <div className="flex items-center gap-3">
        {/* Light section — show each connected light */}
        {displayLights.length > 0 && (
          <div className="flex-1 min-w-0 flex items-center gap-3">
            {displayLights.map((light) => (
              <div key={light.id} className="flex items-center gap-2">
                <button
                  onClick={handleToggle}
                  className="active:scale-90 transition-transform"
                >
                  <span className={`material-symbols-outlined text-2xl ${
                    light.mode > 0 ? 'text-[#fbbf24]' : 'text-[#777575]'
                  }`}>
                    {light.position === 'front' ? (light.mode > 0 ? 'flashlight_on' : 'flashlight_off') : (light.mode > 0 ? 'light' : 'light_off')}
                  </span>
                </button>
                <div className="min-w-0">
                  <button
                    onClick={() => setShowModes(!showModes)}
                    className="text-sm font-bold text-white active:text-[#fbbf24] transition-colors flex items-center gap-1"
                  >
                    {displayLights.length > 1 && (
                      <span className="text-[8px] text-[#777575] uppercase">{light.position === 'front' ? 'F' : 'R'}</span>
                    )}
                    {LIGHT_MODE_LABELS[light.mode] ?? 'Light'}
                  </button>
                  {light.battery_pct > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-8 h-1 bg-[#262626] rounded-full overflow-hidden">
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
            ))}
          </div>
        )}

        {/* Divider */}
        {displayLights.length > 0 && radarConnected && (
          <div className="w-px h-8 bg-[#333]" />
        )}

        {/* Radar section */}
        {radarConnected && (
          <div className={`flex items-center gap-2 ${radarThreat >= 2 ? 'animate-pulse' : ''}`}>
            <span className={`material-symbols-outlined text-2xl ${threatColor}`}>
              radar
            </span>
            <div>
              {radarThreat > 0 ? (
                <>
                  <div className={`text-sm font-bold ${threatColor}`}>
                    {radarDistance > 0 ? `${radarDistance.toFixed(0)}m` : 'CLOSE'}
                  </div>
                  <div className="text-[9px] text-[#777575]">
                    {radarSpeed > 0 ? `${radarSpeed} km/h` : 'approaching'}
                  </div>
                </>
              ) : (
                <div className="text-xs text-[#3fff8b]">Clear</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mode picker (expanded) */}
      {showModes && displayLights.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[#333]">
          <div className="grid grid-cols-3 gap-1">
            {QUICK_MODES.map((mode) => {
              const anyActive = displayLights.some((l) => l.mode === mode);
              return (
                <button
                  key={mode}
                  onClick={() => handleSwitchMode(mode)}
                  className={`h-8 rounded text-[11px] font-bold active:scale-95 transition-transform ${
                    anyActive
                      ? 'bg-[#fbbf24] text-black'
                      : 'bg-[#262626] text-[#adaaaa]'
                  }`}
                >
                  {LIGHT_MODE_LABELS[mode] ?? `#${mode}`}
                </button>
              );
            })}
          </div>
          {/* Turn signals row */}
          <div className="grid grid-cols-2 gap-1 mt-1">
            <button
              onClick={() => handleSwitchMode(LightMode.LEFT_TURN)}
              className="h-8 rounded text-[11px] font-bold active:scale-95 bg-[#262626] text-[#adaaaa]"
            >
              ← Turn L
            </button>
            <button
              onClick={() => handleSwitchMode(LightMode.RIGHT_TURN)}
              className="h-8 rounded text-[11px] font-bold active:scale-95 bg-[#262626] text-[#adaaaa]"
            >
              Turn R →
            </button>
          </div>
        </div>
      )}

      {/* Radar threat bar */}
      {radarConnected && radarThreat > 0 && (
        <div className={`mt-2 p-1.5 rounded ${threatBg}`}>
          <div className="flex gap-1">
            {[1, 2, 3].map((level) => (
              <div
                key={level}
                className={`flex-1 h-1.5 rounded-full ${
                  radarThreat >= level
                    ? level >= 3 ? 'bg-[#ff716c]' : level >= 2 ? 'bg-[#fbbf24]' : 'bg-[#ff9f43]'
                    : 'bg-[#333]'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
