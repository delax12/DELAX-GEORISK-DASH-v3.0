/**
 * /api/snapshot.js — DELAX GEO-RISK — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────────────────
 * MERGED endpoint (Hobby plan caps a deployment at 12 functions, so the daily
 * candle refresh and the read path live in ONE function, dispatched by request):
 *
 *   • Authenticated call  (Authorization: Bearer ${CRON_SECRET})
 *       → runs the CANDLE REFRESH (cron hits this; manual curl seeds it).
 *         Rotates ≤8 symbols/run, advancing a cursor stored in the snapshot,
 *         writing snapshot/candles.json to Vercel Blob.
 *
 *   • Normal visitor GET  (no/!matching bearer)
 *       → SERVES the snapshot: candles as-is, plus quotes with stale-while-
 *         revalidate (refresh from Finnhub only when older than 5 min).
 *
 * v3 (Jul 2026) — PRIMARY PROVIDER: TWELVE DATA
 *   Free tier: 800 credits/day, 8 credits/min, 1 credit per time_series call,
 *   30+ years of daily history. ONE call per symbol returns enough daily
 *   history to build both chart series locally:
 *     - daily:  last 120 daily OHLC rows   (candlesticks, short-range)
 *     - weekly: last ~320 weekly closes    (line charts, 1Y/5Y), derived
 *   The 8/min rate limit is why MAX_PER_RUN is 8 — one run stays inside a
 *   single credit window. SEEDING: run the authenticated curl once, wait
 *   ~70 seconds, repeat — 5 runs fills all 34 tickers.
 *
 *   FALLBACK: Alpha Vantage (compact daily + weekly endpoints, both free,
 *   paced 1.1s for AV's 1-req/sec limit) — used only when Twelve Data
 *   reports a symbol unavailable on the current plan.
 *
 *   If Twelve Data returns 429 (credit window exhausted), the run stops,
 *   saves what completed, and does NOT advance the cursor past the aborted
 *   symbol — the next run picks up exactly there. Same for the wall-clock
 *   budget guard (60s function ceiling).
 *
 * ENV: TWELVE_DATA_KEY, ALPHA_VANTAGE_KEY (fallback), FINNHUB_API_KEY,
 *      CRON_SECRET, Blob store connected.
 * vercel.json cron → { "path": "/api/snapshot", "schedule": "5 5 * * *" }
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

const MAX_PER_RUN    = 8;     // Twelve Data free tier: 8 credits/minute
const TD_PACE_MS     = 1000;  // gentle spacing between TD calls
const AV_PACE_MS     = 1100;  // AV free tier: ~1 request/second
const TIME_BUDGET_MS = 45000; // stop starting new symbols near the 60s cap
const DAILY_KEEP     = 120;   // daily OHLC rows kept per ticker
const WEEKLY_KEEP    = 320;   // ≈6 years of weekly closes per ticker
const TD_OUTPUTSIZE  = 1700;  // trading days ≈ 6.7y — covers both series

const TD_DAILY = (sym) =>
  `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}` +
  `&interval=1day&outputsize=${TD_OUTPUTSIZE}&apikey=${process.env.TWELVE_DATA_KEY}`;
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

  return isRefresh ? runCandleRefresh(res) : serveSnapshot(req, res);
};

/* ── REFRESH PATH (authenticated): rotate candles into Blob ── */
async function runCandleRefresh(res) {
  if (!process.env.TWELVE_DATA_KEY) {
    return res.status(500).json({ error: 'TWELVE_DATA_KEY not configured' });
  }
  const t0 = Date.now();

  let snap = { meta: { cursor: 0, lastRun: null }, candles: {} };
  try {
    const existing = await readJsonBlob(CANDLES_PATH);
    if (existing && existing.candles) snap = existing;
  } catch (_) { /* first run — start fresh */ }

  const start   = snap.meta.cursor % UNIVERSE.length;
  const results = { ok: [], fallback: [], failed: [] };
  let processed = 0;         // symbols COMPLETED (ok or definitively failed)
  let stopReason = null;     // 'rate_limit' | 'time_budget' | null

  for (let i = 0; i < MAX_PER_RUN; i++) {
    if (Date.now() - t0 > TIME_BUDGET_MS) { stopReason = 'time_budget'; break; }

    const sym = UNIVERSE[(start + i) % UNIVERSE.length];
    try {
      if (i > 0) await sleep(TD_PACE_MS);
      const r = await fetch(TD_DAILY(sym));
      const j = await r.json();

      if (j.status === 'ok' && Array.isArray(j.values) && j.values.length) {
        snap.candles[sym] = compressTwelveData(j.values);
        results.ok.push(sym);
        processed = i + 1;
        continue;
      }

      // Twelve Data error paths
      const code = j.code || r.status;
      if (code === 429) {
        // Credit window exhausted — stop WITHOUT advancing past this symbol;
        // the next run (≥1 min later) resumes exactly here.
        stopReason = 'rate_limit';
        break;
      }

      // Symbol unavailable on this plan / not found → try Alpha Vantage
      const fb = await fetchFromAlphaVantage(sym);
      if (fb) {
        snap.candles[sym] = fb;
        results.fallback.push(sym);
      } else {
        results.failed.push({ sym, reason: String(j.message || `TD code ${code}`).slice(0, 160) });
      }
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
    viaFallback: results.fallback,
    failed: results.failed,
    attempted: processed,
    stopReason,
    nextCursor: snap.meta.cursor,
    seeded: Object.keys(snap.candles).length,
    universe: UNIVERSE.length,
    elapsedMs: Date.now() - t0,
    at: snap.meta.lastRun,
  });
}

