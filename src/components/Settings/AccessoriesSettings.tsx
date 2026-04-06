/**
 * AccessoriesSettings — Smart Light + Radar configuration page.
 */

import { useSettingsStore, type AccessoriesConfig } from '../../store/settingsStore';
import { useBikeStore } from '../../store/bikeStore';
import { accessoriesManager } from '../../services/accessories/AccessoriesManager';
import { LIGHT_MODE_LABELS } from '../../services/bluetooth/iGPSportLightService';

/** Hook for shared accessories update logic */
function useAccessoriesUpdate() {
  const config = useSettingsStore((s) => s.accessories);
  const update = useSettingsStore((s) => s.updateAccessories);

  return (partial: Partial<AccessoriesConfig>) => {
    update(partial);
    accessoriesManager.updateSmartLightConfig({
      enabled: partial.smart_light_enabled ?? config.smart_light_enabled,
      auto_on_lux: partial.auto_on_lux ?? config.auto_on_lux,
      auto_off_lux: partial.auto_off_lux ?? config.auto_off_lux,
      brake_flash_enabled: partial.brake_flash_enabled ?? config.brake_flash_enabled,
      brake_decel_threshold: partial.brake_decel_threshold ?? config.brake_decel_threshold,
      radar_flash_enabled: partial.radar_flash_enabled ?? config.radar_flash_enabled,
      radar_flash_threat: partial.radar_flash_threat ?? config.radar_flash_threat,
      speed_adaptive: partial.speed_adaptive ?? config.speed_adaptive,
      turn_signal_duration_ms: partial.turn_signal_duration_ms ?? config.turn_signal_duration_ms,
    });
    accessoriesManager.updateRadarConfig({
      enabled: partial.radar_enabled ?? config.radar_enabled,
      vibrate_on_threat: partial.radar_vibrate ?? config.radar_vibrate,
      vibrate_min_threat: partial.radar_vibrate_min_threat ?? config.radar_vibrate_min_threat,
    });
  };
}

/** Standalone page with header (for Connections or future standalone use) */
export function AccessoriesSettings({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-gray-800">
        <button onClick={onBack} className="text-gray-400 active:scale-90">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div>
          <h1 className="text-lg font-bold text-white">Acessorios</h1>
          <p className="text-xs text-gray-500">Luz traseira + Radar</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <AccessoriesSettingsContent />
      </div>
    </div>
  );
}

