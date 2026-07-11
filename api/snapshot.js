/**
 * /api/snapshot.js — DELAX GEO-RISK — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────────────────
 * MERGED endpoint (Hobby plan caps a deployment at 12 functions, so the daily
 * candle refresh and the read path live in ONE function, dispatched by request):
 *
 *   • Authenticated call  (Authorization: Bearer ${CRON_SECRET})
 *       → runs the DAILY CANDLE REFRESH. This is what the Vercel cron hits, and
 *         what you call manually to seed. Rotates ≤10 symbols/run — TWO Alpha
 *         Vantage calls per symbol (20 calls, under the 25/day cap), advancing
 *         a cursor stored in the snapshot, writing snapshot/candles.json.
 *
 *   • Normal visitor GET  (no/!matching bearer)
 *       → SERVES the snapshot: candles as-is, plus quotes with stale-while-
 *         revalidate (refresh from Finnhub only when older than 5 min).
 *
 * v2 (Jul 2026) — Alpha Vantage free-tier changes forced two fixes:
 *   1. outputsize=full on TIME_SERIES_DAILY is now premium-only.
 *      → daily candles use outputsize=compact (~100 trading days), and
 *        long-range weekly closes come from TIME_SERIES_WEEKLY (still free,
 *        still full multi-year history).
 *   2. Free tier enforces ~1 request/second.
 *      → calls are paced ~1.1s apart, with a wall-clock budget so the run
 *        always saves whatever completed before the 60s function limit.
 *
 * ENV: ALPHA_VANTAGE_KEY, FINNHUB_API_KEY, CRON_SECRET, Blob store connected.
 * vercel.json cron → { "path": "/api/snapshot", "schedule": "5 5 * * *" }
 *   (05:05 UTC = 12:05 AM EST / 1:05 AM EDT — always after the midnight-
 *    Eastern Alpha Vantage quota reset, year-round.)
 */
'use strict';

const { put, list } = require('@vercel/blob');

// Keep in sync with UNIVERSE in risk-structures.js.
const UNIVERSE = [
  'XLE','XOM','CVX','SHEL','KSA','ITA','RTX','LMT','NOC','BAESY',
  'FRO','STNG','TNK','LNG','FANG','GLD','GDX','NEM','JETS','DAL',
  'UAL','LVMUY','EEM','EWZ','EMB','FLR','ACM','PWR','CAT','VMC',
  'SPY','QQQ','DBC','GSG',
];

const CANDLES_PATH = 'snapshot/candles.json';
const QUOTES_PATH  = 'snapshot/quotes.json';
const QUOTE_TTL_MS = 5 * 60 * 1000; // 5-minute quote freshness window

const MAX_PER_RUN   = 10;    // symbols/run × 2 AV calls = 20 of 25 daily calls
const PACE_MS       = 1100;  // free tier enforces ~1 req/sec
const TIME_BUDGET_MS = 48000; // stop starting new symbols past this (60s cap)
const WEEKLY_KEEP   = 320;   // ≈6 years of weekly closes per ticker

const AV_DAILY = (sym) =>
  `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
  `&symbol=${encodeURIComponent(sym)}&outputsize=compact&apikey=${process.env.ALPHA_VANTAGE_KEY}`;
const AV_WEEKLY = (sym) =>
  `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY` +
  `&symbol=${encodeURIComponent(sym)}&apikey=${process.env.ALPHA_VANTAGE_KEY}`;
const FINNHUB = (sym) =>
  `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_API_KEY}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth   = req.headers.authorization || '';
  const isRefresh = !!secret && auth === `Bearer ${secret}`;

  // Authenticated → daily candle refresh (cron / manual seed). Else → serve.
  return isRefresh ? runCandleRefresh(res) : serveSnapshot(req, res);
};