/* Alpha Vantage fallback: compact daily (~100 days) + weekly (multi-year),
   paced for AV's 1-req/sec free tier. Returns a candle bundle or null. */
async function fetchFromAlphaVantage(sym) {
  if (!process.env.ALPHA_VANTAGE_KEY) return null;
  try {
    await sleep(AV_PACE_MS);
    const d = await (await fetch(AV_DAILY(sym))).json();
    await sleep(AV_PACE_MS);
    const w = await (await fetch(AV_WEEKLY(sym))).json();

    const dSeries = d['Time Series (Daily)'];
    const wSeries = w['Weekly Time Series'];
    if (!dSeries && !wSeries) return null;

    const out = { daily: [], weekly: [], updated: null };
    if (dSeries) {
      const dates = Object.keys(dSeries).sort();
      out.daily = dates.slice(-DAILY_KEEP).map((dt) => {
        const o = dSeries[dt];
        return [dt, +o['1. open'], +o['2. high'], +o['3. low'], +o['4. close']];
      });
      out.updated = dates[dates.length - 1];
    }
    if (wSeries) {
      const wDates = Object.keys(wSeries).sort();
      out.weekly = wDates.slice(-WEEKLY_KEEP).map((dt) => [dt, +wSeries[dt]['4. close']]);
      if (!out.updated) out.updated = wDates[wDates.length - 1];
    }
    return out;
  } catch (_) {
    return null;
  }
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

/* Build a ticker's chart bundle from ONE Twelve Data daily series.
   TD returns values newest-first: [{datetime, open, high, low, close}, …]
   - daily:  last DAILY_KEEP rows of OHLC (candlesticks, short-range)
   - weekly: last close of each ISO week, last WEEKLY_KEEP weeks (1Y/5Y lines) */
function compressTwelveData(values) {
  // Oldest-first for consistent processing
  const rows = values.slice().reverse();

  const daily = rows.slice(-DAILY_KEEP).map((v) =>
    [v.datetime, +v.open, +v.high, +v.low, +v.close]);

  // Weekly closes: keep the LAST trading day of each week
  const weekly = [];
  for (const v of rows) {
    const wk = weekOf(v.datetime);
    if (weekly.length && weekly[weekly.length - 1][2] === wk) {
      weekly[weekly.length - 1] = [v.datetime, +v.close, wk]; // overwrite → last day wins
    } else {
      weekly.push([v.datetime, +v.close, wk]);
    }
  }
  const weeklyOut = weekly.slice(-WEEKLY_KEEP).map(([d, c]) => [d, c]);

  return { daily, weekly: weeklyOut, updated: rows[rows.length - 1].datetime };
}

function weekOf(iso) {
  const dt = new Date(iso + 'T00:00:00Z');
  const onejan = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return dt.getUTCFullYear() * 100 + Math.ceil(((dt - onejan) / 86400000 + onejan.getUTCDay() + 1) / 7);
}

async function readJsonBlob(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
