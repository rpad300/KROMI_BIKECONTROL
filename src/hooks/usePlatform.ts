import { useState, useEffect } from 'react';

export type Platform = 'mobile' | 'desktop';

/** Detect if running on mobile (Android/iOS) or desktop */
function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
  const isNarrow = window.innerWidth < 768;
  return isMobile || isNarrow ? 'mobile' : 'desktop';
}

/**
 * Returns 'mobile' or 'desktop'.
 * Mobile: full PWA with BLE, dashboard, motor control.
 * Desktop: config, history, map review only.
 */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);

  useEffect(() => {
    const handleResize = () => setPlatform(detectPlatform());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return platform;
}
