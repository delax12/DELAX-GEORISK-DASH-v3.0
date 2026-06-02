/**
 * /api/whatif.js — Vercel Serverless Function (CommonJS)
 * Multi-provider AI What-If analysis for DELAX GEO-RISK dashboard.
 * Auto-detects: GEMINI_API_KEY (free) → GROQ_API_KEY (free) → ANTHROPIC_API_KEY (paid)
 */
'use strict';

module.exports = async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed — use POST' });

  /* ── Provider chain — Groq leads (generous free tier), runtime fallback ── */
  const PROVIDERS = [
    { name: 'groq',      key: process.env.GROQ_API_KEY },
    { name: 'gemini',    key: process.env.GEMINI_API_KEY },
    { name: 'anthropic', key: process.env.ANTHROPIC_API_KEY },
  ].filter(p => p.key);

  if (!PROVIDERS.length) {
    return res.status(500).json({ error: 'AI service not configured.' });
  }

  /* ── Parse request ── */
  const {
    query         = '',
    scenario      = 'baseline',
    oilPrice      = 121,
    cpi           = '+3.8%',
    gdp           = '-1.9%',
    shipping      = '+310%',
    liveDate      = new Date().toISOString().slice(0,10),
    newsHeadlines = [],
  } = req.body || {};

  if (!query.trim()) return res.status(400).json({ error: 'query is required' });

  /* ── Build prompt ── */
  const scenarioDesc = {
    baseline:    'Baseline (P=50%): 24-month conflict, partial Hormuz disruption',
    optimistic:  'Optimistic (P=22%): Ceasefire by Month 10, Hormuz reopens',
    pessimistic: 'Pessimistic (P=28%): Full Hormuz closure 6+ months, regional expansion',
  }[scenario] || 'Baseline';

  const headlines = newsHeadlines.length
    ? newsHeadlines.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'No live headlines — reasoning from model priors.';

  const prompt = `You are a senior investment advisor on the DELAX GEO-RISK platform. A client is asking about the Iran war and its impact on their investments. Speak directly to them in plain, confident English — like a trusted advisor giving a clear briefing, not a financial terminal spitting out jargon.

CURRENT MARKET CONTEXT:
- Active scenario: ${scenarioDesc}
- WTI Crude today: $${oilPrice}/bbl (as of ${liveDate}, pre-conflict was $78/bbl)
- Inflation impact year 1: ${cpi}
- Global GDP impact year 1: ${gdp}
- Shipping costs: ${shipping} above normal
- Key chokepoint: Strait of Hormuz carries 20% of the world\'s oil

RECENT HEADLINES:
${headlines}

CLIENT QUESTION: "${query}"

Answer in exactly 4 sections. Write in plain English — no jargon, no acronym soup. Every number must be concrete and meaningful to a real investor.

OUTPUT RULES (strict):
- Begin IMMEDIATELY with the first section label. NO greeting, NO preamble, NO "good morning", NO "let's cut to it", NO sign-off.
- Use ONLY the four bold section labels exactly as written below (e.g. **What This Means:**). Do NOT use markdown headers (#, ##, ###), code blocks, or backticks.
- Do NOT wrap the response in quotation marks.

**What This Means:** In 2-3 plain sentences, explain what the client is really asking and which direction this pushes the outlook — better, worse, or unchanged from the current scenario.

**Impact on Markets:** 3-4 bullet points. For each, state the asset, the likely price move with a range, and one sentence on why. Example: "Oil could rise to $165–$195/bbl because a Hormuz closure removes 20% of global supply overnight."

**What You Should Consider:** 2-3 bullet points with specific, actionable ideas — which sectors or ETFs benefit, which to reduce, and one hedge worth knowing about. Name real tickers where relevant (XOM, LMT, GLD, TLT, etc.).

**The One Thing That Could Change Everything:** One sentence. The single biggest unknown that would flip this analysis.

Keep it under 300 words. Be direct. Investors are busy and need clarity, not complexity.`;

  /* ── Route through provider chain with runtime fallback ── */
  let result = { error: 'AI unavailable' };
  for (const p of PROVIDERS) {
    let r;
    if (p.name === 'groq')           r = await callGroq(p.key, prompt, 650);
    else if (p.name === 'gemini')    r = await callGemini(p.key, prompt, 650);
    else if (p.name === 'anthropic') r = await callAnthropic(p.key, prompt, 650);
    else continue;
    if (r && r.text) { result = { text: r.text }; break; }
    result = { error: (r && r.error) || result.error };
    console.warn(`[whatif] ${p.name} failed: ${result.error}`);
  }

  if (result.error) {
    return res.status(500).json({ error: 'Analysis temporarily unavailable — please try again.' });
  }

  /* ── Detect scenario trigger ── */
  const lowerQ = query.toLowerCase();
  let scenarioTrigger = 'baseline';
  if (['hormuz close','hormuz block','200','recession','5 year','five year','nuclear','saudi strike'].some(k => lowerQ.includes(k))) scenarioTrigger = 'pessimistic';
  else if (['ceasefire','peace','deal','resolve','end war','diplomacy'].some(k => lowerQ.includes(k))) scenarioTrigger = 'optimistic';

  return res.status(200).json({
    analysis:        result.text,
    scenarioTrigger,
    analyzedAt:      new Date().toISOString(),
  });
};

/* ════════════════════════════════════
   PROVIDER IMPLEMENTATIONS
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
    let body; try { body = await r.json(); } catch(_) { return { error: 'Gemini returned non-JSON', status: 502 }; }
    if (!r.ok) return { error: body?.error?.message || `Gemini HTTP ${r.status}`, status: r.status };
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return { error: 'Gemini returned empty content', status: 502 };
    return { text, model: 'gemini-2.5-flash' };
  } catch (err) {
    return { error: `Gemini network error: ${err.message}`, status: 500 };
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
    let body; try { body = await r.json(); } catch(_) { return { error: 'Groq returned non-JSON', status: 502 }; }
    if (!r.ok) return { error: body?.error?.message || `Groq HTTP ${r.status}`, status: r.status };
    const text = body?.choices?.[0]?.message?.content || '';
    if (!text) return { error: 'Groq returned empty content', status: 502 };
    return { text, model: 'llama-3.3-70b-versatile' };
  } catch (err) {
    return { error: `Groq network error: ${err.message}`, status: 500 };
  }
}

async function callAnthropic(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body:    JSON.stringify({
        model:    'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    let body; try { body = await r.json(); } catch(_) { return { error: 'Anthropic returned non-JSON', status: 502 }; }
    if (!r.ok) return { error: body?.error?.message || `Anthropic HTTP ${r.status}`, detail: body?.error?.type, status: r.status };
    const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) return { error: 'Anthropic returned empty content', status: 502 };
    return { text, model: body.model || 'claude-haiku' };
  } catch (err) {
    return { error: `Anthropic network error: ${err.message}`, status: 500 };
  }
}
