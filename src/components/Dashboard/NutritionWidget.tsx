import { useNutritionStore } from '../../store/nutritionStore';
import { kromiEngine } from '../../services/intelligence/KromiEngine';
import type { NutritionProduct } from '../../services/intelligence/NutritionEngine';
import { useState } from 'react';

const STATUS_COLORS = {
  green: 'text-[#3fff8b]',
  amber: 'text-[#fbbf24]',
  critical: 'text-[#ff716c]',
} as const;

const STATUS_BG = {
  green: 'bg-[#3fff8b]/10',
  amber: 'bg-[#fbbf24]/10',
  critical: 'bg-[#ff716c]/10',
} as const;

export function NutritionWidget() {
  const nutrition = useNutritionStore((s) => s.state);
  const alertVisible = useNutritionStore((s) => s.alertVisible);
  const [showProducts, setShowProducts] = useState<'eat' | 'drink' | null>(null);

  if (!nutrition) return null;

  const hasAlert = nutrition.alerts.length > 0;
  const worstStatus = nutrition.glycogen_status === 'critical' || nutrition.hydration_status === 'critical'
    ? 'critical'
    : nutrition.glycogen_status === 'amber' || nutrition.hydration_status === 'amber'
      ? 'amber'
      : 'green';

  const handleEat = (product?: NutritionProduct) => {
    kromiEngine.getNutrition().recordEat(product);
    setShowProducts(null);
    useNutritionStore.getState().setAlertVisible(false);
  };

  const handleDrink = (product?: NutritionProduct) => {
    kromiEngine.getNutrition().recordDrink(product);
    setShowProducts(null);
    useNutritionStore.getState().setAlertVisible(false);
  };

  const handleDismiss = () => {
    useNutritionStore.getState().setAlertVisible(false);
  };

  // Get recommended products based on current HR zone
  const engine = kromiEngine.getNutrition();
  const zone = nutrition.ride_duration_min > 0 ? 3 : 1; // fallback zone estimate
  const products = engine.getRecommendedProducts(zone);
  const eatProducts = products.filter(p => p.type !== 'drink');
  const drinkProducts = products.filter(p => p.type === 'drink' || p.type === 'gel');

  return (
    <div className={`rounded-lg border ${worstStatus === 'critical' ? 'border-[#ff716c]/40' : worstStatus === 'amber' ? 'border-[#fbbf24]/20' : 'border-[#262626]'} ${STATUS_BG[worstStatus]} overflow-hidden`}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/40">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>restaurant</span>
          <span className="text-xs font-label uppercase tracking-widest text-[#adaaaa]">Nutrição</span>
        </div>
        {nutrition.cp_factor < 1.0 && (
          <span className="text-[10px] text-[#ff716c] font-bold">CP ×{nutrition.cp_factor.toFixed(2)}</span>
        )}
      </div>

      {/* Status gauges */}
      <div className="grid grid-cols-3 gap-2 px-4 py-3">
        {/* Glycogen */}
        <div className="text-center">
          <div className={`text-2xl font-headline font-black ${STATUS_COLORS[nutrition.glycogen_status]}`}>
            {nutrition.glycogen_pct}%
          </div>
          <div className="text-[9px] text-[#777575] uppercase">Glicogénio</div>
          <div className="mt-1 h-1.5 bg-[#1a1919] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${nutrition.glycogen_status === 'critical' ? 'bg-[#ff716c]' : nutrition.glycogen_status === 'amber' ? 'bg-[#fbbf24]' : 'bg-[#3fff8b]'}`}
              style={{ width: `${Math.min(100, nutrition.glycogen_pct)}%` }}
            />
          </div>
        </div>

        {/* Hydration */}
        <div className="text-center">
          <div className={`text-2xl font-headline font-black ${STATUS_COLORS[nutrition.hydration_status]}`}>
            {(nutrition.fluid_deficit_ml / 1000).toFixed(1)}L
          </div>
          <div className="text-[9px] text-[#777575] uppercase">Défice água</div>
          <div className="mt-1 h-1.5 bg-[#1a1919] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${nutrition.hydration_status === 'critical' ? 'bg-[#ff716c]' : nutrition.hydration_status === 'amber' ? 'bg-[#fbbf24]' : 'bg-[#3fff8b]'}`}
              style={{ width: `${Math.min(100, Math.max(5, 100 - (nutrition.fluid_deficit_ml / 20)))}%` }}
            />
          </div>
        </div>

        {/* Electrolytes */}
        <div className="text-center">
          <div className={`text-2xl font-headline font-black ${STATUS_COLORS[nutrition.electrolyte_status]}`}>
            {nutrition.sodium_lost_mg > 999 ? `${(nutrition.sodium_lost_mg / 1000).toFixed(1)}g` : `${nutrition.sodium_lost_mg}mg`}
          </div>
          <div className="text-[9px] text-[#777575] uppercase">Sódio perdido</div>
        </div>
      </div>

      {/* Alert banner + action buttons */}
      {hasAlert && alertVisible && (
        <div className={`px-4 py-3 ${worstStatus === 'critical' ? 'bg-[#ff716c]/15' : 'bg-[#fbbf24]/10'} border-t border-[#262626]`}>
          {/* Alert text */}
          <div className="mb-3">
            {nutrition.alerts.map((alert, i) => (
              <p key={i} className={`text-sm font-bold ${worstStatus === 'critical' ? 'text-[#ff716c]' : 'text-[#fbbf24]'}`}>
                {alert}
              </p>
            ))}
          </div>

          {/* Action buttons — 64px touch targets */}
          <div className="flex gap-3">
            <button
              onClick={() => showProducts === 'eat' ? handleEat() : setShowProducts('eat')}
              className="flex-1 h-16 rounded-lg bg-[#3fff8b]/20 border border-[#3fff8b]/30 flex items-center justify-center gap-2 active:bg-[#3fff8b]/40 transition-colors"
            >
              <span className="material-symbols-outlined text-[#3fff8b] text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>lunch_dining</span>
              <span className="text-[#3fff8b] font-headline font-black text-lg">COMI</span>
            </button>
            <button
              onClick={() => showProducts === 'drink' ? handleDrink() : setShowProducts('drink')}
              className="flex-1 h-16 rounded-lg bg-[#60a5fa]/20 border border-[#60a5fa]/30 flex items-center justify-center gap-2 active:bg-[#60a5fa]/40 transition-colors"
            >
              <span className="material-symbols-outlined text-[#60a5fa] text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>water_drop</span>
              <span className="text-[#60a5fa] font-headline font-black text-lg">BEBI</span>
            </button>
            <button
              onClick={handleDismiss}
              className="w-12 h-16 rounded-lg bg-[#262626] flex items-center justify-center active:bg-[#333]"
            >
              <span className="material-symbols-outlined text-[#777575] text-lg">close</span>
            </button>
          </div>

          {/* Product picker (if expanded) */}
          {showProducts && (
            <div className="mt-3 flex flex-wrap gap-2">
              {(showProducts === 'eat' ? eatProducts : drinkProducts).map((p, i) => (
                <button
                  key={i}
                  onClick={() => showProducts === 'eat' ? handleEat(p) : handleDrink(p)}
                  className="px-3 py-2 rounded-lg bg-[#1a1919] border border-[#494847]/30 text-xs text-[#adaaaa] active:bg-[#262626]"
                >
                  <span className="font-bold text-white">{p.name}</span>
                  <br />
                  {p.carbs_g > 0 && <span>{p.carbs_g}g carbs</span>}
                  {p.fluid_ml > 0 && <span> {p.fluid_ml}ml</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Intake summary (when no alert) */}
      {(!hasAlert || !alertVisible) && nutrition.ride_duration_min > 10 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-[#262626] text-[10px] text-[#777575]">
          <span>Ingerido: {nutrition.carbs_ingested_g}g carbs · {nutrition.fluid_ingested_ml}ml</span>
          <span>Queima: {nutrition.glycogen_burn_rate_g_min}g/min</span>
        </div>
      )}
    </div>
  );
}
