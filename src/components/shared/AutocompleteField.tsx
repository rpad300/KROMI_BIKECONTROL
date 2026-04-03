import { useState, useEffect, useRef, useCallback } from 'react';
import {
  searchComponents, saveComponent, normalizeComponent, suggestSpecs,
  type BikeComponent,
} from '../../services/bike/BikeComponentService';

interface AutocompleteFieldProps {
  /** Component category for DB lookup */
  category: string;
  /** Field label */
  label: string;
  /** Current value (brand + model combined, or just model) */
  value: string;
  /** Called when user selects or types a value */
  onChange: (value: string) => void;
  /** Optional: called when a component is selected with its specs */
  onSpecsReceived?: (specs: Record<string, unknown>) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Mode: 'full' = brand + model, 'brand' = brand only */
  mode?: 'full' | 'brand';
}

export function AutocompleteField({
  category, label, value, onChange, onSpecsReceived, placeholder, mode = 'full',
}: AutocompleteFieldProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<BikeComponent[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'corrected' | 'error'>('idle');
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync external value changes
  useEffect(() => { setQuery(value); }, [value]);

  // Search on query change (debounced)
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return; }
    const hits = await searchComponents(category, q);
    setResults(hits);
    if (hits.length > 0) setShowDropdown(true);
  }, [category]);

  const handleInputChange = (text: string) => {
    setQuery(text);
    setAiSuggestion(null);
    setAiStatus('idle');
    onChange(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 250);
  };

  // Select a component from dropdown
  const handleSelect = (comp: BikeComponent) => {
    const display = mode === 'brand' ? comp.brand : `${comp.brand} ${comp.model}`.trim();
    setQuery(display);
    onChange(display);
    setShowDropdown(false);
    setAiSuggestion(null);

    // Save usage
    saveComponent(category, comp.brand, comp.model, comp.specs as Record<string, unknown>);

    // Pass specs to parent
    if (onSpecsReceived && comp.specs) {
      onSpecsReceived(comp.specs as Record<string, unknown>);
    }
  };

  // AI normalize on blur (if text doesn't match a known component)
  const handleBlur = async () => {
    // Delay to allow dropdown click
    setTimeout(() => setShowDropdown(false), 200);

    if (!query.trim() || query === value) return;

    // Only normalize if the text doesn't exactly match a result
    const isKnown = results.some(
      (r) => `${r.brand} ${r.model}`.trim().toLowerCase() === query.toLowerCase()
        || r.brand.toLowerCase() === query.toLowerCase(),
    );

    if (!isKnown && query.length >= 3) {
      setAiStatus('loading');
      const result = await normalizeComponent(category, query);
      if (result && result.corrected && result.confidence > 0.7) {
        const corrected = `${result.brand} ${result.model}`.trim();
        setAiSuggestion(corrected);
        setAiStatus('corrected');

        // Auto-fetch specs for the corrected component
        if (onSpecsReceived) {
          const specs = await suggestSpecs(category, result.brand, result.model);
          if (specs) {
            // Save to DB for future autocomplete
            saveComponent(category, result.brand, result.model, specs);
          }
        }
      } else {
        setAiStatus('idle');
        // Save what user typed as new component
        if (query.includes(' ')) {
          const parts = query.split(' ');
          const brand = parts[0]!;
          const model = parts.slice(1).join(' ');
          saveComponent(category, brand, model);
        }
      }
    }
  };

  // Accept AI suggestion
  const acceptSuggestion = async () => {
    if (!aiSuggestion) return;
    setQuery(aiSuggestion);
    onChange(aiSuggestion);
    setAiStatus('idle');
    setAiSuggestion(null);

    // Fetch and apply specs
    if (onSpecsReceived) {
      const parts = aiSuggestion.split(' ');
      const brand = parts[0]!;
      const model = parts.slice(1).join(' ');
      const specs = await suggestSpecs(category, brand, model);
      if (specs) {
        onSpecsReceived(specs);
        saveComponent(category, brand, model, specs);
      }
    }
  };

  // Focus shows dropdown
  const handleFocus = () => {
    if (results.length > 0) setShowDropdown(true);
    else doSearch(query || '');
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>{label}</div>

      {/* Input */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          style={{
            width: '100%', padding: '8px 10px', paddingRight: aiStatus === 'loading' ? '32px' : '10px',
            backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)',
            borderRadius: '4px', color: 'white', fontSize: '13px', outline: 'none',
          }}
          autoComplete="off"
        />
        {/* AI loading spinner */}
        {aiStatus === 'loading' && (
          <div style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)' }}>
            <div className="w-4 h-4 border-2 border-[#e966ff] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* AI suggestion banner */}
      {aiStatus === 'corrected' && aiSuggestion && (
        <div
          style={{
            marginTop: '4px', padding: '6px 10px', borderRadius: '4px',
            backgroundColor: 'rgba(233,102,255,0.1)', border: '1px solid rgba(233,102,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
          }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '10px', color: '#e966ff', fontWeight: 700 }}>AI </span>
            <span style={{ fontSize: '11px', color: '#adaaaa' }}>Queria dizer </span>
            <span style={{ fontSize: '11px', color: 'white', fontWeight: 600 }}>{aiSuggestion}</span>
            <span style={{ fontSize: '11px', color: '#adaaaa' }}>?</span>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={acceptSuggestion}
              style={{
                padding: '3px 8px', fontSize: '10px', fontWeight: 700, borderRadius: '3px',
                backgroundColor: '#e966ff', color: 'black', border: 'none', cursor: 'pointer',
              }}
            >
              Sim
            </button>
            <button
              onClick={() => { setAiStatus('idle'); setAiSuggestion(null); }}
              style={{
                padding: '3px 8px', fontSize: '10px', fontWeight: 700, borderRadius: '3px',
                backgroundColor: 'rgba(73,72,71,0.3)', color: '#adaaaa', border: 'none', cursor: 'pointer',
              }}
            >
              Não
            </button>
          </div>
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && results.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            marginTop: '2px', maxHeight: '200px', overflowY: 'auto',
            backgroundColor: '#1a1a1a', border: '1px solid rgba(73,72,71,0.4)',
            borderRadius: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}
        >
          {results.map((comp) => {
            const display = mode === 'brand' ? comp.brand : `${comp.brand} ${comp.model}`;
            const isMatch = display.toLowerCase() === query.toLowerCase();
            return (
              <button
                key={comp.id}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(comp); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px',
                  backgroundColor: isMatch ? 'rgba(63,255,139,0.05)' : 'transparent',
                  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: '8px',
                }}
              >
                <div>
                  <span style={{ fontSize: '12px', color: '#3fff8b', fontWeight: 700 }}>{comp.brand}</span>
                  {mode !== 'brand' && (
                    <span style={{ fontSize: '12px', color: 'white', marginLeft: '4px' }}>{comp.model}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {/* Show key spec */}
                  {comp.specs && Object.keys(comp.specs).length > 0 && (
                    <span style={{ fontSize: '9px', color: '#777575' }}>
                      {formatSpecPreview(comp.specs as Record<string, unknown>)}
                    </span>
                  )}
                  <span style={{ fontSize: '8px', color: '#494847' }}>
                    {comp.usage_count}x
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Format specs into a tiny preview string */
function formatSpecPreview(specs: Record<string, unknown>): string {
  const parts: string[] = [];
  if (specs.travel_mm) parts.push(`${specs.travel_mm}mm`);
  if (specs.torque_nm) parts.push(`${specs.torque_nm}Nm`);
  if (specs.width_mm) parts.push(`${specs.width_mm}mm`);
  if (specs.rim_width_mm) parts.push(`${specs.rim_width_mm}mm`);
  if (specs.weight_g) parts.push(`${specs.weight_g}g`);
  if (specs.speeds) parts.push(`${specs.speeds}v`);
  if (specs.range) parts.push(`${specs.range}`);
  if (specs.pistons) parts.push(`${specs.pistons}p`);
  if (specs.type && typeof specs.type === 'string') parts.push(specs.type);
  return parts.slice(0, 3).join(' · ');
}
