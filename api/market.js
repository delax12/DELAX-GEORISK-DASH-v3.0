/**
 * /api/market.js — Vercel Serverless Function (Node.js / CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * Live stock / commodity price proxy for DELAX GEO-RISK dashboard.
 *
 * FIX NOTES (v2):
 *  • Replaced broken `execSync('python3 ...')` approach — Vercel Node.js
 *    runtime has NO Python available; every call was silently 500-ing.
 *  • Primary source: Finnhub REST API (free tier, 60 req/min).
 *    Requires env var: FINNHUB_API_KEY
 *  • Secondary fallback: Yahoo Finance unofficial JSON endpoint (no key).
 *  • Returns consistent shape:
 *      { symbol, price, change, percentChange, currency, source, timestamp }
 *  • CORS + 30-second edge cache preserved.
 *
 * Vercel env var to add:
 *   FINNHUB_API_KEY  →  finnhub.io (free, instant registration)
 */
'use strict';

/* ── Symbol normalisation ──────────────────────────────────────────
   The frontend uses some non-standard IDs (BRENT, GOLD, NG).
   Map them to valid Finnhub / Yahoo Finance tickers.
─────────────────────────────────────────────────────────────────── */
const SYMBOL_MAP = {
  BRENT:  'BZ=F',     // Brent Crude futures (Yahoo Finance)
  WTI:    'CL=F',     // WTI Crude futures
  NG:     'NG=F',     // Natural Gas futures
  NATGAS: 'NG=F',     // alias used by index.html ticker
  GOLD:   'GLD',      // SPDR Gold ETF (spot gold proxy)
  SPX:    'SPY',      // S&P 500 ETF proxy
  VIX:    '^VIX',     // CBOE Volatility Index
  DXY:    'DX-Y.NYB', // US Dollar Index
  EMCS:   'EEM',      // EM ETF proxy for EM Credit Spread
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const rawSymbol = (req.query.symbol || '').toUpperCase().trim();
  if (!rawSymbol) return res.status(400).json({ error: 'symbol query parameter required' });

  // Resolve dashboard ID → real ticker
  const symbol = SYMBOL_MAP[rawSymbol] || rawSymbol;
  const finnhubKey = process.env.FINNHUB_API_KEY;

  // ── 1. Try Finnhub (primary) ──────────────────────────────────
  if (finnhubKey) {
    try {
      const result = await fetchFinnhub(symbol, finnhubKey);
      if (result) {
        return res.status(200).json({ ...result, requestedSymbol: rawSymbol });
      }
    } catch (err) {
      console.warn('[market] Finnhub failed:', err.message);
    }
  } else {
    console.warn('[market] FINNHUB_API_KEY not set — skipping Finnhub');
  }

  // ── 2. Fallback: Yahoo Finance unofficial JSON ────────────────
  try {
    const result = await fetchYahooFinance(symbol);
    if (result) {
      return res.status(200).json({ ...result, requestedSymbol: rawSymbol });
    }
  } catch (err) {
    console.warn('[market] Yahoo Finance fallback failed:', err.message);
  }

  // ── 3. Both failed ────────────────────────────────────────────
  return res.status(502).json({
    error:  'All price sources failed',
    symbol: rawSymbol,
    hint:   'Ensure FINNHUB_API_KEY is set in Vercel Environment Variables',
  });
};

/* ─── Finnhub quote fetch ────────────────────────────────────────── */
async function fetchFinnhub(symbol, apiKey) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 6000);

  try {
    // Finnhub /quote endpoint
    const url  = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Finnhub HTTP ${resp.status}`);
    const data = await resp.json();

    // Finnhub returns { c: currentPrice, d: change, dp: percentChange, h, l, o, pc }
    if (!data.c || data.c === 0) return null; // 0 means symbol not found

    return {
      symbol,
      price:         parseFloat(data.c.toFixed(4)),
      change:        parseFloat((data.d  || 0).toFixed(4)),
      percentChange: parseFloat((data.dp || 0).toFixed(4)),
      high:          data.h,
      low:           data.l,
      open:          data.o,
      prevClose:     data.pc,
      currency:      'USD',
      source:        'Finnhub',
      timestamp:     new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/* ─── Yahoo Finance unofficial JSON fallback ─────────────────────── */
async function fetchYahooFinance(symbol) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 7000);

  try {
    const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const resp = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Yahoo HTTP ${resp.status}`);
    const json = await resp.json();

    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta    = result.meta || {};
    const price   = meta.regularMarketPrice || meta.previousClose;
    if (!price) return null;

    const prevClose     = meta.chartPreviousClose || meta.previousClose || price;
    const change        = price - prevClose;
    const percentChange = prevClose ? (change / prevClose) * 100 : 0;

    return {
      symbol,
      price:         parseFloat(price.toFixed(4)),
      change:        parseFloat(change.toFixed(4)),
      percentChange: parseFloat(percentChange.toFixed(4)),
      currency:      meta.currency || 'USD',
      source:        'Yahoo Finance',
      timestamp:     new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
