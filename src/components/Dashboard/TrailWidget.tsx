import { useEffect, useState } from 'react';
import { useMapStore } from '../../store/mapStore';
import { fetchTrailInfo, type TrailInfo } from '../../services/maps/TerrainService';

const CATEGORY_STYLE: Record<string, { icon: string; color: string; label: string }> = {
  paved: { icon: 'add_road', color: 'text-[#adaaaa]', label: 'Asfalto' },
  gravel: { icon: 'texture', color: 'text-[#fbbf24]', label: 'Gravilha' },
  dirt: { icon: 'landscape', color: 'text-[#fbbf24]', label: 'Terra' },
  technical: { icon: 'terrain', color: 'text-[#ff716c]', label: 'Tecnico' },
};

export function TrailWidget() {
  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const [trail, setTrail] = useState<TrailInfo | null>(null);

  useEffect(() => {
    if (!lat || !lng) return;
    fetchTrailInfo(lat, lng).then(setTrail);
    const interval = setInterval(() => {
      const pos = useMapStore.getState();
      if (pos.latitude && pos.longitude) {
        fetchTrailInfo(pos.latitude, pos.longitude).then(setTrail);
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [lat !== 0, lng !== 0]);

  if (!trail) return null;

  const style = CATEGORY_STYLE[trail.category] ?? CATEGORY_STYLE.gravel!;

  return (
    <div className="bg-[#1a1919] rounded-sm p-2 flex items-center gap-3">
      <span className={`material-symbols-outlined text-xl ${style.color}`}>{style.icon}</span>

      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-bold ${style.color}`}>{style.label}</span>
        {trail.surface !== 'unknown' && trail.surface !== '' && (
          <span className="text-[9px] text-[#777575]">{trail.surface}</span>
        )}
      </div>

      {trail.mtb_scale !== null && (
        <span className={`text-xs font-black px-1.5 py-0.5 rounded ${
          trail.mtb_scale <= 1 ? 'bg-green-900/50 text-[#3fff8b]' :
          trail.mtb_scale <= 3 ? 'bg-yellow-900/50 text-[#fbbf24]' :
          'bg-[#9f0519]/50 text-[#ff716c]'
        }`}>
          S{trail.mtb_scale}
        </span>
      )}

      {trail.name && (
        <span className="text-[10px] text-[#777575] truncate ml-auto max-w-[100px]">{trail.name}</span>
      )}

      {!trail.name && trail.highway && (
        <span className="text-[9px] text-[#777575] ml-auto">{trail.highway}</span>
      )}
    </div>
  );
}
