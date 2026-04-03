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

/**
 * ComponentPicker — Brand → Model dropdown flow
 *
 * 1. Load all brands for this category from DB
 * 2. User picks brand → loads models for that brand
 * 3. User picks model → auto-fills specs via onSpecsReceived
 * 4. "Outro" option → free text input → AI normalizes → saves to DB
 */
export function AutocompleteField({
  category, label, value, onChange, onSpecsReceived, placeholder,
}: AutocompleteFieldProps) {
  const [allComponents, setAllComponents] = useState<BikeComponent[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [models, setModels] = useState<BikeComponent[]>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // ── Load components for this category ──────────────────────
  const loadData = useCallback(async () => {
    const data = await getTopComponents(category, 200);
    setAllComponents(data);

    // Extract unique brands sorted by total usage
    const brandMap = new Map<string, number>();
    data.forEach((c) => brandMap.set(c.brand, (brandMap.get(c.brand) ?? 0) + c.usage_count));
    const sorted = [...brandMap.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
    setBrands(sorted);

    // Try to detect current brand from value
    if (value) {
      const match = data.find((c) => `${c.brand} ${c.model}`.trim().toLowerCase() === value.toLowerCase());
      if (match) {
        setSelectedBrand(match.brand);
        setModels(data.filter((c) => c.brand === match.brand));
      } else {
        // Check if value starts with a known brand
        const foundBrand = sorted.find((b) => value.toLowerCase().startsWith(b.toLowerCase()));
        if (foundBrand) {
          setSelectedBrand(foundBrand);
          setModels(data.filter((c) => c.brand === foundBrand));
        }
      }
    }
    setLoaded(true);
  }, [category, value]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Brand selected → filter models ─────────────────────────
  const handleBrandChange = (brand: string) => {
    if (brand === '__custom__') {
      setCustomMode(true);
      setCustomText(value);
      setSelectedBrand('');
      return;
    }
    setCustomMode(false);
    setSelectedBrand(brand);
    const filtered = allComponents.filter((c) => c.brand === brand);
    setModels(filtered);

    // If only one model, auto-select it
    if (filtered.length === 1) {
      handleModelSelect(filtered[0]!);
    }
  };

  // ── Model selected → fill specs ────────────────────────────
  const handleModelSelect = (comp: BikeComponent) => {
    const display = `${comp.brand} ${comp.model}`.trim();
    onChange(display);
    saveComponent(category, comp.brand, comp.model, comp.specs as Record<string, unknown>);
    if (onSpecsReceived && comp.specs && Object.keys(comp.specs).length > 0) {
      onSpecsReceived(comp.specs as Record<string, unknown>);
    }
  };

  const handleModelChange = (modelName: string) => {
    if (modelName === '__custom__') {
      setCustomMode(true);
      setCustomText(selectedBrand ? `${selectedBrand} ` : '');
      return;
    }
    const comp = models.find((c) => c.model === modelName);
    if (comp) handleModelSelect(comp);
  };

  // ── Custom text → AI normalize + save ──────────────────────
  const handleCustomConfirm = async () => {
    if (!customText.trim()) return;

    const text = customText.trim();
    onChange(text);
    setAiStatus('loading');

    const result = await normalizeComponent(category, text);
    if (result && result.corrected && result.confidence > 0.7) {
      const corrected = `${result.brand} ${result.model}`.trim();
      setAiSuggestion(corrected);
      setAiStatus('done');

      // Fetch specs for normalized component
      const specs = await suggestSpecs(category, result.brand, result.model);
      if (specs) {
        saveComponent(category, result.brand, result.model, specs);
        if (onSpecsReceived) onSpecsReceived(specs);
      } else {
        saveComponent(category, result.brand, result.model);
      }
    } else {
      setAiStatus('idle');
      // Save as-is
      const parts = text.split(' ');
      if (parts.length >= 2) {
        const brand = parts[0]!;
        const model = parts.slice(1).join(' ');
        const specs = await suggestSpecs(category, brand, model);
        saveComponent(category, brand, model, specs ?? {});
        if (specs && onSpecsReceived) onSpecsReceived(specs);
      }
    }

    // Reload data so new entry appears
    setTimeout(loadData, 500);
  };

  const acceptAiSuggestion = () => {
    if (!aiSuggestion) return;
    setCustomText(aiSuggestion);
    onChange(aiSuggestion);
    setAiSuggestion(null);
    setAiStatus('idle');
    setCustomMode(false);
    loadData();
  };

  // ── Current model name (from value) ────────────────────────
  const currentModelName = (() => {
    if (!selectedBrand || !value) return '';
    const prefix = selectedBrand.toLowerCase();
    if (value.toLowerCase().startsWith(prefix)) {
      return value.substring(selectedBrand.length).trim();
    }
    return value;
  })();

  if (!loaded) {
    return (
      <div>
        <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>{label}</div>
        <div style={{ padding: '8px 10px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: '#494847', fontSize: '12px' }}>
          A carregar...
        </div>
      </div>
    );
  }

  // ── Custom mode: free text input ───────────────────────────
  if (customMode) {
    return (
      <div>
        <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>{label}</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCustomConfirm(); }}
            placeholder={placeholder ?? 'Marca Modelo...'}
            autoFocus
            style={{
              flex: 1, padding: '8px 10px', backgroundColor: '#0e0e0e',
              border: '1px solid rgba(233,102,255,0.3)', borderRadius: '4px',
              color: 'white', fontSize: '13px', outline: 'none',
            }}
          />
          <button onClick={handleCustomConfirm} style={{
            padding: '0 12px', backgroundColor: '#e966ff', color: 'black',
            border: 'none', borderRadius: '4px', fontWeight: 700, fontSize: '11px', cursor: 'pointer',
          }}>
            {aiStatus === 'loading' ? '...' : 'OK'}
          </button>
          <button onClick={() => { setCustomMode(false); setAiSuggestion(null); setAiStatus('idle'); }} style={{
            padding: '0 8px', backgroundColor: 'rgba(73,72,71,0.2)', color: '#adaaaa',
            border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer',
          }}>
            ✕
          </button>
        </div>

        {/* AI suggestion */}
        {aiStatus === 'done' && aiSuggestion && (
          <div style={{
            marginTop: '4px', padding: '6px 10px', borderRadius: '4px',
            backgroundColor: 'rgba(233,102,255,0.1)', border: '1px solid rgba(233,102,255,0.25)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '10px', color: '#e966ff', fontWeight: 700 }}>AI </span>
              <span style={{ fontSize: '11px', color: '#adaaaa' }}>→ </span>
              <span style={{ fontSize: '11px', color: 'white', fontWeight: 600 }}>{aiSuggestion}</span>
            </div>
            <button onClick={acceptAiSuggestion} style={{
              padding: '3px 8px', fontSize: '10px', fontWeight: 700, borderRadius: '3px',
              backgroundColor: '#e966ff', color: 'black', border: 'none', cursor: 'pointer',
            }}>Usar</button>
          </div>
        )}
      </div>
    );
  }

  // ── Dropdown mode: Brand → Model ───────────────────────────
  return (
    <div>
      <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>{label}</div>
      <div style={{ display: 'flex', gap: '4px' }}>
        {/* Brand dropdown */}
        <select
          value={selectedBrand}
          onChange={(e) => handleBrandChange(e.target.value)}
          style={{
            flex: '0 0 45%', padding: '8px 6px', backgroundColor: '#0e0e0e',
            border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px',
            color: selectedBrand ? 'white' : '#777575', fontSize: '12px', outline: 'none',
            appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%23777575\' stroke-width=\'1.5\'/%3E%3C/svg%3E")',
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px',
          }}
        >
          <option value="" disabled>Marca</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
          <option value="__custom__">+ Outro...</option>
        </select>

        {/* Model dropdown */}
        <select
          value={currentModelName}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={!selectedBrand}
          style={{
            flex: 1, padding: '8px 6px', backgroundColor: '#0e0e0e',
            border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px',
            color: currentModelName ? 'white' : '#777575', fontSize: '12px', outline: 'none',
            opacity: selectedBrand ? 1 : 0.5,
            appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%23777575\' stroke-width=\'1.5\'/%3E%3C/svg%3E")',
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px',
          }}
        >
          <option value="" disabled>Modelo</option>
          {models.map((c) => (
            <option key={c.id} value={c.model}>
              {c.model}{c.weight_g ? ` (${c.weight_g}g)` : ''}{formatSpecTag(c.specs as Record<string, unknown>)}
            </option>
          ))}
          <option value="__custom__">+ Outro...</option>
        </select>
      </div>

      {/* Selected component spec preview */}
      {selectedBrand && currentModelName && (() => {
        const sel = models.find((c) => c.model === currentModelName);
        if (!sel || !sel.specs || Object.keys(sel.specs).length === 0) return null;
        return (
          <div style={{ marginTop: '3px', fontSize: '10px', color: '#494847', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {Object.entries(sel.specs as Record<string, unknown>)
              .filter(([, v]) => v !== null && v !== '' && !Array.isArray(v))
              .slice(0, 5)
              .map(([k, v]) => (
                <span key={k} style={{ padding: '1px 5px', backgroundColor: 'rgba(73,72,71,0.1)', borderRadius: '2px' }}>
                  {formatSpecKey(k)}: {String(v)}
                </span>
              ))}
            {sel.weight_g && (
              <span style={{ padding: '1px 5px', backgroundColor: 'rgba(63,255,139,0.08)', borderRadius: '2px', color: '#3fff8b' }}>
                {sel.weight_g}g
              </span>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function formatSpecTag(specs: Record<string, unknown>): string {
  if (!specs) return '';
  const parts: string[] = [];
  if (specs.travel_mm) parts.push(`${specs.travel_mm}mm`);
  if (specs.speeds) parts.push(`${specs.speeds}v`);
  if (specs.range) parts.push(`${specs.range}`);
  if (specs.diameter_mm) parts.push(`${specs.diameter_mm}mm`);
  if (specs.pistons) parts.push(`${specs.pistons}p`);
  if (specs.torque_nm) parts.push(`${specs.torque_nm}Nm`);
  const tag = parts.slice(0, 2).join(' ');
  return tag ? ` — ${tag}` : '';
}

function formatSpecKey(key: string): string {
  const map: Record<string, string> = {
    travel_mm: 'Travel', stanchion_mm: 'Stanchion', axle: 'Axle', damper: 'Damper',
    spring: 'Spring', type: 'Tipo', pistons: 'Pistões', speeds: 'Vel',
    range: 'Range', diameter_mm: 'Ø', mount: 'Mount', torque_nm: 'Torque',
    power_w: 'Potência', width_mm: 'Largura', tpi: 'TPI', compound: 'Composto',
    master_cylinder_mm: 'MC', technology: 'Tech', electronic: 'Electrónico',
    flight_attendant: 'Flight Attendant', dual_crown: 'Dupla coroa',
  };
  return map[key] ?? key;
}
