// ═══════════════════════════════════════════════════════════════
// ClubInvitesTab — manage invite links for a club
// ═══════════════════════════════════════════════════════════════
//
// Props: { clubId, clubSlug }
// Sections:
//   1. Create invite form (email, max usos, expiry days)
//   2. CONVITES ACTIVOS list with copy-link button
//
// All service calls go through ClubService (supaFetch internally).
// Auth: useAuthStore.getState().getUserId()
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, useCallback } from 'react';
import { getInvites, createInvite, ClubInvite } from '../../services/club/ClubService';
import { useAuthStore } from '../../store/authStore';

// ─── Types ──────────────────────────────────────────────────

interface Props {
  clubId: string;
  clubSlug: string;
}

interface CreateForm {
  email: string;
  maxUses: number;
  expiresInDays: number;
}

const DEFAULT_FORM: CreateForm = {
  email: '',
  maxUses: 0,
  expiresInDays: 7,
};

// ─── Helpers ────────────────────────────────────────────────

function isExpired(invite: ClubInvite): boolean {
  return new Date(invite.expires_at) < new Date();
}

function isExhausted(invite: ClubInvite): boolean {
  return invite.max_uses > 0 && invite.used_count >= invite.max_uses;
}

function isDimmed(invite: ClubInvite): boolean {
  return isExpired(invite) || isExhausted(invite);
}

function formatExpiry(expiresAt: string): string {
  const d = new Date(expiresAt);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function usageLabel(invite: ClubInvite): string {
  const max = invite.max_uses === 0 ? '∞' : String(invite.max_uses);
  return `${invite.used_count}/${max} usos`;
}

// ─── Component ──────────────────────────────────────────────

export default function ClubInvitesTab({ clubId, clubSlug }: Props) {
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // copiedId tracks which invite code was just copied
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── Load invites ─────────────────────────────────────────

  const loadInvites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getInvites(clubId);
      setInvites(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar convites');
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  // ── Create invite ────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);

    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      setCreateError('Utilizador não autenticado');
      setCreating(false);
      return;
    }

    const expiresAt = new Date(
      Date.now() + form.expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    try {
      await createInvite(clubId, userId, {
        email: form.email.trim() || undefined,
        max_uses: form.maxUses,
        expires_at: expiresAt,
      });
      setForm(DEFAULT_FORM);
      setShowForm(false);
      await loadInvites();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erro ao criar convite');
    } finally {
      setCreating(false);
    }
  };

  // ── Copy link ────────────────────────────────────────────

  const handleCopy = async (invite: ClubInvite) => {
    const link = `https://www.kromi.online/club.html?s=${clubSlug}&invite=${invite.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // fallback: select + copy via execCommand
      const el = document.createElement('textarea');
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // ── Render ───────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Create invite button / form ── */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          style={{
            background: 'transparent',
            border: '2px dashed #e966ff',
            borderRadius: 10,
            color: '#e966ff',
            fontSize: 15,
            fontWeight: 600,
            padding: '14px 0',
            cursor: 'pointer',
            width: '100%',
            letterSpacing: 0.3,
          }}
        >
          + Criar Convite
        </button>
      ) : (
        <div
          style={{
            background: '#1a1919',
            border: '1px solid #333',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <p
            style={{
              margin: '0 0 16px 0',
              fontSize: 15,
              fontWeight: 700,
              color: '#e966ff',
              letterSpacing: 0.4,
            }}
          >
            Novo Convite
          </p>

          <form onSubmit={(e) => void handleCreate(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Email (optional) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#aaa', letterSpacing: 0.4 }}>
                Email (opcional — vazio = link genérico)
              </label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@exemplo.com"
                style={{
                  background: '#262626',
                  border: '1px solid #333',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 14,
                  padding: '10px 12px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Max usos */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#aaa', letterSpacing: 0.4 }}>
                Máximo de usos (0 = ilimitado)
              </label>
              <input
                type="number"
                min={0}
                value={form.maxUses}
                onChange={e => setForm(f => ({ ...f, maxUses: parseInt(e.target.value, 10) || 0 }))}
                style={{
                  background: '#262626',
                  border: '1px solid #333',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 14,
                  padding: '10px 12px',
                  outline: 'none',
                  width: 100,
                }}
              />
            </div>

            {/* Expira em */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#aaa', letterSpacing: 0.4 }}>
                Expira em (dias)
              </label>
              <input
                type="number"
                min={1}
                value={form.expiresInDays}
                onChange={e => setForm(f => ({ ...f, expiresInDays: parseInt(e.target.value, 10) || 7 }))}
                style={{
                  background: '#262626',
                  border: '1px solid #333',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 14,
                  padding: '10px 12px',
                  outline: 'none',
                  width: 100,
                }}
              />
            </div>

            {createError && (
              <p style={{ margin: 0, fontSize: 13, color: '#f87171' }}>{createError}</p>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="submit"
                disabled={creating}
                style={{
                  background: creating ? '#555' : '#e966ff',
                  border: 'none',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  padding: '11px 22px',
                  cursor: creating ? 'not-allowed' : 'pointer',
                  flex: 1,
                }}
              >
                {creating ? 'A criar…' : 'Criar Convite'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setCreateError(null); setForm(DEFAULT_FORM); }}
                style={{
                  background: 'transparent',
                  border: '1px solid #444',
                  borderRadius: 8,
                  color: '#aaa',
                  fontSize: 14,
                  padding: '11px 18px',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Convites Activos ── */}
      <div>
        <p
          style={{
            margin: '0 0 12px 0',
            fontSize: 12,
            fontWeight: 700,
            color: '#fbbf24',
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          Convites Activos
        </p>

        {loading && (
          <p style={{ color: '#666', fontSize: 14 }}>A carregar…</p>
        )}

        {!loading && error && (
          <p style={{ color: '#f87171', fontSize: 14 }}>{error}</p>
        )}

        {!loading && !error && invites.length === 0 && (
          <p style={{ color: '#555', fontSize: 14, fontStyle: 'italic' }}>
            Sem convites criados.
          </p>
        )}

        {!loading && !error && invites.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {invites.map(invite => {
              const dimmed = isDimmed(invite);
              return (
                <div
                  key={invite.id}
                  style={{
                    background: '#1a1919',
                    border: '1px solid #333',
                    borderRadius: 10,
                    padding: '14px 16px',
                    opacity: dimmed ? 0.4 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Top row: code + copy button */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 15,
                        color: '#3fff8b',
                        letterSpacing: 1.5,
                        wordBreak: 'break-all',
                      }}
                    >
                      {invite.code}
                    </span>
                    <button
                      onClick={() => void handleCopy(invite)}
                      disabled={dimmed}
                      style={{
                        background: copiedId === invite.id ? '#1a3d2a' : '#1e1e1e',
                        border: `1px solid ${copiedId === invite.id ? '#3fff8b' : '#444'}`,
                        borderRadius: 7,
                        color: copiedId === invite.id ? '#3fff8b' : '#ccc',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '7px 13px',
                        cursor: dimmed ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {copiedId === invite.id ? 'Copiado!' : 'Copiar link'}
                    </button>
                  </div>

                  {/* Meta row: email, usage, expiry */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center' }}>
                    {invite.email && (
                      <span style={{ fontSize: 12, color: '#60a5fa' }}>
                        {invite.email}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: '#888' }}>
                      {usageLabel(invite)}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: isExpired(invite) ? '#f87171' : '#888',
                      }}
                    >
                      Expira {formatExpiry(invite.expires_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
