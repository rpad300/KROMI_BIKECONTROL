import { useState } from 'react';
import { useSettingsStore, safeBikeConfig, type BikeConfig } from '../../store/settingsStore';
import { calculateZones } from '../../types/athlete.types';
import { useBikeStore } from '../../store/bikeStore';
import { useAuthStore } from '../../store/authStore';
import { useLearningStore } from '../../store/learningStore';
import { connectBike, disconnectBike } from '../../services/bluetooth/BLEBridge';
import { ProfileInsightsWidget } from '../Dashboard/ProfileInsightsWidget';
// TuningPreview removed — config is now read-only from motor telemetry
import { importKomootRoute } from '../../services/maps/KomootService';

type Screen = 'dashboard' | 'map' | 'climb' | 'connections' | 'settings' | 'history';
type SettingsPage = 'menu' | 'rider' | 'bike' | 'kromi' | 'bluetooth' | 'routes' | 'account';

const MENU_ITEMS: { id: SettingsPage; icon: string; label: string; desc: string; color: string }[] = [
  { id: 'rider', icon: 'person', label: 'Perfil Ciclista', desc: 'Idade, peso, HR, zonas cardíacas', color: '#ff716c' },
  { id: 'bike', icon: 'pedal_bike', label: 'Bicicleta', desc: 'Bateria, motor, consumo, tuning', color: '#3fff8b' },
  { id: 'kromi', icon: 'psychology', label: 'KROMI Intelligence', desc: 'Auto-assist, aprendizagem, atleta', color: '#e966ff' },
  { id: 'bluetooth', icon: 'bluetooth', label: 'Bluetooth', desc: 'Ligação, sensores, estado', color: '#6e9bff' },
  { id: 'routes', icon: 'route', label: 'Rotas', desc: 'Import Komoot, histórico', color: '#fbbf24' },
  { id: 'account', icon: 'account_circle', label: 'Conta', desc: 'Email, sessão, versão', color: '#adaaaa' },
];

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
            {MENU_ITEMS.find((m) => m.id === activePage)?.label ?? 'Settings'}
          </span>
        </div>
      )}
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {activePage === 'rider' && <RiderPage />}
        {activePage === 'bike' && <BikePage />}
        {activePage === 'kromi' && <KromiPage />}
        {activePage === 'bluetooth' && <BluetoothPage />}
        {activePage === 'routes' && <RoutesPage onNavigate={onNavigate} />}
        {activePage === 'account' && <AccountPage />}
      </div>
    </div>
  );
}

function SettingsMenu({ onSelect, onNavigate }: { onSelect: (p: SettingsPage) => void; onNavigate?: (s: Screen) => void }) {
  return (
    <div style={{ padding: '12px', backgroundColor: '#0e0e0e', minHeight: '100%' }}>
      <h1 className="font-headline font-bold" style={{ fontSize: '22px', color: '#3fff8b', marginBottom: '16px', paddingLeft: '4px' }}>Setup</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {MENU_ITEMS.map(({ id, icon, label, desc, color }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 12px',
              backgroundColor: '#1a1919', border: 'none', cursor: 'pointer', textAlign: 'left',
              borderLeft: `3px solid ${color}`, width: '100%',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '22px', color, flexShrink: 0 }}>{icon}</span>
            <div style={{ flex: 1 }}>
              <div className="font-headline font-bold" style={{ fontSize: '14px', color: 'white' }}>{label}</div>
              <div style={{ fontSize: '10px', color: '#777575', marginTop: '1px' }}>{desc}</div>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#494847' }}>chevron_right</span>
          </button>
        ))}

        {/* History link */}
        {onNavigate && (
          <button
            onClick={() => onNavigate('history')}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 12px',
              backgroundColor: '#1a1919', border: 'none', cursor: 'pointer', textAlign: 'left',
              borderLeft: '3px solid #3fff8b', width: '100%', marginTop: '8px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#3fff8b' }}>history</span>
            <div style={{ flex: 1 }}>
              <div className="font-headline font-bold" style={{ fontSize: '14px', color: 'white' }}>Histórico de Rides</div>
              <div style={{ fontSize: '10px', color: '#777575' }}>Sessões anteriores</div>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#494847' }}>chevron_right</span>
          </button>
        )}
      </div>
      <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '10px', color: '#494847' }}>KROMI BikeControl v0.9.5</div>
    </div>
  );
}

