/**
 * deviceStore — unified device management.
 *
 * Replaces scattered localStorage saved devices with a single persisted store.
 * All BLE devices (bike, sensors, lights, radar) live here.
 * Connections page reads from this list — only added devices are shown.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Device Categories ──────────────────────────────────────────

export type DeviceCategory = 'bike' | 'drivetrain' | 'body' | 'performance' | 'light' | 'radar' | 'tpms' ;

export const DEVICE_CATEGORIES: { id: DeviceCategory; label: string; icon: string; color: string }[] = [
  { id: 'bike', label: 'E-Bike / Motor', icon: 'electric_bike', color: '#3fff8b' },
  { id: 'drivetrain', label: 'Drivetrain', icon: 'settings_suggest', color: '#6e9bff' },
  { id: 'body', label: 'Body Sensors', icon: 'monitor_heart', color: '#ff716c' },
  { id: 'performance', label: 'Performance', icon: 'bolt', color: '#fbbf24' },
  { id: 'light', label: 'Luzes', icon: 'flashlight_on', color: '#fbbf24' },
  { id: 'radar', label: 'Radar', icon: 'radar', color: '#ff9f43' },
  { id: 'tpms', label: 'TPMS', icon: 'tire_repair', color: '#e966ff' },
];

// ── Device Sub-Types ───────────────────────────────────────────

/** Specific device role within a category */
export type DeviceRole =
  // bike
  | 'motor'
  // drivetrain
  | 'di2' | 'sram_axs'
  // body
  | 'heart_rate' | 'cadence'
  // performance
  | 'power_meter'
  // light
  | 'light_front' | 'light_rear'
  // radar
  | 'radar'
  // tpms
  | 'tpms_front' | 'tpms_rear';

/** Map role → BLEServiceStatus key (for bikeStore sync) */
export const ROLE_TO_SERVICE_KEY: Record<DeviceRole, string> = {
  motor: 'gev',
  di2: 'di2',
  sram_axs: 'sram',
  heart_rate: 'heartRate',
  cadence: 'cadence',
  power_meter: 'power',
  light_front: 'light',
  light_rear: 'light',
  radar: 'radar',
  tpms_front: 'tpms',
  tpms_rear: 'tpms',
};

/** Which roles are available per category */
export const CATEGORY_ROLES: Record<DeviceCategory, { role: DeviceRole; label: string; icon: string }[]> = {
  bike: [
    { role: 'motor', label: 'Motor / Gateway', icon: 'electric_bike' },
  ],
  drivetrain: [
    { role: 'di2', label: 'Shimano Di2', icon: 'settings_suggest' },
    { role: 'sram_axs', label: 'SRAM AXS', icon: 'swap_vert' },
  ],
  body: [
    { role: 'heart_rate', label: 'Heart Rate', icon: 'monitor_heart' },
    { role: 'cadence', label: 'Cadence', icon: 'speed' },
  ],
  performance: [
    { role: 'power_meter', label: 'Power Meter', icon: 'bolt' },
  ],
  light: [
    { role: 'light_front', label: 'Luz Frontal', icon: 'flashlight_on' },
    { role: 'light_rear', label: 'Luz Traseira', icon: 'light' },
  ],
  radar: [
    { role: 'radar', label: 'Radar', icon: 'radar' },
  ],
  tpms: [
    { role: 'tpms_front', label: 'TPMS Frontal', icon: 'tire_repair' },
    { role: 'tpms_rear', label: 'TPMS Traseiro', icon: 'tire_repair' },
  ],
};

// ── Saved Device ───────────────────────────────────────────────

export interface SavedDevice {
  id: string;                // Unique ID (address or generated)
  name: string;              // BLE device name
  address: string;           // MAC address (for auto-connect via bridge)
  category: DeviceCategory;
  role: DeviceRole;
  brand: string;             // Detected brand label (e.g. "Polar", "iGPSPORT", "Garmin")
  brandColor: string;        // Brand color for badge
  addedAt: number;           // Timestamp when added
}

// ── Store ──────────────────────────────────────────────────────

interface DeviceStoreState {
  devices: SavedDevice[];

  addDevice: (device: Omit<SavedDevice, 'id' | 'addedAt'>) => SavedDevice;
  removeDevice: (id: string) => void;
  updateDevice: (id: string, partial: Partial<SavedDevice>) => void;
  getByRole: (role: DeviceRole) => SavedDevice | undefined;
  getAllByCategory: (category: DeviceCategory) => SavedDevice[];
  hasRole: (role: DeviceRole) => boolean;
}

export const useDeviceStore = create<DeviceStoreState>()(
  persist(
    (set, get) => ({
      devices: [],

      addDevice: (device) => {
        const id = device.address || crypto.randomUUID();
        const saved: SavedDevice = { ...device, id, addedAt: Date.now() };

        set((s) => {
          // Replace existing device with same role (e.g. can only have one HR sensor)
          // Exception: lights can have front + rear (different roles)
          const filtered = s.devices.filter((d) => d.role !== saved.role);
          return { devices: [...filtered, saved] };
        });

        return saved;
      },

      removeDevice: (id) => set((s) => ({
        devices: s.devices.filter((d) => d.id !== id),
      })),

      updateDevice: (id, partial) => set((s) => ({
        devices: s.devices.map((d) => d.id === id ? { ...d, ...partial } : d),
      })),

      getByRole: (role) => get().devices.find((d) => d.role === role),

      getAllByCategory: (category) => get().devices.filter((d) => d.category === category),

      hasRole: (role) => get().devices.some((d) => d.role === role),
    }),
    {
      name: 'kromi-devices',
    },
  ),
);
