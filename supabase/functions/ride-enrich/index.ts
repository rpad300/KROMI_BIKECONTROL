// ═══════════════════════════════════════════════════════════════════════
// ride-enrich — AI-powered ride content enrichment via Gemini
// ═══════════════════════════════════════════════════════════════════════
// Generates rich editorial content for ride pages:
//   - POI descriptions (historical, geographical, cultural context)
//   - Ride narrative (magazine-style article)
//   - Safety warnings per terrain zone
//   - Food/drink suggestions near stops
//   - Curiosities about areas traversed
//
// Caches result in club_rides.ride_data.ai_enrichment
// ═══════════════════════════════════════════════════════════════════════

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

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

// ── GPX Parsing (server-side) ───────────────────────────────────────────
function parseGpxServer(gpxText: string): Array<{ lat: number; lon: number; ele: number }> {
  const points: Array<{ lat: number; lon: number; ele: number }> = [];
  // Simple regex-based parser (no DOM in Deno edge runtime)
  const trkptRegex = /<(?:trkpt|rtept)\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/(?:trkpt|rtept)>/gi;
  let match;
  while ((match = trkptRegex.exec(gpxText)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const eleMatch = match[3].match(/<ele>([^<]+)<\/ele>/);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
    if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, ele });
  }
  return points;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

interface ProfilePoint { d: number; e: number; lat: number; lon: number }

function buildProfile(pts: Array<{ lat: number; lon: number; ele: number }>): ProfilePoint[] {
  const profile: ProfilePoint[] = [];
  let cumDist = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) cumDist += haversineKm(pts[i - 1], pts[i]);
    profile.push({ d: cumDist, e: pts[i].ele, lat: pts[i].lat, lon: pts[i].lon });
  }
  // 5-point moving average smoothing
  const W = 2;
  return profile.map((p, j) => {
    let sum = 0, cnt = 0;
    for (let k = Math.max(0, j - W); k <= Math.min(profile.length - 1, j + W); k++) {
      sum += profile[k].e; cnt++;
    }
    return { d: p.d, e: sum / cnt, lat: p.lat, lon: p.lon };
  });
}

function autoDetectSegmentsServer(profile: ProfilePoint[]) {
  if (profile.length < 10) return [];
  const segments: Array<Record<string, unknown>> = [];
  const MIN_GAIN = 50;
  let i = 0;
  while (i < profile.length - 1) {
    let j = i + 1;
    while (j < profile.length && Math.abs(profile[j].e - profile[i].e) < 10) j++;
    if (j >= profile.length) break;
    const dir = profile[j].e > profile[i].e ? 1 : -1;
    const segStart = i;
    let segEnd = j;
    let localMin = profile[segStart].e, localMax = profile[segStart].e;
    while (segEnd < profile.length - 1) {
      const nextE = profile[segEnd + 1].e;
      if (dir > 0) { if (nextE > localMax) localMax = nextE; if (localMax - nextE > 30) break; }
      else { if (nextE < localMin) localMin = nextE; if (nextE - localMin > 30) break; }
      segEnd++;
    }
    const startE = profile[segStart].e, endE = profile[segEnd].e;
    let totalGain = 0, totalLoss = 0;
    for (let k = segStart + 1; k <= segEnd; k++) {
      const delta = profile[k].e - profile[k - 1].e;
      if (delta > 0) totalGain += delta; else totalLoss += Math.abs(delta);
    }
    const primaryGain = dir > 0 ? totalGain : totalLoss;
    const distKm = profile[segEnd].d - profile[segStart].d;
    if (primaryGain >= MIN_GAIN && distKm > 0.2) {
      const avgGrad = distKm > 0 ? ((endE - startE) / (distKm * 1000)) * 100 : 0;
      const upCount = segments.filter(s => s.direction === 1).length;
      const downCount = segments.filter(s => s.direction === -1).length;
      segments.push({
        name: dir > 0 ? `Subida ${upCount + 1}` : `Descida ${downCount + 1}`,
        direction: dir, distance_km: +distKm.toFixed(2),
        elevation_gain_m: Math.round(totalGain), elevation_loss_m: Math.round(totalLoss),
        avg_gradient_pct: +avgGrad.toFixed(1), start_ele: Math.round(startE), end_ele: Math.round(endE),
      });
    }
    i = segEnd;
  }
  return segments;
}

