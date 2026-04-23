// ═══════════════════════════════════════════════════════════════
// ClubBackofficeTab — landing page configuration panel
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import {
  getClub,
  getMembers,
  updateClub,
  updateLandingConfig,
  Club,
  ClubTheme,
  LandingConfig,
  BoardMember,
  ClubMember,
} from '../../services/club/ClubService';

// ─── Types ────────────────────────────────────────────────────

interface Props {
  clubId: string;
}

type SectionKey = keyof Pick<
  LandingConfig,
  | 'show_members'
  | 'show_leaderboard'
  | 'show_map'
  | 'show_feed'
  | 'show_upcoming_rides'
  | 'show_board'
>;

interface SectionDef {
  key: SectionKey;
  label: string;
}

// ─── Constants ────────────────────────────────────────────────

const SECTIONS: SectionDef[] = [
  { key: 'show_members', label: 'Membros' },
  { key: 'show_leaderboard', label: 'Leaderboard Mensal' },
  { key: 'show_map', label: 'Mapa de Actividade' },
  { key: 'show_feed', label: 'Feed de Rides' },
  { key: 'show_upcoming_rides', label: 'Proximas Rides' },
  { key: 'show_board', label: 'Direccao / Board' },
];

const DEFAULT_CONFIG: LandingConfig = {
  show_members: true,
  show_leaderboard: true,
  show_map: true,
  show_feed: true,
  show_upcoming_rides: true,
  show_board: false,
  custom_about: '',
  board_members: [],
};

// ─── Styles ───────────────────────────────────────────────────

