/**
 * /api/global-pulse.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * DELAX GEO-RISK — Live "Global Pulse" ticker engine.
 *
 * Replaces the old static "COST OF LIVING MONITOR" banner line with a
 * dynamically generated, terminal-style alert describing the MOST
 * CONSEQUENTIAL CURRENT EFFECTS of live geopolitical/market conditions.
 *
 * ── DESIGN: TWO LANES, NUMBERS NEVER INVENTED ──────────────────────
 *   Lane 1 (DETERMINISTIC): real figures are computed server-side from
 *     EIA (oil), FRED (CPI, food, gas), and GDELT (conflict events).
 *   Lane 2 (EDITORIAL): the AI may ONLY phrase and prioritise effects
 *     using the verified numbers it is handed. It is explicitly barred
 *     from emitting any figure not in the verified block, and the output
 *     is validated against the allow-set before being returned. If the
 *     AI invents a number (or fails), we fall back to a deterministic
 *     line built purely from the verified figures.
 *
 * ── ENDPOINT ──────────────────────────────────────────────────────
 *   GET /api/global-pulse
 *   Returns: { line, label, source, verified, asOf,
 *              generatedAt }
 *     line     → the banner sentence (always real-number-safe)
 *     label    → suggested banner label (e.g. "🛰 LIVE INTEL")
 *     source   → 'ai' | 'deterministic'
 *     verified → the raw figures used (for transparency / tooltips)
 *
 * ── ENV VARS (all already set in Vercel) ──────────────────────────
 *   EIA_API_KEY, FRED_API_KEY, NEWS_API_KEY,
 *   GEMINI_API_KEY (primary AI), GROQ_API_KEY (fallback AI)
 *
 * ── CACHING (cache duration IS the refresh cadence) ───────────────
 *   AI success           → s-maxage=1800 (30 min), swr=300
 *   Deterministic (AI ko)→ s-maxage=300  (retry AI within 5 min)
 *   No data at all       → no-store (frontend shows neutral fallback)
 */
'use strict';

const HARD_BUDGET_MS  = 9000;  // total function budget — must return before the platform 10s limit
const DATA_TIMEOUT_MS = 3500;  // per upstream data fetch
const AI_MAX_MS       = 4500;  // max per AI attempt (further capped by remaining budget)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const startedAt = Date.now();

  /* ── 1. Assemble the verified-data bundle (all best-effort, parallel) ── */
  const [oil, macro, gdelt, headlines] = await Promise.all([
    fetchOil().catch(()      => null),
    fetchFredMacro().catch(()=> null),
    fetchGdelt().catch(()    => null),
    fetchHeadlines().catch(()=> []),
  ]);

  const verified = buildVerified(oil, macro, gdelt);
  const asOf     = buildAsOf(oil, macro, gdelt);

  // If literally nothing real came back, don't cache — let the frontend
  // keep its neutral placeholder and retry on next load.
  if (!verified.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      line:        '',
      label:       '🌐 GLOBAL PULSE',
      source:      'none',
      verified:    [],
      asOf,
      generatedAt: new Date().toISOString(),
      note:        'No live data sources returned values this cycle.',
    });
  }

  /* ── 2. Deterministic line (the always-safe baseline + AI fallback) ── */
  const deterministicLine = buildDeterministicLine(verified, gdelt);

  /* ── 3. Editorial lane — AI phrases using ONLY verified numbers (within remaining budget) ── */
  const aiResult = await generatePulseLine(verified, headlines, startedAt + HARD_BUDGET_MS);

  let line   = deterministicLine;
  let source = 'deterministic';

  if (aiResult && aiResult.text) {
    const candidate = sanitiseLine(aiResult.text);
    // Validate: every number in the AI line must trace to a verified figure.
    if (candidate && numbersAreVerified(candidate, verified)) {
      line     = candidate;
      source   = 'ai';
    } else {
      console.warn('[global-pulse] AI line rejected (unverified number or empty); using deterministic.');
    }
  }

  /* ── 4. Cache by confidence: AI success caches long, fallback caches short ── */
  if (source === 'ai') {
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  } else {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
  }

  return res.status(200).json({
    line,
    label:       source === 'ai' ? '🛰 LIVE INTEL' : '🌐 GLOBAL PULSE',
    source,
    verified,
    asOf,
    generatedAt: new Date().toISOString(),
  });
};

