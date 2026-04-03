/**
 * AmbientGlance — full-screen OLED-saving overlay during rides.
 *
 * Activates after 8s of no touch interaction while riding.
 * Shows only essential metrics in large fonts on pure black background.
 *
 * Color design for cycling eyewear:
 * - All colors are HIGH SATURATION + HIGH LUMINANCE to cut through:
 *   - Photochromatic lenses (darkened in sunlight)
 *   - Polarized lenses (filter certain light angles)
 *   - Yellow/amber tinted lenses (shift blue → invisible)
 * - NO blues or purples (filtered by polarized lenses)
 * - NO low-contrast greys (invisible through tinted lenses)
 * - Pure OLED black (#000) = pixels off = max battery saving
 */

import { useEffect, useRef } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { useGlanceStore } from '../../store/glanceStore';
import { useAmbientLight } from '../../hooks/useAmbientLight';
import { ASSIST_MODE_LABELS, AssistMode } from '../../types/bike.types';
import type { LightMode } from '../../services/sensors/AdaptiveBrightnessService';

// ── Color palettes per light mode ──
// Optimised for visibility through polarized + photochromatic cycling lenses
// Rule: NO blue, NO purple, NO low-saturation — only green/yellow/red/white

interface GlanceColors {
  speed: string;
  speedUnit: string;
  hr: string;
  hrLabel: string;
  battery: string;
  batteryLabel: string;
  modeLabel: string;
  separator: string;
}

const PALETTE: Record<LightMode, GlanceColors> = {
  // Night: deep red preserves night vision, still visible through any lens
  night: {
    speed: '#ff3333',
    speedUnit: '#992222',
    hr: '#ff5544',
    hrLabel: '#882222',
    battery: '#ff3333',
    batteryLabel: '#882222',
    modeLabel: '#ff4444',
    separator: '#331111',
  },
  // Normal: bright green/white, high contrast on black OLED
  normal: {
    speed: '#ffffff',
    speedUnit: '#aaaaaa',
    hr: '#ffffff',
    hrLabel: '#888888',
    battery: '#3fff8b',
    batteryLabel: '#888888',
    modeLabel: '#3fff8b',
    separator: '#222222',
  },
  // High contrast (bright sun + dark lenses): maximum luminance colours
  // Yellow-green cuts through ALL lens types including polarized
  'high-contrast': {
    speed: '#ffff00',      // Pure yellow — max visibility through any lens
    speedUnit: '#cccc00',
    hr: '#ffcc00',         // Amber — visible through polarized
    hrLabel: '#aa8800',
    battery: '#00ff66',    // Neon green — high sat, no blue component
    batteryLabel: '#aa8800',
    modeLabel: '#ffff00',
    separator: '#333300',
  },
};

// Assist mode colors — all high-saturation, no blue/purple
const ASSIST_GLANCE_COLORS: Record<number, string> = {
  [AssistMode.OFF]:    '#777777',
  [AssistMode.ECO]:    '#3fff8b',  // green
  [AssistMode.TOUR]:   '#00ffaa',  // teal-green (not blue)
  [AssistMode.ACTIVE]: '#ffcc00',  // amber
  [AssistMode.SPORT]:  '#ff9933',  // orange
  [AssistMode.POWER]:  '#ff4444',  // red
  [AssistMode.SMART]:  '#ffff00',  // yellow (not purple — visible through polarized)
};

// HR zone colors — high-saturation, polarized-safe
const HR_ZONE_COLORS = [
  '#888888',  // zone 0 (no HR)
  '#aaaaaa',  // zone 1 recovery — white-grey
  '#3fff8b',  // zone 2 endurance — green
  '#ffcc00',  // zone 3 tempo — amber
  '#ff9933',  // zone 4 threshold — orange
  '#ff3333',  // zone 5 VO2max — red
];

function getBatteryColor(pct: number): string {
  if (pct > 30) return '#3fff8b';   // green
  if (pct > 15) return '#ffcc00';   // amber warning
  return '#ff3333';                  // red critical
}

