/**
 * /api/gdelt.js — Vercel Serverless Function (CommonJS)
 * ──────────────────────────────────────────────────────
 * GDELT Project proxy — free, no API key required.
 * Fetches conflict/war/attack geo-events from last 48h
 * and aggregates by country for globe ring density overlay.
 *
 * GDELT API: https://api.gdeltproject.org
 * Free · No key · Updates every 15 minutes
 *
 * v2 hardening (Jul 2026):
 *  - Content-type + startsWith('{') guard before JSON.parse
 *    (GDELT's rate limiter returns plain text "Queries conducted…"
 *    with HTTP 200/429 — previously crashed the parse → 500)
 *  - 6s AbortController timeout (prevents unbounded hangs)
 *  - Upstream failures degrade gracefully: 200 + empty results +
 *    degraded flag, short cache so we retry soon without
 *    hammering GDELT while it is rate-limiting
 */
'use strict';

// Country code → name mapping for aggregation
const CC_MAP = {
  IR:'Iran', IQ:'Iraq', SA:'Saudi Arabia', YE:'Yemen', SY:'Syria',
  LB:'Lebanon', JO:'Jordan', IL:'Israel', TR:'Turkey', EG:'Egypt',
  LY:'Libya', DZ:'Algeria', MA:'Morocco', TN:'Tunisia', SD:'Sudan',
  NG:'Nigeria', ZA:'South Africa', ET:'Ethiopia', KE:'Kenya', GH:'Ghana',
  SO:'Somalia', CD:'Congo', CM:'Cameroon', ML:'Mali', NE:'Niger',
  IN:'India', PK:'Pakistan', AF:'Afghanistan', MM:'Myanmar', BD:'Bangladesh',
  CN:'China', JP:'Japan', KR:'South Korea', TW:'Taiwan', PH:'Philippines',
  ID:'Indonesia', VN:'Vietnam', TH:'Thailand', MY:'Malaysia',
  RU:'Russia', UA:'Ukraine', BY:'Belarus', PL:'Poland',
  US:'United States of America', MX:'Mexico', BR:'Brazil',
  AR:'Argentina', VE:'Venezuela', CO:'Colombia',
  DE:'Germany', FR:'France', GB:'United Kingdom', IT:'Italy', ES:'Spain',
  KZ:'Kazakhstan', UZ:'Uzbekistan', KW:'Kuwait', QA:'Qatar', AE:'United Arab Emirates',
  OM:'Oman', BH:'Bahrain',
};

/* Degraded (but valid) payload — frontend renders an empty overlay
   instead of receiving a 500. Short cache: retry in ~2 min without
   letting every visitor hit GDELT while it is rate-limiting us. */
