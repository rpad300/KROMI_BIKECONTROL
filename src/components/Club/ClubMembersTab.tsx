// ═══════════════════════════════════════════════════════════════
// ClubMembersTab — Role management, kick, and join request approval
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';
import {
  getMembers,
  getJoinRequests,
  setMemberRole,
  removeMember,
  reviewRequest,
  type ClubMember,
  type ClubJoinRequest,
} from '../../services/club/ClubService';
import { useAuthStore } from '../../store/authStore';

// ─── Types ────────────────────────────────────────────────────

interface Props {
  clubId: string;
  userRole: string;
}

type Role = ClubMember['role'];

// ─── Constants ────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  owner: '#fbbf24',
  admin: '#6e9bff',
  moderator: '#e966ff',
  member: '#777777',
};

const ROLE_ICONS: Record<string, string> = {
  owner: 'stars',
  admin: 'shield',
  moderator: 'build',
  member: 'person',
};

const ALL_ROLES: Role[] = ['admin', 'moderator', 'member'];
const OWNER_ROLES: Role[] = ['owner', 'admin', 'moderator', 'member'];

const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Admin',
  moderator: 'Moderador',
  member: 'Membro',
};

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-PT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─── Component ────────────────────────────────────────────────

export default function ClubMembersTab({ clubId, userRole }: Props) {
  const myUserId = useAuthStore.getState().getUserId();

  const canManage = userRole === 'owner' || userRole === 'admin';
  const canModerate = canManage || userRole === 'moderator';

  const [members, setMembers] = useState<ClubMember[]>([]);
  const [requests, setRequests] = useState<ClubJoinRequest[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id of item being processed

  // ── Data loading ──────────────────────────────────────────

  const loadMembers = useCallback(async () => {
    try {
      setLoadingMembers(true);
      setError(null);
      const data = await getMembers(clubId);
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar membros');
    } finally {
      setLoadingMembers(false);
    }
  }, [clubId]);

  const loadRequests = useCallback(async () => {
    if (!canModerate) return;
    try {
      setLoadingRequests(true);
      const data = await getJoinRequests(clubId);
      // Only show pending requests
      setRequests(data.filter(r => r.status === 'pending'));
    } catch {
      // Non-fatal — moderator may have just lost permissions
      setRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  }, [clubId, canModerate]);

  useEffect(() => {
    void loadMembers();
    void loadRequests();
  }, [loadMembers, loadRequests]);

  // ── Actions ───────────────────────────────────────────────

  async function handleRoleChange(member: ClubMember, newRole: Role) {
    if (!confirm(`Alterar papel de ${member.display_name} para ${ROLE_LABELS[newRole]}?`)) return;
    setBusy(member.user_id);
    try {
      await setMemberRole(clubId, member.user_id, newRole);
      await loadMembers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao alterar papel');
    } finally {
      setBusy(null);
    }
  }

  async function handleKick(member: ClubMember) {
    if (!confirm(`Remover ${member.display_name} do clube?`)) return;
    setBusy(member.user_id);
    try {
      await removeMember(clubId, member.user_id);
      await loadMembers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao remover membro');
    } finally {
      setBusy(null);
    }
  }

  async function handleReview(req: ClubJoinRequest, approve: boolean) {
    setBusy(req.id);
    try {
      await reviewRequest(req.id, approve);
      await Promise.all([loadRequests(), loadMembers()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao processar pedido');
    } finally {
      setBusy(null);
    }
  }

  // ── Render ────────────────────────────────────────────────

  if (loadingMembers) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: '#666' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>
          group
        </span>
        A carregar membros…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <p style={{ color: '#ff716c', marginBottom: 12 }}>{error}</p>
        <button
          onClick={() => { void loadMembers(); void loadRequests(); }}
          style={{
            background: '#262626',
            border: '1px solid #333',
            borderRadius: 8,
            color: '#ccc',
            padding: '8px 16px',
            cursor: 'pointer',
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const availableRoles = (_targetRole: Role): Role[] =>
    userRole === 'owner' ? OWNER_ROLES : ALL_ROLES.filter(r => r !== 'owner');

  return (
    <div style={{ padding: '16px 0' }}>

      {/* ── Join requests ─────────────────────────────────── */}
      {canModerate && (loadingRequests || requests.length > 0) && (
        <section style={{ marginBottom: 24 }}>
          <p style={{
            color: '#fbbf24',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 10,
            padding: '0 16px',
          }}>
            Pedidos de Adesão
            {requests.length > 0 && (
              <span style={{
                marginLeft: 8,
                background: '#fbbf24',
                color: '#000',
                borderRadius: 10,
                padding: '1px 7px',
                fontSize: 10,
                fontWeight: 700,
              }}>
                {requests.length}
              </span>
            )}
          </p>

          {loadingRequests ? (
            <p style={{ color: '#555', fontSize: 13, padding: '0 16px' }}>A carregar pedidos…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {requests.map(req => (
                <div
                  key={req.id}
                  style={{
                    background: '#1a1919',
                    borderRadius: 10,
                    padding: '12px 14px',
                    margin: '0 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    opacity: busy === req.id ? 0.5 : 1,
                    pointerEvents: busy === req.id ? 'none' : 'auto',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span className="material-symbols-outlined" style={{ color: '#777', fontSize: 20, marginTop: 1 }}>
                      person_add
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: '#e5e5e5', fontWeight: 600, fontSize: 14, margin: 0 }}>
                        {req.display_name ?? 'Utilizador'}
                      </p>
                      {req.message && (
                        <p style={{ color: '#888', fontSize: 12, marginTop: 3, marginBottom: 0, lineHeight: 1.4 }}>
                          "{req.message}"
                        </p>
                      )}
                      <p style={{ color: '#555', fontSize: 11, marginTop: 4, marginBottom: 0 }}>
                        {formatDate(req.created_at)}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => void handleReview(req, false)}
                      disabled={!!busy}
                      style={{
                        background: 'transparent',
                        border: '1px solid #ff716c',
                        borderRadius: 8,
                        color: '#ff716c',
                        padding: '6px 14px',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        minHeight: 36,
                      }}
                    >
                      Rejeitar
                    </button>
                    <button
                      onClick={() => void handleReview(req, true)}
                      disabled={!!busy}
                      style={{
                        background: '#3fff8b',
                        border: 'none',
                        borderRadius: 8,
                        color: '#000',
                        padding: '6px 16px',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        minHeight: 36,
                      }}
                    >
                      Aceitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Members list ──────────────────────────────────── */}
      <section>
        <p style={{
          color: '#fbbf24',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 10,
          padding: '0 16px',
        }}>
          Membros ({members.length})
        </p>

        {members.length === 0 ? (
          <p style={{ color: '#555', fontSize: 13, padding: '0 16px' }}>Nenhum membro encontrado.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {members.map(member => {
              const isMe = member.user_id === myUserId;
              const isOwner = member.role === 'owner';
              const canEdit = canManage && !isMe && !isOwner;
              const isBusy = busy === member.user_id;
              const roleColor = ROLE_COLORS[member.role] ?? '#777';
              const roleIcon = ROLE_ICONS[member.role] ?? 'person';

              return (
                <div
                  key={member.user_id}
                  style={{
                    background: '#1a1919',
                    borderRadius: 10,
                    padding: '10px 14px',
                    margin: '0 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    opacity: isBusy ? 0.5 : 1,
                    pointerEvents: isBusy ? 'none' : 'auto',
                  }}
                >
                  {/* Role icon */}
                  <span
                    className="material-symbols-outlined"
                    style={{ color: roleColor, fontSize: 22, flexShrink: 0 }}
                    title={ROLE_LABELS[member.role]}
                  >
                    {roleIcon}
                  </span>

                  {/* Name + date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      color: isMe ? '#3fff8b' : '#e5e5e5',
                      fontWeight: isMe ? 700 : 500,
                      fontSize: 14,
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {member.display_name}
                      {isMe && <span style={{ color: '#555', fontWeight: 400, fontSize: 12, marginLeft: 6 }}>(eu)</span>}
                    </p>
                    <p style={{ color: '#555', fontSize: 11, margin: '2px 0 0' }}>
                      {ROLE_LABELS[member.role]} · desde {formatDate(member.joined_at)}
                    </p>
                  </div>

                  {/* Role select (canManage + not self + not owner) */}
                  {canEdit && (
                    <select
                      value={member.role}
                      onChange={e => void handleRoleChange(member, e.target.value as Role)}
                      disabled={isBusy}
                      style={{
                        background: '#262626',
                        border: '1px solid #333',
                        borderRadius: 6,
                        color: roleColor,
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '4px 6px',
                        cursor: 'pointer',
                        flexShrink: 0,
                        minHeight: 32,
                      }}
                    >
                      {availableRoles(member.role).map(r => (
                        <option key={r} value={r} style={{ color: ROLE_COLORS[r] ?? '#777' }}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Kick button (canManage + not self + not owner) */}
                  {canEdit && (
                    <button
                      onClick={() => void handleKick(member)}
                      disabled={isBusy}
                      title={`Remover ${member.display_name}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 4,
                        cursor: 'pointer',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 36,
                        minHeight: 36,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ color: '#ff716c', fontSize: 20 }}
                      >
                        person_remove
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
