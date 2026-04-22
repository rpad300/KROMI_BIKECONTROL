/**
 * RideTickService — single 1-second master tick for all ride-loop subscribers.
 *
 * Consolidates up to 6 independent setInterval(fn, 1000) timers into one,
 * reducing CPU wake-ups from N/sec to 1/sec during a ride.
 *
 * Usage:
 *   const unsub = subscribeRideTick(() => myStore.getState().tick());
 *   // call unsub() in useEffect cleanup
 *
 * For subscribers that need a 2-second cadence, use subscribeRideTick2s().
 * Internally they share the same 1s interval; the 2s variant skips every other tick.
 */

type TickFn = () => void | Promise<void>;

const _subscribers1s = new Set<TickFn>();
const _subscribers2s = new Set<TickFn>();

let _interval: ReturnType<typeof setInterval> | null = null;
let _tick = 0;

function _runTick() {
  _tick++;
  _subscribers1s.forEach((fn) => {
    try {
      const result = fn();
      if (result instanceof Promise) {
        result.catch((e) => console.error('[RideTick]', e));
      }
    } catch (e) {
      console.error('[RideTick]', e);
    }
  });

  // 2-second subscribers run on every other tick
  if (_tick % 2 === 0) {
    _subscribers2s.forEach((fn) => {
      try {
        const result = fn();
        if (result instanceof Promise) {
          result.catch((e) => console.error('[RideTick2s]', e));
        }
      } catch (e) {
        console.error('[RideTick2s]', e);
      }
    });
  }
}

function _ensureRunning() {
  if (!_interval && (_subscribers1s.size > 0 || _subscribers2s.size > 0)) {
    _tick = 0;
    _interval = setInterval(_runTick, 1000);
  }
}

function _maybeStop() {
  if (_subscribers1s.size === 0 && _subscribers2s.size === 0 && _interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

/**
 * Subscribe a function to the 1-second master tick.
 * Returns an unsubscribe function — call it in useEffect cleanup.
 */
export function subscribeRideTick(fn: TickFn): () => void {
  _subscribers1s.add(fn);
  _ensureRunning();
  return () => {
    _subscribers1s.delete(fn);
    _maybeStop();
  };
}

/**
 * Subscribe a function to a 2-second tick (runs on every other master tick).
 * Useful for heavier computations that previously used setInterval(fn, 2000).
 * Returns an unsubscribe function — call it in useEffect cleanup.
 */
export function subscribeRideTick2s(fn: TickFn): () => void {
  _subscribers2s.add(fn);
  _ensureRunning();
  return () => {
    _subscribers2s.delete(fn);
    _maybeStop();
  };
}
