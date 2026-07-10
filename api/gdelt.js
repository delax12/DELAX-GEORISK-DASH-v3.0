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