function generatePOIsServer(profile: ProfilePoint[], gpxText?: string) {
  if (profile.length < 2) return [];
  const pois: Array<Record<string, unknown>> = [];
  const last = profile[profile.length - 1];
  pois.push({ type: 'start', name: 'Partida', km: 0, ele: Math.round(profile[0].e), lat: profile[0].lat, lon: profile[0].lon });

  let maxIdx = 0, minIdx = 0;
  for (let i = 1; i < profile.length; i++) {
    if (profile[i].e > profile[maxIdx].e) maxIdx = i;
    if (profile[i].e < profile[minIdx].e) minIdx = i;
  }
  if (maxIdx !== 0 && maxIdx !== profile.length - 1) {
    pois.push({ type: 'summit', name: 'Ponto mais alto', km: +profile[maxIdx].d.toFixed(1), ele: Math.round(profile[maxIdx].e), lat: profile[maxIdx].lat, lon: profile[maxIdx].lon });
  }
  if (minIdx !== 0 && minIdx !== profile.length - 1 && Math.abs(profile[maxIdx].e - profile[minIdx].e) > 50) {
    pois.push({ type: 'valley', name: 'Ponto mais baixo', km: +profile[minIdx].d.toFixed(1), ele: Math.round(profile[minIdx].e), lat: profile[minIdx].lat, lon: profile[minIdx].lon });
  }
  const midIdx = Math.floor(profile.length / 2);
  pois.push({ type: 'midpoint', name: 'Meio do percurso', km: +profile[midIdx].d.toFixed(1), ele: Math.round(profile[midIdx].e), lat: profile[midIdx].lat, lon: profile[midIdx].lon });
  pois.push({ type: 'end', name: 'Chegada', km: +last.d.toFixed(1), ele: Math.round(last.e), lat: last.lat, lon: last.lon });

  // Parse GPX waypoints (<wpt> tags)
  if (gpxText) {
    const wptRegex = /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/gi;
    let wm;
    while ((wm = wptRegex.exec(gpxText)) !== null) {
      const lat = parseFloat(wm[1]);
      const lon = parseFloat(wm[2]);
      if (isNaN(lat) || isNaN(lon)) continue;
      const nameMatch = wm[3].match(/<name>([^<]+)<\/name>/);
      const eleMatch = wm[3].match(/<ele>([^<]+)<\/ele>/);
      const wptName = nameMatch ? nameMatch[1] : 'Waypoint';
      const wptEle = eleMatch ? parseFloat(eleMatch[1]) : 0;
      // Find closest profile point to get km
      let closestIdx = 0, minD = Infinity;
      for (let i = 0; i < profile.length; i++) {
        const d = Math.abs(profile[i].lat - lat) + Math.abs(profile[i].lon - lon);
        if (d < minD) { minD = d; closestIdx = i; }
      }
      pois.push({ type: 'waypoint', name: wptName, km: +profile[closestIdx].d.toFixed(1), ele: Math.round(wptEle || profile[closestIdx].e), lat, lon });
    }
  }

  pois.sort((a, b) => (a.km as number) - (b.km as number));
  return pois;
}

function computeRideDataFromProfile(profile: ProfilePoint[]) {
  let gain = 0, loss = 0, anchor = profile[0].e;
  for (let i = 1; i < profile.length; i++) {
    const diff = profile[i].e - anchor;
    if (diff > 3) { gain += diff; anchor = profile[i].e; }
    else if (diff < -3) { loss += Math.abs(diff); anchor = profile[i].e; }
  }
  const eles = profile.map(p => p.e);
  return {
    distance_km: +profile[profile.length - 1].d.toFixed(1),
    elevation_gain: Math.round(gain),
    elevation_loss: Math.round(loss),
    max_ele: Math.round(Math.max(...eles)),
    min_ele: Math.round(Math.min(...eles)),
  };
}

