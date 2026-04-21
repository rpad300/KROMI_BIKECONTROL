import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import QRCode from 'qrcode';
import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { calculateZones, calculatePowerZones } from '../../types/athlete.types';
import { useBikeStore } from '../../store/bikeStore';
import { useAuthStore } from '../../store/authStore';
import { useLearningStore } from '../../store/learningStore';
import { connectBike, disconnectBike } from '../../services/bluetooth/BLEBridge';
import { ProfileInsightsWidget } from '../Dashboard/ProfileInsightsWidget';
import { BikeFitPage } from './BikeFitPage';
import { BikesPage } from './BikesPage';
import { PrivacyPage } from './PrivacyPage';
import { ServiceBookPage } from '../ServiceBook/ServiceBookPage';
import { ShopManagementPage } from '../Shop/ShopManagementPage';
import { AdminPanel } from '../Admin/AdminPanel';
import { useIsSuperAdmin, usePermissions } from '../../hooks/usePermission';
import {
  NAV_CATEGORIES,
  NAV_PERMISSION_KEYS,
  ALL_NAV_LEAVES,
  SUPER_ADMIN_CATEGORY,
  filterNavByPermissions,
  type NavCategory,
  type SettingsPage as SettingsPageId,
  type Screen as NavScreen,
} from '../../config/navigation';
const AccessoriesSettingsContent = lazy(() => import('./AccessoriesSettings').then(m => ({ default: m.AccessoriesSettingsContent })));
// TuningPreview removed — config is now read-only from motor telemetry

// App version from git tag (injected at build time by Vite)
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
import { importKomootRoute } from '../../services/maps/KomootService';
import { useRouteStore } from '../../store/routeStore';
import { parseGPXFile } from '../../services/routes/GPXParser';
import { saveRoute, listRoutes, deleteRoute } from '../../services/routes/RouteService';
import { supaFetch, supaGet } from '../../lib/supaFetch';
import { analyzeRoute } from '../../services/routes/PreRideAnalysis';
import { ComplianceSettings as ComplianceSettingsSection } from './ComplianceSettings';
import { isLiveBroadcasting, getShareUrl } from '../../services/tracking/LiveTrackingService';

type Screen = NavScreen;
type SettingsPage = SettingsPageId;

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
            {ALL_NAV_LEAVES.find((m) => m.id === activePage)?.label ?? 'Settings'}
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
        {activePage === 'emergency' && <EmergencyPage />}
        {activePage === 'bikefit' && <BikeFitSection />}
        {activePage === 'club' && <ClubPage />}
        {activePage === 'bike' && <BikesPage />}
        {activePage === 'service-book' && <ServiceBookPage />}
        {activePage === 'shop' && <ShopManagementPage />}
        {activePage === 'kromi' && <KromiPage />}
        {activePage === 'bluetooth' && <BluetoothPage />}
        {activePage === 'accessories' && <Suspense fallback={<div className="text-[#777575] text-center py-8">A carregar...</div>}><AccessoriesSettingsContent /></Suspense>}
        {activePage === 'routes' && <RoutesPage onNavigate={onNavigate} />}
        {activePage === 'super-admin' && <AdminPanel />}
        {activePage === 'account' && <AccountPage />}
        {activePage === 'privacy' && <PrivacyPage />}
      </div>
    </div>
  );
}

