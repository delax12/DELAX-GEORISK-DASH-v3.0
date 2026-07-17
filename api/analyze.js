/**
 * /api/analyze.js — Vercel Serverless Function (CommonJS)
 * Multi-provider AI narrative engine for DELAX GEO-RISK dashboard.
 *
 * STOCKINSIGHTS FIX (Jul 2026):
 *   Two frontend callers share type:'stockinsights' with different payloads:
 *     • Equities tab (eqGetAI):        sends `symbol` + price/pe/beta/sector
 *     • Country/watchlist insight:     sends `countryName` + stocks/stressIndex
 *   Previously only the country path existed — it ignored the equity payload
 *   and returned { theme, stocks, risk }, while the equity tab reads
 *   data.analysis → rendered an empty string (silent blank panel).
 *   Now: payload with `symbol` → single-stock prose returned as { analysis },
 *   payload without → the original country JSON path, unchanged.
 *
 * AGENT TYPE (Jul 2026 — Intelligence Agent Bar):
 *   New type:'agent' (also accepts 'command'). Full context-aware investor AI.
 *   Used by the ⌘K Intelligence Agent Bar. No new serverless function required.
 */
'use strict';

const AI_TIMEOUT_MS = 8000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed — use POST' });

  // Provider chain — tried in order with runtime fallback (not key-presence).
  // Groq leads: its free tier is far more generous than Gemini's daily cap.
  const PROVIDERS = [
    { name: 'groq',      key: process.env.GROQ_API_KEY },
    { name: 'gemini',    key: process.env.GEMINI_API_KEY },
    { name: 'anthropic', key: process.env.ANTHROPIC_API_KEY },
  ].filter(p => p.key);

  if (!PROVIDERS.length) {
    return res.status(500).json({ error: 'AI service not configured.' });
  }

  const {
    type,
    scenario = 'baseline',
    kpiId,
    kpiLabel,
    kpiValue,
    oilPrice = 121,
    cpi = '+3.8%',
    gdp = '-1.9%',
    liveDate = new Date().toISOString().slice(0, 10),
    headlines = [],
    countryName,
    stocks,
    stressIndex,
    countryData,
    // Equities-tab single-stock payload (eqGetAI)
    symbol,
    price,
    change,
    pe,
    beta,
    sector,
    // NEW: Intelligence Agent Bar payload
    query,
    portfolio = [],
    shipping,
    defense,
    duration,
    // v4.1: structure context sent by index.html (aiStructureContext()).
    // Backward compatible: absent → Hormuz assumed (old clients).
    structure = null,
  } = req.body || {};

  /* ═══ v4.1 STRUCTURE CONTEXT ═══════════════════════════════════════════════
     The platform has TWO risk structures. Every prompt below must narrate the
     RIGHT one, with the RIGHT epistemic caveat:
       hormuz-iran   : 'empirical' — betas FITTED to the actual 2026 war.
       taiwan-strait : 'unpriced'  — betas ANALYTICAL, anchored to Bloomberg
                       Economics. The market has NEVER priced this event. The AI
                       must say so and must never present figures as market-derived.
     Output format (all prose types) follows the product standard:
       What changed → Why it matters to you → What to watch next.
     Language is EXPOSURE-ORIENTED, never directive: we describe what a book is
     exposed to; we do not issue buy/sell orders. ══════════════════════════════ */
  const CTX = buildStructureContext(structure, scenario, oilPrice, cpi, gdp, liveDate);

  if (!type) {
    return res.status(400).json({ error: 'type is required: heatmap, kpi, newssummary, stockinsights, or agent' });
  }

  // ═══════════════════════════════════════════════════════════════
  // NEW TYPE: agent / command  — Intelligence Agent Bar
  // Zero new serverless functions. Reuses this endpoint cleanly.
  // ═══════════════════════════════════════════════════════════════
  if (type === 'agent' || type === 'command') {
    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      return res.status(400).json({ error: 'query is required and must be at least 3 characters' });
    }

    const scenLabel = CTX.scenLabel;

    const portfolioSummary = Array.isArray(portfolio) && portfolio.length
      ? portfolio.map(p => `${p.ticker || p.symbol}: ${p.shares || 0} shares @ $${p.cost || p.avgCost || 'N/A'}`).join('; ')
      : 'No portfolio loaded';

    const recentNews = (headlines || []).slice(0, 4).map((h, i) => `${i + 1}. ${h}`).join('\n') || 'No recent headlines';

    const prompt = `You are the DELAX GEO-RISK Intelligence Agent — the sharpest geopolitical financial co-pilot an investor can have. You think like a senior PM at a multi-strategy fund covering ${CTX.domain}.

ACTIVE RISK STRUCTURE: ${CTX.name}
${CTX.contextBlock}
• Shipping Index: ${shipping || 'N/A'}
• Defense Spend Δ: ${defense || 'N/A'}
• Est. Duration: ${duration || 'N/A'}
• User Portfolio: ${portfolioSummary}
• Latest Headlines:
${recentNews}

${CTX.honesty}

USER QUERY: "${query.trim()}"

INSTRUCTIONS:
1. Answer the exact question the investor asked. Structure the answer as: what changed → why it matters to this investor → what to watch next.
2. Reference the live context numbers above whenever relevant. Never invent figures.
3. Frame takeaways as EXPOSURE, never as orders: say which holdings or sectors are most exposed or most resilient under this structure (with tickers where natural), not "buy/sell". The investor decides; you illuminate.
4. Keep total response under 220 words. Use short paragraphs or tight bullets if helpful.
5. End with one concrete "Next watch" item (what number or event to monitor next).
6. Tone: calm, precise, zero hype, plain English a first-time investor can follow. You are not a news anchor — you are a portfolio tool.

Begin the answer immediately. No preamble.`;

    const result = await route(PROVIDERS, prompt, 480);
    if (result.error) return res.status(500).json({ error: result.error });

    return res.status(200).json({
      analysis: result.text.trim(),
      query: query.trim(),
      scenario,
      oilPrice,
      generatedAt: new Date().toISOString(),
    });
  }

  if (type === 'heatmap') {
    const prompt = `You are DELAX GEO-RISK, a geopolitical economic analyst writing a narrative for an investor dashboard heatmap.

ACTIVE RISK STRUCTURE: ${CTX.name}
ACTIVE SCENARIO: ${CTX.scenLabel}
${CTX.contextBlock}

HEATMAP STRESS SCORES (0-10 scale, Year 1 → Year 10):
${CTX.regionalStress}

${CTX.honesty}

Write exactly 3 paragraphs. No headers. No bullet points. Plain prose only.

Paragraph 1 — WHAT IS HAPPENING: Which regions are hardest hit, their exact stress scores, and the specific reason under this scenario.
Paragraph 2 — WHY IT MATTERS: How high-stress regions create spillovers — ${CTX.spilloverChannels} — in terms a first-time investor can follow.
Paragraph 3 — WHAT TO WATCH: How stress evolves from Year 1 to Year 10, which sector or ticker is most EXPOSED and which most RESILIENT under this structure. Describe exposure; do not issue buy/sell orders.

55-70 words per paragraph. Data-driven. Use specific numbers. Begin immediately with Paragraph 1 — no intro line.`;

    const result = await route(PROVIDERS, prompt, 520);
    if (result.error) return res.status(500).json({ error: result.error });
    return res.status(200).json({ narrative: result.text, generatedAt: new Date().toISOString() });
  }

  if (type === 'kpi') {
    if (!kpiId) return res.status(400).json({ error: 'kpiId required when type is kpi' });

    const meta = {
      oil: { full: 'Brent Crude Oil Projected Peak', pre: '$78/bbl', drivers: 'Hormuz closure risk, OPEC spare capacity, SPR drawdown, US shale 6-9 month ramp lag' },
      cpi: { full: 'Global CPI Inflation Addition Year 1', pre: '0%', drivers: 'Oil pass-through +$10/bbl equals +0.3% CPI, fertilizer cost surge, shipping surcharges, EM currency depreciation' },
      gdp: { full: 'Global GDP Loss Year 1', pre: '0%', drivers: 'Consumer confidence collapse, investment freeze, trade volume decline, defense crowding out private investment' },
      ship: { full: 'Shipping Cost Index vs Pre-Conflict', pre: '100 index', drivers: 'Hormuz/Suez rerouting via Cape of Good Hope adding 15 days, war-risk insurance premiums, port congestion' },
      def: { full: 'Global Defense Spending Increase Yr1', pre: '$0 extra', drivers: 'NATO emergency pledges, Gulf state mobilization, Israeli and Indian procurement surge, Taiwan alert' },
      fao: { full: 'FAO Food Price Index Increase', pre: '0%', drivers: 'Gas-based fertilizer spike, fuel input costs for farming, shipping cost pass-through, MENA supply shock' },
      fx: { full: 'Emerging Market Currency Basket vs USD', pre: '0%', drivers: 'Flight-to-safety USD inflows, EM energy import bills priced in USD, capital outflows, EM central bank rate hikes' },
      dur: { full: 'Estimated Conflict Duration', pre: 'N/A', drivers: 'Historical analogs Gulf War 7 months Russia-Ukraine 30 months, Iranian proxy network complexity, diplomatic channels' },
    }[kpiId] || { full: kpiLabel || kpiId, pre: 'N/A', drivers: 'Multiple geopolitical factors' };

    const prompt = `You are DELAX GEO-RISK explaining a market indicator to an investor who just clicked it on a financial dashboard.

ACTIVE RISK STRUCTURE: ${CTX.name}
INDICATOR: ${meta.full}
CURRENT VALUE: ${kpiValue || 'N/A'} | PRE-CRISIS BASELINE: ${meta.pre}
SCENARIO: ${CTX.scenLabel}
${CTX.contextBlock}
KEY DRIVERS: ${meta.drivers}

${CTX.honesty}

Write exactly 4 sections. Begin each with the label in bold followed by a colon. No other markdown or bullet points.

**What it is:** One plain-English sentence that a retiree with no finance background can understand.
**Why it is at ${kpiValue || 'this level'}:** 2 to 3 sentences explaining the specific forces under the ${CTX.scenShort} scenario. Use exact figures.
**Why it matters to you:** 2 sentences translating this into direct investor impact — portfolio, prices paid, or savings — for an ordinary person.
**What to watch next:** One sentence naming which holdings or sectors are most EXPOSED or most RESILIENT to this indicator (a ticker or asset class is fine), plus the one number or event to monitor. Describe exposure; never instruct to buy or sell.

Total 120 to 140 words. Be precise, plain-English, and calm.`;

    const result = await route(PROVIDERS, prompt, 400);
    if (result.error) return res.status(500).json({ error: result.error });
    return res.status(200).json({ narrative: result.text, generatedAt: new Date().toISOString() });
  }

  if (type === 'newssummary') {
    if (!headlines.length) return res.status(400).json({ error: 'headlines array required' });

    if (headlines.length === 1 && headlines[0].length > 200) {
      const result = await route(PROVIDERS, headlines[0], 400);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ summary: result.text, generatedAt: new Date().toISOString() });
    }

    const HOT = ['iran', 'hormuz', 'oil', 'brent', 'opec', 'war', 'strike', 'missile', 'sanctions', 'ceasefire', 'nuclear', 'attack', 'crisis', 'emergency', 'surge', 'fed', 'rate', 'inflation', 'recession', 'crash', 'spike', 'collapse', 'record', 'explosion', 'conflict'];
    const scored = headlines.map((h) => {
      const l = h.toLowerCase();
      const s = HOT.reduce((a, k) => a + (l.includes(k) ? 2 : 0), 0) + (l.includes('iran') || l.includes('hormuz') ? 5 : 0);
      return { h, s };
    }).sort((a, b) => b.s - a.s);

    const top5 = scored.slice(0, 5).map((x) => x.h);
    const hottest = scored[0]?.h || headlines[0];

    const prompt = `You are a Bloomberg terminal intelligence system for the DELAX GEO-RISK dashboard.

STRUCTURE: ${CTX.name} | SCENARIO: ${CTX.scenShort} | ${CTX.headline} | ${new Date().toISOString().slice(0, 10)}

TOP HEADLINES:
${top5.map((h, i) => `${i + 1}. ${h}`).join('\n')}

HOTTEST: "${hottest}"

Write EXACTLY ONE sentence (max 28 words):
- Start with BREAKING, ALERT, or WATCH
- Name the key development
- State direct market impact (oil price move, specific asset, or region)
- Sound like a live terminal alert

Output the sentence only. No quotes. No explanation.`;

    const result = await route(PROVIDERS, prompt, 80);
    if (result.error) return res.status(500).json({ error: result.error });

    return res.status(200).json({
      summary: result.text.trim(),
      hottest,
      top5,
      generatedAt: new Date().toISOString(),
    });
  }

  if (type === 'stockinsights') {

    /* ── Branch A: Equities tab (eqGetAI) — payload carries `symbol` ──
       Returns plain prose as { analysis } (frontend reads data.analysis). */
    if (symbol) {
      const fmt = (v, prefix = '', suffix = '') =>
        (v === null || v === undefined || v === '' || Number.isNaN(v)) ? 'N/A' : `${prefix}${v}${suffix}`;

      const prompt = `You are DELAX GEO-RISK's senior equity analyst. An investor viewing ${symbol} on the dashboard clicked "Get AI Analysis" for a plain-English read on this stock under the active conflict scenario.

STOCK: ${symbol} | Price: ${fmt(price, '$')} | Today: ${fmt(change, '', '%')}
P/E: ${fmt(pe)} | Beta: ${fmt(beta)} | Sector: ${sector || 'general'}
ACTIVE RISK STRUCTURE: ${CTX.name}
ACTIVE SCENARIO: ${CTX.scenLabel}
${CTX.contextBlock}

${CTX.honesty}

Write exactly 3 short paragraphs of plain prose. No markdown, no asterisks, no bullet points, no headers.

Paragraph 1 — WHAT CHANGED / EXPOSURE: How the ${sector || 'stock\'s'} sector transmits the ${CTX.scenShort} scenario to ${symbol} specifically (${CTX.transmission} — whichever applies).
Paragraph 2 — WHY IT MATTERS: Interpret the figures provided above (price move, P/E, beta) in the context of this scenario, in plain English. If a figure reads N/A, skip it — never invent a number.
Paragraph 3 — WHAT TO WATCH: Whether ${symbol} reads as EXPOSED or RESILIENT under this structure and the single most important number or event to monitor next. Describe exposure; do not issue a buy/hold/sell instruction.

35-55 words per paragraph. Use ONLY the figures provided above; never invent data. Begin immediately with Paragraph 1 — no intro line.`;

      const result = await route(PROVIDERS, prompt, 380);
      if (result.error) return res.status(500).json({ error: result.error });

      return res.status(200).json({
        analysis: result.text.trim(),
        symbol,
        scenario,
        generatedAt: new Date().toISOString(),
      });
    }

    /* ── Branch B: Country/watchlist insight — original structured JSON path ── */
    const country = countryName || 'Unknown';
    const stockList = (stocks || []).slice(0, 6).map((s) => `${s[0]} (${s[1]})`).join(', ') || 'XOM, GLD, LMT, RTX';
    const stress = stressIndex || 'N/A';
    const cData = countryData || {};

    const prompt = `You are a sell-side equity analyst at a global investment bank covering: ${CTX.name}.

COUNTRY: ${country}
SCENARIO: ${CTX.scenLabel}
${CTX.honesty}
Stress Index: ${stress}/10 | CPI: ${cData.cpi || 'N/A'}% | GDP: ${cData.gdp || 'N/A'}%
Oil dependency: ${cData.oilDep || 'N/A'}% | FX Vol: ${cData.fxVol || 'N/A'}%

RELEVANT STOCKS: ${stockList}

Return ONLY valid JSON (no markdown, no backticks, no explanation):
{
  "theme": "2-sentence macro theme for ${country} in this scenario",
  "stocks": [
    {"sym":"TICKER","signal":"BENEFICIARY","reason":"one sentence quantitative rationale"},
    {"sym":"TICKER","signal":"RESILIENT","reason":"one sentence quantitative rationale"},
    {"sym":"TICKER","signal":"EXPOSED","reason":"one sentence quantitative rationale"}
  ],
  "risk": "one sentence key risk to this view"
}

Include 3-4 stocks. Keep total under 140 words. JSON only.`;

    const result = await route(PROVIDERS, prompt, 450);
    if (result.error) return res.status(500).json({ error: result.error });

    let parsed = null;
    let raw = String(result.text || '').trim().replace(/```json\n?|```/g, '').trim();
    const firstBrace = raw.indexOf('{');
    if (firstBrace > 0) raw = raw.slice(firstBrace);

    try {
      parsed = JSON.parse(raw);
    } catch (_e) {
      parsed = { theme: raw.slice(0, 200), stocks: [], risk: 'Parse error — see theme for analysis.' };
    }

    return res.status(200).json({
      ...parsed,
      generatedAt: new Date().toISOString(),
    });
  }

  return res.status(400).json({ error: 'Unknown type. Use heatmap, kpi, newssummary, stockinsights, or agent.' });
};

