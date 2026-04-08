import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useReadOnlyGuard } from '../../hooks/useReadOnlyGuard';
import { supaFetch, supaGet } from '../../lib/supaFetch';
import {
  getServiceById, getServiceItems, getComments, getPhotos,
  updateService, updateServiceStatus, addComment, addServiceItem,
  approveItem, rejectItem, deleteServiceItem, deleteService,
} from '../../services/maintenance/MaintenanceService';
import { PhotoUploader, PhotoGrid, type DisplayPhoto } from '../shared/PhotoUploader';
import {
  SERVICE_STATUS_LABELS, SERVICE_STATUS_COLORS, SERVICE_TYPE_LABELS,
  URGENCY_LABELS, URGENCY_COLORS,
  type ServiceRequest, type ServiceItem, type ServiceComment, type ServiceStatus,
} from '../../types/service.types';

export function ServiceDetailPage({ serviceId, onBack }: { serviceId: string; onBack: () => void }) {
  const userId = useAuthStore((s) => s.user?.id);
  const guard = useReadOnlyGuard();
  const [service, setService] = useState<ServiceRequest | null>(null);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [comments, setComments] = useState<ServiceComment[]>([]);
  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [showAddItem, setShowAddItem] = useState(false);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [noteText, setNoteText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [svc, its, cmts, phs] = await Promise.all([
      getServiceById(serviceId),
      getServiceItems(serviceId),
      getComments(serviceId),
      getPhotos(serviceId),
    ]);
    setPhotos(phs);
    setService(svc);
    setItems(its);
    setComments(cmts);
    setNoteText(svc?.service_note ?? '');
    setLoading(false);
  }, [serviceId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !service) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" /></div>;
  }

  const statusColor = SERVICE_STATUS_COLORS[service.status];
  const isRider = userId === service.rider_id;
  const pendingApproval = items.filter((i) => i.needs_approval && i.status === 'pending');

  const handleStatusChange = async (newStatus: ServiceStatus) => {
    if (!guard('Não é possível alterar o estado do serviço em modo impersonation.')) return;
    await updateServiceStatus(service.id, newStatus);
    await addComment({
      service_id: service.id, author_id: userId!, author_role: isRider ? 'rider' : 'mechanic',
      body: `Estado alterado para ${SERVICE_STATUS_LABELS[newStatus]}`,
      comment_type: 'status_change',
    });
    load();
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !userId) return;
    if (!guard('Não é possível comentar em modo impersonation.')) return;
    await addComment({
      service_id: service.id, author_id: userId, author_role: isRider ? 'rider' : 'mechanic',
      body: newComment.trim(), comment_type: 'message',
    });
    setNewComment('');
    load();
  };

  const handleSaveNote = async () => {
    if (!guard('Não é possível guardar notas em modo impersonation.')) return;
    await updateService(service.id, { service_note: noteText });
    setEditNote(false);
    load();
  };

  const handleDelete = async () => {
    if (!guard('Não é possível apagar serviços em modo impersonation.')) return;
    if (!confirm('Apagar este serviço?')) return;
    await deleteService(service.id);
    onBack();
  };

  // Status actions based on current state + viewer role.
  // The DB trigger trg_service_status_guard enforces the same rules
  // server-side; this block is the cosmetic mirror so customers
  // don't see buttons that would 403. See migration
  // s20_service_status_transition_guard.
  const statusActions: { label: string; status: ServiceStatus; color: string }[] = [];
  if (isRider) {
    // Customer (bike owner): only draft → requested and requested → cancelled.
    if (service.status === 'draft') statusActions.push({ label: 'Enviar pedido', status: 'requested', color: '#6e9bff' });
    if (service.status === 'requested') statusActions.push({ label: 'Cancelar pedido', status: 'cancelled', color: '#ff716c' });
  } else {
    // Mechanic / shop owner: the full workflow after submission.
    if (service.status === 'requested') statusActions.push({ label: 'Aceitar', status: 'accepted', color: '#3fff8b' }, { label: 'Rejeitar', status: 'rejected', color: '#ff716c' });
    if (service.status === 'accepted') statusActions.push({ label: 'Iniciar trabalho', status: 'in_progress', color: '#fbbf24' });
    if (service.status === 'in_progress') statusActions.push({ label: 'Concluir', status: 'completed', color: '#3fff8b' }, { label: 'Pedir aprovação', status: 'pending_approval', color: '#e966ff' });
    if (service.status === 'pending_approval') statusActions.push({ label: 'Retomar trabalho', status: 'in_progress', color: '#fbbf24' });
    if (service.status === 'completed') statusActions.push({ label: 'Fechar', status: 'closed', color: '#adaaaa' });
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#adaaaa' }}>arrow_back</span>
        </button>
        <div style={{ flex: 1 }}>
          <div className="font-headline font-bold" style={{ fontSize: '15px', color: 'white' }}>{service.title}</div>
          <div style={{ fontSize: '10px', color: '#777575' }}>{service.bike_name} · {new Date(service.created_at).toLocaleDateString('pt-PT')}</div>
        </div>
        <span style={{ fontSize: '9px', padding: '3px 8px', backgroundColor: `${statusColor}20`, color: statusColor, fontWeight: 700, borderRadius: '3px' }}>
          {SERVICE_STATUS_LABELS[service.status]}
        </span>
      </div>

      {/* Info card */}
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <InfoRow label="Tipo" value={SERVICE_TYPE_LABELS[service.request_type]} />
        <InfoRow label="Urgência" value={URGENCY_LABELS[service.urgency]} color={URGENCY_COLORS[service.urgency]} />
        {service.description && <InfoRow label="Descrição" value={service.description} />}
        {service.scheduled_date && <InfoRow label="Data agendada" value={new Date(service.scheduled_date).toLocaleDateString('pt-PT')} />}
        {service.bike_odo_km && <InfoRow label="Odómetro" value={`${service.bike_odo_km} km`} />}
      </div>

      {/* Cost summary */}
      {service.total_cost > 0 && (
        <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '6px' }}>Custos</div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div><span style={{ fontSize: '9px', color: '#777575' }}>Peças</span><div style={{ fontSize: '14px', color: '#6e9bff', fontWeight: 700 }}>{service.total_parts_cost.toFixed(2)}€</div></div>
            <div><span style={{ fontSize: '9px', color: '#777575' }}>Mão-de-obra</span><div style={{ fontSize: '14px', color: '#e966ff', fontWeight: 700 }}>{service.total_labor_cost.toFixed(2)}€</div></div>
            <div><span style={{ fontSize: '9px', color: '#777575' }}>Total</span><div style={{ fontSize: '14px', color: '#ff9f43', fontWeight: 700 }}>{service.total_cost.toFixed(2)}€</div></div>
          </div>
        </div>
      )}

      {/* Items */}
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', color: '#777575' }}>Itens ({items.length})</span>
          <button onClick={() => setShowAddItem(!showAddItem)} style={{ fontSize: '9px', color: '#ff9f43', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
            + Adicionar
          </button>
        </div>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} isRider={isRider}
            onApprove={() => { approveItem(item.id, userId!); load(); }}
            onReject={() => { rejectItem(item.id, userId!); load(); }}
            onDelete={() => { deleteServiceItem(item.id); load(); }}
          />
        ))}
        {showAddItem && (
          <QuickAddItem serviceId={service.id} onAdded={() => { setShowAddItem(false); load(); }} />
        )}
      </div>

      {/* Pending approvals */}
      {pendingApproval.length > 0 && (
        <div style={{ backgroundColor: 'rgba(233,102,255,0.05)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(233,102,255,0.2)' }}>
          <div style={{ fontSize: '11px', color: '#e966ff', fontWeight: 700, marginBottom: '6px' }}>
            Aguarda a tua aprovação ({pendingApproval.length})
          </div>
          {pendingApproval.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 0' }}>
              <span style={{ flex: 1, fontSize: '11px', color: 'white' }}>{item.description ?? `${item.brand} ${item.model}`}</span>
              <span style={{ fontSize: '11px', color: '#ff9f43' }}>{item.total_cost > 0 ? `${item.total_cost.toFixed(2)}€` : ''}</span>
              <button onClick={() => { approveItem(item.id, userId!); load(); }} style={{ padding: '3px 8px', fontSize: '9px', fontWeight: 700, backgroundColor: '#3fff8b', color: 'black', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Aprovar</button>
              <button onClick={() => { rejectItem(item.id, userId!); load(); }} style={{ padding: '3px 8px', fontSize: '9px', fontWeight: 700, backgroundColor: 'rgba(255,113,108,0.15)', color: '#ff716c', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Rejeitar</button>
            </div>
          ))}
        </div>
      )}

      {/* Photos */}
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', color: '#777575' }}>Fotos ({photos.length})</span>
          <button onClick={() => setShowPhotoUpload(!showPhotoUpload)} style={{ fontSize: '9px', color: '#ff9f43', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
            {showPhotoUpload ? 'Fechar' : '+ Foto'}
          </button>
        </div>
        <PhotoGrid photos={photos} />
        {showPhotoUpload && (
          <PhotoUploader
            serviceId={serviceId}
            bikeName={service.bike_name ?? (`${service.bike_brand ?? ''} ${service.bike_model ?? ''}`.trim() || undefined)}
            onUploaded={() => { setShowPhotoUpload(false); load(); }}
          />
        )}
      </div>

      {/* Service note */}
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', color: '#ff9f43', fontWeight: 700 }}>Nota de Serviço</span>
          <button onClick={() => editNote ? handleSaveNote() : setEditNote(true)} style={{ fontSize: '9px', color: '#ff9f43', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
            {editNote ? 'Guardar' : 'Editar'}
          </button>
        </div>
        {editNote ? (
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4}
            placeholder="Notas sobre o serviço, observações do mecânico, recomendações..."
            style={{ width: '100%', padding: '8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(255,159,67,0.2)', borderRadius: '4px', color: 'white', fontSize: '11px', outline: 'none', resize: 'vertical' }} />
        ) : (
          <div style={{ fontSize: '11px', color: service.service_note ? '#adaaaa' : '#494847', lineHeight: '1.4' }}>
            {service.service_note || 'Sem notas.'}
          </div>
        )}
      </div>

      {/* Comments thread */}
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px' }}>
        <div style={{ fontSize: '10px', color: '#777575', marginBottom: '6px' }}>Comunicação ({comments.length})</div>
        {comments.length === 0 && <div style={{ fontSize: '10px', color: '#494847' }}>Sem mensagens.</div>}
        {comments.map((c) => (
          <div key={c.id} style={{
            padding: '6px 8px', marginBottom: '4px', borderRadius: '4px',
            backgroundColor: c.author_role === 'rider' ? 'rgba(63,255,139,0.04)' : c.author_role === 'system' ? 'rgba(73,72,71,0.1)' : 'rgba(110,155,255,0.04)',
            borderLeft: `2px solid ${c.author_role === 'rider' ? '#3fff8b' : c.author_role === 'system' ? '#494847' : '#6e9bff'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '9px', color: c.author_role === 'rider' ? '#3fff8b' : c.author_role === 'system' ? '#494847' : '#6e9bff', fontWeight: 700 }}>
                {c.author_role === 'rider' ? 'Tu' : c.author_role === 'system' ? 'Sistema' : 'Mecânico'}
              </span>
              <span style={{ fontSize: '8px', color: '#494847' }}>{new Date(c.created_at).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#adaaaa', marginTop: '2px' }}>{c.body}</div>
          </div>
        ))}
        {/* Add comment */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
          <input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }}
            placeholder="Escreve uma mensagem..."
            style={{ flex: 1, padding: '8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.2)', borderRadius: '4px', color: 'white', fontSize: '11px', outline: 'none' }} />
          <button onClick={handleAddComment} disabled={!newComment.trim()}
            style={{ padding: '0 12px', backgroundColor: 'rgba(255,159,67,0.15)', color: '#ff9f43', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
          </button>
        </div>
      </div>

      {/* Status actions */}
      {statusActions.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {statusActions.map((a) => (
            <button key={a.status} onClick={() => handleStatusChange(a.status)}
              style={{
                flex: 1, padding: '10px', borderRadius: '4px', fontSize: '12px', fontWeight: 700,
                backgroundColor: `${a.color}15`, color: a.color, border: `1px solid ${a.color}30`, cursor: 'pointer',
                minWidth: '100px',
              }}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Rating (after completed) */}
      {service.shop_id && (service.status === 'completed' || service.status === 'closed') && (
        <RatingWidget serviceId={service.id} shopId={service.shop_id} userId={userId!} />
      )}

      {/* Delete */}
      {(service.status === 'draft' || service.status === 'cancelled') && (
        <button onClick={handleDelete} style={{ width: '100%', padding: '10px', backgroundColor: 'rgba(255,113,108,0.1)', border: '1px solid rgba(255,113,108,0.2)', borderRadius: '4px', color: '#ff716c', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
          Apagar serviço
        </button>
      )}
    </div>
  );
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ fontSize: '11px', color: '#777575' }}>{label}</span>
      <span style={{ fontSize: '11px', color: color ?? 'white', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function ItemRow({ item, isRider, onApprove, onReject, onDelete }: {
  item: ServiceItem; isRider: boolean;
  onApprove: () => void; onReject: () => void; onDelete: () => void;
}) {
  const statusColors: Record<string, string> = { pending: '#fbbf24', approved: '#3fff8b', rejected: '#ff716c', done: '#3fff8b', warranty: '#e966ff' };
  const desc = item.description ?? [item.brand, item.model].filter(Boolean).join(' ') ?? 'Item';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 0', borderBottom: '1px solid rgba(73,72,71,0.1)' }}>
      <span className="material-symbols-outlined" style={{ fontSize: '14px', color: item.item_type === 'labor' ? '#e966ff' : '#6e9bff' }}>
        {item.item_type === 'labor' ? 'engineering' : item.item_type === 'consumable' ? 'water_drop' : 'settings'}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '11px', color: 'white' }}>{desc}</div>
        {item.replaced_component && <div style={{ fontSize: '9px', color: '#494847' }}>Substituiu: {item.replaced_component}</div>}
      </div>
      <span style={{ fontSize: '10px', color: '#ff9f43', fontWeight: 600 }}>{item.total_cost > 0 ? `${item.total_cost.toFixed(2)}€` : ''}</span>
      <span style={{ fontSize: '8px', padding: '2px 5px', backgroundColor: `${statusColors[item.status] ?? '#494847'}15`, color: statusColors[item.status] ?? '#494847', borderRadius: '2px', fontWeight: 700 }}>
        {item.status}
      </span>
      {item.needs_approval && item.status === 'pending' && isRider && (
        <>
          <button onClick={onApprove} style={{ padding: '2px 6px', fontSize: '8px', backgroundColor: '#3fff8b', color: 'black', border: 'none', borderRadius: '2px', cursor: 'pointer', fontWeight: 700 }}>OK</button>
          <button onClick={onReject} style={{ padding: '2px 6px', fontSize: '8px', backgroundColor: 'rgba(255,113,108,0.15)', color: '#ff716c', border: 'none', borderRadius: '2px', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </>
      )}
      <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '12px', color: '#494847' }}>delete</span>
      </button>
    </div>
  );
}

function QuickAddItem({ serviceId, onAdded }: { serviceId: string; onAdded: () => void }) {
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState(0);
  const [type, setType] = useState<'part' | 'labor' | 'consumable'>('part');
  const guard = useReadOnlyGuard();

  const save = async () => {
    if (!desc.trim()) return;
    if (!guard('Não é possível adicionar itens em modo impersonation.')) return;
    await addServiceItem({ service_id: serviceId, item_type: type, description: desc.trim(), quantity: 1, unit_cost: cost, total_cost: cost });
    onAdded();
  };

  return (
    <div style={{ padding: '8px', backgroundColor: '#0e0e0e', borderRadius: '4px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        {(['part', 'labor', 'consumable'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} style={{
            padding: '3px 8px', fontSize: '9px', fontWeight: 700, borderRadius: '3px', cursor: 'pointer',
            backgroundColor: type === t ? 'rgba(255,159,67,0.2)' : 'rgba(73,72,71,0.15)',
            color: type === t ? '#ff9f43' : '#777575', border: 'none',
          }}>
            {t === 'part' ? 'Peça' : t === 'labor' ? 'Trabalho' : 'Consumível'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição..."
          style={{ flex: 1, padding: '6px 8px', backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.2)', borderRadius: '3px', color: 'white', fontSize: '11px', outline: 'none' }} />
        <input type="number" value={cost || ''} onChange={(e) => setCost(parseFloat(e.target.value) || 0)} placeholder="€"
          style={{ width: '60px', padding: '6px', backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.2)', borderRadius: '3px', color: '#ff9f43', fontSize: '11px', outline: 'none', textAlign: 'right' }} />
        <button onClick={save} style={{ padding: '0 10px', backgroundColor: '#ff9f43', color: 'black', border: 'none', borderRadius: '3px', fontWeight: 700, cursor: 'pointer' }}>+</button>
      </div>
    </div>
  );
}

// ── Rating Widget ───────────────────────────────────────────

function RatingWidget({ serviceId, shopId, userId }: { serviceId: string; shopId: string; userId: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [existing, setExisting] = useState(false);

  useEffect(() => {
    supaGet<Array<{ rating: number; comment: string | null }>>(
      `/rest/v1/shop_reviews?service_id=eq.${serviceId}&user_id=eq.${userId}`,
    ).then((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setRating(data[0]!.rating);
        setComment(data[0]!.comment ?? '');
        setExisting(true);
      }
    }).catch(() => {});
  }, [serviceId, userId]);

  const handleSubmit = async () => {
    if (rating === 0) return;
    await supaFetch('/rest/v1/shop_reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ shop_id: shopId, service_id: serviceId, user_id: userId, rating, comment: comment || null }),
    });
    setSubmitted(true);
  };

  if (submitted || existing) {
    return (
      <div style={{ padding: '10px', backgroundColor: '#131313', borderRadius: '6px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginBottom: '4px' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="material-symbols-outlined" style={{ fontSize: '18px', color: n <= rating ? '#fbbf24' : '#494847', fontVariationSettings: n <= rating ? "'FILL' 1" : undefined }}>star</span>
          ))}
        </div>
        <div style={{ fontSize: '9px', color: '#777575' }}>{existing ? 'Avaliação guardada' : 'Obrigado pela avaliação!'}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px', backgroundColor: '#131313', borderRadius: '6px' }}>
      <div style={{ fontSize: '10px', color: '#fbbf24', fontWeight: 700, marginBottom: '6px' }}>Avaliar oficina</div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '8px' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '28px', color: n <= rating ? '#fbbf24' : '#494847', fontVariationSettings: n <= rating ? "'FILL' 1" : undefined }}>star</span>
          </button>
        ))}
      </div>
      <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comentário (opcional)"
        style={{ width: '100%', padding: '8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.2)', borderRadius: '4px', color: 'white', fontSize: '11px', outline: 'none', marginBottom: '6px' }} />
      <button onClick={handleSubmit} disabled={rating === 0} style={{
        width: '100%', padding: '10px', backgroundColor: rating > 0 ? '#fbbf24' : 'rgba(73,72,71,0.2)',
        color: rating > 0 ? 'black' : '#777575', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
      }}>
        Enviar avaliação
      </button>
    </div>
  );
}
