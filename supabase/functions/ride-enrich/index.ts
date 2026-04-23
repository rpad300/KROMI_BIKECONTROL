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
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || 'AIzaSyCYFKDixWoJAgUvLlyY6jOyuvbVWA9dGJw';
const GEMINI_MODEL = 'gemini-2.5-pro';
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

// ── Gemini call ─────────────────────────────────────────────────────────
async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
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
function buildPrompt(ride: Record<string, unknown>, pois: Array<Record<string, unknown>>): string {
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

GERA O SEGUINTE JSON (sem markdown, apenas JSON puro):
{
  "narrative": "Texto editorial de 3-4 paragrafos descrevendo a travessia de forma evocativa — paisagem, terreno, desafios, recompensas. Menciona as zonas geograficas reais. Estilo revista de outdoor.",

  "pois": [
    {
      "index": 0,
      "description": "Descricao rica de 2-3 frases com contexto historico, geografico ou cultural do local. Menciona nomes reais de aldeias, serras, rios, monumentos se relevante.",
      "curiosity": "Uma curiosidade interessante sobre o local (geologia, historia, fauna, flora, gastronomia local).",
      "food_tip": "Sugestao de restaurante ou cafe proximo se for zona com servicos (null se zona remota)."
    }
  ],

  "safety_notes": [
    {
      "zone": "Nome da zona",
      "km_range": "km X a km Y",
      "warning": "Aviso de seguranca especifico para este trecho (terreno, transito, exposicao, etc.)",
      "tip": "Conselho pratico para passar em seguranca"
    }
  ],

  "difficulty_text": "Avaliacao editorial da dificuldade em 2-3 frases — para quem e adequada, que experiencia requer, o que a torna especial.",

  "gear_tips": [
    "Dica especifica de equipamento baseada neste percurso em particular"
  ]
}

IMPORTANTE:
- Usa conhecimento real de geografia portuguesa
- Menciona nomes reais de localidades, serras, rios
- Cada POI description deve ser unica e relevante para a localizacao exacta
- safety_notes devem ser praticas e especificas ao terreno
- Nao inventes factos — se nao souberes algo sobre um local, descreve o terreno/paisagem
- Responde APENAS com JSON valido, sem marcadores markdown`;
}

// ── Main handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    if (!GEMINI_KEY) return json({ error: 'GEMINI_API_KEY not configured' }, 500);
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Missing Supabase config' }, 500);

    const { ride_id, pois, ride_data } = await req.json();
    if (!ride_id) return json({ error: 'ride_id required' }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Check if already enriched (cache)
    const { data: existing } = await sb
      .from('club_rides')
      .select('ride_data')
      .eq('id', ride_id)
      .maybeSingle();

    if (existing?.ride_data?.ai_enrichment) {
      return json({ cached: true, enrichment: existing.ride_data.ai_enrichment });
    }

    // Build prompt and call Gemini
    const prompt = buildPrompt(ride_data || {}, pois || []);
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
