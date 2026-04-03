import { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { calculateZones, calculatePowerZones } from '../../types/athlete.types';
import { useBikeStore } from '../../store/bikeStore';
import { useAuthStore } from '../../store/authStore';
import { useLearningStore } from '../../store/learningStore';
import { connectBike, disconnectBike } from '../../services/bluetooth/BLEBridge';
import { ProfileInsightsWidget } from '../Dashboard/ProfileInsightsWidget';
import { BikeFitPage } from './BikeFitPage';
import { BikesPage } from './BikesPage';
import { ServiceBookPage } from '../ServiceBook/ServiceBookPage';
import { ShopManagementPage } from '../Shop/ShopManagementPage';
// TuningPreview removed — config is now read-only from motor telemetry
import { importKomootRoute } from '../../services/maps/KomootService';

type Screen = 'dashboard' | 'map' | 'climb' | 'connections' | 'settings' | 'history';
type SettingsPage = 'menu' | 'rider' | 'personal' | 'physical' | 'zones' | 'medical' | 'bikefit' | 'club' | 'bike' | 'kromi' | 'bluetooth' | 'routes' | 'account' | 'service-book' | 'shop';

// ── Grouped menu matching desktop 9-category sidebar ────────
interface MenuCategory {
  label: string;
  icon: string;
  color: string;
  items: { id: SettingsPage; icon: string; label: string; desc: string }[];
  /** Navigate to a different screen instead of opening sub-items */
  navigateTo?: Screen;
}

const MENU_CATEGORIES: MenuCategory[] = [
  { label: 'Perfil', icon: 'person', color: '#ff716c', items: [
    { id: 'personal', icon: 'badge', label: 'Dados Pessoais', desc: 'Nome, nascimento, género, clube, foto' },
    { id: 'physical', icon: 'monitor_heart', label: 'Perfil Físico', desc: 'Peso, altura, VO2max, FTP, SpO2' },
    { id: 'medical', icon: 'health_and_safety', label: 'Médico + Objectivos', desc: 'Condições, objectivos, perfil atleta' },
  ]},
  { label: 'Treino', icon: 'show_chart', color: '#fbbf24', items: [
    { id: 'zones', icon: 'show_chart', label: 'Zonas HR + Potência', desc: 'Zonas cardíacas e de potência editáveis' },
    { id: 'kromi', icon: 'psychology', label: 'KROMI Intelligence', desc: 'Auto-assist, aprendizagem' },
  ]},
  { label: 'Bicicletas', icon: 'pedal_bike', color: '#3fff8b', items: [
    { id: 'bike', icon: 'pedal_bike', label: 'As minhas bikes', desc: 'Bateria, motor, consumo, hardware' },
    { id: 'bikefit', icon: 'straighten', label: 'Bike Fit', desc: '25 medidas, por bike, com histórico' },
  ]},
  { label: 'Manutenção', icon: 'build', color: '#ff9f43', items: [
    { id: 'service-book', icon: 'menu_book', label: 'Caderneta de Serviço', desc: 'Histórico, custos, manutenção programada' },
  ]},
  { label: 'Clube', icon: 'groups', color: '#fbbf24', items: [
    { id: 'club', icon: 'groups', label: 'O meu clube', desc: 'Gerir clube, membros, rides em grupo' },
  ]},
  { label: 'Dispositivos', icon: 'bluetooth', color: '#6e9bff', items: [
    { id: 'bluetooth', icon: 'bluetooth', label: 'BLE + Sensores', desc: 'Ligação, sensores, estado' },
  ]},
  { label: 'Atividades', icon: 'timeline', color: '#e966ff', items: [], navigateTo: 'history' },
  { label: 'Mapa', icon: 'map', color: '#6e9bff', items: [], navigateTo: 'map' },
  { label: 'Oficina', icon: 'store', color: '#ff9f43', items: [
    { id: 'shop', icon: 'store', label: 'Gestão de Oficina', desc: 'Serviços, preços, calendário, equipa' },
  ]},
  { label: 'Sistema', icon: 'settings', color: '#adaaaa', items: [
    { id: 'routes', icon: 'route', label: 'Rotas', desc: 'Import Komoot, histórico' },
    { id: 'account', icon: 'account_circle', label: 'Conta', desc: 'Email, sessão, versão' },
  ]},
];

// Flat lookup for back-header label
const ALL_MENU_ITEMS = MENU_CATEGORIES.flatMap((c) => c.items);

export function Settings({ onNavigate, initialPage }: { onNavigate?: (screen: Screen) => void; initialPage?: SettingsPage }) {
  const [page, setPage] = useState<SettingsPage>(initialPage ?? 'menu');

  // Sync with external initialPage changes (desktop sidebar navigation)
  const prevInitial = useState(initialPage)[0];
  if (initialPage && initialPage !== 'menu' && initialPage !== prevInitial) {
    // Direct to sub-page without showing menu
  }

  if (page === 'menu' && !initialPage) return <SettingsMenu onSelect={setPage} onNavigate={onNavigate} />;

  const activePage = (initialPage && initialPage !== 'menu') ? initialPage : page;

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#0e0e0e' }}>
      {/* Back header — only on mobile (when no initialPage from desktop sidebar) */}
      {!initialPage && (
        <div style={{ height: '48px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', backgroundColor: '#131313', borderBottom: '1px solid rgba(73,72,71,0.2)' }}>
          <button onClick={() => setPage('menu')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '24px', color: '#adaaaa' }}>arrow_back</span>
          </button>
          <span className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b' }}>
            {ALL_MENU_ITEMS.find((m) => m.id === activePage)?.label ?? 'Settings'}
          </span>
        </div>
      )}
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {activePage === 'rider' && <RiderPage />}
        {activePage === 'personal' && <PersonalPage />}
        {activePage === 'physical' && <PhysicalPage />}
        {activePage === 'zones' && <ZonesPage />}
        {activePage === 'medical' && <MedicalPage />}
        {activePage === 'bikefit' && <BikeFitSection />}
        {activePage === 'club' && <ClubPage />}
        {activePage === 'bike' && <BikesPage />}
        {activePage === 'service-book' && <ServiceBookPage />}
        {activePage === 'shop' && <ShopManagementPage />}
        {activePage === 'kromi' && <KromiPage />}
        {activePage === 'bluetooth' && <BluetoothPage />}
        {activePage === 'routes' && <RoutesPage onNavigate={onNavigate} />}
        {activePage === 'account' && <AccountPage />}
      </div>
    </div>
  );
}

