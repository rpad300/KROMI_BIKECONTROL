import { useNutritionStore } from '../../store/nutritionStore';
import { kromiEngine } from '../../services/intelligence/KromiEngine';

const STATUS_COLORS = {
  green: '#3fff8b',
  amber: '#fbbf24',
  critical: '#ff716c',
} as const;

/**
 * NutritionQuickTap — two 64px quick-tap buttons for logging food/water.
 * Shows cumulative intake and glycogen estimate.
 * Designed for gloved hands during ride.
 */
export function NutritionQuickTap() {
  const nutrition = useNutritionStore((s) => s.state);

  const handleDrink = () => {
    kromiEngine.getNutrition().recordDrink();
  };

  const handleEat = () => {
    kromiEngine.getNutrition().recordEat();
  };

  const fluidMl = nutrition?.fluid_ingested_ml ?? 0;
  const carbsG = nutrition?.carbs_ingested_g ?? 0;
  const glycogenPct = nutrition?.glycogen_pct ?? 100;
  const glycogenStatus = nutrition?.glycogen_status ?? 'green';
  const glycogenColor = STATUS_COLORS[glycogenStatus] ?? STATUS_COLORS.green;

  return (
    <div className="bg-[#1a1919] rounded-sm p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-label uppercase tracking-widest text-[#777575]">Nutrition</span>
        <div className="flex items-center gap-2 text-[10px] font-headline tabular-nums text-[#adaaaa]">
          <span>{fluidMl}ml</span>
          <span className="text-[#494847]">|</span>
          <span>{carbsG}g</span>
        </div>
      </div>

      {/* Buttons row */}
      <div className="flex gap-2">
        {/* Water button */}
        <button
          onClick={handleDrink}
          className="flex-1 h-16 flex flex-col items-center justify-center rounded-sm bg-[#60a5fa]/10 border border-[#60a5fa]/20 active:bg-[#60a5fa]/30 active:scale-95 transition-transform"
        >
          <span className="material-symbols-outlined text-[#60a5fa]" style={{ fontSize: '24px', fontVariationSettings: "'FILL' 1" }}>
            water_drop
          </span>
          <span className="text-[9px] font-label font-bold text-[#60a5fa] uppercase tracking-wider mt-0.5">250ml</span>
        </button>

        {/* Food button */}
        <button
          onClick={handleEat}
          className="flex-1 h-16 flex flex-col items-center justify-center rounded-sm bg-[#fbbf24]/10 border border-[#fbbf24]/20 active:bg-[#fbbf24]/30 active:scale-95 transition-transform"
        >
          <span className="material-symbols-outlined text-[#fbbf24]" style={{ fontSize: '24px' }}>
            nutrition
          </span>
          <span className="text-[9px] font-label font-bold text-[#fbbf24] uppercase tracking-wider mt-0.5">25g carbs</span>
        </button>
      </div>

      {/* Glycogen bar */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-label text-[#777575] w-14">Glycogen</span>
        <div className="flex-1 h-2 bg-[#262626] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${glycogenPct}%`, backgroundColor: glycogenColor }}
          />
        </div>
        <span
          className="text-[10px] font-headline font-bold tabular-nums w-10 text-right"
          style={{ color: glycogenColor }}
        >
          {glycogenPct.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