/* ── REFRESH PATH (authenticated): rotate Alpha Vantage candles into Blob ── */
async function runCandleRefresh(res) {
  if (!process.env.ALPHA_VANTAGE_KEY) {
    return res.status(500).json({ error: 'ALPHA_VANTAGE_KEY not configured' });
  }
  const t0 = Date.now();

  let snap = { meta: { cursor: 0, lastRun: null }, candles: {} };
  try {
    const existing = await readJsonBlob(CANDLES_PATH);
    if (existing && existing.candles) snap = existing;
  } catch (_) { /* first run — start fresh */ }

  const start   = snap.meta.cursor % UNIVERSE.length;
  const results = { ok: [], failed: [] };
  let processed = 0;   // symbols attempted this run (cursor advances by this)
  let callsMade = 0;   // AV calls fired (for pacing)

  for (let i = 0; i < MAX_PER_RUN; i++) {
    // Stop starting new symbols if we're near the 60s function ceiling —
    // save what we have; the cursor only advances past completed symbols.
    if (Date.now() - t0 > TIME_BUDGET_MS) break;

    const sym = UNIVERSE[(start + i) % UNIVERSE.length];
    try {
      const daily  = await pacedAvFetch(AV_DAILY(sym),  ++callsMade);
      const weekly = await pacedAvFetch(AV_WEEKLY(sym), ++callsMade);

      const dSeries = daily['Time Series (Daily)'];
      const wSeries = weekly['Weekly Time Series'];

      if (!dSeries && !wSeries) {
        results.failed.push({
          sym,
          reason: String(daily.Note || daily.Information || weekly.Note || weekly.Information || 'no_data').slice(0, 160),
        });
        processed = i + 1;
        continue;
      }

      snap.candles[sym] = compress(dSeries, wSeries);
      results.ok.push(sym);
      processed = i + 1;
    } catch (err) {
      results.failed.push({ sym, reason: String(err).slice(0, 120) });
      processed = i + 1;
    }
  }

  snap.meta.cursor   = (start + processed) % UNIVERSE.length;
  snap.meta.lastRun  = new Date().toISOString();
  snap.meta.universe = UNIVERSE.length;

  await put(CANDLES_PATH, JSON.stringify(snap), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true,
  });

  return res.status(200).json({
    mode: 'refresh',
    refreshed: results.ok,
    failed: results.failed,
    attempted: processed,
    nextCursor: snap.meta.cursor,
    seeded: Object.keys(snap.candles).length,
    universe: UNIVERSE.length,
    elapsedMs: Date.now() - t0,
    at: snap.meta.lastRun,
  });
}

/* Fetch one AV endpoint, pacing to stay under the 1-req/sec free-tier limit.
   No pause before the very first call of the run. */
async function pacedAvFetch(url, callNumber) {
  if (callNumber > 1) await sleep(PACE_MS);
  const r = await fetch(url);
  return r.json(); // AV always returns JSON, incl. its rate-limit notes
}

/* ── READ PATH (visitors): candles + stale-while-revalidate quotes ── */
async function serveSnapshot(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  let candles = {}, candleMeta = null;
  try {
    const c = await readJsonBlob(CANDLES_PATH);
    if (c) { candles = c.candles || {}; candleMeta = c.meta || null; }
  } catch (_) { /* not seeded yet — empty candles */ }

  let quotesDoc = null;
  try { quotesDoc = await readJsonBlob(QUOTES_PATH); } catch (_) {}

  const age = quotesDoc?.at ? Date.now() - new Date(quotesDoc.at).getTime() : Infinity;
  if (age > QUOTE_TTL_MS && process.env.FINNHUB_API_KEY) {
    try {
      quotesDoc = await refreshQuotes();
      await put(QUOTES_PATH, JSON.stringify(quotesDoc), {
        access: 'public', contentType: 'application/json',
        addRandomSuffix: false, allowOverwrite: true,
      });
    } catch (_) { /* serve previous (stale) quotes on failure */ }
  }

  return res.status(200).json({
    meta: {
      candlesUpdated: candleMeta?.lastRun || null,
      quotesUpdated:  quotesDoc?.at || null,
      universe: UNIVERSE.length,
      servedAt: new Date().toISOString(),
    },
    quotes:  quotesDoc?.quotes || {},
    candles,
  });
}

/* Live quotes for the universe from Finnhub. After-hours c===0 → fall back to pc. */
async function refreshQuotes() {
  const quotes = {};
  const settled = await Promise.allSettled(
    UNIVERSE.map(async (sym) => {
      const r = await fetch(FINNHUB(sym));
      const j = await r.json();
      const price = (j.c && j.c > 0) ? j.c : (j.pc || null);
      return [sym, price == null ? null : {
        price, prevClose: j.pc ?? null,
        changePct: (j.pc ? +(((price - j.pc) / j.pc) * 100).toFixed(2) : null),
      }];
    })
  );
  for (const s of settled) if (s.status === 'fulfilled' && s.value) quotes[s.value[0]] = s.value[1];
  return { at: new Date().toISOString(), quotes };
}

/* Build a ticker's chart bundle from the two free AV endpoints:
   - daily: last ~100 trading days of OHLC from TIME_SERIES_DAILY compact
     (candlesticks, short-range views)
   - weekly: last WEEKLY_KEEP weekly closes from TIME_SERIES_WEEKLY
     (line charts, 1Y/5Y views — endpoint still returns full history free)
   Either series may be missing; whichever exists is stored. */
function compress(dSeries, wSeries) {
  const out = { daily: [], weekly: [], updated: null };

  if (dSeries) {
    const dates = Object.keys(dSeries).sort();
    out.daily = dates.slice(-120).map((d) => {
      const o = dSeries[d];
      return [d, +o['1. open'], +o['2. high'], +o['3. low'], +o['4. close']];
    });
    out.updated = dates[dates.length - 1];
  }

  if (wSeries) {
    const wDates = Object.keys(wSeries).sort();
    out.weekly = wDates.slice(-WEEKLY_KEEP).map((d) => [d, +wSeries[d]['4. close']]);
    if (!out.updated) out.updated = wDates[wDates.length - 1];
  }

  return out;
}

async function readJsonBlob(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
