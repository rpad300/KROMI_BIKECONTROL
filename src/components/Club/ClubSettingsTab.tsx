// ═══════════════════════════════════════════════════════════════
// ClubSettingsTab — club owner/admin settings panel
// Sections: Geral · Imagem · Redes Sociais · Save
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { getClub, updateClub, type Club } from '../../services/club/ClubService';
import { uploadFile } from '../../services/storage/KromiFileStore';
import { useAuthStore } from '../../store/authStore';

// ─── Shared style tokens ─────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: '#1a1919',
  borderRadius: '8px',
  padding: '16px',
  border: '1px solid rgba(73,72,71,0.25)',
  marginBottom: '12px',
};

const sectionLabel: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 700,
  color: '#fbbf24',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.8px',
  marginBottom: '12px',
};

const fieldLabel: React.CSSProperties = {
  fontSize: '10px',
  color: '#adaaaa',
  marginBottom: '4px',
  display: 'block',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#262626',
  border: '1px solid rgba(73,72,71,0.4)',
  borderRadius: '6px',
  padding: '8px 10px',
  color: 'white',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: '80px',
  resize: 'vertical' as const,
};

const fieldGroup: React.CSSProperties = {
  marginBottom: '12px',
};

// ─── Helper: SectionHeader ───────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return <div style={sectionLabel}>{label}</div>;
}

// ─── Helper: ImageUpload ─────────────────────────────────────

interface ImageUploadProps {
  label: string;
  currentUrl?: string | null;
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
  accept?: string;
  previewStyle?: React.CSSProperties;
}

