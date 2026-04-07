import { useEffect, useMemo, useState } from 'react';
import { useDriveStore } from '../../store/driveStore';
import { bootstrapFolderStructure, TOP_LEVEL_FOLDERS, deleteFile } from '../../services/storage/KromiFileStore';
import { getStorageStats, type StorageStats } from '../../services/rbac/RBACService';
import { supaGet } from '../../lib/supaFetch';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

/**
 * DriveStoragePage — admin diagnostic for the central KROMI Drive backend.
 *
 * This is a read-only view: connection state is configured server-side
 * (Supabase Edge Function secrets). Users can refresh, see who the
 * backend is acting as, and check the storage quota.
 */
export function DriveStoragePage() {
  const { status, rootFolderId, rootFolderName, actingAs, quota, lastChecked, lastError, refresh } =
    useDriveStore();

  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapResult, setBootstrapResult] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    if (status === 'unknown') void refresh();
  }, [status, refresh]);

  useEffect(() => {
    setUsageLoading(true);
    getStorageStats(10)
      .then(setUsage)
      .catch(() => setUsage(null))
      .finally(() => setUsageLoading(false));
  }, []);

  const runBootstrap = async () => {
    setBootstrapping(true);
    setBootstrapResult(null);
    try {
      const r = await bootstrapFolderStructure();
      setBootstrapResult(`✓ ${r.length} pastas garantidas: ${r.map((x) => x.folder).join(', ')}`);
    } catch (err) {
      setBootstrapResult(`✗ ${(err as Error).message}`);
    } finally {
      setBootstrapping(false);
    }
  };

  const usedBytes = quota?.usage ? Number(quota.usage) : 0;
  const limitBytes = quota?.limit ? Number(quota.limit) : 0;
  const usedPct = limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0;

  const card: React.CSSProperties = {
    backgroundColor: '#131313',
    borderRadius: '8px',
    padding: '14px',
    border: '1px solid rgba(73,72,71,0.2)',
    marginBottom: '12px',
  };
  const label: React.CSSProperties = { fontSize: '10px', color: '#777575', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.5px' };
  const value: React.CSSProperties = { fontSize: '13px', color: 'white', fontWeight: 600 };

  const statusColor =
    status === 'online' ? '#3fff8b' :
    status === 'checking' ? '#fbbf24' :
    status === 'unknown' ? '#777575' : '#ff716c';

  const statusText =
    status === 'online' ? 'Conectado' :
    status === 'checking' ? 'A verificar...' :
    status === 'offline' ? 'Offline' :
    status === 'error' ? 'Erro' : 'Desconhecido';

  return (
    <div style={{ padding: '4px' }}>
      <h2 className="font-headline font-bold" style={{ fontSize: '18px', color: '#3fff8b', marginBottom: '4px' }}>
        Google Drive Storage
      </h2>
      <p style={{ fontSize: '11px', color: '#777575', marginBottom: '16px' }}>
        Backend central da KROMI para ficheiros (fotos, GPX, exports). Tudo é guardado na pasta{' '}
        <strong style={{ color: '#adaaaa' }}>KROMI PLATFORM</strong>.
      </p>

      {/* Connection status */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '10px', height: '10px', borderRadius: '50%',
                backgroundColor: statusColor,
                boxShadow: status === 'online' ? '0 0 8px #3fff8b' : 'none',
              }}
            />
            <span style={{ ...value, color: statusColor }}>{statusText}</span>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={status === 'checking'}
            style={{
              padding: '6px 12px', fontSize: '11px', fontWeight: 700,
              backgroundColor: 'rgba(110,155,255,0.1)', border: '1px solid rgba(110,155,255,0.2)',
              borderRadius: '4px', color: '#6e9bff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>refresh</span>
            Verificar
          </button>
        </div>

        {lastError && (
          <div style={{
            padding: '8px', backgroundColor: 'rgba(255,113,108,0.08)', borderRadius: '4px',
            color: '#ff716c', fontSize: '11px', marginBottom: '12px',
          }}>
            {lastError}
          </div>
        )}

        {lastChecked && (
          <div style={{ fontSize: '9px', color: '#494847' }}>
            Última verificação: {new Date(lastChecked).toLocaleString('pt-PT')}
          </div>
        )}
      </div>

      {/* Folder info */}
      {status === 'online' && rootFolderId && (
        <div style={card}>
          <div style={{ ...label }}>Pasta raiz no Drive</div>
          <div style={{ ...value, marginBottom: '8px' }}>{rootFolderName}</div>
          <a
            href={`https://drive.google.com/drive/folders/${rootFolderId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '11px', color: '#6e9bff', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_new</span>
            Abrir no Google Drive
          </a>
          <div style={{ fontSize: '9px', color: '#494847', marginTop: '8px', fontFamily: 'monospace' }}>
            ID: {rootFolderId}
          </div>
        </div>
      )}

      {/* Acting as */}
      {actingAs && (
        <div style={card}>
          <div style={label}>Conta autenticada</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
            {actingAs.photoLink && (
              <img
                src={actingAs.photoLink}
                alt=""
                style={{ width: '32px', height: '32px', borderRadius: '50%' }}
              />
            )}
            <div>
              <div style={value}>{actingAs.displayName ?? '—'}</div>
              <div style={{ fontSize: '11px', color: '#777575' }}>{actingAs.emailAddress ?? '—'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Storage quota */}
      {quota && limitBytes > 0 && (
        <div style={card}>
          <div style={label}>Quota de armazenamento</div>
          <div style={{ ...value, marginBottom: '8px' }}>
            {formatBytes(usedBytes)} <span style={{ color: '#777575', fontWeight: 400 }}>de</span> {formatBytes(limitBytes)}
          </div>
          <div style={{ height: '6px', backgroundColor: 'rgba(73,72,71,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, usedPct)}%`, height: '100%',
              backgroundColor: usedPct > 90 ? '#ff716c' : usedPct > 70 ? '#fbbf24' : '#3fff8b',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: '10px', color: '#777575', marginTop: '6px' }}>
            {usedPct.toFixed(2)}% usado
          </div>
        </div>
      )}

      {/* Bootstrap */}
      {status === 'online' && (
        <div style={card}>
          <div style={label}>Estrutura de pastas</div>
          <div style={{ fontSize: '11px', color: '#adaaaa', lineHeight: 1.5, marginBottom: '8px' }}>
            Pré-cria as pastas top-level partilhadas dentro de KROMI PLATFORM:{' '}
            <code style={{ fontSize: '10px', color: '#777575' }}>{TOP_LEVEL_FOLDERS.join(' · ')}</code>.
            <br />
            Cada utilizador tem a sua sub-estrutura em <code style={{ fontSize: '10px', color: '#777575' }}>users/{'{slug}'}/</code> que é criada automaticamente no primeiro login (via <code style={{ fontSize: '10px' }}>useDriveBootstrap</code>).
            Esta acção é segura — pastas existentes não são duplicadas.
          </div>
          <button
            onClick={runBootstrap}
            disabled={bootstrapping}
            style={{
              padding: '8px 14px', fontSize: '11px', fontWeight: 700,
              backgroundColor: 'rgba(63,255,139,0.1)', border: '1px solid rgba(63,255,139,0.3)',
              borderRadius: '4px', color: '#3fff8b', cursor: bootstrapping ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>create_new_folder</span>
            {bootstrapping ? 'A criar...' : 'Inicializar estrutura'}
          </button>
          {bootstrapResult && (
            <div style={{
              fontSize: '10px', color: bootstrapResult.startsWith('✓') ? '#3fff8b' : '#ff716c',
              marginTop: '8px',
            }}>
              {bootstrapResult}
            </div>
          )}
        </div>
      )}

      {/* Storage usage by user (kromi_files aggregate) */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ fontSize: '12px', color: '#3fff8b', fontWeight: 700 }}>Utilização (kromi_files)</div>
          {usage && (
            <div style={{ fontSize: '10px', color: '#777575' }}>
              {usage.total_files.toLocaleString('pt-PT')} ficheiros · {formatBytes(usage.total_bytes)}
            </div>
          )}
        </div>
        {usageLoading && <div style={{ fontSize: '11px', color: '#777575' }}>A calcular...</div>}
        {!usageLoading && usage && usage.by_user.length === 0 && (
          <div style={{ fontSize: '11px', color: '#777575' }}>Sem ficheiros registados.</div>
        )}
        {!usageLoading && usage && usage.by_user.length > 0 && (
          <>
            <div style={{ fontSize: '10px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
              Top {usage.by_user.length} utilizadores (por bytes)
            </div>
            <div style={{ width: '100%', height: Math.max(180, usage.by_user.length * 28) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={usage.by_user.map((r) => ({
                    name: r.email ?? r.user_id?.slice(0, 8) ?? '?',
                    bytes: r.bytes,
                    files: r.files,
                  }))}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={140}
                    tick={{ fill: '#adaaaa', fontSize: 10 }}
                    axisLine={{ stroke: '#262626' }}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(63,255,139,0.05)' }}
                    contentStyle={{
                      backgroundColor: '#0e0e0e',
                      border: '1px solid #3fff8b',
                      borderRadius: '4px',
                      fontSize: '11px',
                    }}
                    labelStyle={{ color: '#3fff8b', fontWeight: 700 }}
                    formatter={(value: number, name: string) =>
                      name === 'bytes' ? [formatBytes(value), 'Storage'] : [value, 'Ficheiros']
                    }
                  />
                  <Bar dataKey="bytes" radius={[0, 3, 3, 0]}>
                    {usage.by_user.map((_, idx) => (
                      <Cell key={idx} fill={idx === 0 ? '#3fff8b' : `rgba(63,255,139,${0.85 - idx * 0.07})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {/* Orphan file cleanup */}
      <OrphanFileCleanup card={card} />

      {/* Info */}
      <div style={{ ...card, backgroundColor: 'rgba(110,155,255,0.05)', border: '1px solid rgba(110,155,255,0.2)' }}>
        <div style={{ fontSize: '11px', color: '#6e9bff', fontWeight: 700, marginBottom: '6px' }}>
          ℹ️ Como funciona
        </div>
        <div style={{ fontSize: '11px', color: '#adaaaa', lineHeight: 1.5 }}>
          Todos os ficheiros (fotos de manutenção, fotos de bikes, exports de rides, rotas, etc.) são guardados
          na pasta <strong>KROMI PLATFORM</strong> no Google Drive. O Supabase guarda apenas os links de acesso
          (tabela <code style={{ fontSize: '10px' }}>kromi_files</code>), poupando custos de storage.
          <br /><br />
          <strong style={{ color: '#fbbf24' }}>Regra de ouro:</strong> qualquer feature que envolva ficheiros
          tem de usar <code style={{ fontSize: '10px' }}>KromiFileStore.uploadFile()</code>. Nunca chamar
          Supabase Storage ou Drive API directamente.
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}

// ═══════════════════════════════════════════════════════════
// OrphanFileCleanup — Session 18 admin polish
// ═══════════════════════════════════════════════════════════
//
// Scans kromi_files for rows whose `entity_id` no longer points to
// an existing row in the parent table (bike, service request, etc.)
// — these are leftovers from deletes that didn't cascade their
// kromi_files metadata. Admin can trash them in one click.
//
// Detection is client-side because there's no FK cascade helper:
// we fetch every kromi_files row + a slim id-only projection of
// each parent table we care about, then cross-reference in memory.
// The admin user count is small enough that this is fine.

interface KromiFileRow {
  id: string;
  owner_user_id: string | null;
  category: string;
  entity_type: string | null;
  entity_id: string | null;
  file_name: string;
  size_bytes: number | null;
  created_at: string;
}

interface OrphanRow extends KromiFileRow {
  reason: string;
}

const ENTITY_TABLES: Record<string, string> = {
  bike: 'bike_configs',
  service_request: 'service_requests',
  bike_fit: 'bike_fits',
  ride: 'ride_sessions',
};

function OrphanFileCleanup({ card }: { card: React.CSSProperties }) {
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<KromiFileRow[] | null>(null);
  const [existingIds, setExistingIds] = useState<Record<string, Set<string>>>({});
  const [trashing, setTrashing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    setError(null);
    try {
      const allFiles = await supaGet<KromiFileRow[]>(
        '/rest/v1/kromi_files?select=id,owner_user_id,category,entity_type,entity_id,file_name,size_bytes,created_at&limit=5000',
      );
      setFiles(Array.isArray(allFiles) ? allFiles : []);

      // Fetch ids of each parent table referenced by kromi_files.
      // service_requests.id is uuid; bike_configs.id is text in some
      // rows (legacy) — the comparison is string-based to cover both.
      const result: Record<string, Set<string>> = {};
      for (const [entityType, table] of Object.entries(ENTITY_TABLES)) {
        try {
          const rows = await supaGet<Array<{ id: string }>>(
            `/rest/v1/${table}?select=id&limit=10000`,
          );
          result[entityType] = new Set(
            (Array.isArray(rows) ? rows : []).map((r) => String(r.id)),
          );
        } catch {
          result[entityType] = new Set();
        }
      }
      setExistingIds(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'scan failed');
    } finally {
      setLoading(false);
    }
  };

  const orphans = useMemo<OrphanRow[]>(() => {
    if (!files) return [];
    const out: OrphanRow[] = [];
    for (const f of files) {
      if (!f.entity_type || !f.entity_id) continue; // global files (profile, etc.)
      const ids = existingIds[f.entity_type];
      if (!ids) continue; // unknown entity type, skip (don't flag)
      if (!ids.has(String(f.entity_id))) {
        out.push({ ...f, reason: `${f.entity_type}.id=${f.entity_id.slice(0, 8)} missing` });
      }
    }
    return out;
  }, [files, existingIds]);

  const totalBytes = orphans.reduce((s, f) => s + (f.size_bytes ?? 0), 0);

  const trashOne = async (id: string) => {
    if (!confirm('Mover este ficheiro para o trash do Drive? (Recuperável por 30 dias)')) return;
    setTrashing(id);
    try {
      await deleteFile(id);
      setFiles((prev) => (prev ? prev.filter((f) => f.id !== id) : prev));
    } catch (err) {
      alert(`Erro: ${(err as Error).message}`);
    } finally {
      setTrashing(null);
    }
  };

  const trashAll = async () => {
    if (orphans.length === 0) return;
    if (!confirm(`Mover ${orphans.length} ficheiros órfãos para o trash do Drive?`)) return;
    setTrashing('__bulk__');
    const ids = orphans.map((o) => o.id);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        await deleteFile(id);
        ok++;
      } catch {
        fail++;
      }
    }
    // Refresh scan to reflect new state
    await scan();
    setTrashing(null);
    alert(`Concluído: ${ok} removidos, ${fail} falharam`);
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#ff9f43' }}>cleaning_services</span>
          <span style={{ fontSize: '13px', color: '#ff9f43', fontWeight: 700 }}>
            Limpeza de ficheiros órfãos
          </span>
        </div>
        <button
          onClick={() => void scan()}
          disabled={loading}
          style={{
            padding: '6px 10px', fontSize: '10px', fontWeight: 700,
            backgroundColor: 'rgba(110,155,255,0.1)', border: '1px solid rgba(110,155,255,0.2)',
            borderRadius: '4px', color: '#6e9bff', cursor: 'pointer',
          }}
        >
          {loading ? 'A procurar…' : files ? 'Re-scan' : 'Procurar órfãos'}
        </button>
      </div>

      <div style={{ fontSize: '11px', color: '#adaaaa', lineHeight: 1.5, marginBottom: '10px' }}>
        Rows de <code style={{ fontSize: '10px' }}>kromi_files</code> onde o{' '}
        <code style={{ fontSize: '10px' }}>entity_id</code> já não existe na tabela parente
        (bike apagada, service request removido, etc.). Tipos verificados:{' '}
        {Object.keys(ENTITY_TABLES).join(', ')}.
      </div>

      {error && (
        <div style={{
          padding: '6px 8px', fontSize: '10px', color: '#ff716c',
          backgroundColor: 'rgba(255,113,108,0.1)', border: '1px solid rgba(255,113,108,0.2)',
          borderRadius: '3px', marginBottom: '8px',
        }}>
          {error}
        </div>
      )}

      {files && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
            padding: '8px 10px', backgroundColor: '#0e0e0e', borderRadius: '4px', marginBottom: '8px',
          }}>
            <div style={{ fontSize: '10px', color: '#777575' }}>
              {files.length} ficheiros analisados · {orphans.length} órfãos · {formatBytes(totalBytes)} recuperáveis
            </div>
            {orphans.length > 0 && (
              <button
                onClick={() => void trashAll()}
                disabled={trashing === '__bulk__'}
                style={{
                  padding: '6px 12px', fontSize: '10px', fontWeight: 700,
                  backgroundColor: trashing === '__bulk__' ? 'rgba(255,113,108,0.2)' : '#ff716c',
                  color: trashing === '__bulk__' ? '#777575' : '#0e0e0e',
                  border: 'none', borderRadius: '3px',
                  cursor: trashing === '__bulk__' ? 'not-allowed' : 'pointer',
                }}
              >
                {trashing === '__bulk__' ? 'A remover…' : `Trash todos (${orphans.length})`}
              </button>
            )}
          </div>

          {orphans.length === 0 ? (
            <div style={{
              padding: '14px', textAlign: 'center', color: '#3fff8b', fontSize: '11px',
              backgroundColor: 'rgba(63,255,139,0.05)', borderRadius: '4px',
            }}>
              ✓ Nenhum ficheiro órfão encontrado
            </div>
          ) : (
            <div style={{
              maxHeight: '300px', overflow: 'auto',
              border: '1px solid rgba(73,72,71,0.2)', borderRadius: '4px',
            }}>
              {orphans.map((o) => (
                <div key={o.id} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px', borderBottom: '1px solid rgba(73,72,71,0.15)',
                  fontSize: '10px',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.file_name}
                    </div>
                    <div style={{ color: '#777575', fontSize: '9px', marginTop: '2px' }}>
                      {o.category} · {formatBytes(o.size_bytes ?? 0)} · {o.reason}
                    </div>
                  </div>
                  <button
                    onClick={() => void trashOne(o.id)}
                    disabled={trashing === o.id}
                    style={{
                      padding: '4px 8px', fontSize: '9px', fontWeight: 700,
                      backgroundColor: 'rgba(255,113,108,0.1)', border: '1px solid rgba(255,113,108,0.2)',
                      borderRadius: '3px', color: '#ff716c', cursor: 'pointer',
                    }}
                  >
                    {trashing === o.id ? '…' : 'Trash'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
