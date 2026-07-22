/**
 * /api/whatif.js — Vercel Serverless Function (CommonJS)
 * DELAX GEO-RISK — AI analysis endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v2 — ONE PROMPT, ONE OWNER.
 *
 * v1 had a single hard-coded template and wrapped whatever arrived in `query` as
 * CLIENT QUESTION. Three callers were sending fully-formed prompts into that field,
 * and all three were being overridden by the wrapper:
 *
 *   1. The GEO Intel country briefing sent a 3-paragraph analyst prompt. It was
 *      demoted to "the client's question", and the wrapper's own first section —
 *      "explain what the client is really asking" — was obeyed literally. The
 *      briefing opened with "What This Means: The client is asking how the Iran war
 *      will affect their investments, specifically in the context of Mauritania…"
 *      The model was not misbehaving; it was following the prompt it was given.
 *   2. The GEO Intel natural-language globe query asked for strict JSON. It could
 *      never get JSON back, because the wrapper demanded four prose sections. It
 *      failed silently into a substring-matching fallback on every single call.
 *   3. The What-If tab, which is the only caller the wrapper was ever written for.
 *
 * v2 routes on `mode`. The SERVER owns every template; callers send structured
 * fields, never prose templates. Adding a mode here is also why this stays one
 * function — the project is at its 12-function ceiling.
 *
 *   mode: 'whatif'        (default) — the What-If tab. Backward compatible.
 *   mode: 'country-brief'           — GEO Intel country panel.
 *   mode: 'json'                    — strict JSON out, prompt passed through.
 *
 * Every template is STRUCTURE-AWARE. v1 hard-coded "the Iran war", "$78/bbl
 * pre-conflict" and "Strait of Hormuz" into all output, so a Taiwan session
 * produced Hormuz analysis. Structure framing now comes from STRUCTURE_FRAME.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   STRUCTURE FRAMING — the server's half of the de-fork.
   `tense` carries the house rule. For Hormuz: the war reached ceasefire, the
   crisis did not. Getting that wrong makes every briefing read as either alarmist
   or complacent regardless of the numbers.
   ════════════════════════════════════════════════════════════════════════════ */
const STRUCTURE_FRAME = {
  'hormuz-iran': {
    name:      'Strait of Hormuz / Iran',
    channel:   'crude oil and LNG transiting the Strait of Hormuz (~20% of seaborne oil)',
    benchmark: 'Brent',
    anchor:    70,
    anchorNote: 'measured pre-war Brent, v3.1 calibration anchor',
    tense: 'The 2026 Iran war reached a ceasefire; the CRISIS has not ended. Write in the '
         + 'present tense about an armed truce with unresolved escalation risk — not about '
         + 'an ongoing shooting war, and not about a resolved event.',
    scenarios: {
      baseline:    'Armed truce. Strait open, transit volumes below pre-war, war-risk premiums sticky.',
      optimistic:  'Normalisation. MOU holds, mines cleared, premiums decay toward pre-war.',
      pessimistic: 'Re-escalation. Truce collapses from a worse base; second closure risk.',
    },
  },
  'taiwan-strait': {
    name:      'Taiwan Strait',
    channel:   'leading-edge logic semiconductors and the electronics supply chain',
    benchmark: null,
    anchor:    null,
    anchorNote: null,
    tense: 'This is a FORWARD-LOOKING structure. No comparable event has been priced by '
         + 'markets, so write about exposure and transmission, never about observed moves. '
         + 'Do not imply any of this has happened.',
    scenarios: {
      baseline:    'Blockade. Year-long interruption; the world loses Taiwan-fabricated leading-edge logic.',
      optimistic:  'Gray-zone coercion. Pressure without interruption; shipments continue.',
      pessimistic: 'Invasion drawing in the United States. Leading-edge capacity offline.',
    },
  },
};
function frameFor(id) { return STRUCTURE_FRAME[id] || STRUCTURE_FRAME['hormuz-iran']; }

/* House advice vocabulary. Buy/Hold/Underweight/Hedge is NOT used anywhere on this
   platform — the three-tier stance is the product's language and must be the
   model's too, or the panel disagrees with every other surface. */
const STANCE_VOCAB = '▲ Beneficiary, ● Watch, or ▼ Exposed';

