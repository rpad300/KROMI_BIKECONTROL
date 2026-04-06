/**
 * RadarPanel — dedicated radar view with threat visualization.
 * Shows vehicle approaching indicator, distance, speed, and threat level.
 */

import { useBikeStore } from '../../store/bikeStore';

export function RadarPanel() {
  const radarConnected = useBikeStore((s) => s.ble_services.radar);
  const threat = useBikeStore((s) => s.radar_threat_level);
  const distance = useBikeStore((s) => s.radar_distance_m);
  const speed = useBikeStore((s) => s.radar_speed_kmh);
  const lightConnected = useBikeStore((s) => s.ble_services.light);
  const lightMode = useBikeStore((s) => s.light_mode);

  if (!radarConnected) {
    return (
      <div className="bg-[#1a1919] rounded-sm p-4 flex flex-col items-center justify-center gap-2 h-32">
        <span className="material-symbols-outlined text-[#494847] text-3xl">radar</span>
        <span className="text-[#777575] text-xs">Radar nao ligado</span>
      </div>
    );
  }

  const threatColor = threat >= 3 ? '#ff4444' : threat >= 2 ? '#fbbf24' : threat >= 1 ? '#ff9f43' : '#3fff8b';
  const threatLabel = threat >= 3 ? 'DANGER' : threat >= 2 ? 'WARNING' : threat >= 1 ? 'CAUTION' : 'CLEAR';
  const threatBg = threat >= 3 ? '#ff444420' : threat >= 2 ? '#fbbf2420' : threat >= 1 ? '#ff9f4315' : '#3fff8b10';

  return (
    <div className="bg-[#1a1919] rounded-sm p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-sm" style={{ color: threatColor }}>radar</span>
        <span className="text-xs font-bold text-[#adaaaa] uppercase tracking-widest">Radar</span>
      </div>

      {/* Main threat display */}
      <div
        className={`rounded-lg p-4 flex flex-col items-center ${threat >= 2 ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: threatBg }}
      >
        {/* Threat level indicator */}
        <div className="flex gap-2 mb-2">
          {[1, 2, 3].map((level) => (
            <div
              key={level}
              className="w-8 h-2 rounded-full transition-all"
              style={{
                backgroundColor: threat >= level ? threatColor : '#333',
                boxShadow: threat >= level ? `0 0 8px ${threatColor}40` : 'none',
              }}
            />
          ))}
        </div>

        {/* Status text */}
        <span className="text-lg font-bold tracking-wider" style={{ color: threatColor }}>
          {threatLabel}
        </span>

        {/* Distance + speed */}
        {threat > 0 && (
          <div className="flex items-center gap-4 mt-2">
            <div className="text-center">
              <span className="text-2xl font-bold tabular-nums text-white">
                {distance > 0 ? distance.toFixed(0) : '—'}
              </span>
              <span className="text-xs text-[#777575] ml-1">m</span>
            </div>
            {speed > 0 && (
              <div className="text-center">
                <span className="text-2xl font-bold tabular-nums text-white">{speed}</span>
                <span className="text-xs text-[#777575] ml-1">km/h</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Visual proximity arc */}
      {threat > 0 && (
        <div className="mt-3 flex items-center justify-center">
          <svg width="200" height="80" viewBox="0 0 200 80">
            {/* Background arcs */}
            {[60, 45, 30].map((r, i) => (
              <path
                key={i}
                d={`M ${100 - r} 75 A ${r} ${r} 0 0 1 ${100 + r} 75`}
                fill="none"
                stroke={threat > i ? threatColor : '#333'}
                strokeWidth="3"
                opacity={threat > i ? 0.6 + i * 0.15 : 0.2}
              />
            ))}
            {/* Rider dot */}
            <circle cx="100" cy="75" r="5" fill="#3fff8b" />
            {/* Vehicle dot */}
            {distance > 0 && (
              <circle
                cx="100"
                cy={75 - Math.min(distance / 3, 55)}
                r="4"
                fill={threatColor}
                opacity={0.8}
              >
                <animate
                  attributeName="opacity"
                  values="0.5;1;0.5"
                  dur="1s"
                  repeatCount="indefinite"
                />
              </circle>
            )}
          </svg>
        </div>
      )}

      {/* Light sync status */}
      {lightConnected && (
        <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-[#777575]">
          <span className="material-symbols-outlined text-xs" style={{ color: lightMode > 0 ? '#fbbf24' : '#494847' }}>
            flashlight_on
          </span>
          <span>
            {threat > 0 ? 'Flash activo' : 'Light sync pronto'}
          </span>
        </div>
      )}
    </div>
  );
}