function SettingsMenu({ onSelect, onNavigate }: { onSelect: (p: SettingsPage) => void; onNavigate?: (s: Screen) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const isSuperAdmin = useIsSuperAdmin();
  const perms = usePermissions(NAV_PERMISSION_KEYS);

  // RBAC filter, then append Super Admin if applicable
  const visibleCategories = filterNavByPermissions(NAV_CATEGORIES, perms);
  const categories: NavCategory[] = isSuperAdmin
    ? [...visibleCategories, SUPER_ADMIN_CATEGORY]
    : visibleCategories;

  return (
    <div style={{ padding: '12px', backgroundColor: '#0e0e0e', minHeight: '100%' }}>
      <h1 className="font-headline font-bold" style={{ fontSize: '22px', color: '#3fff8b', marginBottom: '16px', paddingLeft: '4px' }}>Setup</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {categories.map((cat) => {
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
    if (riderName && user?.id) {
      supaFetch(`/rest/v1/app_users?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ name: riderName }),
      }).catch(() => {});
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
  const [rides, setRides] = useState<any[]>([]);
  const [rideParticipants, setRideParticipants] = useState<Record<string, any[]>>({});
  const [creatingRide, setCreatingRide] = useState(false);
  const [rideName, setRideName] = useState('');
  const [rideDesc, setRideDesc] = useState('');
  const [rideDate, setRideDate] = useState('');
  const [rideTime, setRideTime] = useState('');
  const [rideMeetingAddress, setRideMeetingAddress] = useState('');
  const [loadingRides, setLoadingRides] = useState(false);
  const [rideGpxFile, setRideGpxFile] = useState<File | null>(null);
  const [rideGpxName, setRideGpxName] = useState('');
  const rideGpxRef = useRef<HTMLInputElement>(null);

  const userId = useAuthStore.getState().getUserId();

  // Load club details + members if user has a club
  useEffect(() => {
    if (!profile.club_id) return;
    supaGet<typeof clubs>(`/rest/v1/clubs?id=eq.${profile.club_id}&select=name,color,location,website,description,member_count&limit=1`)
      .then((d) => { if (d[0]) setClubDetail(d[0] as unknown as typeof clubDetail); }).catch(() => {});
    supaGet<typeof members>(`/rest/v1/club_members?club_id=eq.${profile.club_id}&select=display_name,role,joined_at&order=joined_at.asc`)
      .then((d) => { if (Array.isArray(d)) setMembers(d); }).catch(() => {});
  }, [profile.club_id]);

  // Load group rides for the club
  useEffect(() => {
    if (!profile.club_id) return;
    setLoadingRides(true);
    supaGet<any[]>(`/rest/v1/club_rides?club_id=eq.${profile.club_id}&status=in.(planned,active)&order=scheduled_at.asc`)
      .then(async (data) => {
        if (!Array.isArray(data)) return;
        setRides(data);
        const parts: Record<string, any[]> = {};
        for (const ride of data) {
          try {
            const p = await supaGet<any[]>(`/rest/v1/club_ride_participants?club_ride_id=eq.${ride.id}&select=*`);
            if (Array.isArray(p)) parts[ride.id] = p;
          } catch {}
        }
        setRideParticipants(parts);
      })
      .catch(() => {})
      .finally(() => setLoadingRides(false));
  }, [profile.club_id]);

  const searchClubs = async (q: string) => {
    if (q.length < 2) { setClubs([]); return; }
    try {
      const data = await supaGet<typeof clubs>(`/rest/v1/clubs?name=ilike.*${encodeURIComponent(q)}*&select=id,name,color,location,member_count,website,description&limit=10`);
      setClubs(data);
    } catch {}
  };

  const joinClub = async (club: { id: string; name: string }) => {
    updateProfile({ club_id: club.id, club_name: club.name });
    if (userId) {
      supaFetch('/rest/v1/club_members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify({ club_id: club.id, user_id: userId, display_name: profile.name ?? 'Rider' }),
      }).catch(() => {});
    }
    setClubSearch(''); setClubs([]);
  };

  const createClub = async () => {
    if (!newName.trim()) return;
    try {
      const r = await supaFetch('/rest/v1/clubs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ name: newName.trim(), location: newLocation, color: newColor, website: newWebsite, description: newDescription, created_by: userId }),
      });
      const [c] = await r.json();
      await joinClub(c);
      setCreating(false);
      setNewName('');
    } catch {}
  };

  const leaveClub = () => {
    if (profile.club_id && userId) {
      supaFetch(`/rest/v1/club_members?club_id=eq.${profile.club_id}&user_id=eq.${userId}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    updateProfile({ club_id: undefined, club_name: undefined });
    setClubDetail(null); setMembers([]);
  };

  const createRide = async () => {
    if (!rideName.trim() || !rideDate || !rideTime || !profile.club_id) return;
    try {
      const scheduled = new Date(`${rideDate}T${rideTime}`).toISOString();
      let gpxContent: string | null = null;
      if (rideGpxFile) {
        gpxContent = await rideGpxFile.text();
      }
      const res = await supaFetch('/rest/v1/club_rides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({
          club_id: profile.club_id,
          created_by: userId,
          name: rideName.trim(),
          description: rideDesc.trim() || null,
          scheduled_at: scheduled,
          meeting_address: rideMeetingAddress.trim() || null,
          route_gpx: gpxContent,
          status: 'planned',
        }),
      });
      const [newRide] = await res.json();
      if (newRide) {
        setRides(prev => [...prev, newRide]);
        await joinRide(newRide.id);
      }
      setCreatingRide(false);
      setRideName(''); setRideDesc(''); setRideDate(''); setRideTime(''); setRideMeetingAddress('');
      setRideGpxFile(null); setRideGpxName('');
    } catch {}
  };

  const joinRide = async (rideId: string) => {
    if (!userId) return;
    const token = profile.emergency_qr_token || null;
    try {
      await supaFetch('/rest/v1/club_ride_participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          club_ride_id: rideId,
          user_id: userId,
          status: 'confirmed',
          display_name: profile.name || 'Rider',
          tracking_token: token,
          phone: profile.phone || null,
          avatar_url: profile.avatar_url || null,
        }),
      });
      const p = await supaGet<any[]>(`/rest/v1/club_ride_participants?club_ride_id=eq.${rideId}&select=*`);
      if (Array.isArray(p)) setRideParticipants(prev => ({ ...prev, [rideId]: p }));
    } catch {}
  };

  const leaveRide = async (rideId: string) => {
    if (!userId) return;
    try {
      await supaFetch(`/rest/v1/club_ride_participants?club_ride_id=eq.${rideId}&user_id=eq.${userId}`, { method: 'DELETE' });
      setRideParticipants(prev => ({
        ...prev,
        [rideId]: (prev[rideId] || []).filter((p: any) => p.user_id !== userId),
      }));
    } catch {}
  };

  const activateRide = async (rideId: string) => {
    try {
      await supaFetch(`/rest/v1/club_rides?id=eq.${rideId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      setRides(prev => prev.map(r => r.id === rideId ? { ...r, status: 'active' } : r));
      import('../../services/tracking/LiveTrackingService').then(({ setActiveGroupRide }) => {
        setActiveGroupRide(rideId);
      });
      // If ride has GPX, load it as active route
      const ride = rides.find(r => r.id === rideId);
      if (ride?.route_gpx) {
        import('../../services/routes/GPXParser').then(({ parseGPX }) => {
          const parsed = parseGPX(ride.route_gpx);
          if (parsed) {
            import('../../store/routeStore').then(({ useRouteStore }) => {
              useRouteStore.getState().setActiveRoute(
                { id: ride.id, name: ride.name, points: parsed.points, total_distance_km: parsed.total_distance_km, total_elevation_gain_m: parsed.total_elevation_gain_m, total_elevation_loss_m: parsed.total_elevation_loss_m, max_gradient_pct: parsed.max_gradient_pct, avg_gradient_pct: parsed.avg_gradient_pct } as any,
                parsed.points
              );
              useRouteStore.getState().startNavigation();
            });
          }
        });
      }
    } catch {}
  };

  const deleteRide = async (rideId: string) => {
    try {
      await supaFetch(`/rest/v1/club_ride_participants?club_ride_id=eq.${rideId}`, { method: 'DELETE' });
      await supaFetch(`/rest/v1/club_rides?id=eq.${rideId}`, { method: 'DELETE' });
      setRides(prev => prev.filter(r => r.id !== rideId));
    } catch {}
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

        {/* Group Rides */}
        <SectionLabel>Rides em Grupo ({rides.length})</SectionLabel>

        {loadingRides && <div style={{ fontSize: '11px', color: '#777', textAlign: 'center', padding: '8px' }}>A carregar rides...</div>}

        {rides.map((ride) => {
          const parts = rideParticipants[ride.id] || [];
          const isJoined = parts.some((p: any) => p.user_id === userId);
          const isCreator = ride.created_by === userId;
          const isActive = ride.status === 'active';
          const scheduledDate = new Date(ride.scheduled_at);
          const dateStr = scheduledDate.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
          const timeStr = scheduledDate.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

          return (
            <Card key={ride.id}>
              <div style={{ borderLeft: `3px solid ${isActive ? '#3fff8b' : '#6e9bff'}`, paddingLeft: '10px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 800, color: 'white' }}>{ride.name}</div>
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                      {dateStr} · {timeStr}
                    </div>
                    {ride.description && <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>{ride.description}</div>}
                    {ride.meeting_address && <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>{ride.meeting_address}</div>}
                    {ride.route_gpx && <div style={{ fontSize: '9px', color: '#3fff8b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}><span className="material-symbols-outlined" style={{ fontSize: '12px' }}>route</span> Rota GPX incluida</div>}
                  </div>
                  <span style={{
                    fontSize: '9px', fontWeight: 800, padding: '2px 8px', borderRadius: '4px',
                    backgroundColor: isActive ? 'rgba(63,255,139,0.15)' : 'rgba(110,155,255,0.15)',
                    color: isActive ? '#3fff8b' : '#6e9bff',
                  }}>
                    {isActive ? 'ATIVA' : 'PLANEADA'}
                  </span>
                </div>

                {/* Participants */}
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '9px', color: '#777', fontWeight: 700, marginBottom: '4px' }}>
                    PARTICIPANTES ({parts.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {parts.map((p: any, i: number) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: '4px',
                        padding: '3px 8px', backgroundColor: '#262626', borderRadius: '12px',
                        fontSize: '10px', color: p.user_id === userId ? '#3fff8b' : '#adaaaa',
                      }}>
                        <span style={{ fontSize: '8px' }}>{p.status === 'riding' ? '\u{1F7E2}' : '\u26AA'}</span>
                        {p.display_name || 'Rider'}
                      </div>
                    ))}
                    {parts.length === 0 && <span style={{ fontSize: '10px', color: '#555' }}>Nenhum participante</span>}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                  {!isJoined ? (
                    <button onClick={() => joinRide(ride.id)} style={{
                      flex: 1, padding: '8px', backgroundColor: '#3fff8b', color: 'black',
                      border: 'none', fontWeight: 700, fontSize: '11px', cursor: 'pointer', borderRadius: '4px',
                    }}>Juntar-me</button>
                  ) : (
                    <button onClick={() => leaveRide(ride.id)} style={{
                      flex: 1, padding: '8px', backgroundColor: '#262626', color: '#ff716c',
                      border: '1px solid rgba(255,113,108,0.3)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', borderRadius: '4px',
                    }}>Sair</button>
                  )}
                  {isCreator && !isActive && (
                    <button onClick={() => activateRide(ride.id)} style={{
                      padding: '8px 12px', backgroundColor: 'rgba(63,255,139,0.15)', color: '#3fff8b',
                      border: '1px solid rgba(63,255,139,0.3)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', borderRadius: '4px',
                    }}>Iniciar</button>
                  )}
                  {isCreator && (
                    <button onClick={() => { if (confirm('Apagar esta ride?')) deleteRide(ride.id); }} style={{
                      padding: '8px', backgroundColor: '#262626', color: '#ff716c',
                      border: 'none', cursor: 'pointer', borderRadius: '4px',
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                    </button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}

        {/* Create new ride */}
        {creatingRide ? (
          <Card>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#e966ff', marginBottom: '8px' }}>NOVA RIDE EM GRUPO</div>
            <TextField label="Nome da Ride" value={rideName} onChange={setRideName} />
            <div style={{ display: 'flex', gap: '6px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: '#777', marginBottom: '2px' }}>Data</div>
                <input type="date" value={rideDate} onChange={(e) => setRideDate(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '8px', border: '1px solid #333', fontSize: '12px', borderRadius: '4px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: '#777', marginBottom: '2px' }}>Hora</div>
                <input type="time" value={rideTime} onChange={(e) => setRideTime(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '8px', border: '1px solid #333', fontSize: '12px', borderRadius: '4px' }} />
              </div>
            </div>
            <TextField label="Local de encontro" value={rideMeetingAddress} onChange={setRideMeetingAddress} />
            <div style={{ marginTop: '4px' }}>
              <div style={{ fontSize: '10px', color: '#777', marginBottom: '2px' }}>Rota GPX (opcional)</div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button onClick={() => rideGpxRef.current?.click()} style={{
                  padding: '8px 12px', backgroundColor: '#262626', color: '#3fff8b',
                  border: '1px solid rgba(63,255,139,0.3)', fontSize: '11px', fontWeight: 700, cursor: 'pointer', borderRadius: '4px',
                }}>
                  {'\uD83D\uDCC1'} {rideGpxName || 'Escolher GPX'}
                </button>
                <input ref={rideGpxRef} type="file" accept=".gpx" style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setRideGpxFile(f); setRideGpxName(f.name); }
                  }} />
                {rideGpxName && <span style={{ fontSize: '10px', color: '#3fff8b' }}>{'\u2713'} {rideGpxName}</span>}
              </div>
            </div>
            <textarea value={rideDesc} onChange={(e) => setRideDesc(e.target.value)} placeholder="Descri\u00E7\u00E3o (opcional)..."
              style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '8px', border: '1px solid #333', fontSize: '12px', minHeight: '50px', resize: 'vertical', borderRadius: '4px' }} />
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <button onClick={createRide} style={{
                flex: 1, padding: '10px', backgroundColor: '#e966ff', color: 'white',
                border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer', borderRadius: '4px',
              }}>Criar Ride</button>
              <button onClick={() => setCreatingRide(false)} style={{
                padding: '10px', backgroundColor: '#262626', color: '#adaaaa',
                border: 'none', cursor: 'pointer', borderRadius: '4px',
              }}>Cancelar</button>
            </div>
          </Card>
        ) : (
          <button onClick={() => setCreatingRide(true)} style={{
            width: '100%', padding: '12px', backgroundColor: '#1a1919',
            border: '1px dashed #494847', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            color: '#e966ff', fontSize: '12px', fontWeight: 700, borderRadius: '4px',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
            Criar Ride em Grupo
          </button>
        )}

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
  const voiceEnabled = useSettingsStore((s) => s.voice_enabled);
  const setVoiceEnabled = useSettingsStore((s) => s.setVoiceEnabled);
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

      <SectionLabel>Comandos de Voz</SectionLabel>
      <Card>
        <Toggle label="Activado" value={voiceEnabled} onChange={(v) => setVoiceEnabled(v)} />
        <div style={{ fontSize: '10px', color: '#777575' }}>
          Controla o motor com a voz: "modo eco", "bateria", "velocidade", "parar".
          Requer microfone (Chrome Android).
        </div>
      </Card>

      <ComplianceSettingsSection />

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

      <RideControlConfig />
    </div>
  );
}

/** RideControl mode configuration — rider inputs their actual RideControl app values */
function RideControlConfig() {
  const bikeConfig = useSettingsStore((s) => s.bikeConfig);
  const updateBikeConfig = useSettingsStore((s) => s.updateBikeConfig);
  const modes = bikeConfig.ridecontrol_modes ?? safeBikeConfig(undefined).ridecontrol_modes;

  const modeNames = [
    { key: 'eco' as const, label: 'ECO', color: '#3fff8b' },
    { key: 'tour' as const, label: 'TOUR', color: '#60a5fa' },
    { key: 'active' as const, label: 'ACTIVE', color: '#fbbf24' },
    { key: 'sport' as const, label: 'SPORT', color: '#ff716c' },
  ];

  const updateMode = (mode: string, field: string, value: number) => {
    const updated = {
      ...modes,
      [mode]: { ...modes[mode as keyof typeof modes], [field]: value },
    };
    updateBikeConfig({ ridecontrol_modes: updated });
  };

  return (
    <>
      <SectionLabel>RideControl — Configuração por Modo</SectionLabel>
      <Card>
        <div style={{ fontSize: '10px', color: '#777575', marginBottom: '8px' }}>
          Copia os valores do teu RideControl app. O KROMI usa estes dados para aprender melhor com as tuas preferencias.
        </div>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: '4px', fontSize: '9px', color: '#777575', fontWeight: 600, marginBottom: '4px' }}>
          <div />
          <div style={{ textAlign: 'center' }}>Support %</div>
          <div style={{ textAlign: 'center' }}>Torque Nm</div>
          <div style={{ textAlign: 'center' }}>Launch</div>
        </div>
        {/* Mode rows */}
        {modeNames.map(({ key, label, color }) => (
          <div key={key} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: '4px', marginBottom: '6px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '2px', backgroundColor: color }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color }}>{label}</span>
            </div>
            <input type="number" value={modes[key].support_pct}
              onChange={(e) => updateMode(key, 'support_pct', Number(e.target.value))}
              style={{ width: '100%', backgroundColor: '#262626', color: 'white', border: 'none', textAlign: 'center', padding: '6px 2px', fontSize: '12px', fontWeight: 700, borderRadius: '2px' }}
            />
            <input type="number" value={modes[key].torque_nm}
              onChange={(e) => updateMode(key, 'torque_nm', Number(e.target.value))}
              style={{ width: '100%', backgroundColor: '#262626', color: 'white', border: 'none', textAlign: 'center', padding: '6px 2px', fontSize: '12px', fontWeight: 700, borderRadius: '2px' }}
            />
            <input type="number" value={modes[key].launch}
              onChange={(e) => updateMode(key, 'launch', Number(e.target.value))}
              style={{ width: '100%', backgroundColor: '#262626', color: 'white', border: 'none', textAlign: 'center', padding: '6px 2px', fontSize: '12px', fontWeight: 700, borderRadius: '2px' }}
            />
          </div>
        ))}
      </Card>
    </>
  );
}

function BluetoothPage() {
  const bleStatus = useBikeStore((s) => s.ble_status);
  const services = useBikeStore((s) => s.ble_services);
  return (
    <div className="space-y-4">
      {/* Bike Connection */}
      <SectionLabel>Bike (Smart Gateway)</SectionLabel>
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

      {/* External Sensors */}
      <SectionLabel>Sensores Externos</SectionLabel>
      <Card>
        <div style={{ fontSize: '10px', color: '#777575', marginBottom: '8px' }}>
          Sensores independentes da bike. Ligam-se em paralelo via BLE.
        </div>
        <SensorRow icon="favorite" color="#ff716c" label="Heart Rate" sensorKey="hr" />
        <SensorRow icon="speed" color="#e966ff" label="Cadência" sensorKey="cadence" />
        <SensorRow icon="bolt" color="#fbbf24" label="Power Meter" sensorKey="power" />
      </Card>
    </div>
  );
}

/** Sensor connect/disconnect row */
function SensorRow({ icon, color, label, sensorKey }: { icon: string; color: string; label: string; sensorKey: string }) {
  const serviceKey = sensorKey === 'hr' ? 'heartRate' : sensorKey;
  const connected = useBikeStore((s) => s.ble_services[serviceKey as keyof typeof s.ble_services] ?? false);
  const [scanning, setScanning] = useState(false);
  const status = connected ? 'connected' : scanning ? 'scanning' : 'disconnected';

  const handleToggle = async () => {
    if (connected) {
      const { disconnectHR, disconnectExtPower, disconnectExtCadence } = await import('../../services/bluetooth/BLEBridge');
      if (sensorKey === 'hr') disconnectHR();
      else if (sensorKey === 'cadence') disconnectExtCadence();
      else if (sensorKey === 'power') disconnectExtPower();
    } else {
      setScanning(true);
      try {
        const { connectHR, connectExtPower, connectExtCadence } = await import('../../services/bluetooth/BLEBridge');
        if (sensorKey === 'hr') await connectHR();
        else if (sensorKey === 'cadence') await connectExtCadence();
        else if (sensorKey === 'power') await connectExtPower();
      } catch { /* scan timeout or user cancel */ }
      setScanning(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #262626' }}>
      <span className="material-symbols-outlined" style={{ fontSize: '20px', color: connected ? color : '#494847', fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: connected ? 'white' : '#adaaaa' }}>{label}</div>
      </div>
      <button
        onClick={handleToggle}
        style={{
          padding: '6px 16px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '11px',
          backgroundColor: status === 'connected' ? '#ff716c' : status === 'scanning' ? '#262626' : color + '30',
          color: status === 'connected' ? 'white' : status === 'scanning' ? '#777575' : color,
          borderRadius: '4px',
        }}
      >
        {status === 'connected' ? 'Desligar' : status === 'scanning' ? 'A procurar...' : 'Ligar'}
      </button>
    </div>
  );
}

function RoutesPage({ onNavigate }: { onNavigate?: (s: Screen) => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [routes, setRoutes] = useState<import('../../services/routes/RouteService').SavedRoute[]>([]);
  const [showPreRide, setShowPreRide] = useState(false);
  const [komootUrl, setKomootUrl] = useState('');

  const activeRoute = useRouteStore((s) => s.activeRoute);
  const preRide = useRouteStore((s) => s.preRideAnalysis);
  const analyzing = useRouteStore((s) => s.analyzingRoute);
  const setActiveRoute = useRouteStore((s) => s.setActiveRoute);
  const setPreRideAnalysis = useRouteStore((s) => s.setPreRideAnalysis);
  const setAnalyzing = useRouteStore((s) => s.setAnalyzing);
  const startNav = useRouteStore((s) => s.startNavigation);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRoutes().then(setRoutes).catch(() => {});
  }, []);

  // GPX file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setResult(null);
    try {
      const parsed = await parseGPXFile(file);
      if (!parsed) { setResult('Ficheiro GPX inválido'); setLoading(false); return; }

      setAnalyzing(true);
      const analysis = analyzeRoute(parsed.points);

      const saved = await saveRoute(parsed, 'gpx', undefined,
        analysis ? { wh: analysis.total_wh, time_min: analysis.estimated_time_min, glycogen_g: analysis.glycogen_g } : undefined);

      if (saved) {
        setRoutes(prev => [saved, ...prev]);
        setActiveRoute(saved, parsed.points);
        if (analysis) setPreRideAnalysis(analysis);
        setShowPreRide(true);
        setResult(null);
      } else {
        setResult('Falhou a guardar rota');
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  // Select saved route
  const handleSelectRoute = async (route: import('../../services/routes/RouteService').SavedRoute) => {
    setActiveRoute(route, route.points);
    setAnalyzing(true);
    const analysis = analyzeRoute(route.points);
    if (analysis) setPreRideAnalysis(analysis);
    setAnalyzing(false);
    setShowPreRide(true);
  };

  // Delete route
  const handleDelete = async (id: string) => {
    try {
      await deleteRoute(id);
      setRoutes(prev => prev.filter(r => r.id !== id));
      if (activeRoute?.id === id) {
        useRouteStore.getState().clearActiveRoute();
      }
    } catch {}
  };

  // Start navigation
  const handleStartNav = () => {
    startNav();
    setShowPreRide(false);
    if (onNavigate) onNavigate('dashboard');
  };

  // Komoot import handler (keep existing logic)
  const handleKomoot = async () => {
    if (!komootUrl.trim()) return;
    setLoading(true); setResult(null);
    try {
      const pts = await importKomootRoute(komootUrl);
      const routePoints = pts.map((p: { lat: number; lng: number; elevation: number }, i: number, arr: { lat: number; lng: number; elevation: number }[]) => ({
        lat: p.lat, lng: p.lng, elevation: p.elevation,
        distance_from_start_m: i === 0 ? 0 : Math.round(
          arr.slice(0, i).reduce((sum, _, j) => {
            if (j === 0) return 0;
            const a = arr[j - 1]!, b = arr[j]!;
            const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lng - a.lng) * Math.PI / 180;
            const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            return sum + R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
          }, 0)
        ),
      }));
      const totalDist = routePoints.length > 0 ? routePoints[routePoints.length - 1]!.distance_from_start_m / 1000 : 0;
      let elevGain = 0;
      for (let i = 1; i < routePoints.length; i++) {
        const d = routePoints[i]!.elevation - routePoints[i - 1]!.elevation;
        if (d > 0) elevGain += d;
      }
      const parsed = {
        name: `Komoot ${komootUrl.match(/\d+/)?.[0] ?? 'route'}`,
        description: 'Importado de Komoot',
        points: routePoints, total_distance_km: Math.round(totalDist * 100) / 100,
        total_elevation_gain_m: Math.round(elevGain), total_elevation_loss_m: 0,
        max_gradient_pct: 0, avg_gradient_pct: 0,
        bbox: { north: 0, south: 0, east: 0, west: 0 },
      };
      const analysis = analyzeRoute(parsed.points);
      const saved = await saveRoute(parsed, 'komoot', komootUrl,
        analysis ? { wh: analysis.total_wh, time_min: analysis.estimated_time_min, glycogen_g: analysis.glycogen_g } : undefined);
      if (saved) {
        setRoutes(prev => [saved, ...prev]);
        setActiveRoute(saved, parsed.points);
        if (analysis) setPreRideAnalysis(analysis);
        setShowPreRide(true);
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Komoot import failed');
    } finally {
      setLoading(false);
      setKomootUrl('');
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Import buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 h-12 rounded-lg bg-[#3fff8b] text-black font-bold text-sm active:scale-95"
        >
          <span className="material-symbols-outlined text-lg">upload_file</span>
          Importar GPX
        </button>
        <input ref={fileRef} type="file" accept=".gpx,.xml" onChange={handleFileUpload} style={{ display: 'none' }} />
      </div>

      {/* Komoot import */}
      <div className="flex gap-2">
        <input
          type="text" placeholder="URL Komoot..."
          value={komootUrl} onChange={(e) => setKomootUrl(e.target.value)}
          className="flex-1 h-10 px-3 rounded-lg bg-[#1a1919] text-white text-sm border border-[#333] focus:border-[#3fff8b] outline-none"
        />
        <button onClick={handleKomoot} disabled={loading || !komootUrl.trim()}
          className="px-4 h-10 rounded-lg bg-[#262626] text-white text-sm font-bold active:scale-95 disabled:opacity-50">
          Komoot
        </button>
      </div>

      {/* Status */}
      {loading && <p className="text-[#6e9bff] text-xs text-center">A processar...</p>}
      {result && <p className="text-[#fbbf24] text-xs text-center">{result}</p>}

      {/* Route list */}
      <div>
        <h3 className="text-[#777] text-xs font-bold uppercase tracking-wider mb-2">Rotas Guardadas ({routes.length})</h3>
        {routes.length === 0 && (
          <p className="text-[#555] text-xs text-center py-4">Nenhuma rota guardada</p>
        )}
        <div className="space-y-2">
          {routes.map((route) => (
            <div key={route.id}
              className={`bg-[#1a1919] rounded-lg p-3 flex items-center gap-3 active:scale-[0.98] transition-transform ${activeRoute?.id === route.id ? 'border border-[#3fff8b]/30' : ''}`}
              onClick={() => handleSelectRoute(route)}
            >
              <span className="material-symbols-outlined text-2xl text-[#3fff8b]">route</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate">{route.name}</p>
                <p className="text-[#777] text-[10px]">
                  {route.total_distance_km}km · ▲{route.total_elevation_gain_m}m
                  {route.estimated_wh ? ` · ${route.estimated_wh}Wh` : ''}
                </p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(route.id); }}
                className="p-1.5 rounded active:scale-90">
                <span className="material-symbols-outlined text-[#ff716c] text-lg">delete</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* History link */}
      {onNavigate && (
        <div>
          <h3 className="text-[#777] text-xs font-bold uppercase tracking-wider mb-2">Histórico</h3>
          <button onClick={() => onNavigate('history')}
            className="w-full flex items-center gap-3 p-3 bg-[#1a1919] rounded-lg active:scale-[0.98] transition-transform">
            <span className="material-symbols-outlined text-[#3fff8b]">history</span>
            <span className="text-white font-bold text-sm">Histórico de Rides</span>
          </button>
        </div>
      )}

      {/* Pre-ride summary modal */}
      {showPreRide && activeRoute && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center">
          <div className="bg-[#1a1919] w-full max-w-md rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-white font-bold text-lg">{activeRoute.name}</h2>
              <button onClick={() => setShowPreRide(false)} className="text-[#777] active:scale-90">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Route stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#262626] p-2 rounded text-center">
                <div className="text-[#777] text-[8px] font-bold">DISTÂNCIA</div>
                <div className="text-white text-lg font-bold">{activeRoute.total_distance_km}<span className="text-[#777] text-xs">km</span></div>
              </div>
              <div className="bg-[#262626] p-2 rounded text-center">
                <div className="text-[#777] text-[8px] font-bold">ELEVAÇÃO</div>
                <div className="text-white text-lg font-bold">▲{activeRoute.total_elevation_gain_m}<span className="text-[#777] text-xs">m</span></div>
              </div>
              <div className="bg-[#262626] p-2 rounded text-center">
                <div className="text-[#777] text-[8px] font-bold">GRADIENTE MAX</div>
                <div className="text-white text-lg font-bold">{activeRoute.max_gradient_pct}<span className="text-[#777] text-xs">%</span></div>
              </div>
            </div>

            {/* Pre-ride analysis */}
            {analyzing && <p className="text-[#6e9bff] text-xs text-center">A analisar rota...</p>}
            {preRide && (
              <div className="space-y-2">
                {/* Feasibility */}
                <div className={`p-3 rounded-lg flex items-center gap-3 ${preRide.feasible ? 'bg-[#3fff8b]/10 border border-[#3fff8b]/30' : 'bg-[#ff716c]/10 border border-[#ff716c]/30'}`}>
                  <span className="material-symbols-outlined text-2xl" style={{ color: preRide.feasible ? '#3fff8b' : '#ff716c' }}>
                    {preRide.feasible ? 'check_circle' : 'warning'}
                  </span>
                  <div>
                    <p className="text-sm font-bold" style={{ color: preRide.feasible ? '#3fff8b' : '#ff716c' }}>
                      {preRide.feasible ? 'Rota Viável' : 'Bateria Insuficiente'}
                    </p>
                    <p className="text-[10px] text-[#999]">
                      {preRide.total_wh}Wh necessários · {preRide.battery_remaining_wh}Wh disponíveis · {preRide.battery_margin_pct}% margem
                    </p>
                  </div>
                </div>

                {/* Estimates grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#262626] p-2 rounded">
                    <span className="text-[#777]">Tempo estimado:</span> <span className="text-white font-bold">{preRide.estimated_time_min} min</span>
                  </div>
                  <div className="bg-[#262626] p-2 rounded">
                    <span className="text-[#777]">Segmentos exigentes:</span> <span className="text-[#fbbf24] font-bold">{preRide.demanding_segments}</span>
                  </div>
                  <div className="bg-[#262626] p-2 rounded">
                    <span className="text-[#777]">Carboidratos:</span> <span className="text-white font-bold">{preRide.carbs_needed_g}g</span>
                  </div>
                  <div className="bg-[#262626] p-2 rounded">
                    <span className="text-[#777]">Hidratação:</span> <span className="text-white font-bold">{preRide.fluid_needed_ml}ml</span>
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowPreRide(false)}
                className="flex-1 h-12 rounded-lg bg-[#262626] text-[#adaaaa] font-bold text-sm active:scale-95">
                Guardar
              </button>
              <button onClick={handleStartNav}
                className="flex-1 h-12 rounded-lg bg-[#3fff8b] text-black font-bold text-sm active:scale-95 flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-lg">navigation</span>
                Iniciar Navegação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function EmergencyPage() {
  const profile = useSettingsStore((s) => s.riderProfile);
  const updateProfile = useSettingsStore((s) => s.updateRiderProfile);
  const user = useAuthStore((s) => s.user);

  const [bloodType, setBloodType] = useState(profile.blood_type ?? '');
  const [allergies, setAllergies] = useState((profile.allergies ?? []).join(', '));
  const [medications, setMedications] = useState((profile.medications ?? []).join(', '));
  const [conditions, setConditions] = useState((profile.medical_conditions ?? []).join(', '));
  const [healthInsurance, setHealthInsurance] = useState(profile.health_insurance ?? '');
  const [organDonor, setOrganDonor] = useState(profile.organ_donor ?? false);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [nationality, setNationality] = useState(profile.nationality ?? '');
  const [idNumber, setIdNumber] = useState(profile.id_number ?? '');
  const [addressStr, setAddressStr] = useState(profile.address?.formatted ?? '');
  const [city, setCity] = useState(profile.address?.city ?? '');
  const [country, setCountry] = useState(profile.address?.country ?? '');

  // Emergency contacts
  const [contacts, setContacts] = useState(profile.emergency_contacts ?? []);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRelation, setNewRelation] = useState('spouse');

  // QR
  const [qrToken, setQrToken] = useState(profile.emergency_qr_token ?? '');
  const [syncing, setSyncing] = useState(false);

  const save = () => {
    const patch = {
      blood_type: bloodType || undefined,
      allergies: allergies ? allergies.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
      medications: medications ? medications.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
      medical_conditions: conditions ? conditions.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
      health_insurance: healthInsurance || undefined,
      organ_donor: organDonor,
      phone: phone || undefined,
      nationality: nationality || undefined,
      id_number: idNumber || undefined,
      address: (addressStr || city || country) ? { formatted: addressStr, city, country } : undefined,
      emergency_contacts: contacts,
      emergency_qr_token: qrToken || undefined,
    };
    updateProfile(patch);
  };

  const addContact = () => {
    if (!newName || !newPhone) return;
    const updated = [...contacts, { name: newName, phone: newPhone, relation: newRelation }];
    setContacts(updated);
    setNewName(''); setNewPhone('');
    updateProfile({ emergency_contacts: updated });
  };

  const removeContact = (i: number) => {
    const updated = contacts.filter((_, idx) => idx !== i);
    setContacts(updated);
    updateProfile({ emergency_contacts: updated });
  };

  // Generate & sync emergency profile to Supabase
  const syncEmergencyProfile = async () => {
    if (!user?.id) return;
    setSyncing(true);

    // Regenerate if token was truncated by old bug (.slice(0,12))
    const validToken = qrToken && qrToken.length >= 32 ? qrToken : null;
    const token = validToken || crypto.randomUUID();
    if (!validToken) { setQrToken(token); updateProfile({ emergency_qr_token: token }); }

    const body = {
      user_id: user.id,
      token,
      name: profile.name,
      birthdate: profile.birthdate,
      gender: profile.gender,
      phone: phone,
      blood_type: bloodType,
      allergies: allergies ? allergies.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      medications: medications ? medications.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      medical_conditions: conditions ? conditions.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      medical_notes: profile.medical_notes,
      organ_donor: organDonor,
      health_insurance: healthInsurance,
      emergency_contacts: contacts,
      address_city: profile.address?.city,
      address_country: profile.address?.country,
      avatar_url: profile.avatar_url,
      weight_kg: profile.weight_kg,
      height_cm: profile.height_cm,
      active: true,
    };

    try {
      await supaFetch(`/rest/v1/emergency_profiles?token=eq.${token}`, {
        method: 'DELETE',
      });
      await supaFetch('/rest/v1/emergency_profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(body),
      });
    } catch { /* ignore */ }
    setSyncing(false);
  };

  const emergencyUrl = qrToken ? `${window.location.origin}/emergency.html?t=${qrToken}` : '';

  // ── Live Tracking state (always-on) ─────────────────────────
  const bleStatus = useBikeStore((s) => s.ble_status);
  const liveActive = isLiveBroadcasting();
  const liveUrl = getShareUrl() ?? '';
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);

  // Render QR when URL is available
  useEffect(() => {
    if (liveCanvasRef.current && liveUrl) {
      QRCode.toCanvas(liveCanvasRef.current, liveUrl, {
        width: 160,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    }
  }, [liveUrl]);

  return (
    <div className="space-y-4">
      {/* Live Tracking — always-on */}
      <SectionLabel>Live Tracking</SectionLabel>
      <Card>
        <div className="space-y-3">
          {/* Status indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {liveActive ? (
              <>
                <span style={{
                  display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%',
                  backgroundColor: '#ff3333', boxShadow: '0 0 8px #ff3333',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
                <span style={{ fontSize: '14px', fontWeight: 900, color: '#ff3333', letterSpacing: '0.1em' }}>LIVE</span>
              </>
            ) : (
              <>
                <span style={{
                  display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%',
                  backgroundColor: bleStatus === 'connected' ? '#fbbf24' : '#494847',
                }} />
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#888' }}>
                  {bleStatus === 'connected' ? 'A ligar...' : 'Inactivo'}
                </span>
              </>
            )}
          </div>

          {/* Explanation */}
          <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.5 }}>
            O tracking inicia automaticamente quando a bike liga via Bluetooth.
          </div>

          {liveUrl ? (
            <>
              {/* Share link */}
              <div style={{ fontSize: '10px', color: '#adaaaa', wordBreak: 'break-all', padding: '8px', backgroundColor: '#1a1919', borderRadius: '4px' }}>
                {liveUrl}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => navigator.clipboard.writeText(liveUrl)}
                  style={{
                    flex: 1, padding: '10px', fontSize: '11px', fontWeight: 700, border: '1px solid rgba(63,255,139,0.25)', cursor: 'pointer', borderRadius: '4px',
                    backgroundColor: 'rgba(63,255,139,0.12)', color: '#3fff8b',
                  }}
                >
                  Copiar link
                </button>
                <button
                  onClick={() => navigator.share?.({ title: 'KROMI Live Tracking', url: liveUrl })}
                  style={{
                    flex: 1, padding: '10px', fontSize: '11px', fontWeight: 700, border: '1px solid rgba(110,155,255,0.25)', cursor: 'pointer', borderRadius: '4px',
                    backgroundColor: 'rgba(110,155,255,0.12)', color: '#6e9bff',
                  }}
                >
                  Partilhar
                </button>
              </div>

              {/* QR Code */}
              <div style={{ textAlign: 'center', marginTop: '4px' }}>
                <div style={{ display: 'inline-block', padding: '10px', backgroundColor: 'white', borderRadius: '8px' }}>
                  <canvas ref={liveCanvasRef} width={160} height={160} style={{ display: 'block' }} />
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: '11px', color: '#ff716c' }}>
              Configura o perfil de emergencia e sincroniza para activar o live tracking.
            </div>
          )}
        </div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </Card>

      {/* Blood type */}
      <SectionLabel>Tipo Sanguineo</SectionLabel>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
          {BLOOD_TYPES.map((bt) => (
            <button key={bt} onClick={() => { setBloodType(bt); save(); }}
              style={{
                width: '52px', height: '44px', fontWeight: 900, fontSize: '16px', border: 'none', cursor: 'pointer', borderRadius: '4px',
                backgroundColor: bloodType === bt ? '#ff3333' : '#262626',
                color: bloodType === bt ? 'white' : '#777575',
              }}>{bt}</button>
          ))}
        </div>
      </Card>

      {/* Personal identification */}
      <SectionLabel>Identificacao</SectionLabel>
      <Card>
        <TextField label="Telefone pessoal" value={phone} onChange={(v) => { setPhone(v); save(); }} />
        <TextField label="Nacionalidade" value={nationality} onChange={(v) => { setNationality(v); save(); }} />
        <TextField label="Nr. CC / Passaporte" value={idNumber} onChange={(v) => { setIdNumber(v); save(); }} />
      </Card>

      {/* Address */}
      <SectionLabel>Morada</SectionLabel>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Morada</span>
          <input type="text" value={addressStr} onChange={(e) => { setAddressStr(e.target.value); save(); }}
            placeholder="Rua, Nr..." style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', width: '180px', textAlign: 'right', fontSize: '12px' }} />
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <div style={{ flex: 2 }}>
            <input type="text" value={city} onChange={(e) => { setCity(e.target.value); save(); }}
              placeholder="Cidade" style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', fontSize: '12px' }} />
          </div>
          <div style={{ flex: 1 }}>
            <input type="text" value={country} onChange={(e) => { setCountry(e.target.value); save(); }}
              placeholder="Pais" style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', fontSize: '12px' }} />
          </div>
        </div>
      </Card>

      {/* Medical alerts */}
      <SectionLabel>Alertas Medicos</SectionLabel>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Alergias</span>
          <input type="text" value={allergies} onChange={(e) => { setAllergies(e.target.value); save(); }}
            placeholder="Penicilina, Latex..." style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', width: '180px', textAlign: 'right', fontSize: '12px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Medicacao</span>
          <input type="text" value={medications} onChange={(e) => { setMedications(e.target.value); save(); }}
            placeholder="Aspirina, Metformina..." style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', width: '180px', textAlign: 'right', fontSize: '12px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Condicoes</span>
          <input type="text" value={conditions} onChange={(e) => { setConditions(e.target.value); save(); }}
            placeholder="Asma, Diabetes..." style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', width: '180px', textAlign: 'right', fontSize: '12px' }} />
        </div>
        <TextField label="Seguro saude" value={healthInsurance} onChange={(v) => { setHealthInsurance(v); save(); }} />
        <Toggle label="Dador de orgaos" value={organDonor} onChange={(v) => { setOrganDonor(v); save(); }} />
      </Card>

      {/* Emergency contacts */}
      <SectionLabel>Contactos de Emergencia</SectionLabel>
      <Card>
        {contacts.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #262626' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{c.name}</div>
              <div style={{ fontSize: '11px', color: '#888' }}>{c.relation} — {c.phone}</div>
            </div>
            <button onClick={() => removeContact(i)} style={{ background: 'none', border: 'none', color: '#ff716c', cursor: 'pointer', fontSize: '18px' }}>x</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome"
            style={{ flex: 1, minWidth: '80px', backgroundColor: '#262626', color: 'white', padding: '6px 8px', border: 'none', fontSize: '12px' }} />
          <input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Telefone"
            style={{ flex: 1, minWidth: '80px', backgroundColor: '#262626', color: 'white', padding: '6px 8px', border: 'none', fontSize: '12px' }} />
          <select value={newRelation} onChange={(e) => setNewRelation(e.target.value)}
            style={{ backgroundColor: '#262626', color: 'white', padding: '6px', border: 'none', fontSize: '11px' }}>
            <option value="spouse">Conjuge</option>
            <option value="parent">Pai/Mae</option>
            <option value="sibling">Irmao/a</option>
            <option value="friend">Amigo/a</option>
            <option value="coach">Treinador</option>
            <option value="other">Outro</option>
          </select>
          <button onClick={addContact}
            style={{ padding: '6px 12px', backgroundColor: '#3fff8b', color: 'black', border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>+</button>
        </div>
      </Card>

      {/* Community rescue opt-in */}
      <SectionLabel>Rede de Ajuda Comunitaria</SectionLabel>
      <Card>
        <div style={{ fontSize: '11px', color: '#adaaaa', marginBottom: '8px' }}>
          Activa para ficares visivel como prestador de ajuda para ciclistas proximos em emergencia. A tua localizacao so e partilhada enquanto tens uma sessao activa.
        </div>
        <Toggle label="Disponivel para ajuda" value={profile.rescue_available ?? false} onChange={(v) => updateProfile({ rescue_available: v })} />
      </Card>

      {/* QR Code generation */}
      <SectionLabel>QR de Emergencia</SectionLabel>
      <Card>
        <div style={{ fontSize: '11px', color: '#adaaaa', marginBottom: '8px' }}>
          Gera um QR code que qualquer pessoa pode ler em caso de acidente. Mostra tipo sanguineo, alergias, contactos de emergencia e dados cardiacos das ultimas 24h.
        </div>
        <button onClick={syncEmergencyProfile} disabled={syncing}
          style={{
            width: '100%', height: '48px', fontWeight: 700, fontSize: '14px', border: 'none', cursor: 'pointer', borderRadius: '4px',
            backgroundColor: syncing ? '#262626' : '#ff3333', color: 'white',
          }}>
          {syncing ? 'A sincronizar...' : qrToken ? 'Actualizar Perfil Emergencia' : 'Gerar QR de Emergencia'}
        </button>
        {emergencyUrl && (
          <div style={{ marginTop: '12px', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', padding: '12px', backgroundColor: 'white', borderRadius: '8px' }}>
              <canvas ref={(el) => { if (el) QRCode.toCanvas(el, emergencyUrl, { width: 180, margin: 1, color: { dark: '#cc0000', light: '#ffffff' }, errorCorrectionLevel: 'M' }); }} width={180} height={180} style={{ display: 'block' }} />
            </div>
            <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px', wordBreak: 'break-all' }}>{emergencyUrl}</div>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '8px' }}>
              <button onClick={() => navigator.clipboard.writeText(emergencyUrl)}
                style={{ padding: '8px 14px', fontSize: '10px', fontWeight: 700, backgroundColor: 'rgba(255,51,51,0.15)', color: '#ff3333', border: '1px solid rgba(255,51,51,0.25)', cursor: 'pointer' }}>
                Copiar link
              </button>
              <button onClick={() => navigator.share?.({ title: 'KROMI Emergency', url: emergencyUrl })}
                style={{ padding: '8px 14px', fontSize: '10px', fontWeight: 700, backgroundColor: '#262626', color: 'white', border: '1px solid #333', cursor: 'pointer' }}>
                Partilhar
              </button>
            </div>
            <div style={{ fontSize: '9px', color: '#ff716c', marginTop: '8px' }}>
              Cola este QR no capacete, bicicleta ou braceleira. Em caso de acidente, qualquer pessoa pode ler e ver os teus dados medicos.
            </div>
          </div>
        )}
      </Card>
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
      <div style={{ textAlign: 'center', fontSize: '10px', color: '#494847', marginTop: '16px' }}>KROMI BikeControl {APP_VERSION}</div>
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
