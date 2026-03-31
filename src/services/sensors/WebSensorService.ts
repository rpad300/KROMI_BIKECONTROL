/**
 * Web Sensor Service — fallback for phone sensors when BLE Bridge is not available.
 *
 * Uses Web APIs:
 * - DeviceMotionEvent → accelerometer (lean angle, crash detection)
 * - DeviceOrientationEvent → compass heading
 *
 * Only activates if user grants permission (iOS requires explicit permission request).
 */

import { useBikeStore } from '../../store/bikeStore';

const ACCEL_THROTTLE_MS = 200; // 5 Hz
const CRASH_G_THRESHOLD = 4.0;
const GRAVITY = 9.80665;

class WebSensorService {
  private running = false;
  private lastAccelUpdate = 0;
  private motionHandler: ((e: DeviceMotionEvent) => void) | null = null;
  private orientationHandler: ((e: DeviceOrientationEvent) => void) | null = null;

  /** Whether device motion is supported */
  get isSupported(): boolean {
    return 'DeviceMotionEvent' in window;
  }

  /** Whether permission has been granted (relevant for iOS 13+) */
  get needsPermission(): boolean {
    return (
      typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
        .requestPermission === 'function'
    );
  }

  /** Request permission (iOS 13+). No-op on Android/desktop. */
  async requestPermission(): Promise<boolean> {
    if (!this.needsPermission) return true;

    try {
      const DME = DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> };
      const result = await DME.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }

  /** Start reading sensors and updating bikeStore */
  async start(): Promise<boolean> {
    if (this.running) return true;
    if (!this.isSupported) return false;

    // Request permission if needed (iOS)
    if (this.needsPermission) {
      const granted = await this.requestPermission();
      if (!granted) return false;
    }

    this.running = true;

    // DeviceMotionEvent → accelerometer
    this.motionHandler = (e: DeviceMotionEvent) => {
      const now = Date.now();
      if (now - this.lastAccelUpdate < ACCEL_THROTTLE_MS) return;
      this.lastAccelUpdate = now;

      const accel = e.accelerationIncludingGravity;
      if (!accel || accel.x == null || accel.y == null || accel.z == null) return;

      const x = accel.x;
      const y = accel.y;
      const z = accel.z;

      const magnitude = Math.sqrt(x * x + y * y + z * z) / GRAVITY;
      // Lean angle: rotation around the forward axis
      const leanDeg = (Math.atan2(x, z) * 180) / Math.PI;

      const store = useBikeStore.getState();
      store.setLeanAngle(Math.round(leanDeg * 10) / 10);

      // Crash detection
      if (magnitude > CRASH_G_THRESHOLD) {
        console.warn('[WebSensor] Crash detected! magnitude=' + magnitude.toFixed(1) + 'g');
        if ('vibrate' in navigator) {
          navigator.vibrate([500, 200, 500, 200, 500]);
        }
      }
    };
    window.addEventListener('devicemotion', this.motionHandler);

    // DeviceOrientationEvent → compass heading (informational)
    this.orientationHandler = (_e: DeviceOrientationEvent) => {
      // Compass heading could be stored if needed in future
    };
    window.addEventListener('deviceorientation', this.orientationHandler);

    console.log('[WebSensor] Started — motion + orientation listeners active');
    return true;
  }

  /** Stop reading sensors */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler);
      this.motionHandler = null;
    }
    if (this.orientationHandler) {
      window.removeEventListener('deviceorientation', this.orientationHandler);
      this.orientationHandler = null;
    }

    console.log('[WebSensor] Stopped');
  }

  get isRunning(): boolean {
    return this.running;
  }
}

export const webSensorService = new WebSensorService();
