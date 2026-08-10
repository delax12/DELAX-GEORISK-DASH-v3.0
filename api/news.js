/**
 * /api/news.js — Vercel Serverless Function (Node.js / CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * Live geopolitical news feed for DELAX GEO-RISK dashboard.
 *
 * FIX NOTES (v3):
 *  • FIX 3.1: Replaced RSS scraping with NewsAPI.org JSON API.
 *    All 6 previous RSS feed URLs returned 403/DNS-failure from
 *    Vercel's cloud IPs. Major publishers (BBC, Reuters, NYT,
 *    MarketWatch) block programmatic access from AWS/serverless
 *    infrastructure. NewsAPI.org is designed for server-side use
 *    and works reliably from Vercel.
 *
 *  • FIX 3.2: Now reads NEWS_API_KEY env var (already in Vercel).
 *    Previously this key was configured but never used.
 *
 *  • FIX 3.3: Response always includes a non-empty 'news' array or
 *    a clear error message. The empty-response path is handled
 *    gracefully so #geopolitical-feed never stays on "Connecting…".
 *    If NewsAPI key is missing, a descriptive error is returned.
 *
 * Vercel env var required:
 *   NEWS_API_KEY  →  newsapi.org (free plan: 100 req/day)
 *
 * Endpoint:  GET /api/news?limit=12
 * Response:  { news: [...], fetchedAt, sources, count }
 */
'use strict';

/* Stories that are never market signal on this platform. A local fire, crash or
   crime is human tragedy, not an investable geopolitical event — and surfacing
   one under a green "CLIMATE & WEATHER" chip on an investor dashboard is both
   irrelevant and tonally wrong. Matched on title only, so a passing mention in
   a macro story does not exclude it. */
const LOCAL_NOISE = [
  'firefighter', 'helicopter crash', 'car crash', 'shooting', 'stabbing',
  'murder', 'homicide', 'arrested', 'sentenced', 'lawsuit filed', 'obituary',
  'missing person', 'amber alert', 'high school', 'county sheriff',
];

/* Minimum relevance score for inclusion. The previous build SORTED by score but
   never filtered, so once genuinely relevant stories ran out, score-zero local
   news padded the list to the requested limit. Returning six good items beats
   returning fifteen where nine are filler. */
const MIN_GEO_SCORE = 2;

/* Geopolitical relevance keywords for scoring/filtering */
const GEO_KEYWORDS = [
  'war','conflict','military','sanction','diplomat','tension','crisis',
  'invasion','nuclear','terror','missile','drone','navy','army',
  'ceasefire','peace','blockade','embargo','coup','assassination',
  'oil','gas','energy','brent','opec','crude','pipeline',
  'inflation','recession','fed rate','interest rate','central bank',
  'china','russia','iran','ukraine','israel','nato','middle east','taiwan',
  'sanctions','cybersecurity','espionage','intelligence',
  'trade war','tariff','supply chain','refugee','humanitarian',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const newsKey = process.env.NEWS_API_KEY;
  if (!newsKey) {
    return res.status(500).json({
      error:  'NEWS_API_KEY environment variable not set.',
      fix:    'Vercel Dashboard → Settings → Environment Variables → Add NEWS_API_KEY',
      docs:   'https://newsapi.org — free plan: 100 req/day',
      news:   [],  // empty array so frontend doesn't crash
    });
  }

  const limit = Math.min(parseInt(req.query.limit || '15', 10), 30);

  try {
    /* ── Fetch from two NewsAPI categories in parallel ── */
    const [worldRes, bizRes] = await Promise.allSettled([
      fetchNewsAPI(newsKey, 'general',  20),
      fetchNewsAPI(newsKey, 'business', 15),
    ]);

    const allItems = [];

    if (worldRes.status === 'fulfilled') allItems.push(...worldRes.value);
    if (bizRes.status   === 'fulfilled') allItems.push(...bizRes.value);

    if (!allItems.length) {
      /* FIX 3.3: Return structured empty response — never leave frontend hanging */
      return res.status(200).json({
        news:      [],
        fetchedAt: new Date().toISOString(),
        sources:   [],
        count:     0,
        warning:   'NewsAPI returned no articles — check key validity or daily quota',
      });
    }

    /* ── Score by geopolitical relevance, then FILTER ── */
    const scored = allItems.map(item => {
      const title = String(item.title || '').toLowerCase();
      const text  = `${title} ${String(item.description || '').toLowerCase()}`;
      const score = GEO_KEYWORDS.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
      const noisy = LOCAL_NOISE.some(kw => title.includes(kw));
      return { ...item, _score: score, _noisy: noisy };
    });

    const relevant = scored.filter(i => !i._noisy && i._score >= MIN_GEO_SCORE);

    /* Sort: most relevant first, then newest */
    relevant.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return new Date(b.pubDate) - new Date(a.pubDate);
    });

    /* De-duplicate by title prefix */
    const seen   = new Set();
    const deduped = [];
    for (const item of relevant) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
      if (!seen.has(key)) { seen.add(key); deduped.push(item); }
      if (deduped.length >= limit) break;
    }

    const sources = [...new Set(deduped.map(i => i.source).filter(Boolean))].slice(0, 6);
    const news    = deduped.map(({ _score, _noisy, ...item }) => item); // strip internal fields

    /* Cache successful responses for 5 min — protects NewsAPI 100 req/day free quota.
       At 5-min CDN cache: fetchNewsArticles (20-min poll) + DashboardLive (8-min poll)
       = at most ~12 real NewsAPI calls/day per edge node. Well within free tier. */
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

    return res.status(200).json({
      news,
      fetchedAt: new Date().toISOString(),
      sources,
      count:     news.length,
    });

  } catch (err) {
    console.error('[api/news] Unhandled error:', err.message);
    return res.status(500).json({
      error:  'News fetch failed',
      detail: err.message,
      news:   [],
    });
  }
};

/* ─── NewsAPI.org fetcher ───────────────────────────────────────── */
async function fetchNewsAPI(apiKey, category, pageSize) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 7000);

  try {
    const url = 'https://newsapi.org/v2/top-headlines' +
      `?category=${category}` +
      `&language=en` +
      `&pageSize=${pageSize}` +
      `&apiKey=${apiKey}`;

    const resp = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'DELAX-GeoRisk/3.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(`NewsAPI HTTP ${resp.status}: ${body.message || 'unknown error'}`);
    }

    const data = await resp.json();
    const articles = data.articles || [];

    /* Normalise to the shape the frontend expects */
    return articles
      .filter(a => a.title && a.title !== '[Removed]')
      .map(a => ({
        title:       (a.title       || '').slice(0, 200),
        description: (a.description || '').slice(0, 300),
        link:        a.url          || '',
        pubDate:     a.publishedAt  || new Date().toISOString(),
        source:      a.source?.name || 'NewsAPI',
      }));

  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[api/news] NewsAPI category=${category} failed: ${err.message}`);
    return []; // non-fatal — other category may succeed
  }
}
