import { useState, useEffect, useCallback } from 'react';
import {
  getTopComponents, saveComponent,
  normalizeComponent, suggestSpecs,
  type BikeComponent,
} from '../../services/bike/BikeComponentService';

interface AutocompleteFieldProps {
  category: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSpecsReceived?: (specs: Record<string, unknown>) => void;
  placeholder?: string;
}

// Spec labels per category — only show relevant fields
const CATEGORY_SPECS: Record<string, { key: string; label: string; type: 'number' | 'text' | 'boolean' }[]> = {
  fork: [
    { key: 'travel_mm', label: 'Travel (mm)', type: 'number' },
    { key: 'stanchion_mm', label: 'Stanchion (mm)', type: 'number' },
    { key: 'axle', label: 'Axle', type: 'text' },
    { key: 'damper', label: 'Damper', type: 'text' },
    { key: 'spring', label: 'Spring', type: 'text' },
    { key: 'electronic', label: 'Electrónica', type: 'boolean' },
    { key: 'flight_attendant', label: 'Flight Attendant', type: 'boolean' },
  ],
  shock: [
    { key: 'type', label: 'Tipo (air/coil)', type: 'text' },
    { key: 'damper', label: 'Damper', type: 'text' },
    { key: 'compression', label: 'Compressão', type: 'text' },
    { key: 'electronic', label: 'Electrónico', type: 'boolean' },
    { key: 'flight_attendant', label: 'Flight Attendant', type: 'boolean' },
  ],
  brake: [
    { key: 'type', label: 'Tipo', type: 'text' },
    { key: 'pistons', label: 'Pistões', type: 'number' },
    { key: 'pad', label: 'Pastilhas', type: 'text' },
    { key: 'mount', label: 'Montagem', type: 'text' },
    { key: 'master_cylinder_mm', label: 'MC (mm)', type: 'number' },
  ],
  cassette: [
    { key: 'speeds', label: 'Velocidades', type: 'number' },
    { key: 'range', label: 'Range', type: 'text' },
    { key: 'sprockets', label: 'Dentes', type: 'text' },
    { key: 'material', label: 'Material', type: 'text' },
  ],
  groupset: [
    { key: 'speeds', label: 'Velocidades', type: 'number' },
    { key: 'type', label: 'Tipo (mechanical/electronic)', type: 'text' },
  ],
  tyre: [
    { key: 'width_mm', label: 'Largura (mm)', type: 'number' },
    { key: 'tpi', label: 'TPI', type: 'number' },
    { key: 'tubeless', label: 'Tubeless', type: 'boolean' },
    { key: 'compound', label: 'Composto', type: 'text' },
  ],
  wheel: [
    { key: 'rim_width_mm', label: 'Largura aro (mm)', type: 'number' },
    { key: 'spokes', label: 'Raios', type: 'text' },
  ],
  saddle: [
    { key: 'width_mm', label: 'Largura (mm)', type: 'number' },
    { key: 'rail', label: 'Rail', type: 'text' },
  ],
  motor: [
    { key: 'torque_nm', label: 'Torque (Nm)', type: 'number' },
    { key: 'power_w', label: 'Potência (W)', type: 'number' },
  ],
  pedal: [
    { key: 'type', label: 'Tipo', type: 'text' },
    { key: 'system', label: 'Sistema', type: 'text' },
    { key: 'power_meter', label: 'Power meter', type: 'boolean' },
  ],
  derailleur: [
    { key: 'speeds', label: 'Velocidades', type: 'number' },
    { key: 'type', label: 'Tipo', type: 'text' },
    { key: 'max_sprocket', label: 'Max sprocket', type: 'number' },
    { key: 'wireless', label: 'Wireless', type: 'boolean' },
  ],
  rotor: [
    { key: 'diameter_mm', label: 'Diâmetro (mm)', type: 'number' },
    { key: 'mount', label: 'Mount', type: 'text' },
    { key: 'technology', label: 'Tecnologia', type: 'text' },
  ],
  hub: [
    { key: 'engagement_deg', label: 'Engagement (°)', type: 'number' },
    { key: 'poe', label: 'POE', type: 'number' },
    { key: 'axle', label: 'Axle', type: 'text' },
  ],
  crankset: [
    { key: 'arm_mm', label: 'Crank (mm)', type: 'number' },
    { key: 'interface', label: 'Interface', type: 'text' },
    { key: 'q_factor_mm', label: 'Q-Factor (mm)', type: 'number' },
  ],
};

