/**
 * /api/market.js — Vercel Serverless Function (Node.js / CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * Live stock / commodity / index price proxy for DELAX GEO-RISK.
 *
 * COMMODITY/INDEX FIX (Jun 2026):
 *   BRENT, WTI, NG/NATGAS and DXY were mapped to Yahoo-style futures/index
 *   tickers (BZ=F, CL=F, NG=F, DX-Y.NYB). Finnhub's free tier cannot quote
 *   those (it serves equities/ETFs only), and the old code deliberately
 *   skipped the Alpha Vantage fallback for futures — so these four symbols
 *   had NO working source and always returned 502.
 *
 *   Now each is routed to a source that actually works, ahead of the
 *   Finnhub/AV equity path:
 *     • BRENT / WTI → EIA v2 petroleum spot (RBRTE / RWTC), daily.
 *     • NG / NATGAS → Alpha Vantage NATURAL_GAS commodity endpoint, daily.
 *     • DXY         → FRED DTWEXBGS (Nominal Broad US Dollar Index), daily.
 *   All three are daily series, so responses are edge-cached 6h — which also
 *   keeps the AV NATURAL_GAS call to ≤4/day, protecting the shared 25/day AV
 *   quota that the snapshot cron also draws on.
 *
 * Prior fixes retained: GLOBAL_QUOTE fallback, c=0→prevClose, no error caching.
 *
 * Sources: Finnhub (equities/ETFs) · Alpha Vantage · EIA · FRED
 */
'use strict';

/* Equity/ETF symbol normalisation (Finnhub-quotable). Commodity/index IDs are
   handled by SPECIAL below, BEFORE this map is consulted. */
const SYMBOL_MAP = {
  SPX:  'SPY',   // S&P 500 ETF proxy
  EMCS: 'EEM',   // EM ETF proxy for EM Credit Spread
  VIX:  '^VIX',  // CBOE Volatility Index
};

/* Commodity & index symbols Finnhub free can't quote → dedicated sources. */
const SPECIAL = {
  BRENT:  { kind: 'eia',  series: 'RBRTE', name: 'Brent Crude Spot',        unit: 'USD/bbl'    },
  WTI:    { kind: 'eia',  series: 'RWTC',  name: 'WTI Cushing Spot',        unit: 'USD/bbl'    },
  NG:     { kind: 'avc',  fn: 'NATURAL_GAS', name: 'Henry Hub Natural Gas', unit: 'USD/MMBtu'  },
  NATGAS: { kind: 'avc',  fn: 'NATURAL_GAS', name: 'Henry Hub Natural Gas', unit: 'USD/MMBtu'  },
  DXY:    { kind: 'fred', series: 'DTWEXBGS', name: 'US Dollar Index (Broad)', unit: 'index'   },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const rawSymbol = (req.query.symbol || '').toUpperCase().trim();
  if (!rawSymbol) return res.status(400).json({ error: 'symbol query parameter required' });

  /* ── 0. Commodity / index special-routing (daily data, cached 6h) ── */
  const special = SPECIAL[rawSymbol];
  if (special) {
    try {
      const result = await fetchSpecial(special);
      if (result) {
        res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
        return res.status(200).json({ ...result, requestedSymbol: rawSymbol });
      }
    } catch (err) {
      console.warn(`[market] special source failed for ${rawSymbol}:`, err.message);
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Price source failed', symbol: rawSymbol });
  }

  /* ── Equities / ETFs: Finnhub primary → Alpha Vantage fallback ── */
  const symbol     = SYMBOL_MAP[rawSymbol] || rawSymbol;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const avKey      = process.env.ALPHA_VANTAGE_KEY;

  if (finnhubKey) {
    try {
      const result = await fetchFinnhub(symbol, finnhubKey);
      if (result) {
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
        return res.status(200).json({ ...result, requestedSymbol: rawSymbol });
      }
    } catch (err) { console.warn('[market] Finnhub failed:', err.message); }
  } else {
    console.warn('[market] FINNHUB_API_KEY not set — skipping Finnhub');
  }

  const isFutures = symbol.endsWith('=F') || symbol.startsWith('^') || symbol.includes('-Y.');
  if (avKey && !isFutures) {
    try {
      const result = await fetchAlphaVantage(symbol, avKey);
      if (result) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
        return res.status(200).json({ ...result, requestedSymbol: rawSymbol });
      }
    } catch (err) { console.warn('[market] Alpha Vantage failed:', err.message); }
  } else if (!avKey) {
    console.warn('[market] ALPHA_VANTAGE_KEY not set — skipping AV fallback');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(502).json({
    error:  'All price sources failed',
    symbol: rawSymbol,
    hints: [
      'Ensure FINNHUB_API_KEY is set correctly in Vercel (no surrounding quotes/spaces)',
      'After market hours Finnhub returns c=0; fallback to prevClose is applied automatically',
    ],
  });
};

/* ═══════════════ Special-source dispatch (commodity / index) ═══════════════ */
async function fetchSpecial(spec) {
  if (spec.kind === 'eia')  return fetchEIASeries(spec.series, spec.name, spec.unit);
  if (spec.kind === 'avc')  return fetchAVCommodity(spec.fn,   spec.name, spec.unit);
  if (spec.kind === 'fred') return fetchFRED(spec.series,      spec.name, spec.unit);
  return null;
}

/* EIA v2 petroleum spot — single series, newest first. */
async function fetchEIASeries(series, name, unit) {
  const key = process.env.EIA_API_KEY;
  if (!key) throw new Error('EIA_API_KEY not set');
  const url = 'https://api.eia.gov/v2/petroleum/pri/spt/data/' +
    '?api_key=' + encodeURIComponent(key) +
    '&frequency=daily&data[0]=value&facets[series][]=' + series +
    '&sort[0][column]=period&sort[0][direction]=desc&length=10';
  const resp = await fetchWithTimeout(url, 7000, { Accept: 'application/json' });
  if (!resp.ok) throw new Error('EIA HTTP ' + resp.status);
  const json = await resp.json();
  const rows = json && json.response && json.response.data;
  if (!rows || !rows.length) return null;
  const price = parseFloat(rows[0].value);
  if (isNaN(price)) return null;
  const prev = rows[1] ? parseFloat(rows[1].value) : price;
  return makePayload(series, price, prev, name, unit, 'EIA');
}

/* Alpha Vantage commodity endpoint (e.g. NATURAL_GAS), daily, newest first.
   Values can be "." on non-trading days — filter to the first two numerics. */
async function fetchAVCommodity(fn, name, unit) {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) throw new Error('ALPHA_VANTAGE_KEY not set');
  const url = 'https://www.alphavantage.co/query?function=' + fn +
    '&interval=daily&apikey=' + key;
  const resp = await fetchWithTimeout(url, 7000);
  if (!resp.ok) throw new Error('Alpha Vantage HTTP ' + resp.status);
  const json = await resp.json();
  if (json?.Note || json?.Information) throw new Error('Alpha Vantage rate limit (25/day)');
  const data = Array.isArray(json?.data) ? json.data : [];
  const nums = data
    .map((d) => parseFloat(d.value))
    .filter((v) => !isNaN(v));
  if (!nums.length) return null;
  const price = nums[0];
  const prev  = nums[1] != null ? nums[1] : price;
  return makePayload(fn, price, prev, name, unit, 'Alpha Vantage');
}

