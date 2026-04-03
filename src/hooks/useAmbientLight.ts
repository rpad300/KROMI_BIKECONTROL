import { useState, useEffect } from 'react';
import { adaptiveBrightnessService, type LightMode } from '../services/sensors/AdaptiveBrightnessService';

/** Subscribe to ambient light sensor mode changes */
export function useAmbientLight(): LightMode {
  const [mode, setMode] = useState<LightMode>(adaptiveBrightnessService.mode);

  useEffect(() => {
    adaptiveBrightnessService.start();
    const unsub = adaptiveBrightnessService.onModeChange((m) => setMode(m));
    return unsub;
  }, []);

  return mode;
}
