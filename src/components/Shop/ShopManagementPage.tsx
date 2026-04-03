import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useServiceStore } from '../../store/serviceStore';
import {
  getShopById, createShop, updateShop, getShopMembers, addShopMember,
  getUserShopMembership, getServicesForShop,
} from '../../services/maintenance/MaintenanceService';
import {
  getShopServices, seedShopDefaults,
  getCalendarSlots,
  getShopAvailability, createCalendarShare, getCalendarShares,
  type ShopServiceTemplate,
} from '../../services/maintenance/ShopService';
import type { Shop, ShopMember, ServiceRequest } from '../../types/service.types';

type Tab = 'dashboard' | 'profile' | 'services' | 'staff' | 'calendar' | 'share';

export function ShopManagementPage() {
  const userId = useAuthStore((s) => s.user?.id);
  const userEmail = useAuthStore((s) => s.user?.email);
  const { shop, shopMembership, setShop } = useServiceStore();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      const membership = await getUserShopMembership(userId);
      if (membership) {
        const s = await getShopById(membership.shop_id);
        setShop(s, membership);
      }
      setLoading(false);
    })();
  }, [userId, setShop]);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" /></div>;
  }

  // No shop yet — create one
  if (!shop) {
    return <CreateShopForm userId={userId!} email={userEmail!} onCreated={() => window.location.reload()} />;
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'services', label: 'Serviços', icon: 'receipt_long' },
    { id: 'calendar', label: 'Calendário', icon: 'calendar_month' },
    { id: 'staff', label: 'Equipa', icon: 'group' },
    { id: 'profile', label: 'Perfil', icon: 'store' },
    { id: 'share', label: 'Partilha', icon: 'share' },
  ];

  return (
    <div className="space-y-3">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '24px', color: '#ff9f43' }}>store</span>
        <div>
          <div className="font-headline font-bold" style={{ fontSize: '16px', color: '#ff9f43' }}>{shop.name}</div>
          <div style={{ fontSize: '10px', color: '#777575' }}>Gestão de oficina · {shopMembership?.role}</div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '2px', overflowX: 'auto' }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 12px', fontSize: '10px', fontWeight: 700, borderRadius: '4px', cursor: 'pointer',
            backgroundColor: tab === t.id ? 'rgba(255,159,67,0.15)' : 'rgba(73,72,71,0.1)',
            color: tab === t.id ? '#ff9f43' : '#777575', border: 'none', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <ShopDashboard shopId={shop.id} />}
      {tab === 'services' && <ShopServicesTab shopId={shop.id} />}
      {tab === 'calendar' && <ShopCalendarTab shopId={shop.id} />}
      {tab === 'staff' && <ShopStaffTab shopId={shop.id} />}
      {tab === 'profile' && <ShopProfileTab shop={shop} />}
      {tab === 'share' && <ShopShareTab shopId={shop.id} />}
    </div>
  );
}

// ── Create Shop Form ────────────────────────────────────────

