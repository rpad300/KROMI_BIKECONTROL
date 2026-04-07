import { useState, useRef } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useReadOnlyGuard } from '../../hooks/useReadOnlyGuard';
import { addPhoto } from '../../services/maintenance/MaintenanceService';
import { uploadFile, slugify, userFolderSlug, type KromiFile } from '../../services/storage/KromiFileStore';
import type { PhotoType } from '../../types/service.types';

interface PhotoUploaderProps {
  serviceId: string;
  itemId?: string;
  /** Bike slug used to route the upload to KROMI PLATFORM/bikes/{slug}/services/{id}/. */
  bikeSlug?: string;
  /** Display name for slug fallback (e.g. "Giant Trance X E+ 2"). */
  bikeName?: string;
  onUploaded?: () => void;
}

export function PhotoUploader({ serviceId, itemId, bikeSlug, bikeName, onUploaded }: PhotoUploaderProps) {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const guard = useReadOnlyGuard();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoType, setPhotoType] = useState<PhotoType>('general');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resolvedBikeSlug = bikeSlug ?? (bikeName ? slugify(bikeName) : 'unknown');

  const handleFile = async (file: File) => {
    if (!user || !userId) {
      setError('Não autenticado');
      return;
    }
    if (!guard('Não é possível enviar fotos em modo impersonation.')) return;
    setError(null);

    // Local preview
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    try {
      // 1. Upload via KromiFileStore → goes to Google Drive, registers in kromi_files
      const kromiFile: KromiFile = await uploadFile(file, {
        ownerUserId: userId,
        ownerUserSlug: userFolderSlug(user),
        category: photoType === 'receipt' ? 'receipt' : 'service_photo',
        subcategory: photoType,
        entityType: 'service_request',
        entityId: serviceId,
        bikeSlug: resolvedBikeSlug,
        serviceId,
        caption: caption || undefined,
      });

      // 2. Also create the service_photos row that links to kromi_files for backwards compat
      await addPhoto({
        service_id: serviceId,
        item_id: itemId ?? null,
        uploaded_by: userId,
        file_id: kromiFile.id,
        file_name: kromiFile.file_name,
        file_size_bytes: kromiFile.size_bytes,
        mime_type: kromiFile.mime_type,
        caption: caption || null,
        photo_type: photoType,
      });

      setPreview(null);
      setCaption('');
      onUploaded?.();
    } catch (err) {
      setError((err as Error).message ?? 'Falha no upload');
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const typeOptions: { value: PhotoType; label: string; icon: string }[] = [
    { value: 'before', label: 'Antes', icon: 'photo_camera' },
    { value: 'after', label: 'Depois', icon: 'check_circle' },
    { value: 'damage', label: 'Dano', icon: 'warning' },
    { value: 'receipt', label: 'Recibo', icon: 'receipt' },
    { value: 'general', label: 'Geral', icon: 'image' },
  ];

  return (
    <div style={{ padding: '10px', backgroundColor: '#131313', borderRadius: '6px' }}>
      <div style={{ fontSize: '10px', color: '#777575', marginBottom: '6px' }}>Adicionar foto</div>

      {/* Type selector */}
      <div style={{ display: 'flex', gap: '3px', marginBottom: '6px' }}>
        {typeOptions.map((opt) => (
          <button key={opt.value} onClick={() => setPhotoType(opt.value)} style={{
            padding: '4px 8px', fontSize: '9px', fontWeight: 700, borderRadius: '3px', cursor: 'pointer',
            backgroundColor: photoType === opt.value ? 'rgba(255,159,67,0.15)' : 'rgba(73,72,71,0.1)',
            color: photoType === opt.value ? '#ff9f43' : '#777575', border: 'none',
            display: 'flex', alignItems: 'center', gap: '2px',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Caption */}
      <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)}
        placeholder="Legenda (opcional)"
        style={{ width: '100%', padding: '6px 8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.2)', borderRadius: '3px', color: 'white', fontSize: '11px', outline: 'none', marginBottom: '6px' }} />

      {/* Preview */}
      {preview && (
        <div style={{ marginBottom: '6px', borderRadius: '4px', overflow: 'hidden' }}>
          <img src={preview} alt="Preview" style={{ width: '100%', maxHeight: '200px', objectFit: 'cover' }} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: '6px 8px', marginBottom: '6px', borderRadius: '3px',
          backgroundColor: 'rgba(255,113,108,0.08)', color: '#ff716c', fontSize: '10px',
        }}>
          {error}
        </div>
      )}

      {/* Upload buttons */}
      <div style={{ display: 'flex', gap: '4px' }}>
        <input ref={fileRef} type="file" accept="image/*,video/*" onChange={handleInputChange} style={{ display: 'none' }} />
        <button onClick={() => { if (fileRef.current) { fileRef.current.capture = ''; fileRef.current.click(); } }} disabled={uploading}
          style={{ flex: 1, padding: '10px', backgroundColor: 'rgba(255,159,67,0.1)', border: '1px solid rgba(255,159,67,0.2)', borderRadius: '4px', color: '#ff9f43', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>photo_camera</span>
          {uploading ? 'A enviar...' : 'Câmara'}
        </button>
        <button onClick={() => { if (fileRef.current) { fileRef.current.removeAttribute('capture'); fileRef.current.click(); } }} disabled={uploading}
          style={{ flex: 1, padding: '10px', backgroundColor: 'rgba(110,155,255,0.1)', border: '1px solid rgba(110,155,255,0.2)', borderRadius: '4px', color: '#6e9bff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>photo_library</span>
          Galeria
        </button>
      </div>
    </div>
  );
}

// ─── Photo display ──────────────────────────────────────────
//
// PhotoGrid handles BOTH new (Google Drive via kromi_files) and legacy
// (Supabase Storage via storage_path) photos. New photos have file_id set
// and the embedded kromi_file from a PostgREST join. Legacy photos
// fall back to the public Supabase Storage URL.

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

export interface DisplayPhoto {
  id: string;
  caption: string | null;
  photo_type: string;
  created_at: string;
  // Legacy
  storage_path?: string | null;
  // New
  file_id?: string | null;
  kromi_file?: {
    drive_view_link: string | null;
    drive_thumbnail_link: string | null;
    drive_download_link: string | null;
  } | null;
}

function photoUrl(p: DisplayPhoto): string {
  if (p.kromi_file?.drive_thumbnail_link) return p.kromi_file.drive_thumbnail_link;
  if (p.kromi_file?.drive_view_link) return p.kromi_file.drive_view_link;
  if (p.storage_path && SB_URL) return `${SB_URL}/storage/v1/object/public/${p.storage_path}`;
  return '';
}

/** Display a grid of uploaded photos. Supports legacy + Drive-backed. */
export function PhotoGrid({ photos }: { photos: DisplayPhoto[] }) {
  if (photos.length === 0) return null;
  const typeColors: Record<string, string> = {
    before: '#fbbf24', after: '#3fff8b', damage: '#ff716c', receipt: '#e966ff', general: '#6e9bff',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
      {photos.map((p) => {
        const url = photoUrl(p);
        return (
          <div key={p.id} style={{ position: 'relative', borderRadius: '4px', overflow: 'hidden', aspectRatio: '1' }}>
            {url ? (
              <img
                src={url}
                alt={p.caption ?? ''}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="lazy"
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0e0e0e' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#494847' }}>broken_image</span>
              </div>
            )}
            <span style={{
              position: 'absolute', top: '2px', left: '2px', fontSize: '7px', padding: '1px 4px',
              backgroundColor: `${typeColors[p.photo_type] ?? '#494847'}cc`, color: 'white',
              borderRadius: '2px', fontWeight: 700,
            }}>
              {p.photo_type}
            </span>
          </div>
        );
      })}
    </div>
  );
}
