import { useState, useRef } from 'react';
import { useAuthStore } from '../../store/authStore';
import { addPhoto } from '../../services/maintenance/MaintenanceService';
import type { PhotoType } from '../../types/service.types';

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

interface PhotoUploaderProps {
  serviceId: string;
  itemId?: string;
  onUploaded?: () => void;
}

export function PhotoUploader({ serviceId, itemId, onUploaded }: PhotoUploaderProps) {
  const userId = useAuthStore((s) => s.user?.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoType, setPhotoType] = useState<PhotoType>('general');
  const [caption, setCaption] = useState('');

  const handleFile = async (file: File) => {
    if (!userId || !SB_URL || !SB_KEY) return;

    // Preview
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    try {
      // Upload to Supabase Storage
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `service-photos/${serviceId}/${crypto.randomUUID()}.${ext}`;

      const uploadRes = await fetch(`${SB_URL}/storage/v1/object/${path}`, {
        method: 'POST',
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          'Content-Type': file.type,
          'x-upsert': 'true',
        },
        body: file,
      });

      if (uploadRes.ok) {
        // Save photo record
        await addPhoto({
          service_id: serviceId,
          item_id: itemId ?? null,
          uploaded_by: userId,
          storage_path: path,
          file_name: file.name,
          file_size_bytes: file.size,
          mime_type: file.type,
          caption: caption || null,
          photo_type: photoType,
        });
        setPreview(null);
        setCaption('');
        onUploaded?.();
      }
    } catch {
      // Upload failed silently
    }
    setUploading(false);
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

/** Display a grid of uploaded photos */
export function PhotoGrid({ photos }: {
  photos: { id: string; storage_path: string; caption: string | null; photo_type: string; created_at: string }[];
}) {
  if (photos.length === 0) return null;
  const typeColors: Record<string, string> = { before: '#fbbf24', after: '#3fff8b', damage: '#ff716c', receipt: '#e966ff', general: '#6e9bff' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
      {photos.map((p) => (
        <div key={p.id} style={{ position: 'relative', borderRadius: '4px', overflow: 'hidden', aspectRatio: '1' }}>
          <img
            src={`${SB_URL}/storage/v1/object/public/${p.storage_path}`}
            alt={p.caption ?? ''}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
          <span style={{
            position: 'absolute', top: '2px', left: '2px', fontSize: '7px', padding: '1px 4px',
            backgroundColor: `${typeColors[p.photo_type] ?? '#494847'}cc`, color: 'white',
            borderRadius: '2px', fontWeight: 700,
          }}>
            {p.photo_type}
          </span>
        </div>
      ))}
    </div>
  );
}
