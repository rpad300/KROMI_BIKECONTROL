/**
 * CrashDetectionService — detects potential crashes via accelerometer + HR anomalies.
 *
 * Detection triggers:
 *   1. Impact:       crash_magnitude > 4G from bikeStore (set by WebSensorService / BLE Bridge)
 *   2. Sudden stop:  speed was > 15 km/h, drops to 0, no HR reading for 10s
 *   3. HR anomaly:   HR drops from > 100 bpm to < 40 bpm suddenly (possible cardiac event)
 *
 * On trigger:
 *   → Alert shown with 30s countdown (UI reads useCrashStore)
 *   → Continuous vibration + Web Audio alarm
 *   → "Estou Bem" cancels the alert
 *   → Countdown expires → POST rescue_request to Supabase + notify emergency contacts
 */

import { create } from 'zustand';
import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { supaFetch, supaInvokeFunction } from '../../lib/supaFetch';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CrashTrigger = 'impact' | 'sudden_stop' | 'hr_anomaly';

export interface CrashAlertState {
  active: boolean;
  trigger: CrashTrigger;
  countdownSeconds: number;  // 30 → 0
  position: { lat: number; lng: number };
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zustand store — consumed by the CrashAlertOverlay UI component
// ─────────────────────────────────────────────────────────────────────────────

export const useCrashStore = create<{
  alert: CrashAlertState | null;
  setAlert: (a: CrashAlertState | null) => void;
}>((set) => ({
  alert: null,
  setAlert: (a) => set({ alert: a }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const COUNTDOWN_SECONDS       = 30;
const IMPACT_G_THRESHOLD      = 4.0;   // G-force spike that triggers impact detection
const SPEED_THRESHOLD_KMH     = 15;    // Min speed before sudden-stop logic activates
const NO_HR_TIMEOUT_MS        = 10_000; // 10s without HR after speed drop → trigger
const HR_HIGH_THRESHOLD       = 100;   // bpm — "was riding hard"
const HR_LOW_THRESHOLD        = 40;    // bpm — suspicious drop
const HR_HISTORY_WINDOW_MS    = 15_000; // Window to compare HR before/after drop
const DEBOUNCE_MS             = 5_000;  // Minimum time between consecutive triggers
const POLL_INTERVAL_MS        = 500;    // How often we sample bikeStore state

// ─────────────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────────────

let monitoringInterval: ReturnType<typeof setInterval> | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let vibrateInterval: ReturnType<typeof setInterval> | null = null;
let audioCtx: AudioContext | null = null;
let _alarmActive = false;
let lastTriggerAt = 0;

// Sudden-stop tracking
let speedDropAt: number | null = null;  // timestamp when speed crossed below threshold
let lastKnownSpeed = 0;

// HR anomaly tracking
let hrHistory: { bpm: number; ts: number }[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Audio — programmatic alarm tone (no audio files)
// ─────────────────────────────────────────────────────────────────────────────

function startAlarmSound(): void {
  try {
    if (_alarmActive) return; // already playing
    audioCtx = new AudioContext();

    // Two-tone siren: alternate 880 Hz and 660 Hz every 400ms
    let high = true;

    const playTone = () => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(high ? 880 : 660, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.38);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.38);
      high = !high;
    };

    playTone();
    _alarmActive = true; // sentinel so we know alarm is active
    // Re-trigger the tone every 400ms via an interval stored outside
    const toneInterval = setInterval(() => {
      if (!audioCtx) { clearInterval(toneInterval); return; }
      playTone();
    }, 400);
    // Attach interval to audioCtx for cleanup
    (audioCtx as AudioContext & { _toneInterval?: ReturnType<typeof setInterval> })._toneInterval = toneInterval;
  } catch (err) {
    console.warn('[CrashDetection] Audio failed:', err);
  }
}

function stopAlarmSound(): void {
  try {
    if (!audioCtx) return;
    const ctx = audioCtx as AudioContext & { _toneInterval?: ReturnType<typeof setInterval> };
    if (ctx._toneInterval) clearInterval(ctx._toneInterval);
    audioCtx.close().catch(() => {});
    audioCtx = null;
    _alarmActive = false;
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vibration
// ─────────────────────────────────────────────────────────────────────────────

function startVibration(): void {
  if (!('vibrate' in navigator)) return;
  // Immediate burst
  navigator.vibrate([500, 200, 500, 200, 500]);
  // Repeat every 2.5s
  vibrateInterval = setInterval(() => {
    navigator.vibrate([500, 200, 500, 200, 500]);
  }, 2500);
}

function stopVibration(): void {
  if (vibrateInterval !== null) {
    clearInterval(vibrateInterval);
    vibrateInterval = null;
  }
  if ('vibrate' in navigator) {
    navigator.vibrate(0); // cancel
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SOS escalation — fires when countdown reaches 0
// ─────────────────────────────────────────────────────────────────────────────

async function escalateToSOS(alert: CrashAlertState): Promise<void> {
  console.warn('[CrashDetection] SOS escalated — trigger:', alert.trigger);

  // 1. Read auth/settings dynamically (avoid top-level import cycles)
  const { useAuthStore } = await import('../../store/authStore');
  const { useSettingsStore } = await import('../../store/settingsStore');
  const user = useAuthStore.getState().user;
  const riderProfile = useSettingsStore.getState().riderProfile;
  const emergencyContacts = riderProfile.emergency_contacts ?? [];

  // 2. Persist rescue_request to Supabase
  try {
    await supaFetch('/rest/v1/rescue_requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: user?.id ?? null,
        trigger: alert.trigger,
        lat: alert.position.lat,
        lng: alert.position.lng,
        occurred_at: new Date(alert.timestamp).toISOString(),
        ride_speed_kmh: useBikeStore.getState().speed_kmh,
        ride_hr_bpm: useBikeStore.getState().hr_bpm,
        ride_battery_pct: useBikeStore.getState().battery_percent,
      }),
    });
  } catch (err) {
    console.error('[CrashDetection] Failed to persist rescue_request:', err);
  }

  // 3. Send notifications to emergency contacts via edge function
  if (emergencyContacts.length === 0) {
    console.warn('[CrashDetection] No emergency contacts configured.');
    return;
  }

  try {
    await supaInvokeFunction('crash-notify', {
      userId: user?.id ?? null,
      trigger: alert.trigger,
      position: alert.position,
      occurredAt: new Date(alert.timestamp).toISOString(),
      emergencyContacts,
      riderName: riderProfile.name ?? 'Ciclista KROMI',
      emergencyQrToken: riderProfile.emergency_qr_token ?? null,
      rideContext: {
        speed_kmh: useBikeStore.getState().speed_kmh,
        hr_bpm: useBikeStore.getState().hr_bpm,
        battery_pct: useBikeStore.getState().battery_percent,
        trip_distance_km: useBikeStore.getState().trip_distance_km ?? 0,
      },
    });
    console.log('[CrashDetection] Emergency contacts notified:', emergencyContacts.length);
  } catch (err) {
    console.error('[CrashDetection] Failed to notify emergency contacts:', err);
    // Store for offline retry — critical for mountain/tunnel scenarios
    try {
      localStorage.setItem('kromi_pending_sos', JSON.stringify({
        trigger: alert.trigger,
        position: alert.position,
        timestamp: alert.timestamp,
        contacts: emergencyContacts,
        riderName: riderProfile.name ?? 'Ciclista KROMI',
        token: riderProfile.emergency_qr_token ?? null,
      }));
      window.addEventListener('online', retryPendingSOS, { once: true });
    } catch { /* localStorage may be unavailable */ }
  }
}

/** Retry pending SOS when network comes back */
async function retryPendingSOS(): Promise<void> {
  const raw = localStorage.getItem('kromi_pending_sos');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    const { supaInvokeFunction: invoke } = await import('../../lib/supaFetch');
    await invoke('crash-notify', {
      trigger: data.trigger,
      position: data.position,
      occurredAt: new Date(data.timestamp).toISOString(),
      emergencyContacts: data.contacts,
      riderName: data.riderName,
      emergencyQrToken: data.token,
    });
    localStorage.removeItem('kromi_pending_sos');
    console.log('[CrashDetection] Pending SOS retried successfully');
  } catch (err) {
    console.error('[CrashDetection] SOS retry failed:', err);
    // Re-listen for next online event
    window.addEventListener('online', retryPendingSOS, { once: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function triggerAlert(trigger: CrashTrigger): void {
  const now = Date.now();
  if (now - lastTriggerAt < DEBOUNCE_MS) return; // debounce repeated triggers
  lastTriggerAt = now;

  const { latitude, longitude } = useMapStore.getState();

  const alert: CrashAlertState = {
    active: true,
    trigger,
    countdownSeconds: COUNTDOWN_SECONDS,
    position: { lat: latitude, lng: longitude },
    timestamp: now,
  };

  useCrashStore.getState().setAlert(alert);
  startAlarmSound();
  startVibration();

  console.warn(`[CrashDetection] Alert triggered — trigger=${trigger} pos=${latitude.toFixed(5)},${longitude.toFixed(5)}`);

  // Countdown tick — clear any existing interval before starting new one
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  let remaining = COUNTDOWN_SECONDS;
  countdownInterval = setInterval(() => {
    remaining -= 1;

    const current = useCrashStore.getState().alert;
    if (!current || !current.active) {
      // User cancelled
      clearInterval(countdownInterval!);
      countdownInterval = null;
      return;
    }

    if (remaining <= 0) {
      clearInterval(countdownInterval!);
      countdownInterval = null;

      // Finalise the alert state before escalating
      useCrashStore.getState().setAlert({ ...current, countdownSeconds: 0 });
      stopAlarmSound();
      stopVibration();

      escalateToSOS(current).catch((err) => {
        console.error('[CrashDetection] escalateToSOS error:', err);
      });
    } else {
      useCrashStore.getState().setAlert({ ...current, countdownSeconds: remaining });
    }
  }, 1_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Monitoring loop — samples bikeStore state at POLL_INTERVAL_MS
// ─────────────────────────────────────────────────────────────────────────────

function monitoringTick(): void {
  // Skip checks while an alert is already active
  if (useCrashStore.getState().alert?.active) return;

  const bike = useBikeStore.getState();
  const now = Date.now();

  // ── Trigger 1: Impact ──────────────────────────────────────────
  // WebSensorService / BLE Bridge writes crash_magnitude; last_crash_at is its timestamp.
  if (
    bike.crash_magnitude >= IMPACT_G_THRESHOLD &&
    bike.last_crash_at > 0 &&
    now - bike.last_crash_at < POLL_INTERVAL_MS * 3
  ) {
    triggerAlert('impact');
    return;
  }

  // ── Trigger 2: Sudden stop + no HR ─────────────────────────────
  const speed = bike.speed_kmh;
  if (lastKnownSpeed >= SPEED_THRESHOLD_KMH && speed < 1) {
    if (speedDropAt === null) speedDropAt = now;
  } else if (speed >= SPEED_THRESHOLD_KMH) {
    speedDropAt = null; // reset — rider is moving again
  }
  lastKnownSpeed = speed;

  if (speedDropAt !== null && now - speedDropAt >= NO_HR_TIMEOUT_MS) {
    if (bike.hr_bpm === 0) {
      triggerAlert('sudden_stop');
      speedDropAt = null;
      return;
    } else {
      // HR is present — not a crash, just a stop
      speedDropAt = null;
    }
  }

  // ── Trigger 3: HR anomaly ───────────────────────────────────────
  if (bike.hr_bpm > 0) {
    hrHistory.push({ bpm: bike.hr_bpm, ts: now });
    // Prune old entries outside the comparison window
    hrHistory = hrHistory.filter((h) => now - h.ts <= HR_HISTORY_WINDOW_MS);

    if (bike.hr_bpm < HR_LOW_THRESHOLD && hrHistory.length >= 2) {
      // Find the highest recent HR before this moment
      const recentPeak = hrHistory
        .filter((h) => h.ts < now - 2_000) // at least 2s ago
        .reduce((max, h) => (h.bpm > max ? h.bpm : max), 0);

      if (recentPeak >= HR_HIGH_THRESHOLD) {
        triggerAlert('hr_anomaly');
        hrHistory = [];
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Start monitoring for crashes. Safe to call multiple times. */
export function startCrashMonitoring(): void {
  if (monitoringInterval !== null) return; // already running

  // Reset transient state
  speedDropAt = null;
  lastKnownSpeed = 0;
  hrHistory = [];
  lastTriggerAt = 0;

  monitoringInterval = setInterval(monitoringTick, POLL_INTERVAL_MS);
  console.log('[CrashDetection] Monitoring started');
}

/** Stop monitoring. Also cancels any active alert without escalating. */
export function stopCrashMonitoring(): void {
  if (monitoringInterval !== null) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  _clearAlert();
  console.log('[CrashDetection] Monitoring stopped');
}

/** Cancel active alert — call when user taps "Estou Bem". */
export function cancelCrashAlert(): void {
  const alert = useCrashStore.getState().alert;
  if (!alert?.active) return;

  _clearAlert();
  console.log('[CrashDetection] Alert cancelled by user');
}

/** Get current alert state (null when no active alert). */
export function getCrashAlertState(): CrashAlertState | null {
  return useCrashStore.getState().alert;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function _clearAlert(): void {
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  stopAlarmSound();
  stopVibration();
  useCrashStore.getState().setAlert(null);
}