/** Content-only version (used inside Settings.tsx which provides its own header) */
export function AccessoriesSettingsContent() {
  const config = useSettingsStore((s) => s.accessories);
  const handleUpdate = useAccessoriesUpdate();
  const lightConnected = useBikeStore((s) => s.ble_services.light);
  const radarConnected = useBikeStore((s) => s.ble_services.radar);
  const lightBattery = useBikeStore((s) => s.light_battery_pct);
  const lightMode = useBikeStore((s) => s.light_mode);

  return (
    <div className="space-y-6">
        {/* ── Status ──────────────────────────────────────────── */}
        <div className="flex gap-3">
          <StatusCard
            label="Luz"
            connected={lightConnected}
            detail={lightConnected ? `${LIGHT_MODE_LABELS[lightMode] ?? 'On'}${lightBattery > 0 ? ` — ${lightBattery}%` : ''}` : undefined}
            icon="flashlight_on"
            color="text-yellow-400"
          />
          <StatusCard
            label="Radar"
            connected={radarConnected}
            icon="radar"
            color="text-orange-400"
          />
        </div>

        {/* ── Smart Light ─────────────────────────────────────── */}
        <Section title="Luz Inteligente" icon="auto_awesome">
          <ToggleRow
            label="Auto-controlo"
            desc="Liga/desliga e modo automatico"
            value={config.smart_light_enabled}
            onChange={(v) => handleUpdate({ smart_light_enabled: v })}
          />

          <ToggleRow
            label="Flash ao travar"
            desc="Pisca quando desacelera"
            value={config.brake_flash_enabled}
            onChange={(v) => handleUpdate({ brake_flash_enabled: v })}
          />

          <SliderRow
            label="Sensibilidade travagem"
            desc="km/h por segundo"
            value={config.brake_decel_threshold}
            min={1}
            max={8}
            step={0.5}
            unit=" km/h/s"
            onChange={(v) => handleUpdate({ brake_decel_threshold: v })}
          />

          <ToggleRow
            label="Adaptivo por velocidade"
            desc="Mais brilho a maior velocidade"
            value={config.speed_adaptive}
            onChange={(v) => handleUpdate({ speed_adaptive: v })}
          />

          <SliderRow
            label="Auto-ON (escuro)"
            desc="Liga quando lux abaixo de"
            value={config.auto_on_lux}
            min={20}
            max={500}
            step={10}
            unit=" lux"
            onChange={(v) => handleUpdate({ auto_on_lux: v })}
          />

          <SliderRow
            label="Auto-OFF (claro)"
            desc="Desliga quando lux acima de"
            value={config.auto_off_lux}
            min={100}
            max={2000}
            step={50}
            unit=" lux"
            onChange={(v) => handleUpdate({ auto_off_lux: v })}
          />

          <SliderRow
            label="Pisca (duração)"
            desc="Duração do sinal de curva"
            value={config.turn_signal_duration_ms / 1000}
            min={2}
            max={15}
            step={1}
            unit="s"
            onChange={(v) => handleUpdate({ turn_signal_duration_ms: v * 1000 })}
          />
        </Section>

        {/* ── Radar ───────────────────────────────────────────── */}
        <Section title="Radar" icon="radar">
          <ToggleRow
            label="Radar activo"
            desc="Processar dados do radar"
            value={config.radar_enabled}
            onChange={(v) => handleUpdate({ radar_enabled: v })}
          />

          <ToggleRow
            label="Flash ao detectar veiculo"
            desc="Pisca a luz quando veiculo se aproxima"
            value={config.radar_flash_enabled}
            onChange={(v) => handleUpdate({ radar_flash_enabled: v })}
          />

          <SliderRow
            label="Flash a partir de"
            desc="Nivel minimo de ameaça"
            value={config.radar_flash_threat}
            min={1}
            max={3}
            step={1}
            unit=""
            labels={['1 — Baixo', '2 — Medio', '3 — Alto']}
            onChange={(v) => handleUpdate({ radar_flash_threat: v })}
          />

          <ToggleRow
            label="Vibrar ao detectar"
            desc="Vibra o telefone"
            value={config.radar_vibrate}
            onChange={(v) => handleUpdate({ radar_vibrate: v })}
          />

          <SliderRow
            label="Vibrar a partir de"
            desc="Nivel minimo para vibrar"
            value={config.radar_vibrate_min_threat}
            min={1}
            max={3}
            step={1}
            unit=""
            labels={['1 — Baixo', '2 — Medio', '3 — Alto']}
            onChange={(v) => handleUpdate({ radar_vibrate_min_threat: v })}
          />
        </Section>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────

function StatusCard({
  label,
  connected,
  detail,
  icon,
  color,
}: {
  label: string;
  connected: boolean;
  detail?: string;
  icon: string;
  color: string;
}) {
  return (
    <div className={`flex-1 bg-gray-800 rounded-xl p-3 border ${connected ? 'border-emerald-500/30' : 'border-gray-700'}`}>
      <div className="flex items-center gap-2">
        <span className={`material-symbols-outlined text-xl ${connected ? color : 'text-gray-600'}`}>{icon}</span>
        <div>
          <div className="text-sm font-bold text-white">{label}</div>
          <div className={`text-xs ${connected ? 'text-emerald-400' : 'text-gray-500'}`}>
            {connected ? detail ?? 'Ligado' : 'Desligado'}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-lg text-[#fbbf24]">{icon}</span>
        <span className="text-sm font-bold text-white">{title}</span>
      </div>
      <div className="space-y-3 bg-gray-800/60 rounded-xl p-3 border border-gray-700/50">
        {children}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <div className="text-sm text-white">{label}</div>
        <div className="text-[10px] text-gray-500">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full transition-colors ${value ? 'bg-emerald-500' : 'bg-gray-600'}`}
      >
        <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function SliderRow({
  label,
  desc,
  value,
  min,
  max,
  step,
  unit,
  labels,
  onChange,
}: {
  label: string;
  desc: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  labels?: string[];
  onChange: (v: number) => void;
}) {
  const displayValue = labels
    ? labels[Math.round(value) - min] ?? `${value}${unit}`
    : `${value}${unit}`;

  return (
    <div className="py-1">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm text-white">{label}</div>
          <div className="text-[10px] text-gray-500">{desc}</div>
        </div>
        <span className="text-xs font-bold text-emerald-400 tabular-nums">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
      />
    </div>
  );
}
