/**
 * Adaptive Brightness Service — adjusts PWA theme based on ambient light.
 *
 * Uses the AmbientLightSensor Web API (Chrome 56+) or receives lux data
 * from the BLE Bridge middleware via WebSocket.
 *
 * Modes:
 *   < 50 lux  → NIGHT (red tints, minimal brightness, preserves night vision)
 *   50–500 lux → NORMAL (default green theme)
 *   > 500 lux → HIGH_CONTRAST (brighter text, stronger contrasts for sun)
 *
 * Applies CSS custom properties to :root for dynamic theming.
 */

export type LightMode = 'night' | 'normal' | 'high-contrast';

const THRESHOLDS = {
  NIGHT_MAX: 50,     // Below this = night mode
  HIGH_CONTRAST_MIN: 500, // Above this = high contrast
} as const;

// Smooth lux with running average to avoid flickering
const SMOOTHING_SAMPLES = 10;

class AdaptiveBrightnessService {
  private luxSamples: number[] = [];
  private currentMode: LightMode = 'normal';
  private sensor: any = null; // AmbientLightSensor
  private _running = false;
  private listeners: Array<(mode: LightMode, lux: number) => void> = [];

  get isRunning(): boolean { return this._running; }
  get mode(): LightMode { return this.currentMode; }

  /**
   * Start reading ambient light.
   * Tries AmbientLightSensor API first, falls back to manual lux updates.
   */
  async start(): Promise<boolean> {
    if (this._running) return true;

    // Try Web AmbientLightSensor API
    if ('AmbientLightSensor' in window) {
      try {
        // Request permission
        const result = await navigator.permissions.query({ name: 'ambient-light-sensor' as any });
        if (result.state === 'denied') {
          console.warn('[Brightness] AmbientLightSensor permission denied');
          return false;
        }

        this.sensor = new (window as any).AmbientLightSensor({ frequency: 2 }); // 2Hz
        this.sensor.addEventListener('reading', () => {
          this.updateLux(this.sensor.illuminance);
        });
        this.sensor.addEventListener('error', (e: any) => {
          console.warn('[Brightness] Sensor error:', e.error.message);
        });
        this.sensor.start();
        this._running = true;
        console.log('[Brightness] AmbientLightSensor started');
        return true;
      } catch (err) {
        console.warn('[Brightness] AmbientLightSensor not available:', err);
      }
    }

    // No sensor available — will rely on manual updates from BLE Bridge
    this._running = true;
    console.log('[Brightness] Waiting for lux data from BLE Bridge');
    return true;
  }

  stop(): void {
    if (this.sensor) {
      this.sensor.stop();
      this.sensor = null;
    }
    this._running = false;
    this.resetTheme();
  }

  /**
   * Manually update lux value (from BLE Bridge WebSocket).
   */
  updateLux(lux: number): void {
    this.luxSamples.push(lux);
    if (this.luxSamples.length > SMOOTHING_SAMPLES) {
      this.luxSamples.shift();
    }

    const avgLux = this.luxSamples.reduce((a, b) => a + b, 0) / this.luxSamples.length;
    const newMode = this.luxToMode(avgLux);

    if (newMode !== this.currentMode) {
      this.currentMode = newMode;
      this.applyTheme(newMode);
      console.log(`[Brightness] Mode changed: ${newMode} (${Math.round(avgLux)} lux)`);
    }

    this.listeners.forEach((fn) => fn(this.currentMode, avgLux));
  }