/* ════════════════════════════════════════════════════════════════
   VERIFIED-DATA FETCHERS  (each returns null/[] on any failure)
   ════════════════════════════════════════════════════════════════ */

/* EIA — WTI (RWTC) spot price + 7-day trend. Real intraday-of-record number. */
async function fetchOil() {
  const key = process.env.EIA_API_KEY;
  if (!key) return null;
  const url =
    'https://api.eia.gov/v2/petroleum/pri/spt/data/' +
    '?api_key=' + encodeURIComponent(key) +
    '&frequency=daily&data[0]=value' +
    '&facets[series][]=RWTC' +
    '&sort[0][column]=period&sort[0][direction]=desc&length=10';

  const json = await fetchJSON(url);
  const rows = json && json.response && json.response.data;
  if (!rows || !rows.length) return null;

  const price = parseFloat(rows[0].value);
  if (isNaN(price)) return null;
  const weekAgo  = rows[Math.min(6, rows.length - 1)];
  const waPrice  = parseFloat(weekAgo && weekAgo.value);
  const trend7d  = (!isNaN(waPrice) && waPrice)
    ? +(((price - waPrice) / waPrice) * 100).toFixed(1)
    : null;

  return { price: +price.toFixed(2), trend7d, date: rows[0].period };
}

/* FRED — CPI (YoY), Global Food Price Index (IMF, YoY), Henry Hub gas. */
async function fetchFredMacro() {
  const key = process.env.FRED_API_KEY;
  if (!key) return null;

  const [cpi, food, gas] = await Promise.all([
    fetchFredSeries(key, 'CPIAUCSL').catch(()    => null),  // US CPI, monthly index
    fetchFredSeries(key, 'PFOODINDEXM').catch(() => null),  // IMF global food price index
    fetchFredSeries(key, 'DHHNGSP').catch(()     => null),  // Henry Hub nat gas $/MMBtu
  ]);

  const out = {};
  if (cpi  && cpi.yoy  != null) out.cpi  = { yoy: cpi.yoy,  date: cpi.date };
  if (food && food.yoy != null) out.food = { yoy: food.yoy, index: food.latest, date: food.date };
  if (gas  && gas.latest != null) out.gas = { price: gas.latest, date: gas.date };
  return Object.keys(out).length ? out : null;
}

