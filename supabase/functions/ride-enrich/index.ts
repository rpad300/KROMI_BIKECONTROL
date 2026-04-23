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
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || 'AIzaSyArG_Q_xGaQ7aT0EMGw8KUbpG0XmKqyfVM';
const GEMINI_MODEL = 'gemini-2.5-flash';
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

    const { ride_id, pois, ride_data, segments } = await req.json();
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
    const prompt = buildPrompt(ride_data || {}, pois || [], segments || []);
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
