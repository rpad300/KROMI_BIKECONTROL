import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useAuthStore } from '../../store/authStore';
import { getQRCode, createQRCode } from '../../services/maintenance/MaintenanceService';
import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import type { BikeQRCode as QRType } from '../../types/service.types';

/** Generate and display a QR code for the active bike */
export function BikeQRDisplay({ bikeId }: { bikeId?: string }) {
  const userId = useAuthStore((s) => s.user?.id);
  const activeBikeId = useSettingsStore((s) => s.activeBikeId);
  const bike = safeBikeConfig(useSettingsStore((s) => s.bikeConfig));
  const id = bikeId ?? activeBikeId;

  const [qr, setQR] = useState<QRType | null>(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!userId || !id) return;
    (async () => {
      setLoading(true);
      let code = await getQRCode(id, userId);
      if (!code) code = await createQRCode(id, userId);
      setQR(code);
      setLoading(false);
    })();
  }, [id, userId]);

  // Draw real QR code on canvas using qrcode lib
  useEffect(() => {
    if (!qr || !canvasRef.current) return;
    const url = `${window.location.origin}/bike/${qr.token}`;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 200,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
  }, [qr]);

  if (loading) {
    return <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!qr) return null;

  const url = `${window.location.origin}/bike/${qr.token}`;

  return (
    <div style={{ padding: '16px', backgroundColor: '#131313', borderRadius: '8px', textAlign: 'center' }}>
      <div style={{ fontSize: '12px', color: '#ff9f43', fontWeight: 700, marginBottom: '8px' }}>QR Code — {bike.name}</div>

      {/* QR Canvas */}
      <div style={{ display: 'inline-block', padding: '12px', backgroundColor: 'white', borderRadius: '8px', marginBottom: '8px' }}>
        <canvas ref={canvasRef} width={200} height={200} style={{ display: 'block' }} />
      </div>

      {/* Token */}
      <div style={{ fontSize: '16px', color: 'white', fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.1em' }}>
        {qr.token}
      </div>

      {/* URL */}
      <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px', wordBreak: 'break-all' }}>{url}</div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '10px', justifyContent: 'center' }}>
        <button onClick={() => navigator.clipboard.writeText(url)} style={{
          padding: '8px 14px', fontSize: '10px', fontWeight: 700, borderRadius: '4px', cursor: 'pointer',
          backgroundColor: 'rgba(255,159,67,0.15)', color: '#ff9f43', border: '1px solid rgba(255,159,67,0.25)',
        }}>
          Copiar link
        </button>
        <button onClick={() => navigator.share?.({ title: `Bike: ${bike.name}`, url })} style={{
          padding: '8px 14px', fontSize: '10px', fontWeight: 700, borderRadius: '4px', cursor: 'pointer',
          backgroundColor: 'rgba(110,155,255,0.15)', color: '#6e9bff', border: '1px solid rgba(110,155,255,0.25)',
        }}>
          Partilhar
        </button>
      </div>

      <div style={{ fontSize: '8px', color: '#494847', marginTop: '8px' }}>
        O mecânico pode ler este QR para aceder ao histórico de serviço da bike.
      </div>
    </div>
  );
}