function CreateShopForm({ userId, email, onCreated }: { userId: string; email: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const shop = await createShop({
      name: name.trim(), city: city.trim(), phone: phone.trim(),
      email, created_by: userId,
    });
    if (shop) {
      await addShopMember({ shop_id: shop.id, user_id: userId, role: 'owner', display_name: name.trim() });
      await seedShopDefaults(shop.id);
      onCreated();
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="font-headline font-bold" style={{ fontSize: '16px', color: '#ff9f43' }}>Criar Oficina</div>
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Field label="Nome da oficina *" value={name} onChange={setName} placeholder="Ex: Bike Lab Lisboa" />
        <Field label="Cidade" value={city} onChange={setCity} placeholder="Lisboa" />
        <Field label="Telefone" value={phone} onChange={setPhone} placeholder="+351 912 345 678" />
        <button onClick={handleCreate} disabled={!name.trim() || saving} style={{
          padding: '12px', backgroundColor: '#ff9f43', color: 'black', border: 'none', borderRadius: '4px',
          fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: !name.trim() || saving ? 0.5 : 1,
        }}>
          {saving ? 'A criar...' : 'Criar Oficina'}
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ───────────────────────────────────────────────

function ShopDashboard({ shopId }: { shopId: string }) {
  const [services, setServices] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getServicesForShop(shopId).then((data) => { setServices(data); setLoading(false); });
  }, [shopId]);

  if (loading) return <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" /></div>;

  const pending = services.filter((s) => s.status === 'requested');
  const active = services.filter((s) => ['accepted', 'in_progress', 'pending_approval'].includes(s.status));
  const completed = services.filter((s) => ['completed', 'closed'].includes(s.status));

  return (
    <div className="space-y-3">
      <div style={{ display: 'flex', gap: '8px' }}>
        <StatBox label="Pendentes" value={String(pending.length)} color="#fbbf24" />
        <StatBox label="Em curso" value={String(active.length)} color="#6e9bff" />
        <StatBox label="Concluídos" value={String(completed.length)} color="#3fff8b" />
        <StatBox label="Total" value={String(services.length)} color="#ff9f43" />
      </div>

      {pending.length > 0 && (
        <div>
          <div style={{ fontSize: '10px', color: '#fbbf24', fontWeight: 700, marginBottom: '4px' }}>Pedidos pendentes</div>
          {pending.map((s) => <MiniServiceCard key={s.id} service={s} />)}
        </div>
      )}
      {active.length > 0 && (
        <div>
          <div style={{ fontSize: '10px', color: '#6e9bff', fontWeight: 700, marginBottom: '4px' }}>Em curso</div>
          {active.map((s) => <MiniServiceCard key={s.id} service={s} />)}
        </div>
      )}
    </div>
  );
}

// ── Services/Prices Tab ─────────────────────────────────────

function ShopServicesTab({ shopId }: { shopId: string }) {
  const [services, setServices] = useState<ShopServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getShopServices(shopId).then((data) => { setServices(data); setLoading(false); });
  }, [shopId]);

  if (loading) return <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" /></div>;

  const categories = [...new Set(services.map((s) => s.category))];
  const catLabels: Record<string, string> = {
    wash: 'Lavagem', drivetrain: 'Transmissão', brakes: 'Travões', wheels: 'Rodas',
    suspension: 'Suspensão', ebike: 'E-Bike', frame: 'Quadro/Cockpit', fit: 'Bike Fit',
    full_service: 'Revisões', other: 'Outros',
  };

  return (
    <div className="space-y-3">
      <div style={{ fontSize: '10px', color: '#777575' }}>Tabela de preços ({services.length} serviços)</div>
      {categories.map((cat) => (
        <div key={cat}>
          <div style={{ fontSize: '10px', color: '#ff9f43', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
            {catLabels[cat] ?? cat}
          </div>
          {services.filter((s) => s.category === cat).map((svc) => (
            <div key={svc.id} style={{ padding: '8px', backgroundColor: '#131313', borderRadius: '4px', marginBottom: '3px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', color: 'white', fontWeight: 600 }}>{svc.name}</div>
                  {svc.description && <div style={{ fontSize: '9px', color: '#494847' }}>{svc.description}</div>}
                </div>
                <div style={{ textAlign: 'right', fontSize: '10px' }}>
                  {svc.pricing_type === 'hourly' ? (
                    <span style={{ color: '#e966ff' }}>Preço/hora</span>
                  ) : svc.pricing_type === 'quote' ? (
                    <span style={{ color: '#777575' }}>Orçamento</span>
                  ) : (
                    <div>
                      {svc.price_mtb && <div><span style={{ color: '#777575' }}>MTB</span> <span style={{ color: '#ff9f43' }}>{svc.price_mtb}€</span></div>}
                      {svc.price_ebike && <div><span style={{ color: '#777575' }}>E-Bike</span> <span style={{ color: '#3fff8b' }}>{svc.price_ebike}€</span></div>}
                      {svc.price_road && <div><span style={{ color: '#777575' }}>Road</span> <span style={{ color: '#6e9bff' }}>{svc.price_road}€</span></div>}
                    </div>
                  )}
                </div>
              </div>
              {svc.estimated_minutes && (
                <div style={{ fontSize: '8px', color: '#494847', marginTop: '2px' }}>
                  ⏱ ~{svc.estimated_minutes}min
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Calendar Tab ────────────────────────────────────────────

function ShopCalendarTab({ shopId }: { shopId: string }) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]!);
  const [slots, setSlots] = useState<Array<{ id: string; start_time: string; end_time: string; title: string; status: string; bike_name: string | null; rider_name: string | null; duration_min: number }>>([]);
  const [avail, setAvail] = useState<{ total_min: number; booked_min: number; free_min: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [s, a] = await Promise.all([
        getCalendarSlots(shopId, date),
        getShopAvailability(shopId, date),
      ]);
      setSlots(s);
      setAvail(a);
      setLoading(false);
    })();
  }, [shopId, date]);

  return (
    <div className="space-y-3">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{
        width: '100%', padding: '8px', backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.3)',
        borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none',
      }} />

      {/* Availability bar */}
      {avail && (
        <div style={{ backgroundColor: '#131313', padding: '10px', borderRadius: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#777575', marginBottom: '4px' }}>
            <span>Disponibilidade {new Date(date).toLocaleDateString('pt-PT', { weekday: 'long' })}</span>
            <span style={{ color: avail.free_min > 0 ? '#3fff8b' : '#ff716c' }}>
              {Math.floor(avail.free_min / 60)}h{avail.free_min % 60 > 0 ? `${avail.free_min % 60}m` : ''} livres
            </span>
          </div>
          <div style={{ height: '8px', backgroundColor: 'rgba(73,72,71,0.2)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '4px',
              width: avail.total_min > 0 ? `${(avail.booked_min / avail.total_min) * 100}%` : '0%',
              backgroundColor: avail.booked_min / avail.total_min > 0.9 ? '#ff716c' : avail.booked_min / avail.total_min > 0.7 ? '#fbbf24' : '#3fff8b',
            }} />
          </div>
          <div style={{ fontSize: '9px', color: '#494847', marginTop: '2px' }}>
            {Math.floor(avail.booked_min / 60)}h{avail.booked_min % 60 > 0 ? `${avail.booked_min % 60}m` : ''} ocupados de {Math.floor(avail.total_min / 60)}h
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-4 h-4 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" /></div>
      ) : slots.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#131313', borderRadius: '6px', fontSize: '11px', color: '#494847' }}>
          Sem marcações para este dia.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {slots.map((slot) => (
            <div key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', backgroundColor: '#131313', borderRadius: '4px', borderLeft: '3px solid #ff9f43' }}>
              <div style={{ fontSize: '11px', color: '#ff9f43', fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: 'white' }}>{slot.title}</div>
                <div style={{ fontSize: '9px', color: '#777575' }}>
                  {slot.rider_name ?? ''} {slot.bike_name ? `· ${slot.bike_name}` : ''} · {slot.duration_min}min
                </div>
              </div>
              <span style={{ fontSize: '8px', padding: '2px 5px', backgroundColor: 'rgba(255,159,67,0.1)', color: '#ff9f43', borderRadius: '2px', fontWeight: 700 }}>
                {slot.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Staff Tab ───────────────────────────────────────────────

function ShopStaffTab({ shopId }: { shopId: string }) {
  const [members, setMembers] = useState<ShopMember[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'mechanic' | 'manager'>('mechanic');

  useEffect(() => {
    getShopMembers(shopId).then(setMembers);
  }, [shopId]);

  const handleAdd = async () => {
    if (!newEmail.trim()) return;
    // In a real system, we'd look up user by email. For now, use email as placeholder user_id
    await addShopMember({ shop_id: shopId, user_id: newEmail.trim(), role: newRole, display_name: newEmail.split('@')[0] });
    setNewEmail('');
    const data = await getShopMembers(shopId);
    setMembers(data);
  };

  const roleLabels: Record<string, string> = { owner: 'Dono', manager: 'Gestor', mechanic: 'Mecânico' };
  const roleColors: Record<string, string> = { owner: '#ff9f43', manager: '#e966ff', mechanic: '#6e9bff' };

  return (
    <div className="space-y-3">
      <div style={{ fontSize: '10px', color: '#777575' }}>Equipa ({members.length})</div>

      {members.map((m) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#131313', borderRadius: '4px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: roleColors[m.role] ?? '#777575' }}>person</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', color: 'white' }}>{m.display_name ?? m.user_id}</div>
            {m.specialties?.length > 0 && (
              <div style={{ fontSize: '9px', color: '#494847' }}>{m.specialties.join(', ')}</div>
            )}
          </div>
          <span style={{ fontSize: '9px', padding: '2px 6px', backgroundColor: `${roleColors[m.role]}20`, color: roleColors[m.role], borderRadius: '3px', fontWeight: 700 }}>
            {roleLabels[m.role]}
          </span>
        </div>
      ))}

      <div style={{ backgroundColor: '#131313', padding: '10px', borderRadius: '6px' }}>
        <div style={{ fontSize: '10px', color: '#777575', marginBottom: '6px' }}>Adicionar membro</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email do utilizador KROMI"
            style={{ flex: 1, padding: '8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '11px', outline: 'none' }} />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'mechanic' | 'manager')}
            style={{ padding: '8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '11px', outline: 'none' }}>
            <option value="mechanic">Mecânico</option>
            <option value="manager">Gestor</option>
          </select>
          <button onClick={handleAdd} style={{ padding: '0 12px', backgroundColor: '#ff9f43', color: 'black', border: 'none', borderRadius: '4px', fontWeight: 700, cursor: 'pointer' }}>+</button>
        </div>
      </div>
    </div>
  );
}

// ── Profile Tab ─────────────────────────────────────────────

function ShopProfileTab({ shop }: { shop: Shop }) {
  const [name, setName] = useState(shop.name);
  const [city, setCity] = useState(shop.city ?? '');
  const [address, setAddress] = useState(shop.address ?? '');
  const [phone, setPhone] = useState(shop.phone ?? '');
  const [email, setEmail] = useState(shop.email ?? '');
  const [website, setWebsite] = useState(shop.website ?? '');
  const [description, setDescription] = useState(shop.description ?? '');
  const [hourlyRate, setHourlyRate] = useState((shop as unknown as Record<string, unknown>).hourly_rate as number ?? 25);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await updateShop(shop.id, {
      name, city, address, phone, email, website, description,
    } as Partial<Shop>);
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Field label="Nome" value={name} onChange={setName} />
        <Field label="Cidade" value={city} onChange={setCity} />
        <Field label="Morada" value={address} onChange={setAddress} />
        <Field label="Telefone" value={phone} onChange={setPhone} />
        <Field label="Email" value={email} onChange={setEmail} />
        <Field label="Website" value={website} onChange={setWebsite} />
        <div>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>Descrição</div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            style={{ width: '100%', padding: '8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '11px', outline: 'none', resize: 'vertical' }} />
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>Preço/hora (€)</div>
          <input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(parseFloat(e.target.value) || 0)} step={0.5}
            style={{ width: '100px', padding: '8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: '#ff9f43', fontSize: '13px', outline: 'none', textAlign: 'right' }} />
        </div>
        <button onClick={handleSave} disabled={saving} style={{
          padding: '10px', backgroundColor: '#ff9f43', color: 'black', border: 'none', borderRadius: '4px',
          fontSize: '12px', fontWeight: 700, cursor: 'pointer',
        }}>
          {saving ? 'A guardar...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

// ── Share Tab ────────────────────────────────────────────────

function ShopShareTab({ shopId }: { shopId: string }) {
  const userId = useAuthStore((s) => s.user?.id);
  const [shares, setShares] = useState<Array<{ id: string; token: string; label: string | null; permissions: string; active: boolean }>>([]);
  const [newLabel, setNewLabel] = useState('Link para equipa');

  useEffect(() => {
    getCalendarShares(shopId).then(setShares);
  }, [shopId]);

  const handleCreate = async () => {
    if (!userId) return;
    await createCalendarShare(shopId, userId, newLabel);
    const data = await getCalendarShares(shopId);
    setShares(data);
  };

  const baseUrl = window.location.origin;

  return (
    <div className="space-y-3">
      <div style={{ fontSize: '10px', color: '#777575' }}>Links de partilha do calendário</div>

      {shares.map((s) => (
        <div key={s.id} style={{ padding: '10px', backgroundColor: '#131313', borderRadius: '6px' }}>
          <div style={{ fontSize: '11px', color: 'white', fontWeight: 600 }}>{s.label ?? 'Link partilhado'}</div>
          <div style={{ fontSize: '9px', color: '#494847', marginTop: '2px', wordBreak: 'break-all' }}>
            {baseUrl}/shop/calendar/{s.token}
          </div>
          <button onClick={() => navigator.clipboard.writeText(`${baseUrl}/shop/calendar/${s.token}`)}
            style={{ marginTop: '4px', fontSize: '9px', color: '#ff9f43', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
            Copiar link
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '4px' }}>
        <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Nome do link"
          style={{ flex: 1, padding: '8px', backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '11px', outline: 'none' }} />
        <button onClick={handleCreate} style={{ padding: '8px 14px', backgroundColor: '#ff9f43', color: 'black', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
          Criar link
        </button>
      </div>
    </div>
  );
}

// ── Shared Components ───────────────────────────────────────

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, padding: '8px', backgroundColor: '#131313', borderRadius: '4px', textAlign: 'center' }}>
      <div className="font-headline font-bold tabular-nums" style={{ fontSize: '16px', color }}>{value}</div>
      <div style={{ fontSize: '8px', color: '#777575' }}>{label}</div>
    </div>
  );
}

function MiniServiceCard({ service }: { service: ServiceRequest }) {
  return (
    <div style={{ padding: '8px', backgroundColor: '#131313', borderRadius: '4px', marginBottom: '3px' }}>
      <div style={{ fontSize: '11px', color: 'white' }}>{service.title}</div>
      <div style={{ fontSize: '9px', color: '#777575' }}>
        {service.bike_name} · {new Date(service.created_at).toLocaleDateString('pt-PT')}
        {service.total_cost > 0 && <span style={{ color: '#ff9f43' }}> · {service.total_cost.toFixed(2)}€</span>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>{label}</div>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none' }} />
    </div>
  );
}