// ── Gemini call ─────────────────────────────────────────────────────────
async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

// ── Build prompt from ride data ─────────────────────────────────────────
function buildPrompt(ride: Record<string, unknown>, pois: Array<Record<string, unknown>>, segments?: Array<Record<string, unknown>>): string {
  const name = ride.name || 'Ride';
  const desc = ride.description || '';
  const dist = ride.distance_km || 0;
  const gain = ride.elevation_gain || 0;
  const loss = ride.elevation_loss || 0;
  const maxEle = ride.max_ele || 0;
  const minEle = ride.min_ele || 0;

  const poisText = pois.map((p, i) =>
    `POI ${i}: "${p.name}" at km ${p.km}, altitude ${p.ele}m, lat=${p.lat}, lon=${p.lon}, type=${p.type}`
  ).join('\n');

  const segsText = (segments || []).map((s, i) =>
    `SEG ${i}: "${s.name}" ${s.direction > 0 ? 'subida' : 'descida'}, ${s.distance_km}km, ${s.elevation_gain_m || 0}m D+, ${s.elevation_loss_m || 0}m D-, gradiente medio ${s.avg_gradient_pct || 0}%, de ${s.start_ele || 0}m a ${s.end_ele || 0}m`
  ).join('\n');

  return `Tu es um escritor editorial especializado em ciclismo de montanha em Portugal.
Gera conteudo rico em portugues de Portugal para uma pagina de pedalada de BTT.

DADOS DA RIDE:
- Nome: ${name}
- Descricao: ${desc}
- Distancia: ${dist} km
- Desnivel positivo: ${gain}m
- Desnivel negativo: ${loss}m
- Altitude maxima: ${maxEle}m
- Altitude minima: ${minEle}m

PONTOS DE INTERESSE:
${poisText}

SEGMENTOS DETECTADOS:
${segsText || 'Nenhum segmento detectado'}

GERA O SEGUINTE JSON (sem markdown, apenas JSON puro):
{
  "narrative": "Texto editorial de 3-4 paragrafos descrevendo a travessia de forma evocativa — paisagem, terreno, desafios, recompensas. Menciona as zonas geograficas reais. Estilo revista de outdoor.",

  "pois": [
    {
      "index": 0,
      "description": "Descricao rica de 2-3 frases com contexto historico, geografico ou cultural do local.",
      "curiosity": "Uma curiosidade interessante sobre o local.",
      "food_tip": "Sugestao de restaurante ou cafe proximo (null se zona remota)."
    }
  ],

  "segments": [
    {
      "index": 0,
      "description": "Descricao do segmento — que tipo de terreno esperar, paisagem, desafio tecnico ou fisico. 2-3 frases.",
      "tip": "Recomendacao pratica e engracada para este segmento (ex: 'Guarda as pernas para a rampa final' ou 'Se vires uma cabra no trilho, ela tem prioridade').",
      "surface": "Tipo de piso neste segmento: asfalto, terra batida, trilho single-track, estradao, gravilha, xisto, etc.",
      "curiosity": "Curiosidade sobre a zona que este segmento atravessa."
    }
  ],

  "terrain_analysis": {
    "summary": "Resumo geral dos tipos de piso encontrados ao longo de todo o percurso. 2-3 frases.",
    "surfaces": [
      {
        "type": "Nome do tipo de piso (ex: Estradao de terra, Trilho single-track, Asfalto, Xisto solto)",
        "percentage": 30,
        "km_range": "km X a km Y aproximadamente",
        "description": "Descricao deste tipo de superficie e como afecta a pedalada.",
        "tire_recommendation": "Recomendacao de pneu para este tipo de piso."
      }
    ],
    "tire_recommendation": "Recomendacao geral de pneu para este percurso completo (modelo/tipo ideal).",
    "pressure_tip": "Sugestao de pressao de pneus para este percurso."
  },

  "safety_notes": [
    {
      "zone": "Nome da zona",
      "km_range": "km X a km Y",
      "warning": "Aviso de seguranca especifico para este trecho.",
      "tip": "Conselho pratico para passar em seguranca."
    }
  ],

  "difficulty_text": "Avaliacao editorial da dificuldade em 2-3 frases.",

  "gear_tips": [
    "Dica especifica de equipamento baseada neste percurso em particular"
  ]
}

IMPORTANTE:
- Usa conhecimento real de geografia portuguesa
- Menciona nomes reais de localidades, serras, rios
- Os tips dos segmentos devem ser engracados mas uteis (estilo conversa entre amigos ciclistas)
- A analise de terreno deve ser baseada na altitude e localizacao (serra = xisto/trilho, vale = estradao/asfalto)
- Recomendacoes de pneus devem ser praticas (ex: "Maxxis Minion DHF 2.5 frente / Dissector 2.4 tras")
- Nao inventes factos — se nao souberes algo sobre um local, descreve o terreno/paisagem
- Responde APENAS com JSON valido, sem marcadores markdown`;
}

