// src/components/Dashboard/ElevationMiniProfile.tsx
import { useMemo } from 'react';
import type { RoutePoint } from '../../services/routes/GPXParser';

interface Props {
  points: RoutePoint[];
  currentIndex: number;
  height?: number;
}

export function ElevationMiniProfile({ points, currentIndex, height = 56 }: Props) {
  const { pathD, fillD, minEle, maxEle, totalGain, currentEle, markerX, markerY } = useMemo(() => {
    if (points.length < 2) return { pathD: '', fillD: '', minEle: 0, maxEle: 0, totalGain: 0, currentEle: 0, markerX: 0, markerY: 0 };

    const totalDist = points[points.length - 1]!.distance_from_start_m;
    let minE = Infinity, maxE = -Infinity, gain = 0;

    for (let i = 0; i < points.length; i++) {
      const e = points[i]!.elevation;
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
      if (i > 0 && e > points[i - 1]!.elevation) gain += e - points[i - 1]!.elevation;
    }

    const eleRange = maxE - minE || 1;
    const padding = 4;
    const w = 340;
    const h = height - padding * 2;

    // Sample ~100 points for SVG performance
    const step = Math.max(1, Math.floor(points.length / 100));
    const sampled: { x: number; y: number }[] = [];

    for (let i = 0; i < points.length; i += step) {
      const p = points[i]!;
      const x = (p.distance_from_start_m / totalDist) * w;
      const y = padding + h - ((p.elevation - minE) / eleRange) * h;
      sampled.push({ x, y });
    }
    // Ensure last point
    const last = points[points.length - 1]!;
    sampled.push({ x: w, y: padding + h - ((last.elevation - minE) / eleRange) * h });

    const pathParts = sampled.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    const lineD = pathParts.join(' ');
    const areaD = `${lineD} L ${w} ${padding + h} L 0 ${padding + h} Z`;

    // Current position marker
    const ci = Math.min(currentIndex, points.length - 1);
    const cp = points[ci]!;
    const mx = (cp.distance_from_start_m / totalDist) * w;
    const my = padding + h - ((cp.elevation - minE) / eleRange) * h;

    return {
      pathD: lineD,
      fillD: areaD,
      minEle: Math.round(minE),
      maxEle: Math.round(maxE),
      totalGain: Math.round(gain),
      currentEle: Math.round(cp.elevation),
      markerX: mx,
      markerY: my,
    };
  }, [points, currentIndex, height]);

  if (points.length < 2) return null;

  return (
    <div style={{ background: '#1a1919', borderRadius: 4, padding: '6px 8px', position: 'relative', height, overflow: 'hidden' }}>
      <svg width="100%" height={height - 12} viewBox={`0 0 340 ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="navElevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3fff8b" />
            <stop offset="100%" stopColor="#0e0e0e" />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#navElevGrad)" opacity={0.3} />
        {/* Done portion — brighter */}
        <clipPath id="donePortion">
          <rect x="0" y="0" width={markerX} height={height} />
        </clipPath>
        <path d={pathD} stroke="#3fff8b" strokeWidth={2} fill="none" clipPath="url(#donePortion)" />
        {/* Remaining — dimmer */}
        <clipPath id="remainPortion">
          <rect x={markerX} y="0" width={340 - markerX} height={height} />
        </clipPath>
        <path d={pathD} stroke="#3fff8b" strokeWidth={1} fill="none" opacity={0.4} clipPath="url(#remainPortion)" />
        {/* Position marker */}
        <line x1={markerX} y1={0} x2={markerX} y2={height} stroke="#fff" strokeWidth={1} strokeDasharray="2,2" opacity={0.4} />
        <circle cx={markerX} cy={markerY} r={3.5} fill="#3fff8b" stroke="#fff" strokeWidth={1} />
      </svg>
      {/* Labels */}
      <div style={{ position: 'absolute', top: 2, left: 8, color: '#777', fontSize: 7 }}>{maxEle}m</div>
      <div style={{ position: 'absolute', bottom: 2, right: 8, color: '#777', fontSize: 7 }}>{minEle}m</div>
      <div style={{ position: 'absolute', top: 2, right: 8, display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{currentEle}m</span>
        <span style={{ color: '#3fff8b', fontSize: 8 }}>▲ {totalGain}m</span>
      </div>
    </div>
  );
}
