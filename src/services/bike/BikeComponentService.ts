/**
 * BikeComponentService — shared bike component catalog
 *
 * Queries Supabase bike_components table for autocomplete suggestions.
 * Supports fuzzy search, auto-saves new components, and AI normalization.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface BikeComponent {
  id: string;
  category: string;
  brand: string;
  model: string;
  specs: Record<string, unknown>;
  usage_count: number;
  weight_g: number | null;
  year_from: number | null;
  compatibility: string | null;
}

// ── Local cache to avoid repeated queries ───────────────────
const cache = new Map<string, { data: BikeComponent[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

/** Search components by category + query text (fuzzy) */
export async function searchComponents(
  category: string,
  query: string,
  limit = 15,
): Promise<BikeComponent[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  if (!query || query.length < 1) return getTopComponents(category, limit);

  const cacheKey = `${category}:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    // Use ilike for simple matching — works well with partial brand/model names
    const q = query.replace(/'/g, "''"); // escape single quotes
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bike_components?category=eq.${category}&or=(brand.ilike.*${q}*,model.ilike.*${q}*)&order=usage_count.desc&limit=${limit}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch {
    return [];
  }
}

/** Get top components by usage for a category (no search query) */
export async function getTopComponents(category: string, limit = 10): Promise<BikeComponent[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  const cacheKey = `top:${category}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bike_components?category=eq.${category}&order=usage_count.desc&limit=${limit}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch {
    return [];
  }
}

/** Get unique brands for a category */
export async function getBrands(category: string): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  const cacheKey = `brands:${category}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data.map((c) => c.brand);

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bike_components?category=eq.${category}&select=brand&order=usage_count.desc&limit=50`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    // Deduplicate brands
    const unique = [...new Set(data.map((d: { brand: string }) => d.brand))];
    return unique;
  } catch {
    return [];
  }
}

/** Save/upsert a component — increments usage if already exists */
export async function saveComponent(
  category: string,
  brand: string,
  model: string,
  specs: Record<string, unknown> = {},
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !brand.trim() || !model.trim()) return;

  try {
    // Try insert with on_conflict handling
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bike_components?on_conflict=category,brand,model`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          category,
          brand: brand.trim(),
          model: model.trim(),
          specs,
          usage_count: 1,
          updated_at: new Date().toISOString(),
        }),
      },
    );

    if (res.status === 409) {
      // Fallback: just increment usage via RPC
      await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/increment_component_usage`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_category: category, p_brand: brand.trim(), p_model: model.trim() }),
        },
      );
    }

    // Invalidate cache for this category
    for (const key of cache.keys()) {
      if (key.startsWith(category) || key.startsWith(`top:${category}`) || key.startsWith(`brands:${category}`)) {
        cache.delete(key);
      }
    }
  } catch {
    // Silently fail — autocomplete is best-effort
  }
}

// ── AI Normalization (Gemini Flash) ─────────────────────────
//
// Uses VITE_GEMINI_API_KEY if available, otherwise falls back to
// VITE_GOOGLE_MAPS_API_KEY (works if Generative Language API is
// enabled on the same GCP project).

const GEMINI_KEY = (import.meta.env.VITE_GEMINI_API_KEY ?? import.meta.env.VITE_GOOGLE_MAPS_API_KEY) as string | undefined;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/** Call Gemini Flash and extract text response */
async function callGemini(prompt: string): Promise<string | null> {
  if (!GEMINI_KEY) return null;
  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

interface AINormalizationResult {
  brand: string;
  model: string;
  confidence: number;
  corrected: boolean;
  suggestion?: string;
}

/**
 * Normalize a component name using Gemini Flash.
 * Fixes typos, standardizes brand names (DTswiss → DT Swiss),
 * and suggests the canonical form.
 */
export async function normalizeComponent(
  category: string,
  input: string,
): Promise<AINormalizationResult | null> {
  if (!GEMINI_KEY || !input.trim()) return null;

  const text = await callGemini(
    `You are a bike component database normalizer. Given a user input for a bicycle ${category}, extract and normalize the brand and model.

Rules:
- Fix common typos (DTswiss → DT Swiss, shimano → Shimano, rockshocks → RockShox)
- Use official brand capitalization (SRAM, not Sram; RockShox, not Rock Shox)
- Separate brand from model clearly
- If input is just a brand, return brand with empty model
- If you can't determine the brand, use "Unknown"

Input: "${input}"

Respond ONLY with JSON: {"brand": "...", "model": "...", "confidence": 0.0-1.0, "corrected": true/false}
No explanation, just JSON.`
  );

  if (!text) return null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      brand: parsed.brand ?? 'Unknown',
      model: parsed.model ?? '',
      confidence: parsed.confidence ?? 0.5,
      corrected: parsed.corrected ?? false,
      suggestion: parsed.corrected ? `${parsed.brand} ${parsed.model}`.trim() : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * AI-powered spec suggestion — given a component, suggest likely specs
 */
export async function suggestSpecs(
  category: string,
  brand: string,
  model: string,
): Promise<Record<string, unknown> | null> {
  if (!GEMINI_KEY || !brand.trim()) return null;

  const text = await callGemini(
    `You are a bicycle component specs database. For the following component, provide its known specifications as JSON.

Category: ${category}
Brand: ${brand}
Model: ${model}

Return ONLY a flat JSON object with numeric/string values. Use these keys depending on category:
- fork: travel_mm, axle, weight_g, wheel_size
- shock: type (air/coil), stroke_mm, weight_g
- tyre: width_mm, tpi, tubeless (bool), weight_g
- brake: type (hydraulic/mechanical), pistons, weight_g
- wheel: rim_width_mm, weight_g, spokes
- saddle: width_mm, weight_g, rail_material
- motor: torque_nm, power_w, weight_g
- pedal: type (flat/clipless), weight_g
- handlebar: width_mm, rise_mm, type (flat/riser/drop), weight_g
- cassette: speeds, range, weight_g

If you don't know a value, omit it. Respond ONLY with JSON, no explanation.`
  );

  if (!text) return null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
