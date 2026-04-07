import { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { useReadOnlyGuard } from '../../hooks/useReadOnlyGuard';
import { FIT_FIELD_GROUPS, type BikeFit, type BikeFitChange } from '../../types/bikefit.types';
import { supaFetch, supaGet } from '../../lib/supaFetch';

export function BikeFitPage() {
  const bikes = useSettingsStore((s) => s.bikes);
  const activeBike = useSettingsStore((s) => s.bikeConfig);
  const [selectedBikeId, setSelectedBikeId] = useState(activeBike.id);
  const bike = bikes.find((b) => b.id === selectedBikeId) ?? activeBike;
  const [fit, setFit] = useState<BikeFit>({ id: '' });
  const [history, setHistory] = useState<BikeFitChange[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>('rider');
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  const userId = useAuthStore((s) => s.getUserId());
  const guard = useReadOnlyGuard();

  // Load existing fit from Supabase
  useEffect(() => {
    if (!userId) { setLoaded(true); return; }
    supaGet<BikeFit[]>(`/rest/v1/bike_fits?user_id=eq.${userId}&bike_name=eq.${encodeURIComponent(bike.name)}&order=updated_at.desc&limit=1`)
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setFit(data[0]!);
        setLoaded(true);
      }).catch(() => setLoaded(true));
  }, [userId, bike.name]);

  // Load change history
  useEffect(() => {
    if (!fit.id) return;
    supaGet<BikeFitChange[]>(`/rest/v1/bike_fit_changes?bike_fit_id=eq.${fit.id}&order=changed_at.desc&limit=20`)
      .then((data) => { if (Array.isArray(data)) setHistory(data); })
      .catch(() => {});
  }, [fit.id]);

  // Save fit to Supabase
  const saveFit = async (updatedFit: BikeFit, changedField?: string, oldValue?: string, newValue?: string) => {
    if (!userId) return;
    if (!guard('Não é possível alterar bike fit em modo impersonation.')) return;
    setSaving(true);

    const payload = { ...updatedFit, user_id: userId, bike_name: bike.name, updated_at: new Date().toISOString() };
    delete (payload as Record<string, unknown>).id;

    try {
      if (fit.id) {
        // Update existing
        await supaFetch(`/rest/v1/bike_fits?id=eq.${fit.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify(payload),
        });
      } else {
        // Create new
        const res = await supaFetch('/rest/v1/bike_fits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify(payload),
        });
        const [created] = await res.json();
        if (created?.id) setFit((f) => ({ ...f, id: created.id }));
      }

      // Record change in history
      if (changedField && fit.id) {
        await supaFetch('/rest/v1/bike_fit_changes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            bike_fit_id: fit.id,
            field_name: changedField,
            old_value: oldValue ?? '',
            new_value: newValue ?? '',
            reason: changeReason,
          }),
        });
        setChangeReason('');
        // Refresh history
        const hData = await supaGet<BikeFitChange[]>(
          `/rest/v1/bike_fit_changes?bike_fit_id=eq.${fit.id}&order=changed_at.desc&limit=20`,
        );
        if (Array.isArray(hData)) setHistory(hData);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const updateField = (key: string, value: string | number) => {
    const oldVal = String((fit as unknown as Record<string, unknown>)[key] ?? '');
    const newFit = { ...fit, [key]: value };
    setFit(newFit);
    saveFit(newFit, key, oldVal, String(value));
  };

  // Reset fit when bike changes — MUST be before any conditional returns (React hooks rule)
  useEffect(() => {
    setFit({ id: '' });
    setHistory([]);
    setLoaded(false);
    if (!userId) { setLoaded(true); return; }
    supaGet<BikeFit[]>(`/rest/v1/bike_fits?user_id=eq.${userId}&bike_name=eq.${encodeURIComponent(bike.name)}&order=updated_at.desc&limit=1`)
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setFit(data[0]!);
        setLoaded(true);
      }).catch(() => setLoaded(true));
  }, [selectedBikeId, userId, bike.name]);

  if (!loaded) return <div style={{ padding: '20px', textAlign: 'center', color: '#777575' }}>A carregar bike fit...</div>;

  const filledCount = FIT_FIELD_GROUPS.flatMap((g) => g.fields).filter((f) => {
    const v = (fit as unknown as Record<string, unknown>)[f.key];
    return v !== undefined && v !== null && v !== '' && v !== 0;
  }).length;
  const totalFields = FIT_FIELD_GROUPS.flatMap((g) => g.fields).length;

  return (
    <div className="space-y-4">
      {/* Bike selector dropdown */}
      {bikes.length > 1 && (
        <div style={{ backgroundColor: '#1a1919', padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#3fff8b' }}>pedal_bike</span>
            <select value={selectedBikeId} onChange={(e) => setSelectedBikeId(e.target.value)}
              style={{ flex: 1, backgroundColor: '#262626', color: 'white', padding: '8px 10px', border: '1px solid #494847', fontSize: '13px', cursor: 'pointer' }}>
              {bikes.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.bike_type === 'ebike' ? '⚡' : '🚲'})</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Summary */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="font-headline font-bold" style={{ fontSize: '14px', color: '#3fff8b' }}>{bike.name}</span>
            <div style={{ fontSize: '10px', color: '#777575', marginTop: '2px' }}>{filledCount}/{totalFields} medidas preenchidas</div>
          </div>
          {saving && <span style={{ fontSize: '10px', color: '#fbbf24' }}>A guardar...</span>}
        </div>
        <div style={{ height: '4px', backgroundColor: '#262626', marginTop: '8px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(filledCount / totalFields) * 100}%`, backgroundColor: '#3fff8b' }} />
        </div>
      </div>

      {/* Reason input — shown when user is about to make changes */}
      <div style={{ backgroundColor: '#1a1919', padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#6e9bff' }}>edit_note</span>
          <span style={{ fontSize: '10px', color: '#adaaaa' }}>Razão da alteração (opcional — fica no histórico)</span>
        </div>
        <input type="text" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Ex: ajustei selim 5mm por dor no joelho"
          style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', fontSize: '12px' }} />
      </div>

      {/* Field groups — expandable */}
      {FIT_FIELD_GROUPS.map((group) => {
        const isExpanded = expandedGroup === group.id;
        const groupFilled = group.fields.filter((f) => {
          const v = (fit as unknown as Record<string, unknown>)[f.key];
          return v !== undefined && v !== null && v !== '' && v !== 0;
        }).length;

        return (
          <div key={group.id} style={{ backgroundColor: '#1a1919' }}>
            <button onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: 'transparent', border: 'none', borderLeft: `3px solid ${group.color}`, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: group.color }}>{group.icon}</span>
                <span className="font-headline font-bold" style={{ fontSize: '13px', color: 'white' }}>{group.label}</span>
                <span style={{ fontSize: '9px', color: '#777575' }}>{groupFilled}/{group.fields.length}</span>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#494847', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>expand_more</span>
            </button>

            {isExpanded && (
              <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {group.fields.map((field) => {
                  const val = (fit as unknown as Record<string, unknown>)[field.key];
                  if (field.type === 'textarea') {
                    return (
                      <div key={field.key}>
                        <span style={{ fontSize: '11px', color: '#adaaaa' }}>{field.label}</span>
                        <textarea value={String(val ?? '')} onChange={(e) => updateField(field.key, e.target.value)}
                          style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '6px', border: 'none', fontSize: '12px', minHeight: '40px', resize: 'vertical', marginTop: '4px' }} />
                      </div>
                    );
                  }
                  return (
                    <div key={field.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: '#adaaaa', fontSize: '12px' }}>{field.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          value={val !== undefined && val !== null ? String(val) : ''}
                          onChange={(e) => updateField(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                          style={{ backgroundColor: '#262626', color: 'white', padding: '4px 8px', border: '1px solid #494847', width: field.type === 'number' ? '80px' : '120px', textAlign: field.type === 'number' ? 'center' : 'left', fontSize: '13px' }}
                          className="tabular-nums"
                        />
                        {field.unit && <span style={{ fontSize: '10px', color: '#777575' }}>{field.unit}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Change history */}
      <div style={{ backgroundColor: '#1a1919' }}>
        <button onClick={() => setShowHistory(!showHistory)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: 'transparent', border: 'none', borderLeft: '3px solid #494847', cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#494847' }}>history</span>
            <span className="font-headline font-bold" style={{ fontSize: '13px', color: '#adaaaa' }}>Histórico de alterações</span>
            <span style={{ fontSize: '9px', color: '#777575' }}>{history.length}</span>
          </div>
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#494847', transform: showHistory ? 'rotate(180deg)' : 'none' }}>expand_more</span>
        </button>

        {showHistory && (
          <div style={{ padding: '8px 12px 12px' }}>
            {history.length === 0 ? (
              <div style={{ fontSize: '11px', color: '#777575', textAlign: 'center', padding: '8px' }}>Sem alterações registadas</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {history.map((h) => (
                  <div key={h.id} style={{ padding: '6px 8px', backgroundColor: '#262626', borderLeft: '2px solid #494847' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                      <span style={{ color: '#6e9bff', fontWeight: 600 }}>{h.field_name}</span>
                      <span style={{ color: '#494847' }}>{new Date(h.changed_at).toLocaleDateString()}</span>
                    </div>
                    <div style={{ fontSize: '10px', color: '#adaaaa', marginTop: '2px' }}>
                      <span style={{ color: '#ff716c' }}>{h.old_value || '—'}</span>
                      <span style={{ color: '#494847' }}> → </span>
                      <span style={{ color: '#3fff8b' }}>{h.new_value}</span>
                    </div>
                    {h.reason && <div style={{ fontSize: '9px', color: '#777575', marginTop: '2px' }}>📝 {h.reason}</div>}
                    {h.notes && <div style={{ fontSize: '9px', color: '#494847', marginTop: '1px' }}>{h.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