  onModeChange(fn: (mode: LightMode, lux: number) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private luxToMode(lux: number): LightMode {
    if (lux < THRESHOLDS.NIGHT_MAX) return 'night';
    if (lux > THRESHOLDS.HIGH_CONTRAST_MIN) return 'high-contrast';
    return 'normal';
  }

  private applyTheme(mode: LightMode): void {
    const root = document.documentElement;

    switch (mode) {
      case 'night':
        // Red-tinted for night vision preservation
        // Override --ev-* tokens so ALL components using var(--ev-*) adapt
        root.style.setProperty('--ev-primary', '#ff4444');
        root.style.setProperty('--ev-primary-dim', '#cc3333');
        root.style.setProperty('--ev-primary-glow', 'rgba(255, 68, 68, 0.15)');
        root.style.setProperty('--ev-primary-shadow', 'rgba(255, 68, 68, 0.30)');
        root.style.setProperty('--ev-secondary', '#ff6666');
        root.style.setProperty('--ev-on-surface', '#cc8888');
        root.style.setProperty('--ev-on-surface-variant', '#884444');
        root.style.setProperty('--ev-on-surface-muted', '#663333');
        root.style.setProperty('--ev-surface-low', '#1a0808');
        root.style.setProperty('--ev-surface-container', '#120505');
        root.style.setProperty('--ev-bg', '#0a0000');
        root.style.setProperty('--ev-bg-hero', '#050000');
        root.style.setProperty('--brightness-filter', 'brightness(0.6)');
        // Legacy support
        root.style.setProperty('--accent-color', '#ff4444');
        root.style.setProperty('--accent-text', '#ff6666');
        root.style.setProperty('--text-primary', '#cc8888');
        root.style.setProperty('--text-secondary', '#884444');
        root.style.setProperty('--bg-card', '#1a0808');
        root.style.setProperty('--bg-surface', '#0a0000');
        root.classList.add('night-mode');
        root.classList.remove('high-contrast-mode');
        break;

      case 'high-contrast':
        // Maximum visibility under direct sunlight
        root.style.setProperty('--ev-primary', '#00ff88');
        root.style.setProperty('--ev-primary-dim', '#00cc6a');
        root.style.setProperty('--ev-primary-glow', 'rgba(0, 255, 136, 0.20)');
        root.style.setProperty('--ev-primary-shadow', 'rgba(0, 255, 136, 0.40)');
        root.style.setProperty('--ev-on-surface', '#ffffff');
        root.style.setProperty('--ev-on-surface-variant', '#dddddd');
        root.style.setProperty('--ev-on-surface-muted', '#aaaaaa');
        root.style.setProperty('--ev-surface-low', '#000000');
        root.style.setProperty('--ev-surface-container', '#000000');
        root.style.setProperty('--ev-bg', '#000000');
        root.style.setProperty('--ev-bg-hero', '#000000');
        root.style.setProperty('--brightness-filter', 'brightness(1.2)');
        // Legacy support
        root.style.setProperty('--accent-color', '#00ff88');
        root.style.setProperty('--accent-text', '#00ff88');
        root.style.setProperty('--text-primary', '#ffffff');
        root.style.setProperty('--text-secondary', '#cccccc');
        root.style.setProperty('--bg-card', '#000000');
        root.style.setProperty('--bg-surface', '#000000');
        root.classList.remove('night-mode');
        root.classList.add('high-contrast-mode');
        break;

      case 'normal':
      default:
        this.resetTheme();
        break;
    }
  }

  private resetTheme(): void {
    const root = document.documentElement;
    // Remove --ev-* overrides (reverts to design-tokens.css defaults)
    const evProps = [
      '--ev-primary', '--ev-primary-dim', '--ev-primary-glow', '--ev-primary-shadow',
      '--ev-secondary', '--ev-on-surface', '--ev-on-surface-variant', '--ev-on-surface-muted',
      '--ev-surface-low', '--ev-surface-container', '--ev-bg', '--ev-bg-hero',
    ];
    evProps.forEach((p) => root.style.removeProperty(p));
    // Remove legacy overrides
    root.style.removeProperty('--accent-color');
    root.style.removeProperty('--accent-text');
    root.style.removeProperty('--text-primary');
    root.style.removeProperty('--text-secondary');
    root.style.removeProperty('--bg-card');
    root.style.removeProperty('--bg-surface');
    root.style.removeProperty('--brightness-filter');
    root.classList.remove('night-mode', 'high-contrast-mode');
    this.currentMode = 'normal';
  }
}

export const adaptiveBrightnessService = new AdaptiveBrightnessService();
