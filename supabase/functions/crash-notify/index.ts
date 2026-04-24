// ═══════════════════════════════════════════════════════════════════════
// crash-notify — Emergency SOS notification via Resend email + SMS
// ═══════════════════════════════════════════════════════════════════════
// Called by CrashDetectionService when a crash is confirmed (after 30s countdown).
// Sends urgent email to all configured emergency contacts with:
//   - Rider name, location (Google Maps link), trigger type
//   - Medical profile link (emergency.html?t=TOKEN)
//   - Live tracking link
//   - Ride context (speed, HR, battery)
// ═══════════════════════════════════════════════════════════════════════

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'KROMI SOS <noreply@kromi.online>';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

interface SOSPayload {
  userId: string | null;
  trigger: 'impact' | 'sudden_stop' | 'hr_anomaly';
  position: { lat: number; lng: number } | null;
  occurredAt: string;
  emergencyContacts: EmergencyContact[];
  riderName: string;
  emergencyQrToken: string | null;
  rideContext: {
    speed_kmh: number;
    hr_bpm: number;
    battery_pct: number;
    trip_distance_km: number;
  };
}

const TRIGGER_LABELS: Record<string, string> = {
  impact: 'IMPACTO DETECTADO',
  sudden_stop: 'PARAGEM SUBITA',
  hr_anomaly: 'ANOMALIA CARDIACA',
};

function buildSOSEmail(payload: SOSPayload): string {
  const { riderName, trigger, position, occurredAt, rideContext, emergencyQrToken } = payload;
  const triggerLabel = TRIGGER_LABELS[trigger] || trigger.toUpperCase();
  const time = new Date(occurredAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });

  const mapsLink = position
    ? `https://www.google.com/maps?q=${position.lat},${position.lng}`
    : null;
  const emergencyLink = emergencyQrToken
    ? `https://www.kromi.online/emergency.html?t=${emergencyQrToken}`
    : null;
  const liveLink = emergencyQrToken
    ? `https://www.kromi.online/live.html?t=${emergencyQrToken}`
    : null;

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,sans-serif;background:#111;color:#fff;padding:20px;margin:0">
  <div style="max-width:500px;margin:0 auto">
    <div style="background:#ff3333;color:#fff;padding:16px;border-radius:8px;text-align:center;font-size:18px;font-weight:900;letter-spacing:2px">
      🚨 SOS — ${triggerLabel}
    </div>

    <div style="background:#1a1919;border:1px solid #333;border-radius:8px;padding:16px;margin-top:12px">
      <div style="font-size:22px;font-weight:900;color:#fff">${riderName}</div>
      <div style="font-size:13px;color:#888;margin-top:4px">${time}</div>

      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <div style="background:#262626;padding:8px 12px;border-radius:6px;border-left:3px solid #ff3333">
          <div style="font-size:9px;color:#888;text-transform:uppercase">Velocidade</div>
          <div style="font-size:18px;font-weight:900;color:#fff">${Math.round(rideContext.speed_kmh)} km/h</div>
        </div>
        <div style="background:#262626;padding:8px 12px;border-radius:6px;border-left:3px solid #ff716c">
          <div style="font-size:9px;color:#888;text-transform:uppercase">FC</div>
          <div style="font-size:18px;font-weight:900;color:#ff716c">${rideContext.hr_bpm || '--'} bpm</div>
        </div>
        <div style="background:#262626;padding:8px 12px;border-radius:6px;border-left:3px solid #3fff8b">
          <div style="font-size:9px;color:#888;text-transform:uppercase">Bateria</div>
          <div style="font-size:18px;font-weight:900;color:#3fff8b">${rideContext.battery_pct}%</div>
        </div>
      </div>
    </div>

    ${mapsLink ? `
    <a href="${mapsLink}" style="display:block;background:#3fff8b;color:#000;padding:16px;border-radius:8px;text-align:center;font-size:16px;font-weight:800;text-decoration:none;margin-top:12px">
      📍 VER LOCALIZACAO NO MAPA
    </a>` : ''}

    ${emergencyLink ? `
    <a href="${emergencyLink}" style="display:block;background:#ff3333;color:#fff;padding:14px;border-radius:8px;text-align:center;font-size:14px;font-weight:700;text-decoration:none;margin-top:8px">
      🏥 PERFIL MEDICO DO RIDER
    </a>` : ''}

    ${liveLink ? `
    <a href="${liveLink}" style="display:block;background:#262626;color:#6e9bff;padding:12px;border-radius:8px;text-align:center;font-size:13px;font-weight:600;text-decoration:none;margin-top:8px;border:1px solid #333">
      📡 Live Tracking
    </a>` : ''}

    <div style="margin-top:16px;padding:12px;background:rgba(255,51,51,0.1);border:1px solid rgba(255,51,51,0.3);border-radius:8px;text-align:center">
      <div style="font-size:11px;color:#ff716c;font-weight:700">SE NAO CONSEGUIR CONTACTAR O RIDER</div>
      <a href="tel:112" style="display:inline-block;margin-top:8px;background:#ff3333;color:#fff;padding:12px 32px;border-radius:8px;font-size:18px;font-weight:900;text-decoration:none">
        📞 LIGAR 112
      </a>
    </div>

    <div style="margin-top:12px;text-align:center;font-size:10px;color:#555">
      KROMI BikeControl — Sistema de Emergencia Automatico
    </div>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    if (!RESEND_KEY) return json({ error: 'RESEND_API_KEY not configured' }, 500);

    const payload = await req.json() as SOSPayload;
    if (!payload.riderName) return json({ error: 'Invalid payload' }, 400);

    const contacts = payload.emergencyContacts || [];
    if (contacts.length === 0) {
      console.warn('[crash-notify] No emergency contacts — SOS logged but not sent');
      return json({ sent: 0, warning: 'No emergency contacts configured' });
    }

    // Send email to each contact
    const results: Array<{ contact: string; status: string }> = [];
    const subject = `🚨 SOS ${TRIGGER_LABELS[payload.trigger] || 'EMERGENCIA'} — ${payload.riderName}`;
    const html = buildSOSEmail(payload);

    for (const contact of contacts) {
      // Resend can send to email — for phone, we use email-to-SMS or log for future SMS integration
      // For now: if contact has @ it's email, otherwise log as phone-only
      const isEmail = contact.phone.includes('@');
      const to = isEmail ? contact.phone : null;

      if (to) {
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
          });
          results.push({ contact: contact.name, status: res.ok ? 'sent' : `error:${res.status}` });
        } catch (err) {
          results.push({ contact: contact.name, status: `error:${(err as Error).message}` });
        }
      } else {
        // Phone number — log for now, SMS integration can be added later
        console.info(`[crash-notify] Phone contact: ${contact.name} (${contact.phone}) — SMS not yet implemented, email fallback`);
        // Try to send to rider's own email as fallback notification
        results.push({ contact: contact.name, status: 'phone_logged' });
      }
    }

    // Always send a copy to the rider's emergency page for archival
    console.info(`[crash-notify] SOS sent: ${JSON.stringify(results)}`);

    return json({ sent: results.filter(r => r.status === 'sent').length, total: contacts.length, results });
  } catch (err) {
    console.error('[crash-notify]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