export function AutocompleteField({
  category, label, value, onChange, onSpecsReceived, placeholder,
}: AutocompleteFieldProps) {
  const [allComponents, setAllComponents] = useState<BikeComponent[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [models, setModels] = useState<BikeComponent[]>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedComp, setSelectedComp] = useState<BikeComponent | null>(null);
  const [editedSpecs, setEditedSpecs] = useState<Record<string, unknown>>({});
  const [editedWeight, setEditedWeight] = useState<number | null>(null);
  const [showSpecs, setShowSpecs] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // ── Load data ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const data = await getTopComponents(category, 200);
    setAllComponents(data);
    const brandMap = new Map<string, number>();
    data.forEach((c) => brandMap.set(c.brand, (brandMap.get(c.brand) ?? 0) + c.usage_count));
    setBrands([...brandMap.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b));

    // Detect current selection from value
    if (value) {
      const match = data.find((c) => `${c.brand} ${c.model}`.trim().toLowerCase() === value.toLowerCase());
      if (match) {
        setSelectedBrand(match.brand);
        setModels(data.filter((c) => c.brand === match.brand));
        setSelectedComp(match);
        setEditedSpecs(match.specs as Record<string, unknown> ?? {});
        setEditedWeight(match.weight_g);
      } else {
        const foundBrand = [...brandMap.keys()].find((b) => value.toLowerCase().startsWith(b.toLowerCase()));
        if (foundBrand) {
          setSelectedBrand(foundBrand);
          setModels(data.filter((c) => c.brand === foundBrand));
        }
      }
    }
    setLoaded(true);
  }, [category, value]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Brand change ───────────────────────────────────────────
  const handleBrandChange = (brand: string) => {
    if (brand === '__custom__') { setCustomMode(true); setCustomText(value); return; }
    setCustomMode(false);
    setSelectedBrand(brand);
    setSelectedComp(null);
    setShowSpecs(false);
    const filtered = allComponents.filter((c) => c.brand === brand);
    setModels(filtered);
    if (filtered.length === 1) handleModelSelect(filtered[0]!);
  };

  // ── Model select ───────────────────────────────────────────
  const handleModelSelect = (comp: BikeComponent) => {
    const display = `${comp.brand} ${comp.model}`.trim();
    onChange(display);
    setSelectedComp(comp);
    setEditedSpecs(comp.specs as Record<string, unknown> ?? {});
    setEditedWeight(comp.weight_g);
    setShowSpecs(true);
    saveComponent(category, comp.brand, comp.model, comp.specs as Record<string, unknown>);
    if (onSpecsReceived && comp.specs) onSpecsReceived(comp.specs as Record<string, unknown>);
  };

  const handleModelChange = (modelName: string) => {
    if (modelName === '__custom__') { setCustomMode(true); setCustomText(selectedBrand ? `${selectedBrand} ` : ''); return; }
    const comp = models.find((c) => c.model === modelName);
    if (comp) handleModelSelect(comp);
  };

  // ── Spec edit ──────────────────────────────────────────────
  const handleSpecChange = (key: string, val: unknown) => {
    const updated = { ...editedSpecs, [key]: val };
    setEditedSpecs(updated);
    if (onSpecsReceived) onSpecsReceived(updated);
  };

  // ── Save edited specs as new variant ───────────────────────
  const handleSaveSpecs = async () => {
    if (!selectedComp) return;
    const origSpecs = selectedComp.specs as Record<string, unknown>;
    const changed = Object.keys(editedSpecs).some((k) => JSON.stringify(editedSpecs[k]) !== JSON.stringify(origSpecs[k]))
      || (editedWeight !== null && editedWeight !== selectedComp.weight_g);

    if (changed) {
      // Save as new version with modified specs
      await saveComponent(category, selectedComp.brand, selectedComp.model, editedSpecs);
      setShowSpecs(false);
      setTimeout(loadData, 300);
    } else {
      setShowSpecs(false);
    }
  };

  // ── Custom text + AI ───────────────────────────────────────
  const handleCustomConfirm = async () => {
    if (!customText.trim()) return;
    const text = customText.trim();
    onChange(text);
    setAiStatus('loading');

    const result = await normalizeComponent(category, text);
    if (result && result.corrected && result.confidence > 0.7) {
      setAiSuggestion(`${result.brand} ${result.model}`.trim());
      setAiStatus('done');
      const specs = await suggestSpecs(category, result.brand, result.model);
      if (specs) {
        saveComponent(category, result.brand, result.model, specs);
        // Show specs for editing
        setSelectedComp({ id: '', category, brand: result.brand, model: result.model, specs, usage_count: 1, weight_g: null, year_from: null, compatibility: null });
        setEditedSpecs(specs);
        setShowSpecs(true);
        if (onSpecsReceived) onSpecsReceived(specs);
      } else {
        saveComponent(category, result.brand, result.model);
      }
    } else {
      setAiStatus('idle');
      const parts = text.split(' ');
      if (parts.length >= 2) {
        const brand = parts[0]!;
        const model = parts.slice(1).join(' ');
        const specs = await suggestSpecs(category, brand, model);
        saveComponent(category, brand, model, specs ?? {});
        if (specs) {
          setSelectedComp({ id: '', category, brand, model, specs, usage_count: 1, weight_g: null, year_from: null, compatibility: null });
          setEditedSpecs(specs);
          setShowSpecs(true);
          if (onSpecsReceived) onSpecsReceived(specs);
        }
      }
    }
    setCustomMode(false);
    setTimeout(loadData, 500);
  };

  // ── Current model name ─────────────────────────────────────
  const currentModelName = (() => {
    if (selectedComp) return selectedComp.model;
    if (!selectedBrand || !value) return '';
    const prefix = selectedBrand.toLowerCase();
    return value.toLowerCase().startsWith(prefix) ? value.substring(selectedBrand.length).trim() : value;
  })();

  const specFields = CATEGORY_SPECS[category] ?? [];

  if (!loaded) {
    return (
      <div>
        <div style={S.label}>{label}</div>
        <div style={{ ...S.select, color: '#494847' }}>A carregar...</div>
      </div>
    );
  }

  // ── Custom mode ────────────────────────────────────────────
  if (customMode) {
    return (
      <div>
        <div style={S.label}>{label}</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input type="text" value={customText} onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCustomConfirm(); }}
            placeholder={placeholder ?? 'Marca Modelo...'} autoFocus
            style={{ ...S.input, flex: 1, borderColor: 'rgba(233,102,255,0.3)' }} />
          <button onClick={handleCustomConfirm} style={S.btnPrimary}>
            {aiStatus === 'loading' ? '...' : 'OK'}
          </button>
          <button onClick={() => { setCustomMode(false); setAiSuggestion(null); setAiStatus('idle'); }} style={S.btnCancel}>✕</button>
        </div>
        {aiStatus === 'done' && aiSuggestion && (
          <div style={S.aiBar}>
            <span style={{ fontSize: '10px', color: '#e966ff', fontWeight: 700 }}>AI → </span>
            <span style={{ fontSize: '11px', color: 'white', fontWeight: 600, flex: 1 }}>{aiSuggestion}</span>
            <button onClick={() => { onChange(aiSuggestion!); setAiSuggestion(null); setAiStatus('idle'); }} style={S.btnPrimary}>Usar</button>
          </div>
        )}
      </div>
    );
  }

  // ── Dropdown mode ──────────────────────────────────────────
  return (
    <div>
      <div style={S.label}>{label}</div>
      <div style={{ display: 'flex', gap: '4px' }}>
        {/* Brand */}
        <select value={selectedBrand} onChange={(e) => handleBrandChange(e.target.value)} style={{ ...S.select, flex: '0 0 40%' }}>
          <option value="" disabled>Marca</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          <option value="__custom__">+ Outro...</option>
        </select>
        {/* Model */}
        <select value={currentModelName} onChange={(e) => handleModelChange(e.target.value)}
          disabled={!selectedBrand} style={{ ...S.select, flex: 1, opacity: selectedBrand ? 1 : 0.5 }}>
          <option value="" disabled>Modelo</option>
          {models.map((c) => (
            <option key={c.id} value={c.model}>
              {c.model}{c.weight_g ? ` (${c.weight_g}g)` : ''}{fmtTag(c.specs as Record<string, unknown>)}
            </option>
          ))}
          <option value="__custom__">+ Outro...</option>
        </select>
        {/* Expand/collapse specs */}
        {selectedComp && specFields.length > 0 && (
          <button onClick={() => setShowSpecs(!showSpecs)} title="Ver/editar specs"
            style={{ padding: '0 8px', backgroundColor: showSpecs ? 'rgba(233,102,255,0.15)' : 'rgba(73,72,71,0.15)',
              color: showSpecs ? '#e966ff' : '#777575', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{showSpecs ? 'expand_less' : 'tune'}</span>
          </button>
        )}
      </div>

      {/* ── Editable specs panel ──────────────────────────── */}
      {showSpecs && selectedComp && (
        <div style={S.specsPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', color: '#e966ff', fontWeight: 700 }}>
              SPECS — {selectedComp.brand} {selectedComp.model}
            </span>
            <span style={{ fontSize: '9px', color: '#494847' }}>Edita e grava como variante</span>
          </div>

          {/* Weight (always shown) */}
          <div style={S.specRow}>
            <span style={S.specLabel}>Peso (g)</span>
            <input type="number" value={editedWeight ?? ''} onChange={(e) => setEditedWeight(parseInt(e.target.value) || null)}
              placeholder="—" style={S.specInput} />
          </div>

          {/* Category-specific spec fields */}
          {specFields.map(({ key, label: specLabel, type }) => {
            const val = editedSpecs[key];
            if (type === 'boolean') {
              return (
                <div key={key} style={S.specRow}>
                  <span style={S.specLabel}>{specLabel}</span>
                  <button onClick={() => handleSpecChange(key, !val)}
                    style={{ ...S.specToggle, backgroundColor: val ? 'rgba(63,255,139,0.15)' : 'rgba(73,72,71,0.15)', color: val ? '#3fff8b' : '#777575' }}>
                    {val ? 'Sim' : 'Não'}
                  </button>
                </div>
              );
            }
            if (type === 'number') {
              return (
                <div key={key} style={S.specRow}>
                  <span style={S.specLabel}>{specLabel}</span>
                  <input type="number" value={val != null ? String(val) : ''} onChange={(e) => handleSpecChange(key, parseFloat(e.target.value) || 0)}
                    placeholder="—" style={S.specInput} />
                </div>
              );
            }
            // text — handle arrays (sprockets) as comma-separated
            if (key === 'sprockets' && Array.isArray(val)) {
              return (
                <div key={key} style={S.specRow}>
                  <span style={S.specLabel}>{specLabel}</span>
                  <input type="text" value={(val as number[]).join(', ')}
                    onChange={(e) => handleSpecChange(key, e.target.value.split(/[,\s]+/).map(Number).filter((n) => !isNaN(n) && n > 0))}
                    style={{ ...S.specInput, fontFamily: 'monospace', flex: '0 0 60%' }} />
                </div>
              );
            }
            return (
              <div key={key} style={S.specRow}>
                <span style={S.specLabel}>{specLabel}</span>
                <input type="text" value={val != null ? String(val) : ''} onChange={(e) => handleSpecChange(key, e.target.value)}
                  placeholder="—" style={S.specInput} />
              </div>
            );
          })}

          {/* Save button */}
          <button onClick={handleSaveSpecs} style={S.btnSave}>
            Guardar alterações
          </button>
        </div>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────
const S = {
  label: { fontSize: '10px', color: '#777575', marginBottom: '2px' } as React.CSSProperties,
  select: {
    padding: '8px 24px 8px 8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)',
    borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none',
    appearance: 'none' as const,
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%23777575\' stroke-width=\'1.5\'/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
  } as React.CSSProperties,
  input: {
    padding: '8px 10px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)',
    borderRadius: '4px', color: 'white', fontSize: '13px', outline: 'none',
  } as React.CSSProperties,
  btnPrimary: {
    padding: '0 12px', backgroundColor: '#e966ff', color: 'black', border: 'none',
    borderRadius: '4px', fontWeight: 700, fontSize: '11px', cursor: 'pointer',
  } as React.CSSProperties,
  btnCancel: {
    padding: '0 8px', backgroundColor: 'rgba(73,72,71,0.2)', color: '#adaaaa',
    border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer',
  } as React.CSSProperties,
  aiBar: {
    marginTop: '4px', padding: '6px 10px', borderRadius: '4px',
    backgroundColor: 'rgba(233,102,255,0.1)', border: '1px solid rgba(233,102,255,0.25)',
    display: 'flex', alignItems: 'center', gap: '8px',
  } as React.CSSProperties,
  specsPanel: {
    marginTop: '4px', padding: '10px', borderRadius: '4px',
    backgroundColor: 'rgba(233,102,255,0.03)', border: '1px solid rgba(233,102,255,0.12)',
  } as React.CSSProperties,
  specRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px',
  } as React.CSSProperties,
  specLabel: { fontSize: '10px', color: '#777575', flex: '0 0 40%' } as React.CSSProperties,
  specInput: {
    flex: 1, padding: '5px 8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.2)',
    borderRadius: '3px', color: 'white', fontSize: '11px', outline: 'none', textAlign: 'right' as const,
  } as React.CSSProperties,
  specToggle: {
    padding: '4px 10px', borderRadius: '3px', border: 'none', cursor: 'pointer',
    fontSize: '10px', fontWeight: 700,
  } as React.CSSProperties,
  btnSave: {
    marginTop: '6px', width: '100%', padding: '8px', backgroundColor: 'rgba(233,102,255,0.15)',
    color: '#e966ff', border: '1px solid rgba(233,102,255,0.25)', borderRadius: '4px',
    fontSize: '11px', fontWeight: 700, cursor: 'pointer',
  } as React.CSSProperties,
};

function fmtTag(specs: Record<string, unknown>): string {
  if (!specs) return '';
  const p: string[] = [];
  if (specs.travel_mm) p.push(`${specs.travel_mm}mm`);
  if (specs.speeds) p.push(`${specs.speeds}v`);
  if (specs.range) p.push(`${specs.range}`);
  if (specs.diameter_mm) p.push(`${specs.diameter_mm}mm`);
  if (specs.pistons) p.push(`${specs.pistons}p`);
  if (specs.torque_nm) p.push(`${specs.torque_nm}Nm`);
  const t = p.slice(0, 2).join(' ');
  return t ? ` — ${t}` : '';
}