/* Pull a FRED series and compute latest, MoM and YoY change. */
async function fetchFredSeries(key, id) {
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=14`;
  const data = await fetchJSON(url);
  if (data && data.error_code) throw new Error(data.error_message || 'FRED error');
  const obs = (data && data.observations || []).filter(o => o.value !== '.' && o.value != null);
  if (!obs.length) return null;

  const latest   = parseFloat(obs[0].value);
  const prev     = obs[1] ? parseFloat(obs[1].value) : NaN;
  const yearAgo  = obs[12] ? parseFloat(obs[12].value) : NaN;
  if (isNaN(latest)) return null;

  return {
    latest: +latest.toFixed(2),
    date:   obs[0].date,
    mom:    (!isNaN(prev)    && prev)    ? +(((latest - prev)    / prev)    * 100).toFixed(1) : null,
    yoy:    (!isNaN(yearAgo) && yearAgo) ? +(((latest - yearAgo) / yearAgo) * 100).toFixed(1) : null,
  };
}

/* GDELT — conflict event count last 48h + hottest country. Best-effort:
   GDELT frequently 429s and returns a NON-JSON throttle page, so we guard
   the parse defensively (this is the bug that 500s /api/gdelt). */
async function fetchGdelt() {
  const q = encodeURIComponent('conflict OR war OR attack OR strike OR missile OR explosion');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}` +
    `&mode=artlist&maxrecords=250&timespan=48h&format=json`;

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), DATA_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
    clearTimeout(tid);
    if (!r.ok) return null;                              // 429 etc. → skip silently
    const ct = r.headers.get('content-type') || '';
    const body = await r.text();
    if (!ct.includes('json') || !body.trim().startsWith('{')) return null; // throttle page → skip
    let data;
    try { data = JSON.parse(body); } catch (_e) { return null; }

    const articles = (data && data.articles) || [];
    if (!articles.length) return null;

    const counts = {};
    articles.forEach(a => { if (a.sourcecountry) counts[a.sourcecountry] = (counts[a.sourcecountry] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;

    return {
      events:      articles.length,
      topCountry:  top ? top[0] : null,
      topCount:    top ? top[1] : null,
    };
  } catch (_e) {
    clearTimeout(tid);
    return null;
  }
}

/* NewsAPI — top headlines, used as SELECTION CONTEXT ONLY (never for numbers). */
async function fetchHeadlines() {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];
  const url = 'https://newsapi.org/v2/top-headlines' +
    `?category=general&language=en&pageSize=20&apiKey=${key}`;
  const data = await fetchJSON(url, { 'User-Agent': 'DELAX-GeoRisk/3.0' });
  const arts = (data && data.articles) || [];
  const HOT = ['iran','hormuz','oil','brent','opec','war','strike','missile','sanctions',
    'ceasefire','nuclear','attack','crisis','surge','fed','rate','inflation','recession',
    'crash','spike','collapse','conflict','tariff','energy','gas'];
  return arts
    .map(a => a.title || '')
    .filter(t => t && t !== '[Removed]')
    .map(t => ({ t, s: HOT.reduce((n, k) => n + (t.toLowerCase().includes(k) ? 1 : 0), 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6)
    .map(x => x.t);
}

/* ════════════════════════════════════════════════════════════════
   BUNDLE → STRINGS
   ════════════════════════════════════════════════════════════════ */

/* Normalised list of verified figures: { key, label, text, num } */
function buildVerified(oil, macro, gdelt) {
  const v = [];
  if (oil && oil.price != null) {
    const trend = (oil.trend7d != null)
      ? ` (${oil.trend7d >= 0 ? '+' : ''}${oil.trend7d}% 7d)` : '';
    v.push({ key: 'wti', label: 'WTI crude', text: `WTI crude $${oil.price}/bbl${trend}`, num: oil.price, num2: oil.trend7d });
  }
  if (macro && macro.cpi) {
    v.push({ key: 'cpi', label: 'US CPI', text: `US CPI ${fmtPct(macro.cpi.yoy)} YoY`, num: macro.cpi.yoy });
  }
  if (macro && macro.food) {
    v.push({ key: 'food', label: 'Global food index', text: `global food prices ${fmtPct(macro.food.yoy)} YoY`, num: macro.food.yoy, num2: macro.food.index });
  }
  if (macro && macro.gas) {
    v.push({ key: 'gas', label: 'Henry Hub gas', text: `US natural gas $${macro.gas.price}/MMBtu`, num: macro.gas.price });
  }
  if (gdelt && gdelt.events != null) {
    v.push({ key: 'gdelt', label: 'Conflict events 48h', text: `${gdelt.events} conflict events tracked (48h)`, num: gdelt.events, num2: gdelt.topCount });
  }
  return v;
}

function buildAsOf(oil, macro, gdelt) {
  return {
    oil:   oil  ? oil.date  : null,
    cpi:   macro && macro.cpi  ? macro.cpi.date  : null,
    food:  macro && macro.food ? macro.food.date : null,
    gas:   macro && macro.gas  ? macro.gas.date  : null,
    gdelt: gdelt ? new Date().toISOString().slice(0, 10) : null,
  };
}

/* Deterministic line — pure real numbers, no AI. Always safe. */
function buildDeterministicLine(verified, gdelt) {
  const lead = (gdelt && gdelt.events > 40) ? 'ALERT' : 'WATCH';
  const parts = verified.map(v => v.text);
  return `${lead} · ${parts.join(' · ')}`;
}

/* ════════════════════════════════════════════════════════════════
   AI EDITORIAL LANE  (Gemini → Groq, with hard no-invented-numbers rule)
   ════════════════════════════════════════════════════════════════ */

async function generatePulseLine(verified, headlines, deadline) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey   = process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) return null;
  const budgetLeft = () => deadline - Date.now() - 400; // 400ms safety margin to serialise response

  const verifiedBlock = verified.map(v => `- ${v.text}`).join('\n');
  const headlineBlock = (headlines && headlines.length)
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(none available)';

  const prompt =
`You are the DELAX GEO-RISK terminal intelligence system. Write ONE live ticker alert describing the most consequential CURRENT global economic effects.

VERIFIED DATA — these are the ONLY numbers you may use:
${verifiedBlock}

HEADLINES (context only — use to judge what is most consequential right now; they contain NO numbers you may cite):
${headlineBlock}

ABSOLUTE RULES:
- You may ONLY state numbers, prices, or percentages that appear verbatim in VERIFIED DATA above.
- NEVER invent, estimate, forecast, round, or infer any figure that is not in VERIFIED DATA.
- If you are unsure whether a number is verified, do not include it.
- Choose the 2-3 MOST consequential effects given the data and headlines.

FORMAT:
- Exactly ONE sentence, max 30 words.
- Begin with BREAKING, ALERT, or WATCH.
- Sound like a live Bloomberg terminal alert.
- Output the sentence only. No quotes, no preamble, no explanation.`;

  // Primary: Groq (generous free tier). Fallback: Gemini. Each runs only if
  // budget remains, with a timeout capped by time left — guarantees we return
  // before HARD_BUDGET_MS.
  if (groqKey && budgetLeft() > 1500) {
    const q = await callGroq(groqKey, prompt, 90, Math.min(AI_MAX_MS, budgetLeft()));
    if (q && q.text) return q;
    console.warn('[global-pulse] Groq failed, trying Gemini:', q && q.error);
  }
  if (geminiKey && budgetLeft() > 1500) {
    const g = await callGemini(geminiKey, prompt, 90, Math.min(AI_MAX_MS, budgetLeft()));
    if (g && g.text) return g;
    console.warn('[global-pulse] Gemini failed:', g && g.error);
  }
  return null;
}

/* Strip stray quotes/markdown/newlines the model sometimes adds. */
function sanitiseLine(text) {
  return String(text || '')
    .replace(/[`*_>#]/g, '')
    .replace(/^\s*["'“”]+|["'“”]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/* Guard: every numeric token in the AI line must correspond to a verified
   figure (matched on integer part, or within 1%). Blocks invented numbers. */
function numbersAreVerified(line, verified) {
  const allowed = [];
  verified.forEach(v => {
    if (typeof v.num  === 'number' && !isNaN(v.num))  allowed.push(Math.abs(v.num));
    if (typeof v.num2 === 'number' && !isNaN(v.num2)) allowed.push(Math.abs(v.num2));
  });
  // Always allow recent years and common timeframe windows (e.g. "48h", "24h", "7d")
  // — these are dates/windows, not data claims.
  const ALLOWED_FIXED = [7, 24, 48, 2024, 2025, 2026, 2027];

  const tokens = line.match(/\d+(?:\.\d+)?/g) || [];
  for (const tok of tokens) {
    const n = Math.abs(parseFloat(tok));
    if (isNaN(n)) continue;
    if (ALLOWED_FIXED.includes(n)) continue;
    const ok = allowed.some(a => {
      if (Math.round(a) === Math.round(n)) return true;          // same integer
      if (a !== 0 && Math.abs(a - n) / Math.abs(a) <= 0.01) return true; // within 1%
      return false;
    });
    if (!ok) return false; // an unverified number slipped in → reject the line
  }
  return true;
}

/* ── AI provider calls ── */
async function callGemini(apiKey, prompt, maxTokens, timeoutMs) {
  try {
    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method:  'POST',
      signal:  abortAfter(timeoutMs),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.6 },
      }),
    });
    let b; try { b = await r.json(); } catch (_e) { return { error: 'Gemini non-JSON' }; }
    if (!r.ok) return { error: (b && b.error && b.error.message) || `Gemini HTTP ${r.status}` };
    const text = b && b.candidates && b.candidates[0] &&
      b.candidates[0].content && b.candidates[0].content.parts &&
      b.candidates[0].content.parts[0] && b.candidates[0].content.parts[0].text;
    if (!text) return { error: 'Gemini empty' };
    return { text };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'Gemini timeout' : `Gemini: ${e.message}` };
  }
}

async function callGroq(apiKey, prompt, maxTokens, timeoutMs) {
  try {
    const model = 'llama-3.3-70b-versatile';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      signal:  abortAfter(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature: 0.6,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    let b; try { b = await r.json(); } catch (_e) { return { error: 'Groq non-JSON' }; }
    if (!r.ok) return { error: (b && b.error && b.error.message) || `Groq HTTP ${r.status}` };
    const text = b && b.choices && b.choices[0] && b.choices[0].message && b.choices[0].message.content;
    if (!text) return { error: 'Groq empty' };
    return { text };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'Groq timeout' : `Groq: ${e.message}` };
  }
}

/* ── small helpers ── */
function abortAfter(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function fetchJSON(url, extraHeaders) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), DATA_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: Object.assign({ 'Accept': 'application/json' }, extraHeaders || {}) });
    clearTimeout(tid);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    clearTimeout(tid);
    throw err;
  }
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n}%`;
}