// === SUB-PAGES ===

function RiderPage() {
  const profile = useSettingsStore((s) => s.riderProfile);
  const updateProfile = useSettingsStore((s) => s.updateRiderProfile);
  const [riderName, setRiderName] = useState(profile.name ?? '');
  const [birthdate, setBirthdate] = useState(profile.birthdate ?? '');
  const [gender, setGender] = useState(profile.gender ?? '');
  const [clubSearch, setClubSearch] = useState('');
  const [clubs, setClubs] = useState<{ id: string; name: string; color: string; location: string; member_count: number }[]>([]);
  const [showClubCreate, setShowClubCreate] = useState(false);
  const [newClubName, setNewClubName] = useState('');
  const [newClubLocation, setNewClubLocation] = useState('');
  const [newClubColor, setNewClubColor] = useState('#3fff8b');
  const [privacyName, setPrivacyName] = useState<string>(profile.privacy?.name ?? 'club');
  const [privacyStats, setPrivacyStats] = useState<string>(profile.privacy?.stats ?? 'club');

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  // Search clubs
  const searchClubs = async (q: string) => {
    if (!SUPABASE_URL || q.length < 2) { setClubs([]); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/clubs?name=ilike.*${encodeURIComponent(q)}*&select=id,name,color,location,member_count&limit=10`, {
        headers: { 'apikey': SUPABASE_KEY },
      });
      if (res.ok) setClubs(await res.json());
    } catch { /* ignore */ }
  };

  // Create club
  const createClub = async () => {
    if (!SUPABASE_URL || !newClubName.trim()) return;
    const userId = useAuthStore.getState().getUserId();
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/clubs`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ name: newClubName.trim(), location: newClubLocation, color: newClubColor, created_by: userId }),
      });
      if (res.ok) {
        const [club] = await res.json();
        updateProfile({ club_id: club.id, club_name: club.name });
        // Add as member
        await fetch(`${SUPABASE_URL}/rest/v1/club_members`, {
          method: 'POST',
          headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ club_id: club.id, user_id: userId, role: 'admin', display_name: riderName }),
        });
        setShowClubCreate(false);
        setNewClubName('');
      }
    } catch { /* ignore */ }
  };

  // Join club
  const joinClub = async (club: { id: string; name: string }) => {
    updateProfile({ club_id: club.id, club_name: club.name });
    const userId = useAuthStore.getState().getUserId();
    if (SUPABASE_URL && userId) {
      fetch(`${SUPABASE_URL}/rest/v1/club_members`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify({ club_id: club.id, user_id: userId, display_name: riderName }),
      }).catch(() => {});
    }
    setClubSearch('');
    setClubs([]);
  };

  // Save personal fields + auto-calculate age from birthdate
  const savePersonal = () => {
    const age = birthdate ? Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : profile.age;
    const autoHrMax = profile.hr_max === 0 || profile.hr_max === (220 - profile.age) ? 220 - age : profile.hr_max;
    updateProfile({
      name: riderName, birthdate, gender, age,
      hr_max: autoHrMax,
      privacy: { name: privacyName, stats: privacyStats },
    });
  };

  return (
    <div className="space-y-4">
      {/* Personal info */}
      <SectionLabel>Dados Pessoais</SectionLabel>
      <Card>
        <TextField label="Nome" value={riderName} onChange={(v) => { setRiderName(v); savePersonal(); }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Data nascimento</span>
          <input type="date" value={birthdate} onChange={(e) => { setBirthdate(e.target.value); savePersonal(); }}
            style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', fontSize: '13px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Género</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {['M', 'F', 'Outro'].map((g) => (
              <button key={g} onClick={() => { setGender(g); savePersonal(); }} style={{
                padding: '4px 12px', fontSize: '11px', fontWeight: 700, border: 'none', cursor: 'pointer',
                backgroundColor: gender === g ? '#3fff8b' : '#262626', color: gender === g ? 'black' : '#adaaaa',
              }}>{g}</button>
            ))}
          </div>
        </div>
      </Card>

      {/* Club */}
      <SectionLabel>Clube</SectionLabel>
      <Card>
        {profile.club_name ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#3fff8b' }} />
              <span className="font-headline font-bold" style={{ fontSize: '14px', color: 'white' }}>{profile.club_name}</span>
            </div>
            <button onClick={() => updateProfile({ club_id: undefined, club_name: undefined })} style={{ fontSize: '10px', color: '#ff716c', background: 'none', border: 'none', cursor: 'pointer' }}>Sair</button>
          </div>
        ) : (
          <>
            <div style={{ position: 'relative' }}>
              <input type="text" value={clubSearch} onChange={(e) => { setClubSearch(e.target.value); searchClubs(e.target.value); }} placeholder="Procurar clube..."
                style={{ width: '100%', backgroundColor: '#262626', color: 'white', padding: '10px', border: 'none', fontSize: '13px' }} />
              {clubs.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, backgroundColor: '#1a1919', border: '1px solid #494847', maxHeight: '150px', overflow: 'auto' }}>
                  {clubs.map((c) => (
                    <button key={c.id} onClick={() => joinClub(c)} style={{
                      width: '100%', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', borderBottom: '1px solid #262626', cursor: 'pointer', textAlign: 'left',
                    }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: c.color }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12px', color: 'white', fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: '9px', color: '#777575' }}>{c.location} · {c.member_count} membros</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowClubCreate(true)} style={{
              width: '100%', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              backgroundColor: '#262626', border: '1px dashed #494847', cursor: 'pointer', color: '#adaaaa', fontSize: '11px',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add</span>
              Criar novo clube
            </button>
          </>
        )}
      </Card>

      {/* Create club dialog */}
      {showClubCreate && (
        <Card>
          <span className="font-headline font-bold" style={{ fontSize: '13px', color: '#3fff8b' }}>Novo Clube</span>
          <TextField label="Nome" value={newClubName} onChange={setNewClubName} />
          <TextField label="Localização" value={newClubLocation} onChange={setNewClubLocation} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#adaaaa', fontSize: '13px' }}>Cor</span>
            <input type="color" value={newClubColor} onChange={(e) => setNewClubColor(e.target.value)} style={{ width: '40px', height: '30px', border: 'none', cursor: 'pointer' }} />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={createClub} style={{ flex: 1, padding: '10px', backgroundColor: '#3fff8b', color: 'black', border: 'none', fontWeight: 700, cursor: 'pointer' }}>Criar</button>
            <button onClick={() => setShowClubCreate(false)} style={{ padding: '10px', backgroundColor: '#262626', color: '#adaaaa', border: 'none', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </Card>
      )}

      {/* Privacy settings */}
      <SectionLabel>Privacidade</SectionLabel>
      <Card>
        <PrivacyToggle label="Nome" value={privacyName} onChange={(v) => { setPrivacyName(v); savePersonal(); }} />
        <PrivacyToggle label="Estatísticas" value={privacyStats} onChange={(v) => { setPrivacyStats(v); savePersonal(); }} />
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px' }}>
          Público: todos vêem · Clube: só membros do clube · Privado: só tu
        </div>
      </Card>

      {/* Physical profile */}
      <SectionLabel>Perfil Físico</SectionLabel>
      <Card>
        {/* Age auto-calculated from birthdate */}
        {birthdate ? (
          <ReadOnlyRow label="Idade" value={`${Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} anos`} color="#3fff8b" />
        ) : (
          <div style={{ fontSize: '10px', color: '#fbbf24' }}>⚠ Preenche a data de nascimento para calcular a idade</div>
        )}
        <NumberField label="Peso (kg)" value={profile.weight_kg} onChange={(v) => updateProfile({ weight_kg: v })} />
        <NumberField label="Altura (cm)" value={profile.height_cm ?? 175} onChange={(v) => updateProfile({ height_cm: v })} />
      </Card>

      <SectionLabel>Zonas Cardíacas</SectionLabel>
      <Card>
        {/* FC source indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px', color: profile.hr_max > 180 ? '#3fff8b' : '#fbbf24' }}>
            {profile.hr_max > 180 ? 'verified' : 'info'}
          </span>
          <span style={{ fontSize: '10px', color: '#adaaaa' }}>
            {profile.hr_max > 0 && profile.hr_max !== (220 - (profile.age || 30))
              ? 'FC Máxima configurada manualmente ou detectada'
              : 'FC Máxima estimada pela idade (220-idade) — será ajustada com dados reais'}
          </span>
        </div>

        {/* HR Max — editable with estimate helper */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>FC Máxima (bpm)</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="number" value={profile.hr_max} onChange={(e) => updateProfile({ hr_max: Number(e.target.value) })}
              style={{ backgroundColor: '#262626', color: 'white', padding: '6px 10px', border: 'none', width: '70px', textAlign: 'center', fontSize: '15px' }} className="tabular-nums" />
            {birthdate && (() => {
              const age = Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
              const estimated = 220 - age;
              return profile.hr_max !== estimated ? (
                <button onClick={() => updateProfile({ hr_max: estimated, age })} style={{ fontSize: '9px', color: '#6e9bff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Est: {estimated}
                </button>
              ) : null;
            })()}
          </div>
        </div>
        <NumberField label="FC Repouso (bpm)" value={profile.hr_rest} onChange={(v) => updateProfile({ hr_rest: v })} />

        {/* Zone visualization + target selector */}
        <div style={{ borderTop: '1px solid rgba(73,72,71,0.2)', marginTop: '8px', paddingTop: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', color: '#adaaaa' }}>Seleciona a zona alvo para o KROMI</span>
          </div>
        </div>
        <div className="space-y-1.5">
          {calculateZones(profile.hr_max).map((zone, i) => {
            const isTarget = (profile.target_zone ?? 2) === i + 1;
            return (
              <button key={zone.name} onClick={() => updateProfile({ target_zone: i + 1 })}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', backgroundColor: isTarget ? 'rgba(63,255,139,0.1)' : '#262626', border: isTarget ? '1px solid rgba(63,255,139,0.3)' : '1px solid transparent', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: zone.color }} />
                  <span style={{ fontSize: '12px', color: 'white', fontWeight: 700 }}>{zone.name}</span>
                  <span style={{ fontSize: '10px', color: '#777575' }}>{zone.min_bpm}-{zone.max_bpm}bpm</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '9px', color: '#494847' }}>{zone.description}</span>
                  {isTarget && <span style={{ fontSize: '8px', padding: '2px 6px', backgroundColor: '#3fff8b', color: 'black', fontWeight: 900 }}>ALVO</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '8px' }}>
          Valores iniciais baseados na fórmula 220-idade. O KROMI ajusta automaticamente com dados das tuas voltas (FC max observada, tempo em zona, padrões de esforço).
        </div>
      </Card>

      <SectionLabel>Perfil Atleta</SectionLabel>
      <ProfileInsightsWidget />
    </div>
  );
}

function BikePage() {
  const bike = safeBikeConfig(useSettingsStore((s) => s.bikeConfig));
  const bikes = useSettingsStore((s) => s.bikes);
  const activeBikeId = useSettingsStore((s) => s.activeBikeId);
  const updateBike = useSettingsStore((s) => s.updateBikeConfig);
  const addBike = useSettingsStore((s) => s.addBike);
  const removeBike = useSettingsStore((s) => s.removeBike);
  const selectBike = useSettingsStore((s) => s.selectBike);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'ebike' | 'mechanical'>('mechanical');

  const isEBike = bike.bike_type === 'ebike';

  return (
    <div className="space-y-4">
      {/* Bike selector */}
      <SectionLabel>As minhas bicicletas</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {bikes.map((b) => (
          <div key={b.id} style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
            backgroundColor: b.id === activeBikeId ? '#262626' : '#1a1919',
            borderLeft: `3px solid ${b.bike_type === 'ebike' ? '#3fff8b' : '#6e9bff'}`,
          }}>
            <button onClick={() => selectBike(b.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: b.bike_type === 'ebike' ? '#3fff8b' : '#6e9bff' }}>
                {b.bike_type === 'ebike' ? 'electric_bike' : 'pedal_bike'}
              </span>
              <div>
                <div className="font-headline font-bold" style={{ fontSize: '13px', color: 'white' }}>{b.name}</div>
                <div style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase' }}>{b.bike_type === 'ebike' ? 'Elétrica' : 'Mecânica'}</div>
              </div>
            </button>
            {b.id === activeBikeId && <span style={{ fontSize: '8px', padding: '2px 6px', backgroundColor: '#3fff8b', color: 'black', fontWeight: 900 }}>ACTIVA</span>}
            {bikes.length > 1 && (
              <button onClick={() => { if (confirm(`Apagar ${b.name}?`)) removeBike(b.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#ff716c' }}>delete</span>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add bike */}
      {showAdd ? (
        <Card>
          <span className="font-headline font-bold" style={{ fontSize: '13px', color: '#3fff8b' }}>Adicionar Bicicleta</span>
          <TextField label="Nome" value={newName} onChange={setNewName} />
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => setNewType('ebike')} style={{
              flex: 1, padding: '10px', border: 'none', cursor: 'pointer', textAlign: 'center',
              backgroundColor: newType === 'ebike' ? '#3fff8b' : '#262626', color: newType === 'ebike' ? 'black' : '#adaaaa',
              fontWeight: 700, fontSize: '12px',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px', display: 'block', marginBottom: '2px' }}>electric_bike</span>
              Elétrica
            </button>
            <button onClick={() => setNewType('mechanical')} style={{
              flex: 1, padding: '10px', border: 'none', cursor: 'pointer', textAlign: 'center',
              backgroundColor: newType === 'mechanical' ? '#6e9bff' : '#262626', color: newType === 'mechanical' ? 'black' : '#adaaaa',
              fontWeight: 700, fontSize: '12px',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px', display: 'block', marginBottom: '2px' }}>pedal_bike</span>
              Mecânica
            </button>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => { if (newName.trim()) { addBike({ name: newName.trim(), bike_type: newType }); setShowAdd(false); setNewName(''); } }}
              style={{ flex: 1, padding: '10px', backgroundColor: '#3fff8b', color: 'black', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              Adicionar
            </button>
            <button onClick={() => setShowAdd(false)}
              style={{ padding: '10px', backgroundColor: '#262626', color: '#adaaaa', border: 'none', fontSize: '13px', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </Card>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{
          width: '100%', padding: '10px', backgroundColor: '#1a1919', border: '1px dashed #494847', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: '#adaaaa', fontSize: '12px',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
          Adicionar bicicleta
        </button>
      )}

      {/* Bike config — only show fields relevant to type */}
      <SectionLabel>Configuração — {bike.name}</SectionLabel>
      <Card>
        <TextField label="Nome" value={bike.name} onChange={(v) => updateBike({ name: v })} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#adaaaa', fontSize: '13px' }}>Tipo</span>
          <span className="font-headline font-bold" style={{ color: isEBike ? '#3fff8b' : '#6e9bff', fontSize: '13px' }}>
            {isEBike ? '⚡ Elétrica' : '🚲 Mecânica'}
          </span>
        </div>
      </Card>

      {/* === E-BIKE ONLY SECTIONS (read-only from motor telemetry) === */}
      {isEBike && <EBikeReadOnlyInfo bike={bike} />}

      <SectionLabel>Bike Info</SectionLabel>
      <BikeInfoCard />
    </div>
  );
}

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

/** E-Bike info — all values auto-detected from motor, read-only display */
function EBikeReadOnlyInfo({ bike }: { bike: BikeConfig }) {
  const bat1 = useBikeStore((s) => s.battery_main_pct);
  const bat2 = useBikeStore((s) => s.battery_sub_pct);
  const motorOdo = useBikeStore((s) => s.motor_odo_km);
  const motorHours = useBikeStore((s) => s.motor_total_hours);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);
  const fw = useBikeStore((s) => s.firmware_version);
  const hw = useBikeStore((s) => s.hardware_version);
  const sw = useBikeStore((s) => s.software_version);

  const hasLive = bat1 > 0 || motorOdo > 0;

  return (
    <>
      <SectionLabel>Bateria {hasLive ? '(live do motor)' : '(config manual)'}</SectionLabel>
      <Card>
        <ReadOnlyRow label="Principal" value={`${bike.main_battery_wh} Wh`} />
        {bike.has_range_extender && <ReadOnlyRow label="Range Extender" value={`${bike.sub_battery_wh} Wh`} />}
        <ReadOnlyRow label="Total" value={`${bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0)} Wh`} color="#3fff8b" />
        {bat1 > 0 && (
          <>
            <div style={{ borderTop: '1px solid rgba(73,72,71,0.2)', marginTop: '4px', paddingTop: '8px' }} />
            <ReadOnlyRow label="Main SOC" value={`${bat1}%`} color={bat1 > 30 ? '#3fff8b' : '#fbbf24'} />
            {bat2 > 0 && <ReadOnlyRow label="Sub SOC" value={`${bat2}%`} color={bat2 > 30 ? '#3fff8b' : '#fbbf24'} />}
          </>
        )}
      </Card>

      <SectionLabel>Motor</SectionLabel>
      <Card>
        <ReadOnlyRow label="Modelo" value={bike.motor_name || 'Auto-detectado'} />
        <ReadOnlyRow label="Torque max" value={`${bike.max_torque_nm} Nm`} />
        <ReadOnlyRow label="Potência max" value={`${bike.max_power_w} W`} />
        <ReadOnlyRow label="Limite velocidade" value={`${bike.speed_limit_kmh} km/h`} />
        {motorOdo > 0 && <ReadOnlyRow label="Odómetro motor" value={`${motorOdo.toLocaleString()} km`} color="#6e9bff" />}
        {motorHours > 0 && <ReadOnlyRow label="Horas motor" value={`${motorHours} h`} />}
        {fw && <ReadOnlyRow label="Firmware" value={fw} />}
        {hw && <ReadOnlyRow label="Hardware" value={hw} />}
        {sw && <ReadOnlyRow label="Software" value={sw} />}
      </Card>

      {rangePerMode && (
        <>
          <SectionLabel>Autonomia por modo (do motor)</SectionLabel>
          <Card>
            {(['eco', 'tour', 'active', 'sport', 'power', 'smart'] as const).map((mode) => {
              const range = (rangePerMode as Record<string, number>)[mode] ?? 0;
              if (range <= 0) return null;
              const modeColors: Record<string, string> = { eco: '#3fff8b', tour: '#6e9bff', active: '#fbbf24', sport: '#fbbf24', power: '#ff716c', smart: '#e966ff' };
              return <ReadOnlyRow key={mode} label={mode.toUpperCase()} value={`${range} km`} color={modeColors[mode]} />;
            })}
          </Card>
        </>
      )}

      <SectionLabel>Consumo calibrado (auto do motor)</SectionLabel>
      <Card>
        <ReadOnlyRow label="ECO" value={`${bike.consumption_eco} Wh/km`} />
        <ReadOnlyRow label="TOUR" value={`${bike.consumption_tour} Wh/km`} />
        <ReadOnlyRow label="ACTIVE" value={`${bike.consumption_active} Wh/km`} />
        <ReadOnlyRow label="SPORT" value={`${bike.consumption_sport} Wh/km`} />
        <ReadOnlyRow label="POWER" value={`${bike.consumption_power} Wh/km`} />
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px' }}>
          Valores auto-calibrados a partir dos ranges do motor (cmd 17). Actualizam a cada 2 min durante a volta.
        </div>
      </Card>
    </>
  );
}

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

function BikeInfoCard() {
  const fw = useBikeStore((s) => s.firmware_version);
  const hw = useBikeStore((s) => s.hardware_version);
  const sw = useBikeStore((s) => s.software_version);
  const odo = useBikeStore((s) => s.motor_odo_km);
  const hours = useBikeStore((s) => s.motor_total_hours);
  if (!fw && !hw && !sw && !odo) return null;
  return (
    <Card>
      {fw && <InfoRow label="Firmware" value={fw} />}
      {hw && <InfoRow label="Hardware" value={hw} />}
      {sw && <InfoRow label="Software" value={sw} />}
      {odo > 0 && <InfoRow label="Motor ODO" value={`${odo.toLocaleString()} km`} />}
      {hours > 0 && <InfoRow label="Motor Hours" value={`${hours} h`} />}
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#adaaaa', fontSize: '12px' }}>{label}</span>
      <span className="font-headline tabular-nums" style={{ color: 'white', fontSize: '12px' }}>{value}</span>
    </div>
  );
}
