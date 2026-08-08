/**
 * /api/market-equity.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * DELAX GEO-RISK — Equities research fundamentals proxy
 *
 * Fetches stock fundamentals (P/E, market cap, 52W range, beta,
 * dividend yield, analyst target, profit margin) from Finnhub
 * and Alpha Vantage server-side — API keys never touch the browser.
 *
 * Also returns daily OHLC history for the candlestick chart.
 *
 * CANDLE FIX (Jul 2026):
 *   Finnhub moved /stock/candle behind its paid tier — free keys get 403,
 *   so the chart showed "No chart data available" for every symbol.
 *
 * STALENESS GUARD (Aug 2026):
 *   /api/snapshot's candle rotation grew from 34 to 66 tickers, which stretched
 *   a full pass from ~5 days to ~8.25 at MAX_PER_RUN=8. Weekly closes don't care
 *   (they move once a week) but a daily OHLC bundle can now sit a week behind,
 *   which would render as a visible gap at the right edge of the chart. So a
 *   stored bundle is only served when its last row is within STALE_TRADING_DAYS
 *   of today; otherwise Twelve Data is asked on demand. The stale bundle is NOT
 *   discarded — it's held and served if the on-demand path fails, because stale
 *   data beats an empty chart. candleSource distinguishes the two.
 *
 *   Candles are sourced in priority order:
 *     1. SNAPSHOT BLOB (fresh)  — instant, zero external API calls, 120 rows
 *     2. TWELVE DATA            — on demand (1 credit of 800/day, ~120 rows)
 *     3. SNAPSHOT BLOB (stale)  — better than nothing when on-demand fails
 *     4. FINNHUB CANDLE         — legacy attempt, kept as a last resort
 *   Response includes candleSource and candleAsOf for observability.
 *
 * ENDPOINT:
 *   GET /api/market-equity?symbol=XOM
 *   Returns: { quote, fundamentals, candles, candleSource, candleAsOf, fetchedAt }
 *
 * ENV VARS (already set in Vercel):
 *   FINNHUB_API_KEY   — quote + basic financials
 *   ALPHA_VANTAGE_KEY — fallback fundamentals (OVERVIEW endpoint)
 *   TWELVE_DATA_KEY   — on-demand candles for off-universe / stale symbols
 *   (Blob store connected — snapshot candle reads)
 */
'use strict';

const { list } = require('@vercel/blob');

const CANDLES_PATH = 'snapshot/candles.json';

/* A stored bundle older than this many weekday sessions is treated as stale.
   Weekday counting ignores market holidays, which only ever errs toward
   freshness — the cost of a false "stale" is one Twelve Data credit. */
const STALE_TRADING_DAYS = 3;

/* The candle blob is ~800KB at 66 tickers, and every request previously
   downloaded and parsed all of it to read ONE ticker's daily array. Warm
   lambda instances now reuse a parsed copy for SNAP_TTL_MS. Cold starts still
   pay once; the cron rewrites the blob daily, so a 10-minute window can never
   serve data older than the staleness guard already tolerates. */
const SNAP_TTL_MS = 10 * 60 * 1000;
let _snapCache = { at: 0, candles: null };