/* ═══ v4.1: builds the per-structure prompt context. Falls back to HORMUZ when the
   client sends nothing (old cached frontends). All Taiwan figures trace to
   risk-structures.js / Bloomberg Economics — nothing here is invented. ═══ */
function buildStructureContext(structure, scenario, oilPrice, cpi, gdp, liveDate) {
  const isTaiwan = structure && structure.structureId === 'taiwan-strait';

  if (isTaiwan) {
    const kf = structure.keyFacts || {};
    const scenLabel = structure.scenarioLabel
      ? `${structure.scenarioLabel} — ${String(structure.scenarioDesc || '').slice(0, 140)}`
      : ({ baseline: 'Quarantine / Blockade (P=28%)', optimistic: 'Gray-Zone Pressure (P=60%)', pessimistic: 'Invasion / Fab Denial (P=12%)' }[scenario] || scenario);
    return {
      name: 'TAIWAN STRAIT — Semiconductor Chokepoint (UNPRICED structure)',
      domain: 'semiconductors, tech supply chains, container shipping, Asian FX, and defense — THERE IS NO OIL CHANNEL in this structure',
      scenLabel,
      scenShort: structure.scenarioLabel || scenario,
      headline: `Adv. chip capacity offline: ${kf.advancedChipCapacityOffline || 'N/A'}`,
      contextBlock:
`• Advanced chip capacity offline: ${kf.advancedChipCapacityOffline || 'N/A'} (Taiwan holds ~90% of world ≤7nm capacity)
• Lagging-edge chip shortfall: ${kf.laggingEdgeShortfall || 'N/A'}
• World GDP impact (Yr 1): ${kf.worldGDP || gdp}
• Anchor: ${kf.anchor || 'Bloomberg Economics (Feb 2026)'}
• Date: ${liveDate}`,
      honesty: 'EPISTEMIC STATUS (must be reflected in your answer): this structure is UNPRICED. No Taiwan blockade has ever occurred, so its sensitivities are ANALYTICAL estimates anchored to Bloomberg Economics — not fitted to market data. The Dec 2025 PLA escalation sent TSMC UP 20% vs the market: the market is not pricing this risk. Never present these figures as market-derived; where relevant, say plainly that these are reasoned estimates of a never-observed event.',
      regionalStress:
`East Asia: 9.4→3.1 | North America: 6.8→2.2 | Europe: 5.9→1.8
South Asia: 4.6→1.4 | South America: 3.2→0.9 | Middle East: 2.6→0.8
Africa: 2.4→0.7 | Oceania: 3.0→0.9
(model values — this structure is analytical; see epistemic status)`,
      spilloverChannels: 'chip shortages stalling electronics and auto production, container-trade collapse (the cargo disappears, unlike Red Sea rerouting), Asian FX stress, and tech-heavy index drawdowns',
      transmission: 'chip supply cutoff, tech supply-chain shortfall, container-trade collapse, Asian FX stress, defense demand, or risk-off flows',
    };
  }

  // HORMUZ (default; also the fallback for old clients that send no structure field)
  const scenLabel = (structure && structure.scenarioLabel)
    ? `${structure.scenarioLabel} — ${String(structure.scenarioDesc || '').slice(0, 140)}`
    : ({
        baseline: 'Armed Truce (P=50%) — Iran retains leverage over Hormuz, Brent peaks ~$102',
        optimistic: 'Normalisation (P=25%) — MOU holds, mines cleared, Brent settles $70–78',
        pessimistic: 'Re-escalation (P=25%) — truce collapses, second Hormuz closure, Brent $150–180',
      }[scenario] || `Scenario: ${scenario}`);
  return {
    name: 'STRAIT OF HORMUZ / IRAN — post-war armed truce (EMPIRICAL structure)',
    domain: 'oil, shipping, defense, and EM risk',
    scenLabel,
    scenShort: (structure && structure.scenarioLabel) || scenario,
    headline: `Brent: $${oilPrice}/bbl`,
    contextBlock:
`• Live Brent: $${oilPrice}/bbl (as of ${liveDate})
• CPI Addition Yr1: ${cpi}
• Global GDP Impact Yr1: ${gdp}`,
    honesty: 'EPISTEMIC STATUS: this structure is EMPIRICAL — its sector sensitivities were fitted to the actual 2026 Strait of Hormuz war (Brent $70.9→$138.2 peak, ceasefire 8 Apr). TENSE DISCIPLINE: the WAR is past tense (it ran 28 Feb–8 Apr 2026); the ARMED TRUCE and strait disruption are PRESENT tense — transits remain below pre-war, war-risk premia persist, attacks continue, and Re-escalation carries P=25%. Never state or imply that the risk is over, closed, or resolved. The house formulation: the war reached ceasefire; the crisis has not.',
    regionalStress:
`Middle East: 9.1→1.7 | Africa: 6.8→1.1 | South Asia: 5.4→0.6
Europe: 3.8→0.3 | East Asia: 2.8→0.2 | South America: 2.9→0.3
North America: 2.1→0.2 | Oceania: 1.4→0.1`,
    spilloverChannels: 'food prices, energy supply, migration, and trade routes',
    transmission: `oil at $${oilPrice}/bbl, shipping, defense demand, or risk-off flows`,
  };
}