/* Section labels per mode. The client renders whatever comes back rather than
   stamping its own labels on positional paragraphs, but it can only do that if the
   labels are stable — so they live here, next to the prompts that emit them. */
const SECTIONS = {
  whatif: ['What This Means', 'Impact on Markets', 'What You Should Consider',
           'The One Thing That Could Change Everything'],
  'country-brief': ['Exposure', 'Transmission', 'Stance', 'Key Uncertainty'],
};

module.exports = async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed — use POST' });

  const PROVIDERS = [
    { name: 'groq',      key: process.env.GROQ_API_KEY },
    { name: 'gemini',    key: process.env.GEMINI_API_KEY },
    { name: 'anthropic', key: process.env.ANTHROPIC_API_KEY },
  ].filter(p => p.key);

  if (!PROVIDERS.length) return res.status(500).json({ error: 'AI service not configured.' });

  const {
    mode          = 'whatif',
    query         = '',
    scenario      = 'baseline',
    scenarioLabel = '',
    structureId   = 'hormuz-iran',
    /* Country-brief structured fields. These replace the client-side prompt. */
    country       = '',
    region        = '',
    metrics       = null,
    /* What-If context. oilPrice is now nullable: v1 defaulted it to 121, so a caller
       that had no live price still emitted a confident "$121/bbl today". */
    oilPrice      = null,
    cpi           = null,
    gdp           = null,
    shipping      = null,
    liveDate      = new Date().toISOString().slice(0, 10),
    newsHeadlines = [],
  } = req.body || {};

  if (!String(query || '').trim() && mode !== 'country-brief') {
    return res.status(400).json({ error: 'query is required' });
  }
  if (mode === 'country-brief' && !String(country || '').trim()) {
    return res.status(400).json({ error: 'country is required for country-brief' });
  }

  const F = frameFor(structureId);
  const scenLabel = scenarioLabel || scenario;
  const scenDesc  = F.scenarios[scenario] || F.scenarios.baseline;

  let prompt, maxTokens = 650;
  if (mode === 'json')                prompt = buildJsonPrompt(query);
  else if (mode === 'country-brief') { prompt = buildCountryBrief(F, country, region, scenLabel, scenDesc, metrics); maxTokens = 520; }
  else                                prompt = buildWhatIf(F, query, scenLabel, scenDesc, { oilPrice, cpi, gdp, shipping, liveDate, newsHeadlines });

  let result = { error: 'AI unavailable' };
  for (const p of PROVIDERS) {
    let r;
    if (p.name === 'groq')           r = await callGroq(p.key, prompt, maxTokens);
    else if (p.name === 'gemini')    r = await callGemini(p.key, prompt, maxTokens);
    else if (p.name === 'anthropic') r = await callAnthropic(p.key, prompt, maxTokens);
    else continue;
    if (r && r.text) { result = { text: r.text }; break; }
    result = { error: (r && r.error) || result.error };
    console.warn(`[whatif] provider ${p.name} failed: ${result.error}`);
  }

  if (result.error) {
    return res.status(500).json({ error: 'Analysis temporarily unavailable — please try again.' });
  }

  /* Scenario trigger is a What-If-tab affordance and stays keyword-driven there. */
  let scenarioTrigger = 'baseline';
  if (mode === 'whatif') {
    const lowerQ = String(query).toLowerCase();
    if (['hormuz close','hormuz block','blockade','200','recession','5 year','five year','nuclear','saudi strike','invasion']
        .some(k => lowerQ.includes(k))) scenarioTrigger = 'pessimistic';
    else if (['ceasefire','peace','deal','resolve','end war','diplomacy','gray zone','gray-zone']
        .some(k => lowerQ.includes(k))) scenarioTrigger = 'optimistic';
  }

  /* Parse sections SERVER-SIDE against the labels this server just asked for.
     v1 returned prose and the GEO Intel renderer split on blank lines and stamped
     its own three labels onto paragraphs 0-2 — so labels landed on unrelated
     content whenever the model emitted a different number of paragraphs. The
     endpoint that defines the sections is the one that should identify them. */
  const sections = splitSections(result.text, SECTIONS[mode] || []);

  return res.status(200).json({
    analysis:   result.text,
    sections,                       // [] when the shape was unexpected — caller falls back
    structureId,
    scenario,
    scenarioTrigger,
    analyzedAt: new Date().toISOString(),
  });
};

