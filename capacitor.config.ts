import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'online.kromi.bikecontrol',
  appName: 'BikeControl',
  webDir: 'dist',
  plugins: {
    BluetoothLe: {
      // Display strings for BLE permission dialogs
      displayStrings: {
        scanning: 'Scanning for Giant eBike...',
        cancel: 'Cancel',
        availableDevices: 'Available Devices',
        noDeviceFound: 'No Giant eBike found',
      },
    },
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  server: {
    // Allow mixed content for dev
    androidScheme: 'https',
  },
};

export default config;
