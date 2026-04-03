import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { useServiceStore } from '../../store/serviceStore';
import { createService, addServiceItem } from '../../services/maintenance/MaintenanceService';
import {
  SERVICE_TYPE_LABELS, URGENCY_LABELS, URGENCY_COLORS,
  type ServiceType, type ServiceUrgency,
} from '../../types/service.types';

export function NewServicePage({ bikeId, onBack }: { bikeId: string; onBack: () => void }) {
  const userId = useAuthStore((s) => s.user?.id);
  const bike = safeBikeConfig(useSettingsStore((s) => s.bikes.find((b) => b.id === bikeId)));
  const addToList = useServiceStore((s) => s.addService);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requestType, setRequestType] = useState<ServiceType>('maintenance');
  const [urgency, setUrgency] = useState<ServiceUrgency>('normal');
  const [preferredDate, setPreferredDate] = useState('');
  const [saving, setSaving] = useState(false);

  // Quick items to add
  const [items, setItems] = useState<{ desc: string; type: 'part' | 'labor' | 'consumable'; cost: number }[]>([]);
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemCost, setNewItemCost] = useState(0);

  const handleSave = async () => {
    if (!title.trim() || !userId) return;
    setSaving(true);

    const svc = await createService({
      bike_id: bikeId,
      rider_id: userId,
      bike_name: bike.name,
      bike_brand: bike.brand,
      bike_model: bike.model,
      title: title.trim(),
      description: description.trim() || null,
      request_type: requestType,
      urgency,
      preferred_date: preferredDate || null,
      status: 'draft',
    });

    if (svc) {
      // Add items
      for (const item of items) {
        await addServiceItem({
          service_id: svc.id,
          item_type: item.type,
          description: item.desc,
          quantity: 1,
          unit_cost: item.cost,
          total_cost: item.cost,
        });
      }
      addToList(svc);
    }

    setSaving(false);
    onBack();
  };

  const addItem = () => {
    if (!newItemDesc.trim()) return;
    setItems([...items, { desc: newItemDesc.trim(), type: 'part', cost: newItemCost }]);
    setNewItemDesc('');
    setNewItemCost(0);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#adaaaa' }}>arrow_back</span>
        </button>
        <div>
          <div className="font-headline font-bold" style={{ fontSize: '16px', color: '#ff9f43' }}>Novo Serviço</div>
          <div style={{ fontSize: '10px', color: '#777575' }}>{bike.name}</div>
        </div>
      </div>

      {/* Form */}
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Title */}
        <div>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>Título *</div>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Revisão 3000km, Substituir corrente, Barulho no pedal..."
            style={{ width: '100%', padding: '10px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '13px', outline: 'none' }} />
        </div>

        {/* Type chips */}
        <div>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Tipo</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((t) => (
              <button key={t} onClick={() => setRequestType(t)}
                style={{
                  padding: '5px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                  backgroundColor: requestType === t ? 'rgba(255,159,67,0.2)' : 'rgba(73,72,71,0.15)',
                  color: requestType === t ? '#ff9f43' : '#777575',
                  border: requestType === t ? '1px solid rgba(255,159,67,0.3)' : '1px solid transparent',
                }}>
                {SERVICE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Urgency */}
        <div>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Urgência</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {(Object.keys(URGENCY_LABELS) as ServiceUrgency[]).map((u) => (
              <button key={u} onClick={() => setUrgency(u)}
                style={{
                  padding: '5px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                  backgroundColor: urgency === u ? `${URGENCY_COLORS[u]}20` : 'rgba(73,72,71,0.15)',
                  color: urgency === u ? URGENCY_COLORS[u] : '#777575',
                  border: urgency === u ? `1px solid ${URGENCY_COLORS[u]}40` : '1px solid transparent',
                }}>
                {URGENCY_LABELS[u]}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>Descrição</div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Descreve o que precisa de ser feito..."
            rows={3}
            style={{ width: '100%', padding: '10px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none', resize: 'vertical' }} />
        </div>

        {/* Preferred date */}
        <div>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>Data preferida</div>
          <input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none' }} />
        </div>
      </div>

      {/* Items */}
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px' }}>
        <div style={{ fontSize: '10px', color: '#777575', marginBottom: '6px' }}>Itens (peças, trabalho)</div>

        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', padding: '6px 8px', backgroundColor: '#0e0e0e', borderRadius: '3px' }}>
            <span style={{ flex: 1, fontSize: '11px', color: 'white' }}>{item.desc}</span>
            <span style={{ fontSize: '11px', color: '#ff9f43' }}>{item.cost > 0 ? `${item.cost}€` : ''}</span>
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#ff716c' }}>close</span>
            </button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: '4px' }}>
          <input type="text" value={newItemDesc} onChange={(e) => setNewItemDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            placeholder="Peça ou trabalho..." style={{ flex: 1, padding: '6px 8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.2)', borderRadius: '3px', color: 'white', fontSize: '11px', outline: 'none' }} />
          <input type="number" value={newItemCost || ''} onChange={(e) => setNewItemCost(parseFloat(e.target.value) || 0)}
            placeholder="€" style={{ width: '60px', padding: '6px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.2)', borderRadius: '3px', color: '#ff9f43', fontSize: '11px', outline: 'none', textAlign: 'right' }} />
          <button onClick={addItem} style={{ padding: '0 8px', backgroundColor: 'rgba(255,159,67,0.15)', border: 'none', borderRadius: '3px', color: '#ff9f43', cursor: 'pointer', fontSize: '14px' }}>+</button>
        </div>
      </div>

      {/* Save */}
      <button onClick={handleSave} disabled={!title.trim() || saving}
        style={{
          width: '100%', padding: '14px', backgroundColor: '#ff9f43', border: 'none', borderRadius: '6px',
          color: 'black', fontSize: '14px', fontWeight: 700, cursor: 'pointer', opacity: !title.trim() || saving ? 0.5 : 1,
        }}>
        {saving ? 'A guardar...' : 'Registar Serviço'}
      </button>
    </div>
  );
}
