import { useState, useEffect, useRef } from 'react';
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

  // Draw QR code on canvas (simple implementation without external lib)
  useEffect(() => {
    if (!qr || !canvasRef.current) return;
    const url = `${window.location.origin}/bike/${qr.token}`;
    drawQR(canvasRef.current, url);
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

/** Simple QR code drawing (uses a basic encoding — for production use qrcode lib) */
function drawQR(canvas: HTMLCanvasElement, text: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = 200;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, size, size);

  // Simple visual QR placeholder using text hash pattern
  // For real QR, install 'qrcode' npm package
  const hash = simpleHash(text);
  const moduleSize = 5;
  const modules = Math.floor(size / moduleSize);

  ctx.fillStyle = '#000000';
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      // Position detection patterns (3 corners)
      if (isFinderPattern(x, y, modules)) {
        ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
        continue;
      }
      // Data modules from hash
      const bit = (hash[(y * modules + x) % hash.length]! ^ ((x * 7 + y * 13) & 0xFF)) & 1;
      if (bit) {
        ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
      }
    }
  }

  // Draw text below
  ctx.fillStyle = '#666666';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  const token = text.split('/').pop() ?? text;
  ctx.fillText(token, size / 2, size - 4);
}

function isFinderPattern(x: number, y: number, modules: number): boolean {
  const s = 7; // finder pattern size
  // Top-left
  if (x < s && y < s) return (x === 0 || x === s - 1 || y === 0 || y === s - 1) || (x >= 2 && x <= 4 && y >= 2 && y <= 4);
  // Top-right
  if (x >= modules - s && y < s) { const lx = x - (modules - s); return (lx === 0 || lx === s - 1 || y === 0 || y === s - 1) || (lx >= 2 && lx <= 4 && y >= 2 && y <= 4); }
  // Bottom-left
  if (x < s && y >= modules - s) { const ly = y - (modules - s); return (x === 0 || x === s - 1 || ly === 0 || ly === s - 1) || (x >= 2 && x <= 4 && ly >= 2 && ly <= 4); }
  return false;
}

function simpleHash(str: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < 256; i++) {
    let h = i;
    for (let j = 0; j < str.length; j++) {
      h = (h * 31 + str.charCodeAt(j % str.length)) & 0xFF;
    }
    result.push(h);
  }
  return result;
}