// ── Main handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    if (!GEMINI_KEY) return json({ error: 'GEMINI_API_KEY not configured' }, 500);
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Missing Supabase config' }, 500);

    const { ride_id, pois: inputPois, ride_data: inputRideData, segments: inputSegments, force, custom_instructions } = await req.json();
    if (!ride_id) return json({ error: 'ride_id required' }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Check if already enriched (cache) — skip if force=true
    const { data: existing } = await sb
      .from('club_rides')
      .select('ride_data, route_gpx, name, description')
      .eq('id', ride_id)
      .maybeSingle();

    if (!force && existing?.ride_data?.ai_enrichment) {
      return json({ cached: true, enrichment: existing.ride_data.ai_enrichment });
    }

    // Auto-parse GPX if POIs/segments not provided
    let pois = inputPois || [];
    let rideData = inputRideData || {};
    let segments = inputSegments || [];

    if (pois.length === 0 && existing?.route_gpx) {
      const gpxPoints = parseGpxServer(existing.route_gpx);
      if (gpxPoints.length >= 2) {
        const profile = buildProfile(gpxPoints);
        pois = generatePOIsServer(profile, existing.route_gpx);
        segments = autoDetectSegmentsServer(profile);
        rideData = {
          ...computeRideDataFromProfile(profile),
          name: existing.name || rideData.name,
          description: existing.description || rideData.description,
        };
      }
    }

    // Merge ride name/description from DB if not in rideData
    if (!rideData.name && existing?.name) rideData.name = existing.name;
    if (!rideData.description && existing?.description) rideData.description = existing.description;

    // Build prompt and call Gemini
    let prompt = buildPrompt(rideData, pois, segments);
    if (custom_instructions) {
      prompt += `\n\nINSTRUCOES ADICIONAIS DO UTILIZADOR:\n${custom_instructions}\nSegue estas instrucoes ao gerar o conteudo. Mantém o formato JSON igual.`;
    }
    const rawResponse = await callGemini(prompt);

    // Parse response
    let enrichment;
    try {
      enrichment = JSON.parse(rawResponse);
    } catch {
      // Try to extract JSON from markdown code block
      const match = rawResponse.match(/```json\s*([\s\S]*?)```/) || rawResponse.match(/\{[\s\S]*\}/);
      if (match) {
        enrichment = JSON.parse(match[1] || match[0]);
      } else {
        return json({ error: 'Failed to parse Gemini response', raw: rawResponse.slice(0, 500) }, 500);
      }
    }

    // Save to ride_data.ai_enrichment (merge with existing ride_data)
    const currentRideData = existing?.ride_data || {};
    const updatedRideData = { ...currentRideData, ai_enrichment: enrichment };

    await sb
      .from('club_rides')
      .update({ ride_data: updatedRideData })
      .eq('id', ride_id);

    return json({ cached: false, enrichment });

  } catch (err) {
    console.error('[ride-enrich]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
