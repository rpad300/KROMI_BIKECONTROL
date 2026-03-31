import { useAthleteStore } from '../../store/athleteStore';
import { batteryEfficiencyTracker } from '../../services/learning/BatteryEfficiencyTracker';
import { useBikeStore } from '../../store/bikeStore';

export function ProfileInsightsWidget() {
  const profile = useAthleteStore((s) => s.profile);
  const lastUpdate = useAthleteStore((s) => s.lastUpdate);
  const battery = useBikeStore((s) => s.battery_percent);

  const saving = batteryEfficiencyTracker.getSavingPercent();
  const extraKm = batteryEfficiencyTracker.getExtraRangeKm(battery);
  const accuracy = Math.round((1 - profile.stats.avg_override_rate) * 100);
  const formScore = profile.fatigue.form_score;

  return (
    <div className="space-y-3">
      {/* Battery efficiency */}
      {saving > 0 && (
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Poupanca vs SPORT fixo</span>
            <span className="text-green-400 font-bold">{saving}%</span>
          </div>
          {extraKm > 0 && (
            <div className="text-xs text-green-400/70 mt-1">
              +{extraKm} km extra de autonomia
            </div>
          )}
        </div>
      )}

      {/* Form score */}
      <div className="bg-gray-800 rounded-xl p-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Forma</span>
          <span className={`font-bold ${
            formScore > 10 ? 'text-green-400' :
            formScore < -10 ? 'text-red-400' : 'text-yellow-400'
          }`}>
            {formScore > 10 ? 'Fresco' : formScore < -10 ? 'Fatigado' : 'Neutro'}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Aguda: {Math.round(profile.fatigue.acute_load_7d)} |
          Cronica: {Math.round(profile.fatigue.chronic_load_42d)}
        </div>
      </div>

      {/* System accuracy */}
      <div className="bg-gray-800 rounded-xl p-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Precisao auto-assist</span>
          <span className="text-white font-bold">{accuracy}%</span>
        </div>
        <div className="mt-1 h-2 bg-gray-700 rounded-full">
          <div className="h-full bg-green-500 rounded-full" style={{ width: `${accuracy}%` }} />
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {profile.stats.total_rides} saidas | {Math.round(profile.stats.total_km)} km total
        </div>
      </div>

      {/* FTP + HRmax */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-blue-400 tabular-nums">
            {profile.physiology.ftp_estimate_watts}W
          </div>
          <div className="text-xs text-gray-400">FTP estimado</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-red-400 tabular-nums">
            {profile.physiology.hr_max_observed}
          </div>
          <div className="text-xs text-gray-400">FCmax observada</div>
        </div>
      </div>

      {/* Last ride learnings */}
      {lastUpdate && lastUpdate.changes.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="text-gray-400 text-sm mb-2">Ultima aprendizagem</div>
          {lastUpdate.changes.slice(0, 3).map((c, i) => (
            <div key={i} className="text-xs text-gray-300 mb-1">
              <span className="text-blue-400">{c.field}</span>: {c.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