function ImageUpload({
  label,
  currentUrl,
  onUpload,
  uploading,
  accept = 'image/*',
  previewStyle,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onUpload(file);
    // Reset so same file can be re-selected if needed
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={fieldGroup}>
      <span style={fieldLabel}>{label}</span>
      {currentUrl && (
        <img
          src={currentUrl}
          alt={label}
          style={{
            display: 'block',
            width: '80px',
            height: '80px',
            objectFit: 'cover',
            borderRadius: '8px',
            marginBottom: '8px',
            border: '1px solid rgba(73,72,71,0.4)',
            ...previewStyle,
          }}
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{
          padding: '7px 14px',
          backgroundColor: '#262626',
          border: '1px solid rgba(73,72,71,0.5)',
          borderRadius: '6px',
          color: uploading ? '#555' : '#adaaaa',
          fontSize: '11px',
          cursor: uploading ? 'not-allowed' : 'pointer',
        }}
      >
        {uploading ? 'A enviar...' : 'Escolher ficheiro'}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────

interface Props {
  clubId: string;
  onUpdated: () => void;
}

interface FormState {
  name: string;
  location: string;
  website: string;
  description: string;
  founded_at: string;
  color: string;
  visibility: 'public' | 'private';
  instagram: string;
  facebook: string;
}

const DEFAULT_FORM: FormState = {
  name: '',
  location: '',
  website: '',
  description: '',
  founded_at: '',
  color: '#3fff8b',
  visibility: 'public',
  instagram: '',
  facebook: '',
};

export function ClubSettingsTab({ clubId, onUpdated }: Props) {
  const user = useAuthStore((s) => s.user);

  const [club, setClub] = useState<Club | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);

  // ── Load club on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getClub(clubId)
      .then((c) => {
        if (cancelled) return;
        if (!c) {
          setError('Clube não encontrado.');
          return;
        }
        setClub(c);
        setForm({
          name: c.name ?? '',
          location: c.location ?? '',
          website: c.website ?? '',
          description: c.description ?? '',
          founded_at: c.founded_at ? c.founded_at.slice(0, 10) : '',
          color: c.color ?? '#3fff8b',
          visibility: c.visibility ?? 'public',
          instagram: c.social_links?.instagram ?? '',
          facebook: c.social_links?.facebook ?? '',
        });
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [clubId]);

  // ── Field helpers ───────────────────────────────────────────
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ── Image upload helper ─────────────────────────────────────
  const handleImageUpload = async (
    file: File,
    field: 'avatar_url' | 'banner_url',
    setUploading: (v: boolean) => void,
  ) => {
    if (!user) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadFile(file, {
        ownerUserId: user.id,
        category: 'club_photo',
        entityType: 'club',
        entityId: clubId,
        caption: field === 'avatar_url' ? 'Club avatar' : 'Club banner',
      });
      const url = result.drive_view_link ?? undefined;
      await updateClub(clubId, { [field]: url });
      setClub((prev) => prev ? { ...prev, [field]: url } : prev);
    } catch (err) {
      setError(`Erro ao enviar imagem: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  // ── Save ────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const socialLinks: Record<string, string> = {};
      if (form.instagram) socialLinks.instagram = form.instagram;
      if (form.facebook) socialLinks.facebook = form.facebook;

      // Preserve existing social links not managed here
      if (club?.social_links) {
        const existing = club.social_links;
        Object.keys(existing).forEach((k) => {
          if (k !== 'instagram' && k !== 'facebook' && existing[k] !== undefined) {
            socialLinks[k] = existing[k] as string;
          }
        });
      }

      await updateClub(clubId, {
        name: form.name.trim(),
        location: form.location.trim(),
        website: form.website.trim() || undefined,
        description: form.description.trim() || undefined,
        founded_at: form.founded_at || undefined,
        color: form.color,
        visibility: form.visibility,
        social_links: socialLinks,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ── Render: loading ─────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#777575', fontSize: '13px' }}>
        A carregar...
      </div>
    );
  }

  if (error && !club) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#ff716c', fontSize: '13px' }}>
        {error}
      </div>
    );
  }

  // ── Render: form ────────────────────────────────────────────
  return (
    <div style={{ padding: '4px' }}>

      {/* ── GERAL ─────────────────────────────────────────── */}
      <div style={card}>
        <SectionHeader label="Geral" />

        {/* Name */}
        <div style={fieldGroup}>
          <label style={fieldLabel}>Nome do clube *</label>
          <input
            style={inputStyle}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Ex: MTB Lisboa"
            maxLength={80}
          />
        </div>

        {/* Location */}
        <div style={fieldGroup}>
          <label style={fieldLabel}>Localização</label>
          <input
            style={inputStyle}
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Ex: Lisboa, Portugal"
            maxLength={100}
          />
        </div>

        {/* Website */}
        <div style={fieldGroup}>
          <label style={fieldLabel}>Website</label>
          <input
            style={inputStyle}
            type="url"
            value={form.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://..."
          />
        </div>

        {/* Description */}
        <div style={fieldGroup}>
          <label style={fieldLabel}>Descrição</label>
          <textarea
            style={textareaStyle}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Descreve o clube, os seus objetivos, modalidades..."
            maxLength={1000}
          />
        </div>

        {/* Founded at */}
        <div style={fieldGroup}>
          <label style={fieldLabel}>Data de fundação</label>
          <input
            style={inputStyle}
            type="date"
            value={form.founded_at}
            onChange={(e) => set('founded_at', e.target.value)}
          />
        </div>

        {/* Color */}
        <div style={fieldGroup}>
          <label style={fieldLabel}>Cor do clube</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="color"
              value={form.color}
              onChange={(e) => set('color', e.target.value)}
              style={{
                width: '44px',
                height: '36px',
                padding: '2px',
                border: '1px solid rgba(73,72,71,0.4)',
                borderRadius: '6px',
                backgroundColor: '#262626',
                cursor: 'pointer',
              }}
            />
            <span style={{ fontSize: '12px', color: '#adaaaa', fontFamily: 'monospace' }}>
              {form.color.toUpperCase()}
            </span>
            <span
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: form.color,
                border: '2px solid rgba(255,255,255,0.1)',
                display: 'inline-block',
              }}
            />
          </div>
        </div>

        {/* Visibility */}
        <div style={fieldGroup}>
          <label style={fieldLabel}>Visibilidade</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['public', 'private'] as const).map((v) => {
              const active = form.visibility === v;
              return (
                <button
                  key={v}
                  onClick={() => set('visibility', v)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '6px',
                    border: active ? '1px solid #3fff8b' : '1px solid rgba(73,72,71,0.4)',
                    backgroundColor: active ? 'rgba(63,255,139,0.08)' : '#262626',
                    color: active ? '#3fff8b' : '#adaaaa',
                    fontSize: '12px',
                    fontWeight: active ? 700 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {v === 'public' ? 'Publico' : 'Privado'}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: '10px', color: '#555', marginTop: '4px', display: 'block' }}>
            {form.visibility === 'public'
              ? 'Qualquer pessoa pode encontrar e ver o clube.'
              : 'Apenas membros aprovados acedem ao clube.'}
          </span>
        </div>
      </div>

      {/* ── IMAGEM ────────────────────────────────────────── */}
      <div style={card}>
        <SectionHeader label="Imagem" />

        <ImageUpload
          label="Avatar (foto do clube)"
          currentUrl={club?.avatar_url}
          uploading={avatarUploading}
          onUpload={(file) =>
            handleImageUpload(file, 'avatar_url', setAvatarUploading)
          }
          previewStyle={{ borderRadius: '50%' }}
        />

        <ImageUpload
          label="Banner (cabeçalho)"
          currentUrl={club?.banner_url}
          uploading={bannerUploading}
          onUpload={(file) =>
            handleImageUpload(file, 'banner_url', setBannerUploading)
          }
          previewStyle={{ width: '100%', height: '80px', borderRadius: '6px' }}
        />
      </div>

      {/* ── REDES SOCIAIS ─────────────────────────────────── */}
      <div style={card}>
        <SectionHeader label="Redes Sociais" />

        <div style={fieldGroup}>
          <label style={fieldLabel}>Instagram</label>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#555',
              fontSize: '12px',
              userSelect: 'none',
            }}>
              instagram.com/
            </span>
            <input
              style={{ ...inputStyle, paddingLeft: '100px' }}
              value={form.instagram}
              onChange={(e) => set('instagram', e.target.value)}
              placeholder="nomedoutilizador"
            />
          </div>
        </div>

        <div style={fieldGroup}>
          <label style={fieldLabel}>Facebook</label>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#555',
              fontSize: '12px',
              userSelect: 'none',
            }}>
              facebook.com/
            </span>
            <input
              style={{ ...inputStyle, paddingLeft: '100px' }}
              value={form.facebook}
              onChange={(e) => set('facebook', e.target.value)}
              placeholder="nomedapagina"
            />
          </div>
        </div>
      </div>

      {/* ── Error / Success feedback ───────────────────────── */}
      {error && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 14px',
          backgroundColor: 'rgba(255,113,108,0.1)',
          border: '1px solid rgba(255,113,108,0.3)',
          borderRadius: '6px',
          color: '#ff716c',
          fontSize: '12px',
        }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 14px',
          backgroundColor: 'rgba(63,255,139,0.08)',
          border: '1px solid rgba(63,255,139,0.3)',
          borderRadius: '6px',
          color: '#3fff8b',
          fontSize: '12px',
        }}>
          Alteracoes guardadas com sucesso.
        </div>
      )}

      {/* ── Save button ────────────────────────────────────── */}
      <button
        onClick={handleSave}
        disabled={saving || !form.name.trim()}
        style={{
          width: '100%',
          padding: '14px',
          backgroundColor: saving || !form.name.trim() ? '#2a4a38' : '#3fff8b',
          color: saving || !form.name.trim() ? '#4a7a5a' : 'black',
          fontWeight: 900,
          fontSize: '13px',
          border: 'none',
          borderRadius: '8px',
          cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
          letterSpacing: '0.5px',
          textTransform: 'uppercase' as const,
          marginBottom: '24px',
        }}
      >
        {saving ? 'A guardar...' : 'Guardar Alteracoes'}
      </button>
    </div>
  );
}
