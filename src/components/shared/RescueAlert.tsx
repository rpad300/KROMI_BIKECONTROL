/**
 * RescueAlert — monitors for nearby SOS requests and shows alert popup.
 *
 * When a cyclist opens their emergency QR page and taps "Pedir Ajuda SOS",
 * a rescue_request is created in Supabase. This component polls every 10s
 * and shows an alert with sound if a request is found within 5km.
 *
 * Privacy: the responder's contact info is only shared AFTER they accept.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMapStore } from '../../store/mapStore';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAthleteStore } from '../../store/athleteStore';

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const POLL_INTERVAL = 10_000; // 10s
const RADIUS_KM = 5;

interface SOSRequest {
  id: string;
  victim_name: string;
  victim_lat: number;
  victim_lng: number;
  distance_km: number;
  created_at: string;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Play emergency alert sound */
function playAlertSound() {
  try {
    const ctx = new AudioContext();
    // 3 ascending urgent beeps
    [0, 300, 600].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880 + delay; // ascending pitch
      gain.gain.value = 0.4;
      osc.start(ctx.currentTime + delay / 1000);
      osc.stop(ctx.currentTime + delay / 1000 + 0.2);
    });
    // Vibrate if supported
    if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 500]);
  } catch { /* no audio context */ }
}

export function RescueAlert() {
  const [sos, setSos] = useState<SOSRequest | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const rideActive = useAthleteStore((s) => s.rideActive);
  const rescueAvailable = useSettingsStore((s) => s.riderProfile.rescue_available);

  const checkForSOS = useCallback(async () => {
    if (!SB_URL || !SB_KEY || !rescueAvailable) return;

    const map = useMapStore.getState();
    if (!map.latitude || !map.longitude) return;

    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/rescue_requests?status=eq.active&expires_at=gt.${new Date().toISOString()}&select=id,victim_name,victim_lat,victim_lng,created_at&order=created_at.desc&limit=5`,
        { headers: { 'apikey': SB_KEY!, 'Authorization': `Bearer ${SB_KEY}` } },
      );
      const requests = await res.json() as { id: string; victim_name: string; victim_lat: number; victim_lng: number; created_at: string }[];

      // Find nearest within radius
      for (const req of requests) {
        if (dismissed.has(req.id)) continue;
        const dist = haversineKm(map.latitude, map.longitude, req.victim_lat, req.victim_lng);
        if (dist <= RADIUS_KM) {
          setSos({ ...req, distance_km: Math.round(dist * 10) / 10 });
          playAlertSound();
          return;
        }
      }
    } catch { /* ignore */ }
  }, [rescueAvailable, dismissed]);

  // Poll when ride is active and rescue is enabled
  useEffect(() => {
    if (!rideActive || !rescueAvailable) return;
    checkForSOS();
    const id = setInterval(checkForSOS, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [rideActive, rescueAvailable, checkForSOS]);

  const handleAccept = async () => {
    if (!sos || !SB_URL || !SB_KEY) return;

    const userId = useAuthStore.getState().getUserId();
    const profile = useSettingsStore.getState().riderProfile;
    const map = useMapStore.getState();

    try {
      await fetch(`${SB_URL}/rest/v1/rescue_responses`, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          request_id: sos.id,
          responder_user_id: userId,
          responder_name: profile.name || 'Ciclista',
          responder_phone: profile.phone || null,
          responder_lat: map.latitude,
          responder_lng: map.longitude,
          distance_km: sos.distance_km,
        }),
      });
      setAccepted(true);
    } catch { /* ignore */ }
  };

  const handleDismiss = () => {
    if (sos) setDismissed((prev) => new Set(prev).add(sos.id));
    setSos(null);
    setAccepted(false);
  };

  if (!sos) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      backgroundColor: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
      animation: 'rescuePulse 1s ease-in-out infinite alternate',
    }}>
      <div style={{
        backgroundColor: '#1a1919', borderRadius: '16px', padding: '24px',
        maxWidth: '400px', width: '100%', textAlign: 'center',
        border: '2px solid #ff3333',
      }}>
        {/* SOS icon */}
        <div style={{ fontSize: '56px', marginBottom: '8px' }}>&#128680;</div>

        <div style={{ fontSize: '22px', fontWeight: 900, color: '#ff3333', marginBottom: '4px' }}>
          PEDIDO DE AJUDA
        </div>

        <div style={{ fontSize: '16px', color: 'white', fontWeight: 700, marginBottom: '4px' }}>
          {sos.victim_name || 'Ciclista'}
        </div>

        <div style={{ fontSize: '14px', color: '#fbbf24', marginBottom: '16px' }}>
          a {sos.distance_km} km de ti
        </div>

        {!accepted ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button onClick={handleAccept}
              style={{
                width: '100%', height: '56px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                backgroundColor: '#3fff8b', color: '#000', fontSize: '18px', fontWeight: 900,
              }}>
              ACEITAR — VOU AJUDAR
            </button>
            <button onClick={handleDismiss}
              style={{
                width: '100%', height: '44px', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer',
                backgroundColor: '#262626', color: '#888', fontSize: '14px', fontWeight: 600,
              }}>
              Nao posso ajudar agora
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '16px', color: '#3fff8b', fontWeight: 700, marginBottom: '12px' }}>
              Obrigado! Os teus dados foram partilhados.
            </div>
            <a
              href={`https://maps.google.com/?q=${sos.victim_lat},${sos.victim_lng}&navigate=yes`}
              target="_blank"
              rel="noopener"
              style={{
                display: 'block', width: '100%', height: '48px', lineHeight: '48px', borderRadius: '8px',
                backgroundColor: '#6e9bff', color: 'white', fontSize: '16px', fontWeight: 700,
                textDecoration: 'none', textAlign: 'center',
              }}>
              Navegar ate a vitima
            </a>
            <button onClick={handleDismiss}
              style={{
                width: '100%', height: '36px', border: 'none', cursor: 'pointer', marginTop: '8px',
                backgroundColor: 'transparent', color: '#888', fontSize: '12px',
              }}>
              Fechar
            </button>
          </div>
        )}

        <div style={{ fontSize: '9px', color: '#494847', marginTop: '12px' }}>
          A tua localizacao e contacto so sao partilhados se aceitares.
        </div>
      </div>

      <style>{`
        @keyframes rescuePulse {
          from { border-color: rgba(255,51,51,0.3); }
          to { border-color: rgba(255,51,51,0.8); }
        }
      `}</style>
    </div>
  );
}