/* ════════════════════════════════════════════════════════════════════════════
   PROMPT BUILDERS — the server owns every template.
   ════════════════════════════════════════════════════════════════════════════ */

const NO_PREAMBLE =
`OUTPUT RULES (strict):
- Begin IMMEDIATELY with the first section label. No greeting, no preamble, no sign-off.
- Do NOT restate, summarise, paraphrase or refer to the question or the request. Do not
  write "the client is asking", "this question is about", "you want to know", or any
  equivalent. Open on analysis.
- Do NOT refer to a client, a user, or yourself. No first or second person about the ask.
- Use ONLY the bold section labels exactly as written. No markdown headers (#, ##), no
  code blocks, no backticks. Do not wrap the response in quotation marks.
- State a number only if it is given below or is a well-established public figure. Do not
  invent country-level statistics.`;

function buildCountryBrief(F, country, region, scenLabel, scenDesc, metrics) {
  const m = metrics && typeof metrics === 'object' ? metrics : {};
  const lines = [];
  if (m.stress   != null) lines.push(`- Projected stress: ${Number(m.stress).toFixed(1)}/10 (0-10 scale, derived from this structure's regional series)`);
  if (m.cpiExcess!= null) lines.push(`- Excess CPI: ${fmtSigned(m.cpiExcess)} points above trend`);
  if (m.gdpDrag  != null) lines.push(`- GDP effect: ${fmtSigned(m.gdpDrag)} percentage points`);
  if (m.investability != null) lines.push(`- Investability composite: ${m.investability}/100`);
  if (m.oilDep   != null) lines.push(`- Petroleum position: ${m.oilDep > 0 ? `net importer (${m.oilDep}% dependency)` : `net exporter (index ${Math.abs(m.oilDep)})`}`);
  const known = lines.length ? lines.join('\n') : '- No country-level metrics available.';

  return `You are a geopolitical risk analyst on the DELAX GEO-RISK platform, writing a briefing on ${country}${region ? ` (${region})` : ''} under one specific risk structure.

RISK STRUCTURE: ${F.name}
TRANSMISSION CHANNEL: ${F.channel}
SCENARIO: ${scenLabel} — ${scenDesc}
TENSE AND FRAMING: ${F.tense}

MODELLED FIGURES FOR ${country.toUpperCase()} (these are projections from the structure, not observed data):
${known}

Write exactly 4 sections, using these bold labels exactly:

**Exposure:** 2-3 sentences. How is ${country} specifically exposed to THIS structure and THIS channel? If its exposure is indirect or minor, say so plainly rather than manufacturing a link.

**Transmission:** 2-3 sentences. The mechanism — how the shock actually reaches this economy, and through which sectors or trade relationships. Be concrete about the pathway.

**Stance:** One line. Choose exactly one of ${STANCE_VOCAB}, then one sentence of rationale. Use no other rating vocabulary — not Buy, Hold, Sell, Underweight, Overweight or Hedge.

**Key Uncertainty:** One sentence. The single thing that would most change this read.

${NO_PREAMBLE}

Maximum 200 words total. Analysis only.`;
}

function buildWhatIf(F, query, scenLabel, scenDesc, ctx) {
  const bits = [];
  if (ctx.oilPrice != null && F.benchmark) {
    bits.push(`- ${F.benchmark} today: $${ctx.oilPrice}/bbl (as of ${ctx.liveDate}`
      + (F.anchor ? `; ${F.anchorNote} was $${F.anchor}/bbl)` : ')'));
  }
  if (ctx.cpi      != null) bits.push(`- Inflation impact, year 1: ${ctx.cpi}`);
  if (ctx.gdp      != null) bits.push(`- Global GDP impact, year 1: ${ctx.gdp}`);
  if (ctx.shipping != null) bits.push(`- Shipping costs: ${ctx.shipping} versus normal`);
  const context = bits.length ? bits.join('\n') : '- No live market context available; reason from the structure.';

  const heads = (ctx.newsHeadlines || []).length
    ? ctx.newsHeadlines.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'No live headlines — reasoning from model priors.';

  return `You are a senior investment advisor on the DELAX GEO-RISK platform. Speak in plain, confident English — a trusted advisor giving a clear briefing, not a terminal emitting jargon.

RISK STRUCTURE: ${F.name}
TRANSMISSION CHANNEL: ${F.channel}
SCENARIO: ${scenLabel} — ${scenDesc}
TENSE AND FRAMING: ${F.tense}

MARKET CONTEXT:
${context}

RECENT HEADLINES:
${heads}

QUESTION TO ANSWER: "${query}"

Answer in exactly 4 sections, using these bold labels exactly:

**What This Means:** 2-3 plain sentences on which direction this pushes the outlook — better, worse, or unchanged versus the current scenario. Answer it; do not describe it.

**Impact on Markets:** 3-4 bullets. Each names the asset, a likely move with a range, and one sentence of why.

**What You Should Consider:** 2-3 bullets with specific, actionable ideas — which sectors or ETFs benefit, which to reduce, and one hedge worth knowing. Name real tickers where relevant.

**The One Thing That Could Change Everything:** One sentence. The single biggest unknown that would flip this.

${NO_PREAMBLE}

Under 300 words. Be direct.`;
}

