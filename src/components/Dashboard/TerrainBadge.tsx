import { useAutoAssistStore } from '../../store/autoAssistStore';

const TERRAIN_CONFIG: Record<string, { color: string; label: string }> = {
  paved:     { color: '#ffffff', label: 'PAVED' },
  gravel:    { color: '#a0a0a0', label: 'GRAVEL' },
  dirt:      { color: '#fbbf24', label: 'DIRT' },
  technical: { color: '#ff716c', label: 'TECHNICAL' },
  mud:       { color: '#a06030', label: 'MUD' },
};

/**
 * TerrainBadge — small inline badge showing auto-detected terrain type.
 * Fits in the info strip area. 24px height.
 */
export function TerrainBadge() {
  const terrain = useAutoAssistStore((s) => s.autoDetectedTerrain);

  const cfg = TERRAIN_CONFIG[terrain] ?? TERRAIN_CONFIG.dirt!;

  return (
    <div
      className="inline-flex items-center gap-1 px-2 rounded-sm"
      style={{ height: '24px', backgroundColor: 'rgba(38,38,38,0.8)', borderLeft: `2px solid ${cfg.color}` }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: '12px', color: cfg.color }}
      >
        terrain
      </span>
      <span
        className="text-[9px] font-label font-bold uppercase tracking-wider"
        style={{ color: cfg.color }}
      >
        {cfg.label}
      </span>
    </div>
  );
}
