import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import {
  exportMyData,
  downloadExport,
  deleteMyAccount,
  cancelMyAccountDeletion,
  getMyDeletionSchedule,
  listMySessions,
  revokeMySession,
  type ExportProgress,
  type MySession,
} from '../../services/gdpr/GdprService';

// ═══════════════════════════════════════════════════════════════
// PrivacyPage — GDPR self-service (export + delete)
// ═══════════════════════════════════════════════════════════════

export function PrivacyPage() {
  const user = useAuthStore((s) => s.user);
  const isImpersonating = useAuthStore((s) => s.isImpersonating());
  const logout = useAuthStore((s) => s.logout);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExportRows, setLastExportRows] = useState<number | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [sessions, setSessions] = useState<MySession[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setSessionsLoading(true);
    listMySessions()
      .then((rows) => setSessions(rows))
      .finally(() => setSessionsLoading(false));
    void getMyDeletionSchedule().then((at) => setScheduledAt(at));
  }, [user]);

  if (!user) return null;

  const handleRevoke = async (sessionId: string) => {
    if (!confirm('Revogar esta sessão? Se for a sessão actual, vais ter de fazer login outra vez.')) return;
    setRevoking(sessionId);
    try {
      const ok = await revokeMySession(sessionId);
      if (ok) {
        setSessions((prev) => (prev ?? []).filter((s) => s.id !== sessionId));
        // If we revoked the current session, force logout
        const wasCurrent = sessions?.find((s) => s.id === sessionId)?.is_current;
        if (wasCurrent) {
          logout();
          window.location.href = '/';
        }
      }
    } finally {
      setRevoking(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportProgress([]);
    setLastExportRows(null);
    try {
      const result = await exportMyData((p) => setExportProgress(p));
      downloadExport(result);
      setLastExportRows(result.total_rows);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export falhou');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteMyAccount(deleteEmail);
      if (!result.success) {
        setDeleteError(result.error ?? 'Falha ao apagar conta');
        setDeleting(false);
        return;
      }
      // Success — deletion is now SCHEDULED, not executed. The user
      // stays logged in during the 30-day grace window so they can
      // cancel if this was a mistake. We just refresh the schedule
      // banner and close the form.
      setScheduledAt(result.scheduled_at ?? null);
      setDeleteOpen(false);
      setDeleting(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro inesperado');
      setDeleting(false);
    }
  };

  const handleCancelDeletion = async () => {
    setCancelling(true);
    try {
      const result = await cancelMyAccountDeletion();
      if (result.success) {
        setScheduledAt(null);
      } else {
        alert(result.error ?? 'Falha ao cancelar eliminação');
      }
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px' }}>
      <div>
        <h2 className="font-headline font-bold" style={{ fontSize: '18px', color: '#3fff8b', marginBottom: '4px' }}>
          Privacidade e dados
        </h2>
        <p style={{ fontSize: '11px', color: '#777575', lineHeight: 1.5 }}>
          Tens direito a receber uma cópia de todos os teus dados e a apagar a
          tua conta (RGPD). As acções abaixo afectam apenas a tua conta —
          fazes tudo sozinho, sem contactar suporte.
        </p>
      </div>

      {isImpersonating && (
        <div style={{
          padding: '10px 12px',
          backgroundColor: 'rgba(255,159,67,0.1)',
          border: '1px solid rgba(255,159,67,0.3)',
          borderRadius: '6px',
          fontSize: '11px',
          color: '#ff9f43',
        }}>
          Estás em modo impersonation. As acções de privacidade estão
          desactivadas nesta tab para proteger a conta do utilizador real.
        </div>
      )}

      {/* ── Export ───────────────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#6e9bff' }}>download</span>
          <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Exportar os meus dados</h3>
        </div>
        <p style={{ fontSize: '10px', color: '#777575', lineHeight: 1.5, marginBottom: '10px' }}>
          Gera um ficheiro zip com tudo o que o KROMI sabe sobre ti: perfil,
          bikes, bike fits, atividades, rotas, pedidos de serviço e metadados
          dos ficheiros no Drive. Imagens e vídeos não são descarregados,
          apenas os links diretos. O zip é gerado no teu browser — não passa
          por servidor.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting || isImpersonating}
          style={{
            ...buttonStyle,
            backgroundColor: 'rgba(110,155,255,0.15)',
            border: '1px solid rgba(110,155,255,0.4)',
            color: '#6e9bff',
            opacity: exporting || isImpersonating ? 0.5 : 1,
            cursor: exporting || isImpersonating ? 'not-allowed' : 'pointer',
          }}
        >
          {exporting ? 'A exportar…' : 'Exportar agora (.zip)'}
        </button>

        {exportProgress.length > 0 && (
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {exportProgress.map((p) => (
              <div key={p.table} style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '9px',
                color: p.status === 'failed' ? '#ff716c' : p.status === 'done' ? '#3fff8b' : '#777575',
              }}>
                <span>{p.table}</span>
                <span>
                  {p.status === 'done' && `${p.rows ?? 0} linhas`}
                  {p.status === 'fetching' && '…'}
                  {p.status === 'failed' && `erro: ${p.error}`}
                  {p.status === 'pending' && '—'}
                </span>
              </div>
            ))}
          </div>
        )}
        {exportError && (
          <div style={errorStyle}>{exportError}</div>
        )}
        {lastExportRows !== null && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#3fff8b' }}>
            Exportado: {lastExportRows} linhas totais
          </div>
        )}
      </section>

      {/* ── Active sessions ─────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#3fff8b' }}>devices</span>
          <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Sessões activas</h3>
        </div>
        <p style={{ fontSize: '10px', color: '#777575', lineHeight: 1.5, marginBottom: '10px' }}>
          Cada vez que fazes login num browser ou dispositivo novo é criada uma sessão
          com 30 dias de validade. Podes revogar qualquer uma — se revogares a actual,
          o próximo pedido vai falhar e vais ter de fazer login outra vez.
        </p>

        {sessionsLoading && (
          <div style={{ fontSize: '10px', color: '#777575' }}>A carregar…</div>
        )}

        {sessions && sessions.length === 0 && (
          <div style={{ fontSize: '10px', color: '#777575' }}>
            Nenhuma sessão activa encontrada (deves estar em modo device-login).
          </div>
        )}

        {sessions && sessions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {sessions.map((s) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px',
                backgroundColor: s.is_current ? 'rgba(63,255,139,0.05)' : '#0e0e0e',
                border: s.is_current ? '1px solid rgba(63,255,139,0.3)' : '1px solid rgba(73,72,71,0.2)',
                borderRadius: '4px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
                    <span style={{ color: '#adaaaa', fontWeight: 600 }}>
                      {new Date(s.created_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    {s.is_current && (
                      <span style={{
                        fontSize: '8px', padding: '1px 5px', backgroundColor: 'rgba(63,255,139,0.15)',
                        color: '#3fff8b', borderRadius: '2px', fontWeight: 700,
                      }}>
                        SESSÃO ACTUAL
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '9px', color: '#777575', marginTop: '2px' }}>
                    Último uso: {new Date(s.last_used_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}
                    {' · '}Expira: {new Date(s.expires_at).toLocaleDateString('pt-PT')}
                  </div>
                </div>
                <button
                  onClick={() => void handleRevoke(s.id)}
                  disabled={revoking === s.id || isImpersonating}
                  style={{
                    padding: '5px 10px', fontSize: '9px', fontWeight: 700,
                    backgroundColor: 'rgba(255,113,108,0.1)',
                    border: '1px solid rgba(255,113,108,0.3)',
                    borderRadius: '3px', color: '#ff716c',
                    cursor: (revoking === s.id || isImpersonating) ? 'not-allowed' : 'pointer',
                    opacity: (revoking === s.id || isImpersonating) ? 0.5 : 1,
                  }}
                >
                  {revoking === s.id ? '…' : 'Revogar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Delete account ──────────────────────────────── */}
      <section style={{ ...sectionStyle, borderColor: 'rgba(255,113,108,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#ff716c' }}>delete_forever</span>
          <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Apagar a minha conta</h3>
        </div>

        {scheduledAt ? (
          <div style={{
            padding: '12px 14px',
            backgroundColor: 'rgba(255,159,67,0.1)',
            border: '1px solid rgba(255,159,67,0.4)',
            borderRadius: '6px',
            marginBottom: '10px',
          }}>
            <div style={{ fontSize: '11px', color: '#ff9f43', fontWeight: 700, marginBottom: '6px' }}>
              Eliminação agendada
            </div>
            <p style={{ fontSize: '10px', color: '#adaaaa', lineHeight: 1.5, marginBottom: '10px' }}>
              A tua conta vai ser apagada em{' '}
              <strong style={{ color: '#fbbf24' }}>
                {new Date(scheduledAt).toLocaleDateString('pt-PT', { dateStyle: 'long' })}
              </strong>.
              Podes cancelar a qualquer momento antes dessa data e a tua conta
              continua intacta. Depois dessa data, os dados são apagados
              permanentemente e a acção não pode ser revertida.
            </p>
            <button
              onClick={() => void handleCancelDeletion()}
              disabled={cancelling || isImpersonating}
              style={{
                ...buttonStyle,
                backgroundColor: 'rgba(63,255,139,0.15)',
                border: '1px solid rgba(63,255,139,0.4)',
                color: '#3fff8b',
                opacity: cancelling || isImpersonating ? 0.5 : 1,
                cursor: cancelling || isImpersonating ? 'not-allowed' : 'pointer',
              }}
            >
              {cancelling ? 'A cancelar…' : 'Cancelar eliminação'}
            </button>
          </div>
        ) : (
          <>
        <p style={{ fontSize: '10px', color: '#777575', lineHeight: 1.5, marginBottom: '10px' }}>
          Agenda a eliminação da tua conta KROMI. Tens{' '}
          <strong style={{ color: '#fbbf24' }}>30 dias</strong> para cancelar antes
          que os dados sejam apagados definitivamente — perfil, bikes, bike fits,
          atividades, rotas, pedidos de serviço e metadados de ficheiros. Os
          ficheiros no Google Drive vão imediatamente para a trash da conta KROMI
          (ficam recuperáveis durante os 30 dias).
        </p>
        <p style={{ fontSize: '10px', color: '#777575', lineHeight: 1.5, marginBottom: '10px' }}>
          Recomendamos que exportes os teus dados primeiro (acima).
        </p>
          </>
        )}
        {!scheduledAt && (!deleteOpen ? (
          <button
            onClick={() => { setDeleteOpen(true); setDeleteEmail(''); setDeleteError(null); }}
            disabled={isImpersonating}
            style={{
              ...buttonStyle,
              backgroundColor: 'rgba(255,113,108,0.15)',
              border: '1px solid rgba(255,113,108,0.4)',
              color: '#ff716c',
              opacity: isImpersonating ? 0.5 : 1,
              cursor: isImpersonating ? 'not-allowed' : 'pointer',
            }}
          >
            Começar processo de eliminação
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '10px', color: '#adaaaa' }}>
              Escreve o teu email ({user.email}) para confirmar:
            </label>
            <input
              type="email"
              value={deleteEmail}
              onChange={(e) => setDeleteEmail(e.target.value)}
              placeholder={user.email}
              disabled={deleting}
              style={{
                padding: '8px 10px',
                backgroundColor: '#0e0e0e',
                border: '1px solid rgba(255,113,108,0.3)',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '11px',
                outline: 'none',
              }}
            />
            {deleteError && <div style={errorStyle}>{deleteError}</div>}
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                style={{ ...buttonStyle, flex: 1, backgroundColor: 'rgba(73,72,71,0.15)', border: '1px solid rgba(73,72,71,0.3)', color: '#adaaaa' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || deleteEmail.trim().toLowerCase() !== user.email.toLowerCase()}
                style={{
                  ...buttonStyle,
                  flex: 1,
                  backgroundColor: '#ff716c',
                  border: 'none',
                  color: '#0e0e0e',
                  opacity: (deleting || deleteEmail.trim().toLowerCase() !== user.email.toLowerCase()) ? 0.4 : 1,
                  cursor: (deleting || deleteEmail.trim().toLowerCase() !== user.email.toLowerCase()) ? 'not-allowed' : 'pointer',
                }}
              >
                {deleting ? 'A agendar…' : 'Agendar eliminação (30 dias grace)'}
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: '14px',
  backgroundColor: '#131313',
  border: '1px solid rgba(73,72,71,0.2)',
  borderRadius: '8px',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
};

const errorStyle: React.CSSProperties = {
  marginTop: '8px',
  padding: '8px 10px',
  backgroundColor: 'rgba(255,113,108,0.1)',
  border: '1px solid rgba(255,113,108,0.3)',
  borderRadius: '4px',
  fontSize: '10px',
  color: '#ff716c',
};