/* Pass-through mode: the caller needs a machine-readable answer, so no advisor
   template is applied at all. This is the mode the globe's NL query needs. */
function buildJsonPrompt(query) {
  return `${query}

STRICT OUTPUT: return ONLY the raw JSON object. No markdown fences, no backticks, no
commentary before or after, no explanation. The first character must be { and the last
character must be }.`;
}

function fmtSigned(v) { const n = Number(v); return (n > 0 ? '+' : '') + n.toFixed(1); }

/* ════════════════════════════════════════════════════════════════════════════
   SECTION SPLITTER — tolerant of bold/plain, colon inside or outside the markers.
   Returns [] when it cannot find at least two of the expected labels, which is the
   caller's signal to render the raw text instead of guessing.
   ════════════════════════════════════════════════════════════════════════════ */
function splitSections(text, labels) {
  if (!text || !labels || !labels.length) return [];
  const found = [];
  labels.forEach(label => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re  = new RegExp('\\*{0,2}\\s*' + esc + '\\s*:?\\s*\\*{0,2}\\s*:?', 'i');
    const m   = re.exec(text);
    if (m) found.push({ label, start: m.index, end: m.index + m[0].length });
  });
  if (found.length < 2) return [];
  found.sort((a, b) => a.start - b.start);
  return found.map((f, i) => {
    const stop = i + 1 < found.length ? found[i + 1].start : text.length;
    return { label: f.label, body: text.slice(f.end, stop).replace(/\*\*/g, '').trim() };
  }).filter(s => s.body);
}

/* ════════════════════════════════════
   PROVIDER IMPLEMENTATIONS
   Runtime fallback, not key-presence switching. No provider or model identifier is
   ever returned to the client — errors are collapsed to a generic message above.
   ════════════════════════════════════ */

async function callGemini(apiKey, prompt, maxTokens) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
    });
    let body; try { body = await r.json(); } catch (_) { return { error: 'provider returned non-JSON', status: 502 }; }
    if (!r.ok) return { error: body?.error?.message || `provider HTTP ${r.status}`, status: r.status };
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return { error: 'provider returned empty content', status: 502 };
    return { text };
  } catch (err) {
    return { error: `provider network error: ${err.message}`, status: 500 };
  }
}

async function callGroq(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        max_tokens:  maxTokens,
        temperature: 0.7,
        messages:    [{ role: 'user', content: prompt }],
      }),
    });
    let body; try { body = await r.json(); } catch (_) { return { error: 'provider returned non-JSON', status: 502 }; }
    if (!r.ok) return { error: body?.error?.message || `provider HTTP ${r.status}`, status: r.status };
    const text = body?.choices?.[0]?.message?.content || '';
    if (!text) return { error: 'provider returned empty content', status: 502 };
    return { text };
  } catch (err) {
    return { error: `provider network error: ${err.message}`, status: 500 };
  }
}

async function callAnthropic(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body:    JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    let body; try { body = await r.json(); } catch (_) { return { error: 'provider returned non-JSON', status: 502 }; }
    if (!r.ok) return { error: body?.error?.message || `provider HTTP ${r.status}`, status: r.status };
    const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) return { error: 'provider returned empty content', status: 502 };
    return { text };
  } catch (err) {
    return { error: `provider network error: ${err.message}`, status: 500 };
  }
}
