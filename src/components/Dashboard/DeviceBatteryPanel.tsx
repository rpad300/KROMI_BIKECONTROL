/**
 * DeviceBatteryPanel — shows all connected device batteries in one view.
 * Displayed as a swipeable panel in the Dashboard expanded view.
 */

import { useBikeStore } from '../../store/bikeStore';
import * as BLE from '../../services/bluetooth/BLEBridge';
import { identifyByName } from '../../services/bluetooth/DeviceBrandDetector';

interface BatteryDevice {
  key: string;
  label: string;
  pct: number;
  icon: string;
  color: string;
  brand?: string;
  brandColor?: string;
}

export function DeviceBatteryPanel() {
  const bikeBattery = useBikeStore((s) => s.battery_percent);
  const batteryMain = useBikeStore((s) => s.battery_main_pct);
  const batterySub = useBikeStore((s) => s.battery_sub_pct);
  const di2Battery = useBikeStore((s) => s.di2_battery);
  const lightBattery = useBikeStore((s) => s.light_battery_pct);
  const lightName = useBikeStore((s) => s.light_device_name);

  const servicesConnected = useBikeStore((s) => s.ble_services);

  // Build device list dynamically from what's connected
  const devices: BatteryDevice[] = [];

  // Bike batteries (always show if connected)
  if (servicesConnected.battery || bikeBattery > 0) {
    if (batteryMain > 0) {
      devices.push({ key: 'bat-main', label: 'Battery 800Wh', pct: batteryMain, icon: 'battery_full', color: '#3fff8b' });
    }
    if (batterySub > 0) {
      devices.push({ key: 'bat-sub', label: 'Battery 250Wh', pct: batterySub, icon: 'battery_full', color: '#3fff8b' });
    }
    if (batteryMain === 0 && batterySub === 0 && bikeBattery > 0) {
      devices.push({ key: 'bat-bike', label: 'Bike Battery', pct: bikeBattery, icon: 'battery_full', color: '#3fff8b' });
    }
  }

  // Di2 battery
  if (servicesConnected.di2 && di2Battery > 0) {
    const saved = BLE.getSavedSensorDevice('di2');
    const brand = saved ? identifyByName(saved.name) : null;
    devices.push({
      key: 'di2', label: 'Shimano Di2', pct: di2Battery, icon: 'settings_suggest', color: '#6e9bff',
      brand: brand?.brandLabel, brandColor: brand?.color,
    });
  }

  // Light battery
  if (servicesConnected.light && lightBattery > 0) {
    const brand = lightName ? identifyByName(lightName) : null;
    devices.push({
      key: 'light', label: lightName || 'Rear Light', pct: lightBattery, icon: 'flashlight_on', color: '#fbbf24',
      brand: brand?.brandLabel, brandColor: brand?.color,
    });
  }

  if (devices.length === 0) {
    return (
      <div className="bg-[#1a1919] rounded-sm p-4 flex items-center justify-center gap-2 h-24">
        <span className="material-symbols-outlined text-[#494847] text-xl">battery_unknown</span>
        <span className="text-[#777575] text-xs">Nenhuma bateria ligada</span>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1919] rounded-sm p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-sm text-[#3fff8b]" style={{ fontVariationSettings: "'FILL' 1" }}>battery_full</span>
        <span className="text-xs font-bold text-[#adaaaa] uppercase tracking-widest">Baterias</span>
      </div>

      <div className="space-y-2.5">
        {devices.map((dev) => {
          const barColor =
            dev.pct > 50 ? '#3fff8b' :
            dev.pct > 30 ? '#fbbf24' :
            dev.pct > 15 ? '#ff9f43' : '#ff716c';
          const textColor =
            dev.pct > 30 ? '#3fff8b' :
            dev.pct > 15 ? '#fbbf24' : '#ff716c';

          return (
            <div key={dev.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base" style={{ color: dev.color }}>{dev.icon}</span>
                  <span className="text-xs text-white font-medium">{dev.label}</span>
                  {dev.brand && (
                    <span
                      className="text-[8px] font-bold px-1 py-0.5 rounded"
                      style={{ color: dev.brandColor, backgroundColor: `${dev.brandColor}15` }}
                    >
                      {dev.brand}
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold tabular-nums" style={{ color: textColor }}>
                  {dev.pct}%
                </span>
              </div>
              <div className="h-2 bg-[#262626] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.max(dev.pct, 1)}%`, backgroundColor: barColor }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