function degrade(res, reason) {
  console.warn('[gdelt] degraded:', reason);
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
  return res.status(200).json({
    results:       [],
    totalArticles: 0,
    fetchedAt:     new Date().toISOString(),
    timespan:      '48h',
    degraded:      true,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300'); // 15min cache
  if (req.method !== 'GET') return res.status(405).end();

  /* v4.3 — DGSI conflict-attention component (Phase 2, conditional — see
     methodology.html §07). mode=timelinevol on ?mode= is a SECOND, separate
     use of this same endpoint: the globe overlay above stays on mode=artlist
     with a fixed 48h window; this branch serves the backfill/gate routine in
     api/market-data.js?type=index-backfill, which needs an arbitrary
     multi-year window. Same JSON-guard discipline as the artlist path below —
     GDELT's rate limiter returns HTTP 200 with a plain-text body, never
     JSON.parse blindly. */
  if (req.query.mode === 'timelinevol') {
    const q     = String(req.query.query || '');
    const start = String(req.query.start || ''); // YYYYMMDDHHMMSS
    const end   = String(req.query.end   || '');
    if (!q || !/^\d{14}$/.test(start) || !/^\d{14}$/.test(end)) {
      return res.status(400).json({ error: 'timelinevol requires query, start, end (YYYYMMDDHHMMSS)' });
    }
    try {
      const points = await fetchTimelineVol(q, start, end);
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
      return res.status(200).json({ points, query: q, start, end, fetchedAt: new Date().toISOString() });
    } catch (err) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'timelinevol fetch failed', detail: err.message });
    }
  }

  try {
    // GDELT Doc API — conflict geo-events last 48h
    // Returns articles with location data tagged to countries
    const query = encodeURIComponent('conflict OR war OR attack OR strike OR missile OR explosion');
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=250&timespan=48h&format=json`;

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 6000);

    let r;
    try {
      r = await fetch(url, {
        signal:  controller.signal,
        headers: { 'Accept': 'application/json' },
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      // Network failure or 6s timeout — upstream unreachable, degrade
      return degrade(res, fetchErr.name === 'AbortError'
        ? 'upstream timeout (6s)'
        : `fetch failed: ${fetchErr.message}`);
    }
    clearTimeout(timeout);

    if (!r.ok) {
      // 429 = GDELT rate limiter; any non-2xx is an upstream problem, not ours
      return degrade(res, `GDELT HTTP ${r.status}`);
    }

    /* ── JSON guard (ported from global-pulse.js) ──
       GDELT's rate limiter can return HTTP 200 with a plain-text body
       ("Queries conducted…"). Never JSON.parse blindly. */
    const contentType = r.headers.get('content-type') || '';
    const bodyText    = await r.text();
    const trimmed     = bodyText.trim();

    if (!contentType.includes('json') && !trimmed.startsWith('{')) {
      return degrade(res, `non-JSON upstream body: "${trimmed.slice(0, 60)}"`);
    }

    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (parseErr) {
      return degrade(res, `JSON parse failed: "${trimmed.slice(0, 60)}"`);
    }

    const articles = Array.isArray(data?.articles) ? data.articles : [];

    // Count events per country using GDELT source country codes
    const countryCounts = {};
    const countryTones  = {}; // avg tone (negative = more alarming)

    articles.forEach(a => {
      // GDELT returns sourcecountry as 2-letter ISO
      const cc = a.sourcecountry;
      if (!cc) return;
      const name = CC_MAP[cc];
      if (!name) return;
      countryCounts[name] = (countryCounts[name] || 0) + 1;
      // tone: negative = conflict/war coverage, range approx -10 to +10
      const tone = parseFloat(a.tone || '0');
      if (!countryTones[name]) countryTones[name] = [];
      countryTones[name].push(tone);
    });

    // Build result array
    const maxCount = Math.max(...Object.values(countryCounts), 1);
    const results = Object.entries(countryCounts).map(([name, count]) => {
      const tones = countryTones[name] || [0];
      const avgTone = tones.reduce((a, b) => a + b, 0) / tones.length;
      return {
        country:    name,
        count,
        intensity:  parseFloat((count / maxCount).toFixed(3)), // 0–1 normalized
        avgTone:    parseFloat(avgTone.toFixed(2)),             // negative = alarming
        isAlarm:    avgTone < -3 && count > 3,
      };
    }).sort((a, b) => b.count - a.count);

    return res.status(200).json({
      results,
      totalArticles: articles.length,
      fetchedAt:     new Date().toISOString(),
      timespan:      '48h',
    });

  } catch (err) {
    // Truly unexpected internal error — still never surface a 500 to users;
    // log at error level so it shows in Vercel error clusters for diagnosis.
    console.error('[gdelt] unexpected:', err.message);
    return degrade(res, `unexpected: ${err.message}`);
  }
};

/* ── fetchTimelineVol ─────────────────────────────────────────────
   DOC 2.0 mode=TimelineVol. Returns article volume as a PERCENTAGE of all
   GDELT-monitored articles in each time bucket — normalized by construction,
   which is what makes it usable in a z-score: a raw event count trends
   upward purely because GDELT's source corpus has grown since 2017, and
   z-scoring that would publish "the world getting more violent" as an
   artifact of better internet coverage, not more conflict.

   RESPONSE SHAPE — UNVERIFIED against a live call from this build environment
   (no GDELT egress from the sandbox this was built in); documented only.
   GDELT's JSON timeline response nests as
     { timeline: [ { series: "...", data: [ { date, value, ... }, ... ] } ] }
   per the DOC 2.0 API documentation. Confirm this shape against one real
   response before trusting index-backfill's GDELT gate results — if the
   shape is wrong this parser returns null defensively rather than crash or
   fabricate a series, which fails the gate closed exactly as intended. */
async function fetchTimelineVol(query, startdatetime, enddatetime) {
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc'
    + '?query=' + encodeURIComponent(query)
    + '&mode=TimelineVol'
    + '&startdatetime=' + startdatetime
    + '&enddatetime=' + enddatetime
    + '&format=json';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let r;
  try {
    r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(timeout);
  }
  if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);

  const bodyText = (await r.text()).trim();
  if (!bodyText.startsWith('{')) {
    // Same rate-limiter guard as the artlist path: plain-text body, not JSON.
    throw new Error(`non-JSON upstream body: "${bodyText.slice(0, 80)}"`);
  }
  const data = JSON.parse(bodyText);

  const series = data && Array.isArray(data.timeline) ? data.timeline[0] : null;
  const rows   = series && Array.isArray(series.data) ? series.data : null;
  if (!rows) return null; // shape mismatch — fail closed, do not guess

  return rows
    .map(function (r) { return { date: r.date, value: parseFloat(r.value) }; })
    .filter(function (r) { return r.date && !isNaN(r.value); });
}

module.exports.fetchTimelineVol = fetchTimelineVol;
