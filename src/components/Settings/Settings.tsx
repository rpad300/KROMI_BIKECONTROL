import { useState } from 'react';
import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { useBikeStore } from '../../store/bikeStore';
import { useAuthStore } from '../../store/authStore';
import { connectBike, disconnectBike } from '../../services/bluetooth/BLEBridge';
import { ProfileInsightsWidget } from '../Dashboard/ProfileInsightsWidget';
import { TuningPreview } from './TuningPreview';
import { importKomootRoute } from '../../services/maps/KomootService';

type Screen = 'dashboard' | 'map' | 'climb' | 'connections' | 'settings' | 'history';

export function Settings({ onNavigate }: { onNavigate?: (screen: Screen) => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const bleStatus = useBikeStore((s) => s.ble_status);
  const services = useBikeStore((s) => s.ble_services);
  const profile = useSettingsStore((s) => s.riderProfile);
  const bike = safeBikeConfig(useSettingsStore((s) => s.bikeConfig));
  const autoAssist = useSettingsStore((s) => s.autoAssist);
  const updateProfile = useSettingsStore((s) => s.updateRiderProfile);
  const updateBike = useSettingsStore((s) => s.updateBikeConfig);
  const updateAutoAssist = useSettingsStore((s) => s.updateAutoAssist);

  const [komootUrl, setKomootUrl] = useState('');
  const [komootLoading, setKomootLoading] = useState(false);
  const [komootResult, setKomootResult] = useState<string | null>(null);

  const handleKomootImport = async () => {
    if (!komootUrl.trim()) return;
    setKomootLoading(true);
    setKomootResult(null);
    try {
      const points = await importKomootRoute(komootUrl);
      setKomootResult(`Importados ${points.length} pontos`);
      // Store in sessionStorage for use by map/elevation components
      sessionStorage.setItem('komoot_route', JSON.stringify(points));
    } catch (err) {
      setKomootResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setKomootLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      await connectBike();
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  const handleDisconnect = () => {
    disconnectBike();
  };

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-xl font-bold">Configuracao</h1>

      {/* Bluetooth Section */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-300">Bluetooth</h2>
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Estado</span>
            <span className={`font-bold ${bleStatus === 'connected' ? 'text-green-400' : 'text-red-400'}`}>
              {bleStatus === 'connected' ? 'Ligado' : 'Desligado'}
            </span>
          </div>
          {bleStatus === 'connected' && (
            <div className="text-xs text-gray-500 flex flex-wrap gap-2">
              {services.battery && <span className="bg-gray-700 px-2 py-1 rounded">Bateria</span>}
              {services.csc && <span className="bg-gray-700 px-2 py-1 rounded">Vel/Cad</span>}
              {services.power && <span className="bg-gray-700 px-2 py-1 rounded">Potencia</span>}
              {services.gev && <span className="bg-gray-700 px-2 py-1 rounded">Motor GEV</span>}
            </div>
          )}
          <button
            onClick={bleStatus === 'connected' ? handleDisconnect : handleConnect}
            className={`w-full h-14 rounded-xl font-bold text-white text-lg active:scale-95 transition-transform ${
              bleStatus === 'connected' ? 'bg-red-600' : 'bg-blue-600'
            }`}
          >
            {bleStatus === 'connected' ? 'Desligar' : 'Ligar Giant GBHA25704'}
          </button>
        </div>
      </section>

      {/* Rider Profile */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-300">Perfil do Ciclista</h2>
        <div className="bg-gray-800 rounded-xl p-4 space-y-4">
          <NumberField label="Idade" value={profile.age} onChange={(v) => updateProfile({ age: v })} />
          <NumberField label="Peso (kg)" value={profile.weight_kg} onChange={(v) => updateProfile({ weight_kg: v })} />
          <NumberField label="FC Maxima (bpm)" value={profile.hr_max} onChange={(v) => updateProfile({ hr_max: v })} />
          <div className="text-xs text-gray-500">
            Calculada: 220 - {profile.age} = {220 - profile.age} bpm
            <button
              onClick={() => updateProfile({ hr_max: 220 - profile.age })}
              className="ml-2 text-blue-400 underline"
            >
              Usar
            </button>
          </div>
        </div>
      </section>

      {/* Bike Profile */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-300">Perfil da Bicicleta</h2>
        <div className="bg-gray-800 rounded-xl p-4 space-y-4">
          <TextField label="Nome" value={bike.name} onChange={(v) => updateBike({ name: v })} />

          <div className="border-t border-gray-700 pt-3">
            <span className="text-xs text-gray-500 uppercase">Bateria</span>
          </div>
          <NumberField label="Bateria principal (Wh)" value={bike.main_battery_wh} onChange={(v) => updateBike({ main_battery_wh: v })} />
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Range Extender</span>
            <button
              onClick={() => updateBike({ has_range_extender: !bike.has_range_extender })}
              className={`w-14 h-8 rounded-full transition-colors ${
                bike.has_range_extender ? 'bg-blue-600' : 'bg-gray-600'
              }`}
            >
              <div className={`w-6 h-6 rounded-full bg-white transition-transform mx-1 ${
                bike.has_range_extender ? 'translate-x-6' : ''
              }`} />
            </button>
          </div>
          {bike.has_range_extender && (
            <NumberField label="Range extender (Wh)" value={bike.sub_battery_wh} onChange={(v) => updateBike({ sub_battery_wh: v })} />
          )}
          <div className="text-xs text-gray-600 text-right">
            Total: {bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0)}Wh
          </div>

          <div className="border-t border-gray-700 pt-3">
            <span className="text-xs text-gray-500 uppercase">Motor</span>
          </div>
          <TextField label="Motor" value={bike.motor_name} onChange={(v) => updateBike({ motor_name: v })} />
          <NumberField label="Torque max (Nm)" value={bike.max_torque_nm} onChange={(v) => updateBike({ max_torque_nm: v })} />
          <NumberField label="Potencia max (W)" value={bike.max_power_w} onChange={(v) => updateBike({ max_power_w: v })} />
          <NumberField label="Limite velocidade (km/h)" value={bike.speed_limit_kmh} onChange={(v) => updateBike({ speed_limit_kmh: v })} />

          <div className="border-t border-gray-700 pt-3">
            <span className="text-xs text-gray-500 uppercase">Consumo estimado (Wh/km)</span>
          </div>
          <NumberField label="ECO" value={bike.consumption_eco} onChange={(v) => updateBike({ consumption_eco: v })} />
          <NumberField label="TOUR" value={bike.consumption_tour} onChange={(v) => updateBike({ consumption_tour: v })} />
          <NumberField label="ACTIVE" value={bike.consumption_active} onChange={(v) => updateBike({ consumption_active: v })} />
          <NumberField label="SPORT" value={bike.consumption_sport} onChange={(v) => updateBike({ consumption_sport: v })} />
          <NumberField label="POWER" value={bike.consumption_power} onChange={(v) => updateBike({ consumption_power: v })} />
          <div className="text-[10px] text-gray-600">
            Valores usados para estimar range quando nao ha dados live.
            Ajusta com base na tua experiencia de conduzir.
          </div>

          <div className="border-t border-gray-700 pt-3">
            <span className="text-xs text-gray-500 uppercase">Tuning Levels (POWER mode — KROMI controla)</span>
          </div>
          <div className="text-[10px] text-gray-600 mb-2">
            Características de cada nível que o SET_TUNING configura no motor.
          </div>
          {(['tuning_max', 'tuning_mid', 'tuning_min'] as const).map((key) => {
            const label = key === 'tuning_max' ? 'MAX (nível 1)' : key === 'tuning_mid' ? 'MID (nível 2)' : 'MIN (nível 3)';
            const color = key === 'tuning_max' ? 'text-red-400' : key === 'tuning_mid' ? 'text-yellow-400' : 'text-green-400';
            const spec = bike[key];
            return (
              <div key={key} className="bg-gray-900 rounded-lg p-3 space-y-2">
                <span className={`text-xs font-bold ${color}`}>{label}</span>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Assist %" value={spec.assist_pct} onChange={(v) => updateBike({ [key]: { ...spec, assist_pct: v } })} />
                  <NumberField label="Torque (Nm)" value={spec.torque_nm} onChange={(v) => updateBike({ [key]: { ...spec, torque_nm: v } })} />
                  <NumberField label="Launch (1-10)" value={spec.launch} onChange={(v) => updateBike({ [key]: { ...spec, launch: v } })} />
                  <NumberField label="Consumo (Wh/km)" value={spec.consumption_wh_km} onChange={(v) => updateBike({ [key]: { ...spec, consumption_wh_km: v } })} />
                </div>
              </div>
            );
          })}

          <div className="border-t border-gray-700 pt-3">
            <span className="text-xs text-gray-500 uppercase">Configuração fixa (para comparação)</span>
          </div>
          <div className="text-[10px] text-gray-600 mb-2">
            A tua config normal sem KROMI. Usada para comparar poupança de bateria na simulação.
          </div>
          <div className="bg-gray-900 rounded-lg p-3 space-y-2">
            <span className="text-xs font-bold text-orange-400">A tua config fixa</span>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Support %" value={bike.fixed_baseline.assist_pct} onChange={(v) => updateBike({ fixed_baseline: { ...bike.fixed_baseline, assist_pct: v } })} />
              <NumberField label="Torque (Nm)" value={bike.fixed_baseline.torque_nm} onChange={(v) => updateBike({ fixed_baseline: { ...bike.fixed_baseline, torque_nm: v } })} />
              <NumberField label="Launch (1-10)" value={bike.fixed_baseline.launch} onChange={(v) => updateBike({ fixed_baseline: { ...bike.fixed_baseline, launch: v } })} />
              <NumberField label="Consumo (Wh/km)" value={bike.fixed_baseline.consumption_wh_km} onChange={(v) => updateBike({ fixed_baseline: { ...bike.fixed_baseline, consumption_wh_km: v } })} />
            </div>
          </div>

          {/* Live preview of tuning impact */}
          <TuningPreview />
        </div>
      </section>

      {/* Auto-Assist */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-300">Auto-Assist</h2>
        <div className="bg-gray-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Activado</span>
            <button
              onClick={() => updateAutoAssist({ enabled: !autoAssist.enabled })}
              className={`w-14 h-8 rounded-full transition-colors ${
                autoAssist.enabled ? 'bg-blue-600' : 'bg-gray-600'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full bg-white transition-transform mx-1 ${
                  autoAssist.enabled ? 'translate-x-6' : ''
                }`}
              />
            </button>
          </div>
          <NumberField
            label="Lookahead (m)"
            value={autoAssist.lookahead_m}
            onChange={(v) => updateAutoAssist({ lookahead_m: v })}
          />
          <NumberField
            label="Pre-activacao (m)"
            value={autoAssist.preempt_distance_m}
            onChange={(v) => updateAutoAssist({ preempt_distance_m: v })}
          />
          <NumberField
            label="Override timeout (s)"
            value={autoAssist.override_duration_s}
            onChange={(v) => updateAutoAssist({ override_duration_s: v })}
          />
        </div>
      </section>

      {/* Athlete Profile Insights */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-300">Perfil Atleta</h2>
        <ProfileInsightsWidget />
      </section>

      {/* Komoot Import */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-300">Import Komoot Route</h2>
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <input
            type="text"
            value={komootUrl}
            onChange={(e) => setKomootUrl(e.target.value)}
            placeholder="Komoot tour URL or ID"
            className="w-full bg-gray-700 text-white rounded-lg p-3 text-sm placeholder-gray-500"
          />
          <button
            onClick={handleKomootImport}
            disabled={komootLoading || !komootUrl.trim()}
            className={`w-full h-12 rounded-xl font-bold text-sm active:scale-95 transition-transform ${
              komootLoading || !komootUrl.trim()
                ? 'bg-gray-700 text-gray-500'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            {komootLoading ? 'Importing...' : 'Import'}
          </button>
          {komootResult && (
            <div className={`text-xs ${komootResult.startsWith('Importados') ? 'text-emerald-400' : 'text-red-400'}`}>
              {komootResult}
            </div>
          )}
        </div>
      </section>

      {/* Account */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-300">Conta</h2>
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Email</span>
            <span className="text-white text-sm">{user?.email}</span>
          </div>
          <button
            onClick={logout}
            className="w-full h-12 rounded-xl font-bold text-red-400 text-sm bg-gray-700 active:scale-95 transition-transform"
          >
            Terminar sessao
          </button>
        </div>
      </section>

      {/* Ride History link */}
      {onNavigate && (
        <section>
          <button
            onClick={() => onNavigate('history')}
            className="w-full bg-gray-800 rounded-xl p-4 flex items-center justify-between active:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-emerald-400">history</span>
              <span className="text-gray-300 font-medium">Historico de Rides</span>
            </div>
            <span className="material-symbols-outlined text-gray-600">chevron_right</span>
          </button>
        </section>
      )}

      {/* Bike Info */}
      <BikeInfoSection />

      {/* Version */}
      <div className="text-center text-xs text-gray-600 pb-4">
        KROMI BikeControl v0.6.0
      </div>
    </div>
  );
}

function BikeInfoSection() {
  const fw = useBikeStore((s) => s.firmware_version);
  const hw = useBikeStore((s) => s.hardware_version);
  const sw = useBikeStore((s) => s.software_version);
  const tpmsF = useBikeStore((s) => s.tpms_front_psi);
  const tpmsR = useBikeStore((s) => s.tpms_rear_psi);

  if (!fw && !hw && !sw && !tpmsF && !tpmsR) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-300">Bike Info</h2>
      <div className="bg-gray-800 rounded-xl p-4 space-y-2">
        {fw && (
          <div className="flex justify-between">
            <span className="text-gray-400 text-sm">Firmware</span>
            <span className="text-white text-sm font-mono">{fw}</span>
          </div>
        )}
        {hw && (
          <div className="flex justify-between">
            <span className="text-gray-400 text-sm">Hardware</span>
            <span className="text-white text-sm font-mono">{hw}</span>
          </div>
        )}
        {sw && (
          <div className="flex justify-between">
            <span className="text-gray-400 text-sm">Software</span>
            <span className="text-white text-sm font-mono">{sw}</span>
          </div>
        )}
        {tpmsF > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-400 text-sm">TPMS Front</span>
            <span className="text-white text-sm">{tpmsF.toFixed(1)} PSI</span>
          </div>
        )}
        {tpmsR > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-400 text-sm">TPMS Rear</span>
            <span className="text-white text-sm">{tpmsR.toFixed(1)} PSI</span>
          </div>
        )}
      </div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400 text-sm">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-700 text-white rounded-lg p-2 w-40 text-right text-sm"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400 text-sm">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-gray-700 text-white rounded-lg p-2 w-20 text-center text-lg tabular-nums"
      />
    </div>
  );
}