/* FRED observations — newest first, "." for missing values. */
async function fetchFRED(series, name, unit) {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY not set');
  const url = 'https://api.stlouisfed.org/fred/series/observations' +
    '?series_id=' + series + '&api_key=' + key +
    '&file_type=json&sort_order=desc&limit=10';
  const resp = await fetchWithTimeout(url, 7000);
  if (!resp.ok) throw new Error('FRED HTTP ' + resp.status);
  const json = await resp.json();
  const obs = Array.isArray(json?.observations) ? json.observations : [];
  const nums = obs
    .map((o) => parseFloat(o.value))
    .filter((v) => !isNaN(v));
  if (!nums.length) return null;
  const price = nums[0];
  const prev  = nums[1] != null ? nums[1] : price;
  return makePayload(series, price, prev, name, unit, 'FRED');
}

/* ═══════════════ Equity sources (unchanged behaviour) ═══════════════ */
async function fetchFinnhub(symbol, apiKey) {
  const url  = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const resp = await fetchWithTimeout(url, 5000);
  if (!resp.ok) throw new Error(`Finnhub HTTP ${resp.status}`);
  const data = await resp.json();

  const currentPrice = data.c;
  const prevClose    = data.pc;
  if ((!currentPrice || currentPrice === 0) && (!prevClose || prevClose === 0)) return null;

  const price       = (currentPrice && currentPrice !== 0) ? currentPrice : prevClose;
  const isEstimated = (!currentPrice || currentPrice === 0);
  const change        = prevClose ? price - prevClose : 0;
  const percentChange = prevClose ? (change / prevClose) * 100 : 0;

  return {
    symbol,
    price:         round4(price),
    change:        round4(change),
    percentChange: round4(percentChange),
    high: data.h || null, low: data.l || null, open: data.o || null,
    prevClose: prevClose || null,
    isEstimated, currency: 'USD', source: 'Finnhub',
    timestamp: new Date().toISOString(),
  };
}

async function fetchAlphaVantage(symbol, apiKey) {
  const url  = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  const resp = await fetchWithTimeout(url, 6000);
  if (!resp.ok) throw new Error(`Alpha Vantage HTTP ${resp.status}`);
  const json = await resp.json();
  if (json?.Note || json?.Information) throw new Error('Alpha Vantage rate limit (25/day)');

  const q = json?.['Global Quote'];
  if (!q || !q['05. price']) return null;
  const price     = parseFloat(q['05. price']);
  const prevClose = parseFloat(q['08. previous close'] || q['05. price']);
  const change    = parseFloat(q['09. change'] || '0');
  const pct       = parseFloat((q['10. change percent'] || '0%').replace('%', ''));
  if (!price || isNaN(price)) return null;

  return {
    symbol,
    price:         round4(price),
    change:        round4(change),
    percentChange: round4(pct),
    prevClose:     round4(prevClose),
    isEstimated:   false, currency: 'USD', source: 'Alpha Vantage',
    timestamp:     new Date().toISOString(),
  };
}

/* ═══════════════ Shared helpers ═══════════════ */
function makePayload(symbol, price, prevClose, name, unit, source) {
  const change = prevClose ? price - prevClose : 0;
  const pct    = prevClose ? (change / prevClose) * 100 : 0;
  return {
    symbol, name,
    price:         round4(price),
    change:        round4(change),
    percentChange: round4(pct),
    prevClose:     round4(prevClose),
    isEstimated:   false,
    unit, currency: unit === 'index' ? null : 'USD',
    source,
    timestamp: new Date().toISOString(),
  };
}

function round4(n) { return parseFloat(Number(n).toFixed(4)); }

async function fetchWithTimeout(url, ms, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, headers ? { headers, signal: controller.signal } : { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('upstream timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