const s = {
  container: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  card: {
    background: '#1a1919',
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid #333',
  },
  sectionHeader: {
    color: '#fbbf24',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '1.2px',
    textTransform: 'uppercase' as const,
    marginBottom: '14px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid #262626',
  },
  rowLast: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
  },
  label: {
    color: '#e0e0e0',
    fontSize: '14px',
  },
  dot: (on: boolean): React.CSSProperties => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: on ? '#3fff8b' : '#333',
    border: on ? 'none' : '1px solid #555',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s',
  }),
  textarea: {
    width: '100%',
    background: '#262626',
    border: '1px solid #333',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '14px',
    padding: '10px',
    resize: 'vertical' as const,
    minHeight: '80px',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  boardMemberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 0',
    borderBottom: '1px solid #262626',
  },
  boardMemberName: {
    color: '#e0e0e0',
    fontSize: '14px',
    flex: 1,
  },
  boardMemberTitle: {
    color: '#e966ff',
    fontSize: '12px',
    flex: 1,
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: '#ff716c',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '0 4px',
    lineHeight: 1,
    flexShrink: 0,
  },
  addForm: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
    flexWrap: 'wrap' as const,
  },
  select: {
    background: '#262626',
    border: '1px solid #333',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '13px',
    padding: '8px 10px',
    flex: 1,
    minWidth: '120px',
    outline: 'none',
  },
  input: {
    background: '#262626',
    border: '1px solid #333',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '13px',
    padding: '8px 10px',
    flex: 1,
    minWidth: '100px',
    outline: 'none',
  },
  addBtn: {
    background: 'none',
    border: '1px solid #e966ff',
    borderRadius: '8px',
    color: '#e966ff',
    cursor: 'pointer',
    fontSize: '20px',
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  buttonsRow: {
    display: 'flex',
    gap: '10px',
  },
  saveBtn: {
    flex: 1,
    background: '#3fff8b',
    color: '#000',
    border: 'none',
    borderRadius: '12px',
    padding: '14px',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  previewBtn: {
    background: '#262626',
    color: '#6e9bff',
    border: '1px solid #333',
    borderRadius: '12px',
    padding: '14px 18px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  errorText: {
    color: '#ff716c',
    fontSize: '13px',
    textAlign: 'center' as const,
  },
  loadingText: {
    color: '#888',
    fontSize: '14px',
    textAlign: 'center' as const,
    padding: '32px 0',
  },
  successText: {
    color: '#3fff8b',
    fontSize: '12px',
    textAlign: 'center' as const,
  },
};

// ─── Component ────────────────────────────────────────────────

export default function ClubBackofficeTab({ clubId }: Props) {
  const [club, setClub] = useState<Club | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [config, setConfig] = useState<LandingConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Theme state
  const [theme, setTheme] = useState<ClubTheme>({
    color_primary: '#3fff8b',
    color_secondary: '#6366f1',
    font_heading: 'Fraunces',
    font_body: 'System',
  });

  // Add-board-member form state
  const [addUserId, setAddUserId] = useState('');
  const [addTitle, setAddTitle] = useState('');

  // ── Load ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([getClub(clubId), getMembers(clubId)])
      .then(([fetchedClub, fetchedMembers]) => {
        if (cancelled) return;
        if (fetchedClub) {
          setClub(fetchedClub);
          setConfig({ ...DEFAULT_CONFIG, ...fetchedClub.landing_config });
          setTheme(prev => ({
            ...prev,
            color_primary: fetchedClub.color ?? prev.color_primary,
            ...fetchedClub.theme,
          }));
        }
        setMembers(fetchedMembers);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar clube');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [clubId]);

  // ── Helpers ─────────────────────────────────────────────────

  function toggleSection(key: SectionKey) {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
    setSuccess(false);
  }

  function removeBoardMember(userId: string) {
    setConfig(prev => ({
      ...prev,
      board_members: (prev.board_members ?? []).filter(m => m.user_id !== userId),
    }));
    setSuccess(false);
  }

  function addBoardMember() {
    if (!addUserId || !addTitle.trim()) return;
    const member = members.find(m => m.user_id === addUserId);
    if (!member) return;

    const newEntry: BoardMember = {
      user_id: member.user_id,
      display_name: member.display_name,
      avatar_url: member.avatar_url,
      title: addTitle.trim(),
    };

    // Deduplicate — replace if already on board
    setConfig(prev => {
      const existing = (prev.board_members ?? []).filter(
        m => m.user_id !== newEntry.user_id,
      );
      return { ...prev, board_members: [...existing, newEntry] };
    });

    setAddUserId('');
    setAddTitle('');
    setSuccess(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await Promise.all([
        updateLandingConfig(clubId, config),
        updateClub(clubId, { theme }),
      ]);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar configuracao');
    } finally {
      setSaving(false);
    }
  }

  function handlePreview() {
    if (!club) return;
    window.open(`/club.html?s=${encodeURIComponent(club.slug)}`, '_blank', 'noopener');
  }

  // ── Render ──────────────────────────────────────────────────

  if (loading) {
    return <div style={s.loadingText}>A carregar...</div>;
  }

  if (error && !club) {
    return <div style={s.errorText}>{error}</div>;
  }

  const boardMembers = config.board_members ?? [];

  // Members not yet on the board (for the add dropdown)
  const availableToAdd = members.filter(
    m => !boardMembers.some(b => b.user_id === m.user_id),
  );

  return (
    <div style={s.container}>

      {/* ── 1. Section toggles ─────────────────────────────── */}
      <div style={s.card}>
        <div style={s.sectionHeader}>Seccoes da Landing Page</div>
        {SECTIONS.map((sec, idx) => {
          const isLast = idx === SECTIONS.length - 1;
          const on = !!config[sec.key];
          return (
            <div
              key={sec.key}
              style={isLast ? s.rowLast : s.row}
              onClick={() => toggleSection(sec.key)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && toggleSection(sec.key)}
              aria-pressed={on}
            >
              <span style={s.label}>{sec.label}</span>
              <span style={s.dot(on)} />
            </div>
          );
        })}
      </div>

      {/* ── 2. About text ──────────────────────────────────── */}
      <div style={s.card}>
        <div style={s.sectionHeader}>Sobre Nos</div>
        <textarea
          style={s.textarea}
          value={config.custom_about ?? ''}
          onChange={e => {
            setConfig(prev => ({ ...prev, custom_about: e.target.value }));
            setSuccess(false);
          }}
          placeholder="Escreve uma descricao para a pagina do clube..."
          rows={4}
        />
      </div>

      {/* ── 3. Theme ───────────────────────────────────────── */}
      <div style={s.card}>
        <div style={s.sectionHeader}>Tema</div>

        {/* Cor Primaria */}
        <div style={s.row}>
          <span style={s.label}>Cor Primaria</span>
          <input
            type="color"
            value={theme.color_primary ?? '#3fff8b'}
            onChange={e => {
              setTheme(prev => ({ ...prev, color_primary: e.target.value }));
              setSuccess(false);
            }}
            style={{
              width: '40px',
              height: '32px',
              border: '1px solid #333',
              borderRadius: '6px',
              background: '#262626',
              cursor: 'pointer',
              padding: '2px',
            }}
            aria-label="Cor primaria"
          />
        </div>

        {/* Cor Secundaria */}
        <div style={s.row}>
          <span style={s.label}>Cor Secundaria</span>
          <input
            type="color"
            value={theme.color_secondary ?? '#6366f1'}
            onChange={e => {
              setTheme(prev => ({ ...prev, color_secondary: e.target.value }));
              setSuccess(false);
            }}
            style={{
              width: '40px',
              height: '32px',
              border: '1px solid #333',
              borderRadius: '6px',
              background: '#262626',
              cursor: 'pointer',
              padding: '2px',
            }}
            aria-label="Cor secundaria"
          />
        </div>

        {/* Font Titulos */}
        <div style={s.row}>
          <span style={s.label}>Font Titulos</span>
          <select
            style={{ ...s.select, flex: 'none', width: '180px' }}
            value={theme.font_heading ?? 'Fraunces'}
            onChange={e => {
              setTheme(prev => ({ ...prev, font_heading: e.target.value }));
              setSuccess(false);
            }}
            aria-label="Font para titulos"
          >
            <option value="Fraunces">Fraunces</option>
            <option value="Playfair Display">Playfair Display</option>
            <option value="Libre Baskerville">Libre Baskerville</option>
            <option value="System">System</option>
          </select>
        </div>

        {/* Font Corpo */}
        <div style={s.rowLast}>
          <span style={s.label}>Font Corpo</span>
          <select
            style={{ ...s.select, flex: 'none', width: '180px' }}
            value={theme.font_body ?? 'System'}
            onChange={e => {
              setTheme(prev => ({ ...prev, font_body: e.target.value }));
              setSuccess(false);
            }}
            aria-label="Font para corpo de texto"
          >
            <option value="System">System</option>
            <option value="Geist">Geist</option>
            <option value="Inter">Inter</option>
          </select>
        </div>
      </div>

      {/* ── 4. Board members (only if show_board) ──────────── */}
      {config.show_board && (
        <div style={s.card}>
          <div style={s.sectionHeader}>Direccao</div>

          {boardMembers.length === 0 && (
            <div style={{ color: '#666', fontSize: '13px', marginBottom: '8px' }}>
              Nenhum membro na direccao.
            </div>
          )}

          {boardMembers.map(bm => (
            <div key={bm.user_id} style={s.boardMemberRow}>
              <span style={s.boardMemberName}>
                {bm.display_name ?? bm.user_id}
              </span>
              <span style={s.boardMemberTitle}>{bm.title}</span>
              <button
                style={s.removeBtn}
                onClick={() => removeBoardMember(bm.user_id)}
                aria-label={`Remover ${bm.display_name ?? bm.user_id}`}
                type="button"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add form */}
          <div style={s.addForm}>
            <select
              style={s.select}
              value={addUserId}
              onChange={e => setAddUserId(e.target.value)}
              aria-label="Seleccionar membro"
            >
              <option value="">Seleccionar membro...</option>
              {availableToAdd.map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
            <input
              style={s.input}
              type="text"
              placeholder="Cargo / titulo"
              value={addTitle}
              onChange={e => setAddTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBoardMember()}
              aria-label="Cargo ou titulo"
            />
            <button
              style={s.addBtn}
              onClick={addBoardMember}
              disabled={!addUserId || !addTitle.trim()}
              aria-label="Adicionar membro"
              type="button"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* ── Error / success feedback ────────────────────────── */}
      {error && <div style={s.errorText}>{error}</div>}
      {success && <div style={s.successText}>Configuracao guardada</div>}

      {/* ── 4. Action buttons ──────────────────────────────── */}
      <div style={s.buttonsRow}>
        <button
          style={{ ...s.saveBtn, opacity: saving ? 0.6 : 1 }}
          onClick={handleSave}
          disabled={saving}
          type="button"
        >
          {saving ? 'A guardar...' : 'Guardar Config'}
        </button>
        <button
          style={s.previewBtn}
          onClick={handlePreview}
          disabled={!club}
          type="button"
        >
          Preview
        </button>
      </div>

    </div>
  );
}
