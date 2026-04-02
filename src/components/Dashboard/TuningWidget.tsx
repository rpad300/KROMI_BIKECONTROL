import { useState } from 'react';
import { useTuningStore, TUNING_MODES, TUNING_MODE_LABELS, TUNING_MODE_COLORS, type TuningMode } from '../../store/tuningStore';
import { setTuning, tuneMax, tuneMin, tuneRestore, readTuning, isTuningAvailable } from '../../services/bluetooth/BLEBridge';

const LEVEL_LABELS = ['', 'MAX', 'MID', 'MIN'] as const;

export function TuningWidget() {
  const current = useTuningStore((s) => s.current);
  const original = useTuningStore((s) => s.original);
  const hasRead = useTuningStore((s) => s.hasRead);
  const lastStatus = useTuningStore((s) => s.lastStatus);
  const [expanded, setExpanded] = useState(false);

  const available = isTuningAvailable();

  const handlePreset = (action: 'max' | 'min' | 'restore' | 'read') => {
    if (!available) return;
    if ('vibrate' in navigator) navigator.vibrate(30);
    switch (action) {
      case 'max': tuneMax(); break;
      case 'min': tuneMin(); break;
      case 'restore': tuneRestore(); break;
      case 'read': readTuning(); break;
    }
  };

  const handleLevelChange = (mode: TuningMode, level: number) => {
    if (!available) return;
    if ('vibrate' in navigator) navigator.vibrate(30);
    const updated = { ...current, [mode]: level };
    useTuningStore.getState().setLevel(mode, level);
    setTuning(updated);
  };

  const statusColor =
    lastStatus === 'success' ? 'text-[#3fff8b]' :
    lastStatus === 'error' ? 'text-[#ff716c]' :
    lastStatus === 'reading' || lastStatus === 'writing' ? 'text-[#fbbf24]' :
    'text-[#777575]';

  const statusText =
    lastStatus === 'success' ? '✓' :
    lastStatus === 'error' ? '✗' :
    lastStatus === 'reading' ? '...' :
    lastStatus === 'writing' ? '↑' : '';

  return (
    <div className="bg-[#1a1919] rounded-sm p-3 space-y-2">
      {/* Header — tap to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">TUNING</span>
          <span className={`text-xs ${statusColor}`}>{statusText}</span>
          {!hasRead && available && (
            <span className="text-xs text-[#777575]">não lido</span>
          )}
        </div>
        {/* Compact current levels when collapsed */}
        <div className="flex gap-1">
          {TUNING_MODES.map((m) => (
            <span key={m} className="text-xs text-[#adaaaa] tabular-nums">
              {current[m]}
            </span>
          ))}
          <span className="text-[#777575] text-xs ml-1">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Preset buttons — always visible */}
      <div className="grid grid-cols-4 gap-1.5">
        <PresetBtn label="MAX" color="bg-red-700" onClick={() => handlePreset('max')} disabled={!available} />
        <PresetBtn label="MIN" color="bg-green-700" onClick={() => handlePreset('min')} disabled={!available} />
        <PresetBtn label="RESTORE" color="bg-blue-700" onClick={() => handlePreset('restore')} disabled={!available || !original} />
        <PresetBtn label="READ" color="bg-[#262626]" onClick={() => handlePreset('read')} disabled={!available} />
      </div>

      {/* Expanded: per-mode level controls */}
      {expanded && (
        <div className="space-y-1.5 pt-1">
          {TUNING_MODES.map((mode) => (
            <div key={mode} className="flex items-center gap-2">
              <span className={`text-xs font-bold text-white w-14 text-center px-1.5 py-0.5 rounded ${TUNING_MODE_COLORS[mode]}`}>
                {TUNING_MODE_LABELS[mode]}
              </span>
              <div className="flex gap-1 flex-1">
                {[1, 2, 3].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => handleLevelChange(mode, lvl)}
                    disabled={!available}
                    className={`
                      flex-1 h-10 rounded-lg font-bold text-sm
                      ${current[mode] === lvl
                        ? `${TUNING_MODE_COLORS[mode]} text-white ring-1 ring-white`
                        : 'bg-[#262626] text-[#adaaaa]'}
                      active:scale-95 transition-transform
                      disabled:opacity-40
                    `}
                  >
                    {LEVEL_LABELS[lvl]}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {/* Original tuning reference */}
          {original && (
            <div className="text-[10px] text-[#777575] text-center pt-1">
              Original: {TUNING_MODES.map((m) => `${TUNING_MODE_LABELS[m]}=${original[m]}`).join(' ')}
            </div>
          )}
        </div>
      )}

      {/* Not available message */}
      {!available && (
        <div className="text-center text-xs text-[#777575]">
          Liga a bike via Bridge para controlo do motor
        </div>
      )}
    </div>
  );
}

function PresetBtn({ label, color, onClick, disabled }: {
  label: string; color: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-11 rounded-lg font-bold text-white text-sm ${color}
        active:scale-95 transition-transform disabled:opacity-40`}
    >
      {label}
    </button>
  );
}