export function AmbientGlance() {
  const isActive = useGlanceStore((s) => s.isGlanceActive);
  const lightMode = useAmbientLight();

  const overlayRef = useRef<HTMLDivElement>(null);
  const spdRef = useRef<HTMLSpanElement>(null);
  const hrRef = useRef<HTMLSpanElement>(null);
  const hrIconRef = useRef<HTMLSpanElement>(null);
  const batRef = useRef<HTMLSpanElement>(null);
  const batBarRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLSpanElement>(null);
  const modeDotRef = useRef<HTMLSpanElement>(null);

  // Subscribe to bikeStore — update DOM refs directly (zero re-renders)
  useEffect(() => {
    const update = () => {
      const b = useBikeStore.getState();
      const colors = PALETTE[lightMode];

      if (spdRef.current) {
        spdRef.current.textContent = b.speed_kmh > 0 ? b.speed_kmh.toFixed(0) : '0';
        spdRef.current.style.color = colors.speed;
      }

      if (hrRef.current) {
        hrRef.current.textContent = b.hr_bpm > 0 ? String(b.hr_bpm) : '--';
        hrRef.current.style.color = lightMode === 'night'
          ? colors.hr
          : (b.hr_zone > 0 ? HR_ZONE_COLORS[b.hr_zone] ?? colors.hr : colors.hr);
      }
      if (hrIconRef.current) {
        hrIconRef.current.style.color = lightMode === 'night'
          ? colors.hr
          : (b.hr_zone > 0 ? HR_ZONE_COLORS[b.hr_zone] ?? colors.hr : colors.hr);
      }

      if (batRef.current) {
        const batColor = lightMode === 'night' ? colors.battery : getBatteryColor(b.battery_percent);
        batRef.current.textContent = `${b.battery_percent}%`;
        batRef.current.style.color = batColor;
      }
      if (batBarRef.current) {
        const batColor = lightMode === 'night' ? colors.battery : getBatteryColor(b.battery_percent);
        batBarRef.current.style.width = `${Math.max(b.battery_percent, 2)}%`;
        batBarRef.current.style.backgroundColor = batColor;
      }

      if (modeRef.current) {
        const label = ASSIST_MODE_LABELS[b.assist_mode as AssistMode] ?? 'OFF';
        modeRef.current.textContent = label;
        modeRef.current.style.color = lightMode === 'night'
          ? colors.modeLabel
          : (ASSIST_GLANCE_COLORS[b.assist_mode] ?? colors.modeLabel);
      }
      if (modeDotRef.current) {
        modeDotRef.current.style.backgroundColor = lightMode === 'night'
          ? colors.modeLabel
          : (ASSIST_GLANCE_COLORS[b.assist_mode] ?? colors.modeLabel);
      }
    };

    // Initial update
    update();

    // Subscribe to store changes
    const unsub = useBikeStore.subscribe(update);
    return unsub;
  }, [lightMode]);

  const handleTouch = (e: React.TouchEvent) => {
    e.stopPropagation();
    useGlanceStore.getState().resetIdle();
  };

  if (!isActive) return null;

  const colors = PALETTE[lightMode];

  return (
    <div
      ref={overlayRef}
      onTouchStart={handleTouch}
      onClick={() => useGlanceStore.getState().resetIdle()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        backgroundColor: '#000000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
        animation: 'glanceFadeIn 300ms ease-out',
        touchAction: 'manipulation',
      }}
    >
      {/* Speed — dominant metric */}
      <div style={{ textAlign: 'center' }}>
        <span
          ref={spdRef}
          style={{
            fontSize: '120px',
            fontWeight: 900,
            lineHeight: 1,
            fontFamily: "'Space Grotesk', sans-serif",
            color: colors.speed,
          }}
          className="tabular-nums"
        >
          0
        </span>
        <div style={{ fontSize: '18px', fontWeight: 600, color: colors.speedUnit, marginTop: '-8px' }}>
          km/h
        </div>
      </div>

      {/* Separator */}
      <div style={{ width: '60%', height: '1px', backgroundColor: colors.separator }} />

      {/* HR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span
          ref={hrIconRef}
          style={{ fontSize: '36px', color: colors.hr }}
        >
          &#9829;
        </span>
        <span
          ref={hrRef}
          style={{
            fontSize: '64px',
            fontWeight: 900,
            fontFamily: "'Space Grotesk', sans-serif",
            color: colors.hr,
          }}
          className="tabular-nums"
        >
          --
        </span>
        <span style={{ fontSize: '16px', color: colors.hrLabel, alignSelf: 'flex-end', paddingBottom: '12px' }}>
          bpm
        </span>
      </div>

      {/* Battery bar */}
      <div style={{
        width: '70%',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <div style={{
          flex: 1,
          height: '12px',
          backgroundColor: '#1a1a1a',
          borderRadius: '6px',
          overflow: 'hidden',
        }}>
          <div
            ref={batBarRef}
            style={{
              height: '100%',
              width: '50%',
              backgroundColor: colors.battery,
              borderRadius: '6px',
              transition: 'width 1s ease',
            }}
          />
        </div>
        <span
          ref={batRef}
          style={{
            fontSize: '36px',
            fontWeight: 800,
            fontFamily: "'Space Grotesk', sans-serif",
            color: colors.battery,
            minWidth: '80px',
            textAlign: 'right',
          }}
          className="tabular-nums"
        >
          0%
        </span>
      </div>

      {/* Assist mode */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginTop: '8px',
      }}>
        <span
          ref={modeDotRef}
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            backgroundColor: colors.modeLabel,
          }}
        />
        <span
          ref={modeRef}
          style={{
            fontSize: '40px',
            fontWeight: 900,
            fontFamily: "'Space Grotesk', sans-serif",
            color: colors.modeLabel,
            letterSpacing: '2px',
          }}
        >
          ECO
        </span>
      </div>

      {/* Subtle tap hint — disappears quickly */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        fontSize: '12px',
        color: '#333333',
        opacity: 0.6,
      }}>
        toca para voltar
      </div>

      <style>{`
        @keyframes glanceFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
