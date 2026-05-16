/**
 * /api/market-search.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * DELAX GEO-RISK — Global equity symbol search (Batch 3 / Step 15)
 *
 * Queries Finnhub symbol search covering 50,000+ securities across
 * NYSE, NASDAQ, LSE, TSX, ASX, Euronext, Tokyo, Hong Kong, Frankfurt,
 * Tadawul, and more. Returns ranked results with exchange context.
 *
 * ENDPOINT:
 *   GET /api/market-search?q=shell
 *   GET /api/market-search?q=XOM
 *   Returns: { results: [...], count, query, fetchedAt }
 *
 * Each result:
 *   { symbol, name, exchange, type, displaySymbol, flag }
 *
 * ENV VARS:
 *   FINNHUB_API_KEY — required (free tier: 60 req/min)
 *
 * CACHING:
 *   5 minutes CDN cache — search results are stable
 */
'use strict';

/* Exchange code → human label + country flag */
const EXCHANGE_META = {
  US:   { label: 'NYSE/NASDAQ', flag: '🇺🇸' },
  NYSE: { label: 'NYSE',        flag: '🇺🇸' },
  NASDAQ:{ label:'NASDAQ',      flag: '🇺🇸' },
  L:    { label: 'LSE',         flag: '🇬🇧' },
  PA:   { label: 'Euronext',    flag: '🇫🇷' },
  AS:   { label: 'Euronext AMS',flag: '🇳🇱' },
  BR:   { label: 'Euronext BRU',flag: '🇧🇪' },
  T:    { label: 'Tokyo',       flag: '🇯🇵' },
  HK:   { label: 'Hong Kong',   flag: '🇭🇰' },
  SS:   { label: 'Shanghai',    flag: '🇨🇳' },
  SZ:   { label: 'Shenzhen',    flag: '🇨🇳' },
  SR:   { label: 'Tadawul',     flag: '🇸🇦' },
  AX:   { label: 'ASX',         flag: '🇦🇺' },
  TO:   { label: 'TSX',         flag: '🇨🇦' },
  V:    { label: 'TSXV',        flag: '🇨🇦' },
  F:    { label: 'Frankfurt',   flag: '🇩🇪' },
  XETRA:{ label: 'XETRA',       flag: '🇩🇪' },
  MI:   { label: 'Milan',       flag: '🇮🇹' },
  MC:   { label: 'Madrid',      flag: '🇪🇸' },
  ST:   { label: 'Stockholm',   flag: '🇸🇪' },
  OL:   { label: 'Oslo',        flag: '🇳🇴' },
  CO:   { label: 'Copenhagen',  flag: '🇩🇰' },
  HE:   { label: 'Helsinki',    flag: '🇫🇮' },
  SW:   { label: 'SIX Swiss',   flag: '🇨🇭' },
  BO:   { label: 'BSE',         flag: '🇮🇳' },
  NS:   { label: 'NSE',         flag: '🇮🇳' },
  JK:   { label: 'Jakarta',     flag: '🇮🇩' },
  KL:   { label: 'Bursa',       flag: '🇲🇾' },
  SI:   { label: 'SGX',         flag: '🇸🇬' },
  BK:   { label: 'Thailand',    flag: '🇹🇭' },
  TW:   { label: 'TWSE',        flag: '🇹🇼' },
  KS:   { label: 'KOSPI',       flag: '🇰🇷' },
  NZ:   { label: 'NZX',         flag: '🇳🇿' },
  SN:   { label: 'Santiago',    flag: '🇨🇱' },
  SA:   { label: 'B3',          flag: '🇧🇷' },
  MX:   { label: 'BMV',         flag: '🇲🇽' },
  IL:   { label: 'Tel Aviv',    flag: '🇮🇱' },
  JO:   { label: 'JSE',         flag: '🇿🇦' },
};

/* US-first exchange priority for sorting */
const EXCHANGE_PRIORITY = { US:0, NYSE:0, NASDAQ:0, L:1, T:2, HK:3, F:4, PA:4, SR:5 };

function getExchangeMeta(symbol, exchange) {
  // Extract suffix from symbol (e.g. BP.L → L, 7203.T → T)
  const parts = symbol.split('.');
  const suffix = parts.length > 1 ? parts[parts.length - 1] : '';
  const key = EXCHANGE_META[suffix] ? suffix :
              EXCHANGE_META[exchange] ? exchange : '';
  return EXCHANGE_META[key] || { label: exchange || 'Global', flag: '🌐' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const q = (req.query.q || '').trim();
  if (!q || q.length < 1) {
    return res.status(400).json({ error: 'q query parameter required (min 1 char)' });
  }
  if (q.length > 60) {
    return res.status(400).json({ error: 'Query too long (max 60 chars)' });
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (!finnhubKey) {
    return res.status(500).json({ error: 'FINNHUB_API_KEY not configured' });
  }

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 6000);

    const resp = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${finnhubKey}`,
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(timeout);

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(resp.status).json({ error: body.error || `Finnhub HTTP ${resp.status}` });
    }

    const data   = await resp.json();
    const raw    = data.result || [];

    /* ── Filter & enrich ── */
    const results = raw
      // Remove junk entries (empty names, indices-only noise, warrants, rights)
      .filter(r => r.symbol && r.description && r.description.length > 1)
      .filter(r => !['W','R','UNIT','NOTE'].includes(r.type))
      // Enrich with display info
      .map(r => {
        const meta = getExchangeMeta(r.symbol, r.primaryExchange || '');
        return {
          symbol:        r.symbol,
          displaySymbol: r.displaySymbol || r.symbol,
          name:          r.description,
          exchange:      meta.label,
          exchangeCode:  r.primaryExchange || '',
          type:          r.type || 'Stock',
          flag:          meta.flag,
          _priority:     EXCHANGE_PRIORITY[r.primaryExchange] ?? 10,
        };
      })
      // Sort: US markets first, then by query match score
      .sort((a, b) => {
        // Exact symbol match always wins
        const aExact = a.symbol.toUpperCase() === q.toUpperCase() ? -100 : 0;
        const bExact = b.symbol.toUpperCase() === q.toUpperCase() ? -100 : 0;
        if (aExact !== bExact) return aExact - bExact;
        // Starts-with match
        const aStart = a.symbol.toUpperCase().startsWith(q.toUpperCase()) ? -10 : 0;
        const bStart = b.symbol.toUpperCase().startsWith(q.toUpperCase()) ? -10 : 0;
        if (aStart !== bStart) return aStart - bStart;
        // Exchange priority
        return a._priority - b._priority;
      })
      // Return top 12
      .slice(0, 12)
      // Strip internal sort fields
      .map(({ _priority, ...r }) => r);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      results,
      count:     results.length,
      query:     q,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Search timed out — try again' });
    }
    console.error('[market-search]', err.message);
    return res.status(500).json({ error: 'Search failed', detail: err.message });
  }
};