async function route(providers, prompt, maxTokens) {
  let lastErr = 'AI unavailable';
  for (const p of providers) {
    let r;
    if (p.name === 'groq')           r = await callGroq(p.key, prompt, maxTokens);
    else if (p.name === 'gemini')    r = await callGemini(p.key, prompt, maxTokens);
    else if (p.name === 'anthropic') r = await callAnthropic(p.key, prompt, maxTokens);
    else continue;
    if (r && r.text) return { text: r.text };       // success — no model/provider exposed
    lastErr = (r && r.error) || lastErr;
    console.warn(`[analyze] ${p.name} failed: ${lastErr}`);
  }
  return { error: lastErr };
}

function makeAbortSignal() {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  return controller.signal;
}

async function callGemini(apiKey, prompt, maxTokens) {
  try {
    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method: 'POST',
      signal: makeAbortSignal(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
    });

    let b;
    try { b = await r.json(); } catch (_e) { return { error: 'Gemini non-JSON response', status: 502 }; }
    if (!r.ok) return { error: b?.error?.message || `Gemini HTTP ${r.status}`, status: r.status };

    const text = b?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return { error: 'Gemini returned empty text', status: 502 };
    return { text, model };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Gemini request timed out after 8s', status: 504 };
    return { error: `Gemini network: ${e.message}`, status: 500 };
  }
}

async function callGroq(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: makeAbortSignal(),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    let b;
    try { b = await r.json(); } catch (_e) { return { error: 'Groq non-JSON response', status: 502 }; }
    if (!r.ok) return { error: b?.error?.message || `Groq HTTP ${r.status}`, status: r.status };

    const text = b?.choices?.[0]?.message?.content || '';
    if (!text) return { error: 'Groq returned empty text', status: 502 };
    return { text, model: 'llama-3.3-70b-versatile' };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Groq request timed out after 8s', status: 504 };
    return { error: `Groq network: ${e.message}`, status: 500 };
  }
}

async function callAnthropic(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: makeAbortSignal(),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    let b;
    try { b = await r.json(); } catch (_e) { return { error: 'Anthropic non-JSON response', status: 502 }; }
    if (!r.ok) return { error: b?.error?.message || `Anthropic HTTP ${r.status}`, status: r.status };

    const text = (b.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
    if (!text) return { error: 'Anthropic returned empty content', status: 502 };
    return { text, model: b.model || 'claude-3-5-haiku-latest' };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Anthropic request timed out after 8s', status: 504 };
    return { error: `Anthropic network: ${e.message}`, status: 500 };
  }
}