function SettingsMenu({ onSelect, onNavigate }: { onSelect: (p: SettingsPage) => void; onNavigate?: (s: Screen) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div style={{ padding: '12px', backgroundColor: '#0e0e0e', minHeight: '100%' }}>
      <h1 className="font-headline font-bold" style={{ fontSize: '22px', color: '#3fff8b', marginBottom: '16px', paddingLeft: '4px' }}>Setup</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {MENU_CATEGORIES.map((cat) => {
          // Direct navigation (Atividades, Mapa) — no sub-items
          if (cat.navigateTo && onNavigate) {
            return (
              <button
                key={cat.label}
                onClick={() => onNavigate(cat.navigateTo!)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 12px',
                  backgroundColor: '#131313', border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderLeft: `3px solid ${cat.color}`, width: '100%',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: cat.color }}>{cat.icon}</span>
                <span className="font-headline font-bold" style={{ fontSize: '14px', color: 'white', flex: 1 }}>{cat.label}</span>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#494847' }}>chevron_right</span>
              </button>
            );
          }

          // Single sub-item → go direct (no expand)
          if (cat.items.length === 1) {
            const item = cat.items[0]!;
            return (
              <button
                key={cat.label}
                onClick={() => onSelect(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 12px',
                  backgroundColor: '#131313', border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderLeft: `3px solid ${cat.color}`, width: '100%',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: cat.color }}>{cat.icon}</span>
                <div style={{ flex: 1 }}>
                  <div className="font-headline font-bold" style={{ fontSize: '14px', color: 'white' }}>{cat.label}</div>
                  <div style={{ fontSize: '10px', color: '#777575', marginTop: '1px' }}>{item.desc}</div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#494847' }}>chevron_right</span>
              </button>
            );
          }

          // Multi sub-items → expandable
          const isExpanded = expanded === cat.label;
          return (
            <div key={cat.label}>
              <button
                onClick={() => setExpanded(isExpanded ? null : cat.label)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 12px',
                  backgroundColor: isExpanded ? 'rgba(63,255,139,0.04)' : '#131313',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderLeft: `3px solid ${cat.color}`, width: '100%',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: cat.color }}>{cat.icon}</span>
                <span className="font-headline font-bold" style={{ fontSize: '14px', color: 'white', flex: 1 }}>{cat.label}</span>
                <span className="material-symbols-outlined" style={{
                  fontSize: '18px', color: '#494847',
                  transform: isExpanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}>expand_more</span>
              </button>

              {isExpanded && (
                <div style={{ marginLeft: '16px', borderLeft: `1px solid ${cat.color}20` }}>
                  {cat.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onSelect(item.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                        backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
                        textAlign: 'left', width: '100%',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#777575' }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: 'white', fontWeight: 600 }}>{item.label}</div>
                        <div style={{ fontSize: '10px', color: '#777575', marginTop: '1px' }}>{item.desc}</div>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#494847' }}>chevron_right</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '10px', color: '#494847' }}>KROMI BikeControl v0.9.5</div>
    </div>
  );
}

// === SUB-PAGES ===

/** Legacy RiderPage — redirects to split pages on mobile */
function RiderPage() {
  return (
    <div className="space-y-6">
      <PersonalPage />
      <PhysicalPage />
      <ZonesPage />
      <MedicalPage />
      <BikeFitSection />
    </div>
  );
}

/** OLD RiderPage code removed — replaced by PersonalPage, PhysicalPage, ZonesPage, MedicalPage, BikeFitSection */
// === SPLIT PAGES (extracted from RiderPage for better organization) ===

function PersonalPage() {
  const profile = useSettingsStore((s) => s.riderProfile);
  const updateProfile = useSettingsStore((s) => s.updateRiderProfile);
  const user = useAuthStore((s) => s.user);
  const [riderName, setRiderName] = useState(profile.name ?? '');
  const [birthdate, setBirthdate] = useState(profile.birthdate ?? '');
  const [gender, setGender] = useState(profile.gender ?? '');

  const save = () => {
    const age = birthdate ? Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : profile.age;
    updateProfile({ name: riderName, birthdate, gender, age });
    // Sync name to app_users
    if (riderName) {
      const SB = import.meta.env.VITE_SUPABASE_URL;
      const SK = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (SB && SK && user?.id) {
        fetch(`${SB}/rest/v1/app_users?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ name: riderName }),
        }).catch(() => {});
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Account association */}
      {user?.email && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#adaaaa', fontSize: '13px' }}>Conta</span>
            <span style={{ color: '#3fff8b', fontSize: '13px' }}>{user.email}</span>
          </div>
        </Card>
      )}

      <Card>
        <TextField label="Nome" value={riderName} onChange={(v) => { setRiderName(v); save(); }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Data nascimento</span>
          <input type="date" value={birthdate} onChange={(e) => { setBirthdate(e.target.value); save(); }} style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', fontSize: '13px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Género</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {['M', 'F', 'Outro'].map((g) => (
              <button key={g} onClick={() => { setGender(g); save(); }} style={{ padding: '4px 12px', fontSize: '11px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: gender === g ? '#3fff8b' : '#262626', color: gender === g ? 'black' : '#adaaaa' }}>{g}</button>
            ))}
          </div>
        </div>
        {birthdate && <ReadOnlyRow label="Idade" value={`${Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} anos`} color="#3fff8b" />}
      </Card>

      {/* Club — just show current, full management in Club page */}
      {profile.club_name && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#fbbf24' }}>groups</span>
            <span className="font-headline font-bold" style={{ fontSize: '13px', color: 'white' }}>{profile.club_name}</span>
          </div>
        </Card>
      )}

      <SectionLabel>Foto de Perfil</SectionLabel>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '60px', height: '60px', borderRadius: '50%', backgroundColor: '#262626', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {profile.avatar_url ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="material-symbols-outlined" style={{ fontSize: '28px', color: '#494847' }}>person</span>}
          </div>
          <TextField label="URL" value={profile.avatar_url ?? ''} onChange={(v) => updateProfile({ avatar_url: v })} />
        </div>
      </Card>

      <SectionLabel>Privacidade</SectionLabel>
      <Card>
        <PrivacyToggle label="Nome" value={profile.privacy?.name ?? 'club'} onChange={(v) => updateProfile({ privacy: { ...profile.privacy, name: v } })} />
        <PrivacyToggle label="Estatísticas" value={profile.privacy?.stats ?? 'club'} onChange={(v) => updateProfile({ privacy: { ...profile.privacy, stats: v } })} />
      </Card>
    </div>
  );
}

function PhysicalPage() {
  const profile = useSettingsStore((s) => s.riderProfile);
  const updateProfile = useSettingsStore((s) => s.updateRiderProfile);
  return (
    <div className="space-y-4">
      <Card>
        {profile.birthdate && <ReadOnlyRow label="Idade" value={`${Math.floor((Date.now() - new Date(profile.birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} anos`} color="#3fff8b" />}
        <NumberField label="Peso (kg)" value={profile.weight_kg} onChange={(v) => updateProfile({ weight_kg: v })} />
        <NumberField label="Altura (cm)" value={profile.height_cm ?? 175} onChange={(v) => updateProfile({ height_cm: v })} />
      </Card>
      <SectionLabel>SpO2</SectionLabel>
      <Card>
        <NumberField label="SpO2 repouso (%)" value={profile.spo2_rest ?? 97} onChange={(v) => updateProfile({ spo2_rest: v })} />
        <NumberField label="Alerta (%)" value={profile.spo2_threshold_warning ?? 93} onChange={(v) => updateProfile({ spo2_threshold_warning: v })} />
        <NumberField label="Perigo (%)" value={profile.spo2_threshold_danger ?? 88} onChange={(v) => updateProfile({ spo2_threshold_danger: v })} />
      </Card>
      <SectionLabel>Performance</SectionLabel>
      <Card>
        <NumberField label="VO2max (ml/kg/min)" value={profile.vo2max ?? 0} onChange={(v) => updateProfile({ vo2max: v })} />
        <NumberField label="FTP (watts)" value={profile.ftp_watts ?? 0} onChange={(v) => updateProfile({ ftp_watts: v })} />
      </Card>
    </div>
  );
}

function ZonesPage() {
  const profile = useSettingsStore((s) => s.riderProfile);
  const updateProfile = useSettingsStore((s) => s.updateRiderProfile);
  return (
    <div className="space-y-4">
      <SectionLabel>Zonas Cardíacas</SectionLabel>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>FC Máxima (bpm)</span>
          <input type="number" value={profile.hr_max} onChange={(e) => updateProfile({ hr_max: Number(e.target.value) })} style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', width: '70px', textAlign: 'center', fontSize: '15px' }} className="tabular-nums" />
        </div>
        <NumberField label="FC Repouso (bpm)" value={profile.hr_rest} onChange={(v) => updateProfile({ hr_rest: v })} />
        {profile.custom_zones && (
          <button onClick={() => updateProfile({ custom_zones: undefined, zones_source: 'formula', zones_updated_at: new Date().toISOString() })} style={{ fontSize: '9px', color: '#6e9bff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Reset fórmula</button>
        )}
        <div className="space-y-1.5">
          {calculateZones(profile.hr_max, profile.custom_zones).map((zone, i) => {
            const isTarget = (profile.target_zone ?? 2) === i + 1;
            return (
              <div key={zone.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', backgroundColor: isTarget ? 'rgba(63,255,139,0.1)' : '#262626', border: isTarget ? '1px solid rgba(63,255,139,0.3)' : '1px solid transparent' }}>
                <button onClick={() => updateProfile({ target_zone: i + 1 })} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', minWidth: '80px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: zone.color }} />
                  <span style={{ fontSize: '11px', color: 'white', fontWeight: 700 }}>{zone.name.split(' ')[0]}</span>
                </button>
                <input type="number" value={zone.min_bpm} onChange={(e) => { const c = profile.custom_zones ? [...profile.custom_zones] : calculateZones(profile.hr_max).map(z => ({ min_bpm: z.min_bpm, max_bpm: z.max_bpm })); c[i] = { ...c[i]!, min_bpm: Number(e.target.value) }; updateProfile({ custom_zones: c, zones_source: 'manual', zones_updated_at: new Date().toISOString() }); }} style={{ width: '50px', backgroundColor: '#1a1919', color: 'white', padding: '4px', border: '1px solid #494847', textAlign: 'center', fontSize: '12px' }} className="tabular-nums" />
                <span style={{ fontSize: '10px', color: '#494847' }}>—</span>
                <input type="number" value={zone.max_bpm} onChange={(e) => { const c = profile.custom_zones ? [...profile.custom_zones] : calculateZones(profile.hr_max).map(z => ({ min_bpm: z.min_bpm, max_bpm: z.max_bpm })); c[i] = { ...c[i]!, max_bpm: Number(e.target.value) }; updateProfile({ custom_zones: c, zones_source: 'manual', zones_updated_at: new Date().toISOString() }); }} style={{ width: '50px', backgroundColor: '#1a1919', color: 'white', padding: '4px', border: '1px solid #494847', textAlign: 'center', fontSize: '12px' }} className="tabular-nums" />
                <span style={{ fontSize: '9px', color: '#777575', flex: 1, textAlign: 'right' }}>bpm</span>
                {isTarget && <span style={{ fontSize: '7px', padding: '2px 4px', backgroundColor: '#3fff8b', color: 'black', fontWeight: 900 }}>ALVO</span>}
              </div>
            );
          })}
        </div>
      </Card>

      {(profile.ftp_watts ?? 0) > 0 && (
        <>
          <SectionLabel>Zonas de Potência (FTP: {profile.ftp_watts}W)</SectionLabel>
          <Card>
            {calculatePowerZones(profile.ftp_watts!).map((zone) => (
              <div key={zone.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: zone.color }} />
                  <span style={{ fontSize: '11px', color: 'white', fontWeight: 600 }}>{zone.name}</span>
                </div>
                <span className="tabular-nums" style={{ fontSize: '11px', color: '#adaaaa' }}>{zone.min_watts}–{zone.max_watts}W</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function MedicalPage() {
  const profile = useSettingsStore((s) => s.riderProfile);
  const updateProfile = useSettingsStore((s) => s.updateRiderProfile);
  return (
    <div className="space-y-4">
      <SectionLabel>Condições Médicas</SectionLabel>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {['asma', 'cardíaco', 'diabetes', 'hipertensão', 'joelho', 'costas'].map((cond) => {
            const active = (profile.medical_conditions ?? []).includes(cond);
            return (
              <button key={cond} onClick={() => { const c = profile.medical_conditions ?? []; updateProfile({ medical_conditions: active ? c.filter(x => x !== cond) : [...c, cond] }); }} style={{ padding: '4px 10px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', backgroundColor: active ? '#ff716c' : '#262626', color: active ? 'black' : '#adaaaa' }}>{cond}</button>
            );
          })}
        </div>
        <textarea value={profile.medical_notes ?? ''} onChange={(e) => updateProfile({ medical_notes: e.target.value })} placeholder="Notas médicas..." style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '8px', border: 'none', fontSize: '12px', minHeight: '40px', resize: 'vertical' }} />
      </Card>

      <SectionLabel>Objectivos</SectionLabel>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {([{ id: 'weight_loss', l: '⚖️ Peso' }, { id: 'endurance', l: '🏔 Endurance' }, { id: 'performance', l: '🏆 Performance' }, { id: 'event_prep', l: '📅 Evento' }, { id: 'fun', l: '🎉 Diversão' }, { id: 'rehab', l: '🏥 Reabilitação' }] as const).map(({ id, l }) => (
            <button key={id} onClick={() => updateProfile({ goal: id })} style={{ padding: '6px 10px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', backgroundColor: profile.goal === id ? '#3fff8b' : '#262626', color: profile.goal === id ? 'black' : '#adaaaa' }}>{l}</button>
          ))}
        </div>
        {profile.goal === 'event_prep' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
            <span style={{ color: '#adaaaa', fontSize: '12px' }}>Data do evento</span>
            <input type="date" value={profile.goal_event_date ?? ''} onChange={(e) => updateProfile({ goal_event_date: e.target.value })} style={{ backgroundColor: '#262626', color: 'white', padding: '6px', border: 'none', fontSize: '12px' }} />
          </div>
        )}
      </Card>

      <SectionLabel>Perfil Atleta (análise automática)</SectionLabel>
      <ProfileInsightsWidget />
    </div>
  );
}

function ClubPage() {
  const profile = useSettingsStore((s) => s.riderProfile);
  const updateProfile = useSettingsStore((s) => s.updateRiderProfile);
  const [clubSearch, setClubSearch] = useState('');
  const [clubs, setClubs] = useState<{ id: string; name: string; color: string; location: string; member_count: number; website?: string; description?: string }[]>([]);
  const [members, setMembers] = useState<{ display_name: string; role: string; joined_at: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newColor, setNewColor] = useState('#3fff8b');
  const [newWebsite, setNewWebsite] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [clubDetail, setClubDetail] = useState<{ name: string; color: string; location: string; website?: string; description?: string; member_count: number } | null>(null);

  const SB_URL = import.meta.env.VITE_SUPABASE_URL as string;
  const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const userId = useAuthStore.getState().getUserId();

  // Load club details + members if user has a club
  useEffect(() => {
    if (!profile.club_id || !SB_URL) return;
    fetch(`${SB_URL}/rest/v1/clubs?id=eq.${profile.club_id}&select=name,color,location,website,description,member_count&limit=1`, { headers: { 'apikey': SB_KEY } })
      .then((r) => r.json()).then((d) => { if (d[0]) setClubDetail(d[0]); }).catch(() => {});
    fetch(`${SB_URL}/rest/v1/club_members?club_id=eq.${profile.club_id}&select=display_name,role,joined_at&order=joined_at.asc`, { headers: { 'apikey': SB_KEY } })
      .then((r) => r.json()).then((d) => { if (Array.isArray(d)) setMembers(d); }).catch(() => {});
  }, [profile.club_id]);

  const searchClubs = async (q: string) => {
    if (!SB_URL || q.length < 2) { setClubs([]); return; }
    try { const r = await fetch(`${SB_URL}/rest/v1/clubs?name=ilike.*${encodeURIComponent(q)}*&select=id,name,color,location,member_count,website,description&limit=10`, { headers: { 'apikey': SB_KEY } }); if (r.ok) setClubs(await r.json()); } catch {}
  };

  const joinClub = async (club: { id: string; name: string }) => {
    updateProfile({ club_id: club.id, club_name: club.name });
    if (SB_URL && userId) {
      fetch(`${SB_URL}/rest/v1/club_members`, { method: 'POST', headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify({ club_id: club.id, user_id: userId, display_name: profile.name ?? 'Rider' }) }).catch(() => {});
    }
    setClubSearch(''); setClubs([]);
  };

  const createClub = async () => {
    if (!SB_URL || !newName.trim()) return;
    try {
      const r = await fetch(`${SB_URL}/rest/v1/clubs`, { method: 'POST', headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify({ name: newName.trim(), location: newLocation, color: newColor, website: newWebsite, description: newDescription, created_by: userId }) });
      if (r.ok) { const [c] = await r.json(); await joinClub(c); setCreating(false); setNewName(''); }
    } catch {}
  };

  const leaveClub = () => {
    if (profile.club_id && SB_URL && userId) {
      fetch(`${SB_URL}/rest/v1/club_members?club_id=eq.${profile.club_id}&user_id=eq.${userId}`, { method: 'DELETE', headers: { 'apikey': SB_KEY } }).catch(() => {});
    }
    updateProfile({ club_id: undefined, club_name: undefined });
    setClubDetail(null); setMembers([]);
  };

  // Has club — show club info
  if (profile.club_id && clubDetail) {
    return (
      <div className="space-y-4">
        {/* Club header */}
        <div style={{ backgroundColor: '#1a1919', padding: '16px', borderLeft: `4px solid ${clubDetail.color}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="font-headline font-bold" style={{ fontSize: '20px', color: 'white' }}>{clubDetail.name}</div>
              {clubDetail.location && <div style={{ fontSize: '11px', color: '#adaaaa', marginTop: '2px' }}>📍 {clubDetail.location}</div>}
              {clubDetail.website && <div style={{ fontSize: '10px', color: '#6e9bff', marginTop: '2px' }}>{clubDetail.website}</div>}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="font-headline font-bold" style={{ fontSize: '24px', color: clubDetail.color }}>{clubDetail.member_count}</div>
              <div style={{ fontSize: '9px', color: '#777575' }}>membros</div>
            </div>
          </div>
          {clubDetail.description && <div style={{ fontSize: '11px', color: '#777575', marginTop: '8px' }}>{clubDetail.description}</div>}
        </div>

        {/* Members */}
        <SectionLabel>Membros ({members.length})</SectionLabel>
        <Card>
          {members.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: m.role === 'admin' ? '#fbbf24' : m.role === 'captain' ? '#6e9bff' : '#777575' }}>person</span>
                <span style={{ fontSize: '12px', color: 'white' }}>{m.display_name || 'Rider'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '9px', padding: '1px 6px', backgroundColor: m.role === 'admin' ? '#fbbf24' : '#262626', color: m.role === 'admin' ? 'black' : '#777575' }}>{m.role}</span>
                <span style={{ fontSize: '8px', color: '#494847' }}>{new Date(m.joined_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
          {members.length === 0 && <div style={{ fontSize: '11px', color: '#777575', textAlign: 'center' }}>A carregar membros...</div>}
        </Card>

        {/* Rides em grupo — coming soon */}
        <SectionLabel>Rides em Grupo</SectionLabel>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#e966ff' }}>group_work</span>
            <div>
              <div style={{ fontSize: '12px', color: '#adaaaa' }}>Em breve — rides em grupo com tracking em tempo real</div>
              <div style={{ fontSize: '9px', color: '#494847', marginTop: '2px' }}>Planear rotas, ver membros no mapa, comparar performance</div>
            </div>
          </div>
        </Card>

        {/* Leave */}
        <button onClick={() => { if (confirm(`Sair de ${clubDetail.name}?`)) leaveClub(); }} style={{ width: '100%', padding: '10px', backgroundColor: '#262626', color: '#ff716c', border: '1px solid rgba(255,113,108,0.3)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
          Sair do clube
        </button>
      </div>
    );
  }

  // No club — search + create
  return (
    <div className="space-y-4">
      <SectionLabel>Procurar Clube</SectionLabel>
      <Card>
        <input type="text" value={clubSearch} onChange={(e) => { setClubSearch(e.target.value); searchClubs(e.target.value); }} placeholder="Nome do clube..."
          style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '10px', border: 'none', fontSize: '13px' }} />
        {clubs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
            {clubs.map((c) => (
              <button key={c.id} onClick={() => joinClub(c)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#262626', border: 'none', borderLeft: `3px solid ${c.color}`, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                <div style={{ flex: 1 }}>
                  <div className="font-headline font-bold" style={{ fontSize: '13px', color: 'white' }}>{c.name}</div>
                  <div style={{ fontSize: '9px', color: '#777575' }}>{c.location} · {c.member_count} membros</div>
                  {c.description && <div style={{ fontSize: '9px', color: '#494847', marginTop: '2px' }}>{c.description}</div>}
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#3fff8b' }}>add</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <SectionLabel>Criar Novo Clube</SectionLabel>
      {creating ? (
        <Card>
          <TextField label="Nome" value={newName} onChange={setNewName} />
          <TextField label="Localização" value={newLocation} onChange={setNewLocation} />
          <TextField label="Website" value={newWebsite} onChange={setNewWebsite} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#adaaaa', fontSize: '13px' }}>Cor</span>
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} style={{ width: '40px', height: '30px', border: 'none', cursor: 'pointer' }} />
          </div>
          <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Descrição do clube..." style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '8px', border: 'none', fontSize: '12px', minHeight: '60px', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={createClub} style={{ flex: 1, padding: '10px', backgroundColor: '#3fff8b', color: 'black', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>Criar Clube</button>
            <button onClick={() => setCreating(false)} style={{ padding: '10px', backgroundColor: '#262626', color: '#adaaaa', border: 'none', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </Card>
      ) : (
        <button onClick={() => setCreating(true)} style={{ width: '100%', padding: '12px', backgroundColor: '#1a1919', border: '1px dashed #494847', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: '#adaaaa', fontSize: '12px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
          Criar novo clube
        </button>
      )}
    </div>
  );
}

function BikeFitSection() {
  return (
    <div className="space-y-4">
      <BikeFitPage />
    </div>
  );
}

// Old BikePage removed — replaced by BikesPage component

function KromiPage() {
  const autoAssist = useSettingsStore((s) => s.autoAssist);
  const updateAutoAssist = useSettingsStore((s) => s.updateAutoAssist);
  const learning = useLearningStore();

  return (
    <div className="space-y-4">
      <SectionLabel>Auto-Assist</SectionLabel>
      <Card>
        <Toggle label="Activado" value={autoAssist.enabled} onChange={(v) => updateAutoAssist({ enabled: v })} />
        <NumberField label="Lookahead (m)" value={autoAssist.lookahead_m} onChange={(v) => updateAutoAssist({ lookahead_m: v })} />
        <NumberField label="Pre-activação (m)" value={autoAssist.preempt_distance_m} onChange={(v) => updateAutoAssist({ preempt_distance_m: v })} />
        <NumberField label="Override timeout (s)" value={autoAssist.override_duration_s} onChange={(v) => updateAutoAssist({ override_duration_s: v })} />
      </Card>

      <SectionLabel>Aprendizagem Adaptativa</SectionLabel>
      <Card>
        <div style={{ fontSize: '10px', color: '#777575' }}>O KROMI aprende com os teus overrides e ajusta o algoritmo.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', textAlign: 'center', marginTop: '8px' }}>
          <div><div className="font-headline font-bold" style={{ fontSize: '18px', color: '#6e9bff' }}>{learning.total_rides_learned}</div><div style={{ fontSize: '8px', color: '#777575' }}>Rides</div></div>
          <div><div className="font-headline font-bold" style={{ fontSize: '18px', color: '#fbbf24' }}>{learning.total_overrides}</div><div style={{ fontSize: '8px', color: '#777575' }}>Overrides</div></div>
          <div><div className="font-headline font-bold" style={{ fontSize: '18px', color: '#3fff8b' }}>{Object.keys(learning.adjustments).length}</div><div style={{ fontSize: '8px', color: '#777575' }}>Contextos</div></div>
        </div>
        {Object.keys(learning.adjustments).length > 0 && (
          <div className="space-y-1" style={{ marginTop: '8px' }}>
            {Object.entries(learning.adjustments).sort((a, b) => Math.abs(b[1].score_delta) - Math.abs(a[1].score_delta)).slice(0, 6).map(([key, adj]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: '#adaaaa' }}>{key}</span>
                <span style={{ color: adj.score_delta > 0 ? '#3fff8b' : '#fbbf24' }}>{adj.score_delta > 0 ? '+' : ''}{adj.score_delta} ({adj.sample_count})</span>
              </div>
            ))}
          </div>
        )}
        {learning.total_overrides > 0 && (
          <button onClick={() => { if (confirm('Apagar toda a aprendizagem?')) learning.resetLearning(); }}
            style={{ width: '100%', marginTop: '8px', padding: '8px', fontSize: '11px', color: '#ff716c', backgroundColor: '#262626', border: '1px solid rgba(255,113,108,0.3)', cursor: 'pointer' }}>
            Reset Aprendizagem
          </button>
        )}
      </Card>
    </div>
  );
}

function BluetoothPage() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const services = useBikeStore((s) => s.ble_services);

  return (
    <div className="space-y-4">
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Estado</span>
          <span className="font-headline font-bold" style={{ color: bleStatus === 'connected' ? '#3fff8b' : '#ff716c' }}>
            {bleStatus === 'connected' ? 'Ligado' : 'Desligado'}
          </span>
        </div>
        {bleStatus === 'connected' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
            {services.battery && <Tag>Bateria</Tag>}
            {services.csc && <Tag>Vel/Cad</Tag>}
            {services.power && <Tag>Potência</Tag>}
            {services.gev && <Tag>Motor GEV</Tag>}
            {services.heartRate && <Tag color="#ff716c">HR</Tag>}
            {services.di2 && <Tag color="#6e9bff">Di2</Tag>}
            {services.sram && <Tag color="#e966ff">SRAM</Tag>}
          </div>
        )}
        <button
          onClick={() => bleStatus === 'connected' ? disconnectBike() : connectBike()}
          style={{
            width: '100%', height: '48px', marginTop: '12px', border: 'none', cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: '14px', textTransform: 'uppercase',
            backgroundColor: bleStatus === 'connected' ? '#ff716c' : '#3fff8b',
            color: 'black',
          }}
        >
          {bleStatus === 'connected' ? 'Desligar' : 'Ligar'}
        </button>
      </Card>
    </div>
  );
}

function RoutesPage({ onNavigate }: { onNavigate?: (s: Screen) => void }) {
  const [komootUrl, setKomootUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleImport = async () => {
    if (!komootUrl.trim()) return;
    setLoading(true); setResult(null);
    try {
      const pts = await importKomootRoute(komootUrl);
      setResult(`Importados ${pts.length} pontos`);
      sessionStorage.setItem('komoot_route', JSON.stringify(pts));
    } catch (err) { setResult(err instanceof Error ? err.message : 'Import failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <SectionLabel>Import Komoot Route</SectionLabel>
      <Card>
        <input type="text" value={komootUrl} onChange={(e) => setKomootUrl(e.target.value)} placeholder="Komoot tour URL or ID"
          style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '10px', border: 'none', fontSize: '13px' }} />
        <button onClick={handleImport} disabled={loading || !komootUrl.trim()}
          style={{ width: '100%', height: '40px', marginTop: '8px', backgroundColor: loading ? '#262626' : '#3fff8b', color: 'black', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
          {loading ? 'A importar...' : 'Import'}
        </button>
        {result && <div style={{ fontSize: '11px', color: result.startsWith('Importados') ? '#3fff8b' : '#ff716c', marginTop: '4px' }}>{result}</div>}
      </Card>
      {onNavigate && (
        <>
          <SectionLabel>Histórico</SectionLabel>
          <button onClick={() => onNavigate('history')}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: '#1a1919', border: 'none', cursor: 'pointer', borderLeft: '3px solid #3fff8b' }}>
            <span className="material-symbols-outlined" style={{ color: '#3fff8b' }}>history</span>
            <span style={{ color: 'white', fontWeight: 600 }}>Histórico de Rides</span>
          </button>
        </>
      )}
    </div>
  );
}

function AccountPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="space-y-4">
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Email</span>
          <span style={{ color: 'white', fontSize: '13px' }}>{user?.email}</span>
        </div>
      </Card>
      <button onClick={logout}
        style={{ width: '100%', height: '48px', backgroundColor: '#262626', color: '#ff716c', border: '1px solid rgba(255,113,108,0.3)', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>
        Terminar Sessão
      </button>
      <div style={{ textAlign: 'center', fontSize: '10px', color: '#494847', marginTop: '16px' }}>KROMI BikeControl v0.9.5</div>
    </div>
  );
}

// EBikeReadOnlyInfo removed — now in BikesPage.tsx EBikeSection

function PrivacyToggle({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const opts = [
    { id: 'public', label: '🌍', desc: 'Público' },
    { id: 'club', label: '👥', desc: 'Clube' },
    { id: 'private', label: '🔒', desc: 'Privado' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: '#adaaaa', fontSize: '13px' }}>{label}</span>
      <div style={{ display: 'flex', gap: '3px' }}>
        {opts.map((o) => (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            padding: '3px 8px', fontSize: '10px', border: 'none', cursor: 'pointer',
            backgroundColor: value === o.id ? '#3fff8b' : '#262626', color: value === o.id ? 'black' : '#adaaaa', fontWeight: 600,
          }}>{o.label} {o.desc}</button>
        ))}
      </div>
    </div>
  );
}

function ReadOnlyRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#adaaaa', fontSize: '13px' }}>{label}</span>
      <span className="font-headline font-bold tabular-nums" style={{ fontSize: '13px', color: color ?? 'white' }}>{value}</span>
    </div>
  );
}

// === SHARED COMPONENTS ===

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ backgroundColor: '#1a1919', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="font-label" style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.12em', paddingLeft: '4px' }}>{children}</div>;
}

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return <span style={{ fontSize: '10px', padding: '3px 8px', backgroundColor: '#262626', color: color ?? '#adaaaa' }}>{children}</span>;
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: '#adaaaa', fontSize: '13px' }}>{label}</span>
      <button onClick={() => onChange(!value)} style={{ width: '48px', height: '28px', borderRadius: '14px', backgroundColor: value ? '#3fff8b' : '#494847', border: 'none', cursor: 'pointer', position: 'relative' }}>
        <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: 'white', position: 'absolute', top: '3px', left: value ? '23px' : '3px', transition: 'left 0.2s' }} />
      </button>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: '#adaaaa', fontSize: '13px' }}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', width: '140px', textAlign: 'right', fontSize: '13px' }} />
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: '#adaaaa', fontSize: '13px' }}>{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', width: '80px', textAlign: 'center', fontSize: '15px' }} className="tabular-nums" />
    </div>
  );
}

// BikeInfoCard / InfoRow removed — now in BikesPage.tsx