async function getCandleBundle(symbol) {
  const now = Date.now();
  if (!_snapCache.candles || (now - _snapCache.at) > SNAP_TTL_MS) {
    const snap = await readJsonBlob(CANDLES_PATH);
    _snapCache = { at: now, candles: (snap && snap.candles) || {} };
  }
  return _snapCache.candles[symbol] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const symbol = (req.query.symbol || '').toUpperCase().trim().replace(/[^A-Z0-9.\-^]/g, '');
  if (!symbol || symbol.length > 12) {
    return res.status(400).json({ error: 'symbol query parameter required (e.g. ?symbol=XOM)' });
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const avKey      = process.env.ALPHA_VANTAGE_KEY;

  if (!finnhubKey && !avKey) {
    return res.status(500).json({ error: 'No market data API keys configured' });
  }

  const result  = {
    symbol, quote: null, fundamentals: null,
    candles: null, candleSource: null, candleAsOf: null,
    fetchedAt: new Date().toISOString(),
  };
  const errors  = [];

  /* ── 1. Finnhub quote (price, change, 52W, beta) ── */
  if (finnhubKey) {
    try {
      const [quoteRes, metricsRes] = await Promise.allSettled([
        fetchJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`),
        fetchJSON(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${finnhubKey}`),
      ]);

      /* A quote of c:0 means the provider does not carry this symbol — common
         for foreign-exchange listings on US-only plans. Previously this fell
         through silently, so the errors[] array reported only 2 of the 4
         providers that actually failed and diagnosis became guesswork. */
      if (quoteRes.status === 'rejected') {
        errors.push(`quote: ${quoteRes.reason?.message || 'request failed'}`);
      } else if (!quoteRes.value?.c) {
        errors.push(`quote: symbol not carried on current data plan`);
      }
      if (metricsRes.status === 'rejected') {
        errors.push(`fundamentals: ${metricsRes.reason?.message || 'request failed'}`);
      } else if (!metricsRes.value?.metric) {
        errors.push(`fundamentals: no data for symbol`);
      }

      if (quoteRes.status === 'fulfilled' && quoteRes.value?.c) {
        const q = quoteRes.value;
        const price    = q.c || q.pc || 0;
        const prevClose= q.pc || price;
        const change   = price - prevClose;
        const pctChg   = prevClose ? (change / prevClose) * 100 : 0;
        result.quote = {
          price:         +price.toFixed(2),
          change:        +change.toFixed(2),
          percentChange: +pctChg.toFixed(2),
          high:          q.h || null,
          low:           q.l || null,
          open:          q.o || null,
          prevClose:     +prevClose.toFixed(2),
          isEstimated:   (!q.c || q.c === 0),
          source:        'Finnhub',
        };
      }

      if (metricsRes.status === 'fulfilled' && metricsRes.value?.metric) {
        const m = metricsRes.value.metric;
        result.fundamentals = {
          marketCap:      m['marketCapitalization'] ? (m['marketCapitalization'] * 1e6) : null,
          pe:             m['peNormalizedAnnual']   || m['peTTM']    || null,
          eps:            m['epsNormalizedAnnual']  || m['epsTTM']   || null,
          high52:         m['52WeekHigh']            || null,
          low52:          m['52WeekLow']             || null,
          beta:           m['beta']                  || null,
          dividendYield:  m['dividendYieldIndicatedAnnual'] || null,
          profitMargin:   m['netProfitMarginAnnual'] || m['netProfitMarginTTM'] || null,
          analystTarget:  m['targetPrice']           || null,
          revenueGrowth:  m['revenueGrowthTTMYoy']  || null,
          source:         'Finnhub',
        };
      }
    } catch (err) {
      errors.push(`Finnhub: ${err.message}`);
    }
  }

  /* ── 2. Candles — fresh snapshot → Twelve Data → stale snapshot → Finnhub ── */

  // 2a. Snapshot blob, only if recent enough to render without a right-edge gap.
  let staleBundle = null;
  try {
    const bundle = await getCandleBundle(symbol);
    if (bundle && Array.isArray(bundle.daily) && bundle.daily.length) {
      const lastRow = bundle.daily[bundle.daily.length - 1];
      const asOf    = bundle.updated || (lastRow && lastRow[0]) || null;
      if (asOf && weekdaysSince(asOf) <= STALE_TRADING_DAYS) {
        result.candles      = mapSnapshotDaily(bundle.daily);
        result.candleSource = 'snapshot';
        result.candleAsOf   = asOf;
      } else {
        staleBundle = { daily: bundle.daily, asOf };
      }
    }
  } catch (err) {
    errors.push(`Snapshot: ${err.message}`);
  }

  // 2b. Twelve Data on demand (off-universe symbols, or a stale stored bundle)
  if (!result.candles && process.env.TWELVE_DATA_KEY) {
    try {
      const td = await fetchJSON(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
        `&interval=1day&outputsize=120&apikey=${process.env.TWELVE_DATA_KEY}`
      );
      if (td?.status === 'ok' && Array.isArray(td.values) && td.values.length) {
        const rows = td.values.slice().reverse();
        result.candles = rows.map((v) => ({
          time:   Math.floor(Date.parse(v.datetime + 'T00:00:00Z') / 1000),
          open:   +v.open,
          high:   +v.high,
          low:    +v.low,
          close:  +v.close,
          volume: v.volume != null ? +v.volume : 0,
        }));
        result.candleSource = 'twelvedata';
        result.candleAsOf   = rows[rows.length - 1].datetime;
      } else if (td?.message) {
        errors.push(`TwelveData: ${String(td.message).slice(0, 120)}`);
      }
    } catch (err) {
      errors.push(`TwelveData: ${err.message}`);
    }
  }

  // 2c. Stale snapshot — held back above, better than an empty chart.
  if (!result.candles && staleBundle) {
    result.candles      = mapSnapshotDaily(staleBundle.daily);
    result.candleSource = 'snapshot-stale';
    result.candleAsOf   = staleBundle.asOf;
  }

  // 2d. Finnhub candle — legacy last resort (paid tier; usually 403 on free)
  if (!result.candles && finnhubKey) {
    try {
      const to   = Math.floor(Date.now() / 1000);
      const from = to - 45 * 24 * 3600; // 45 calendar days → ~30 trading days
      const candleRes = await fetchJSON(
        `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}` +
        `&resolution=D&from=${from}&to=${to}&token=${finnhubKey}`
      );
      if (candleRes?.s === 'ok' && candleRes.t?.length) {
        result.candles = candleRes.t.map((t, i) => ({
          time:  t,
          open:  candleRes.o[i],
          high:  candleRes.h[i],
          low:   candleRes.l[i],
          close: candleRes.c[i],
          volume:candleRes.v[i],
        }));
        result.candleSource = 'finnhub';
        const lastT = candleRes.t[candleRes.t.length - 1];
        result.candleAsOf = new Date(lastT * 1000).toISOString().slice(0, 10);
      }
    } catch (err) {
      errors.push(`Finnhub candles: ${err.message}`);
    }
  }

  /* ── 3. Alpha Vantage fallback for fundamentals ── */
  if (avKey && !result.fundamentals) {
    try {
      const ov = await fetchJSON(
        `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${avKey}`
      );
      if (!ov?.Symbol) {
        errors.push(`fundamentals fallback: ${ov?.Note || ov?.Information || 'symbol not found'}`);
      }
      if (ov?.Symbol && !ov.Note && !ov.Information) {
        result.fundamentals = {
          marketCap:     ov.MarketCapitalization ? +ov.MarketCapitalization : null,
          pe:            ov.PERatio   !== 'None' ? +ov.PERatio   : null,
          eps:           ov.EPS       !== 'None' ? +ov.EPS       : null,
          high52:        ov['52WeekHigh'] !== 'None' ? +ov['52WeekHigh'] : null,
          low52:         ov['52WeekLow']  !== 'None' ? +ov['52WeekLow']  : null,
          beta:          ov.Beta      !== 'None' ? +ov.Beta      : null,
          dividendYield: ov.DividendYield !== 'None' ? +ov.DividendYield : null,
          profitMargin:  ov.ProfitMargin  !== 'None' ? +ov.ProfitMargin  : null,
          analystTarget: ov.AnalystTargetPrice !== 'None' ? +ov.AnalystTargetPrice : null,
          revenueGrowth: null,
          name:          ov.Name || null,
          sector:        ov.Sector || null,
          industry:      ov.Industry || null,
          description:   ov.Description ? ov.Description.slice(0, 280) : null,
          source:        'Alpha Vantage',
        };
      }
    } catch (err) {
      errors.push(`Alpha Vantage: ${err.message}`);
    }
  }

  /* ── 4. Alpha Vantage quote fallback ── */
  if (avKey && !result.quote) {
    try {
      const gq = await fetchJSON(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${avKey}`
      );
      const q = gq?.['Global Quote'];
      if (!q?.['05. price']) {
        errors.push(`quote fallback: ${gq?.Note || gq?.Information || 'symbol not found'}`);
      }
      if (q?.['05. price']) {
        const price = +q['05. price'];
        const prev  = +(q['08. previous close'] || price);
        result.quote = {
          price,
          change:        +(q['09. change']        || 0),
          percentChange: +(q['10. change percent']?.replace('%','') || 0),
          high:          +(q['03. high']  || 0) || null,
          low:           +(q['04. low']   || 0) || null,
          open:          +(q['02. open']  || 0) || null,
          prevClose:     prev,
          isEstimated:   false,
          source:        'Alpha Vantage',
        };
      }
    } catch (err) {
      errors.push(`AV quote: ${err.message}`);
    }
  }

  if (!result.quote && !result.fundamentals) {
    /* errors[] carries the per-provider reason. It is returned so the client can
       show something better than a generic failure, and so this branch is never
       again indistinguishable from a code fault. */
    return res.status(502).json({
      error: 'Market data temporarily unavailable for ' + symbol,
      symbol, errors,
    });
  }

  // Only cache successful responses
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  return res.status(200).json({ ...result, errors: errors.length ? errors : undefined });
};

/* ── helpers ── */

/* Fetch + parse JSON with a hard timeout.
   RESTORED Aug 2026: this helper was dropped during the Stage 1 rewrite while
   all six call sites remained. Every provider call threw
   `ReferenceError: fetchJSON is not defined`, each was swallowed by its own
   try/catch, and the handler fell through to the 502 "All data sources failed"
   branch — so quotes, fundamentals AND candles returned empty for every symbol
   while nothing appeared in runtime error reporting. The undeclared-identifier
   gate now runs against api/*.js to make this class impossible to ship again. */
async function fetchJSON(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError') throw new Error('Timeout');
    throw err;
  }
}

/* Snapshot stores compact rows: [date, open, high, low, close] */
function mapSnapshotDaily(daily) {
  return daily.map((row) => ({
    time:   Math.floor(Date.parse(row[0] + 'T00:00:00Z') / 1000),
    open:   row[1],
    high:   row[2],
    low:    row[3],
    close:  row[4],
    volume: 0, // snapshot stores OHLC only; chart skips volume bars at 0
  }));
}

/* Weekday sessions between an ISO date and today, exclusive of the start.
   Sat/Sun are skipped; market holidays are not modelled, so this slightly
   overstates staleness and errs toward re-fetching. */
function weekdaysSince(isoDate) {
  const then = Date.parse(isoDate + 'T00:00:00Z');
  if (Number.isNaN(then)) return Infinity;

  const DAY = 86400000;
  const todayUTC = Math.floor(Date.now() / DAY) * DAY;
  const startUTC = Math.floor(then / DAY) * DAY;
  if (todayUTC <= startUTC) return 0;

  let count = 0;
  for (let t = startUTC + DAY; t <= todayUTC; t += DAY) {
    const dow = new Date(t).getUTCDay(); // 0 Sun … 6 Sat
    if (dow !== 0 && dow !== 6) count++;
    if (count > 400) break; // guard against a malformed far-past date
  }
  return count;
}

async function readJsonBlob(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
