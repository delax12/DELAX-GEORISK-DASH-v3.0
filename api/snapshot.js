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
 * v4 (Aug 2026) — SPLIT UNIVERSES
 *   The single UNIVERSE list previously drove BOTH the candle rotation and the
 *   Finnhub quote refresh. Those two jobs have different ceilings and different
 *   consumers, so they are now separate lists:
 *
 *     QUOTE_UNIVERSE  (34) — tickers shown live in the ticker strip / watchlist.
 *                            refreshQuotes() bursts one Finnhub call per symbol
 *                            with no pacing; Finnhub's free tier allows 60/min,
 *                            so this list MUST stay well under 60. Do not grow
 *                            it without adding pacing to refreshQuotes().
 *
 *     CANDLE_UNIVERSE (66) — every ticker needing stored price history: the 34
 *                            display names plus every ticker referenced by a
 *                            risk structure's SECTOR_IMPACT map (hormuz-iran +
 *                            taiwan-strait). Portfolio VaR reads weekly closes
 *                            from here, so a covered ticker missing from this
 *                            list means VaR silently suppresses for it.
 *
 *   Rotation at MAX_PER_RUN=8, once daily, covers 66 names in ~8.25 days. That
 *   is fine for weekly closes (they only move once a week) but leaves daily OHLC
 *   up to a week stale — api/market-equity.js carries a freshness guard that
 *   falls through to on-demand Twelve Data when a bundle is >3 trading days old.
 *
 *   SEED-FIRST WORK LIST: each run fills tickers with NO stored bundle before it
 *   resumes normal rotation, so adding names to CANDLE_UNIVERSE self-seeds on
 *   the next few runs regardless of where the cursor happens to sit. A ticker
 *   that fails MAX_SEED_ATTEMPTS times is parked in meta.skipped so one dead
 *   symbol can never block the rotation forever.
 *
 * v3 (Jul 2026) — PRIMARY PROVIDER: TWELVE DATA
 *   Free tier: 800 credits/day, 8 credits/min, 1 credit per time_series call,
 *   30+ years of daily history. ONE call per symbol returns enough daily
 *   history to build both chart series locally:
 *     - daily:  last 120 daily OHLC rows   (candlesticks, short-range)
 *     - weekly: last ~320 weekly closes    (line charts, 1Y/5Y + VaR), derived
 *   The 8/min rate limit is why MAX_PER_RUN is 8 — one run stays inside a
 *   single credit window. SEEDING: run the authenticated curl once, wait
 *   ~70 seconds, repeat.
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
 * READ-PATH FILTERS (v4, additive — unfiltered output is unchanged):
 *   GET /api/snapshot                              → everything (as before)
 *   GET /api/snapshot?symbols=NVDA,TSM,GLD         → only those candle bundles
 *   GET /api/snapshot?series=weekly                → weekly closes only
 *   GET /api/snapshot?symbols=NVDA,TSM&series=weekly
 *   Quotes are always returned in full — the map is small and several callers
 *   depend on it being complete.
 *
 * ENV: TWELVE_DATA_KEY, ALPHA_VANTAGE_KEY (fallback), FINNHUB_API_KEY,
 *      CRON_SECRET, Blob store connected.
 * vercel.json cron → { "path": "/api/snapshot", "schedule": "5 5 * * *" }
 */
'use strict';

const { put, list } = require('@vercel/blob');

/* Live-quote tickers. Finnhub free tier is 60 req/min and refreshQuotes()
   fires these unpaced — keep this list short. Mirrors UNIVERSE in
   risk-structures.js. */
const QUOTE_UNIVERSE = [
  'XLE','XOM','CVX','SHEL','KSA','ITA','RTX','LMT','NOC','BAESY',
  'FRO','STNG','TNK','LNG','FANG','GLD','GDX','NEM','JETS','DAL',
  'UAL','LVMUY','EEM','EWZ','EMB','FLR','ACM','PWR','CAT','VMC',
  'SPY','QQQ','DBC','GSG',
];

/* Tickers referenced by a risk structure's SECTOR_IMPACT map but not shown
   live in the ticker strip. Needed for portfolio impact + weekly-close VaR.
   Keep in sync with STRUCT_DATA[*].SECTOR_IMPACT in index.html / workspace.html. */
const STRUCTURE_ONLY = [
  // hormuz-iran
  'CCJ','DE','FCX','JNJ','PANW','PFE','VWO','ZIM',
  // taiwan-strait
  'AAPL','AMAT','AMD','ASML','AVGO','DELL','EWJ','EWT',
  'EWY','F','FXI','GM','INTC','LRCX','MCHI','MSFT',
  'MU','NEE','NVDA','QCOM','SMH','TM','TSM','UMC',
];

/* Every ticker with stored price history. Order matters: the already-seeded
   display names come first so cursor positions carried over from v3 stay
   meaningful. */
const CANDLE_UNIVERSE = QUOTE_UNIVERSE.concat(STRUCTURE_ONLY);

const CANDLES_PATH = 'snapshot/candles.json';
const QUOTES_PATH  = 'snapshot/quotes.json';
const QUOTE_TTL_MS = 5 * 60 * 1000; // 5-minute quote freshness window

const MAX_PER_RUN       = 8;     // Twelve Data free tier: 8 credits/minute
const TD_PACE_MS        = 1000;  // gentle spacing between TD calls
const AV_PACE_MS        = 1100;  // AV free tier: ~1 request/second
const TIME_BUDGET_MS    = 45000; // stop starting new symbols near the 60s cap
const DAILY_KEEP        = 120;   // daily OHLC rows kept per ticker
const WEEKLY_KEEP       = 320;   // ≈6 years of weekly closes per ticker
const TD_OUTPUTSIZE     = 1700;  // trading days ≈ 6.7y — covers both series
const MAX_SEED_ATTEMPTS = 3;     // park a symbol after this many seed failures
const MAX_FILTER_SYMS   = 80;    // cap on ?symbols= to bound response work

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

  let snap = { meta: { cursor: 0, lastRun: null, skipped: {} }, candles: {} };
  try {
    const existing = await readJsonBlob(CANDLES_PATH);
    if (existing && existing.candles) snap = existing;
  } catch (_) { /* first run — start fresh */ }

  if (!snap.meta)         snap.meta = { cursor: 0, lastRun: null };
  if (!snap.meta.skipped) snap.meta.skipped = {};

  /* Work list: unseeded tickers first (so names newly added to
     CANDLE_UNIVERSE fill immediately regardless of cursor position),
     otherwise resume normal rotation from the cursor. */
  const unseeded = CANDLE_UNIVERSE.filter((s) =>
    !snap.candles[s] && (snap.meta.skipped[s] || 0) < MAX_SEED_ATTEMPTS);

  const seeding = unseeded.length > 0;
  const start   = snap.meta.cursor % CANDLE_UNIVERSE.length;

  const workList = seeding
    ? unseeded.slice(0, MAX_PER_RUN)
    : Array.from({ length: MAX_PER_RUN },
        (_, i) => CANDLE_UNIVERSE[(start + i) % CANDLE_UNIVERSE.length]);

  const results = { ok: [], fallback: [], failed: [] };
  let processed = 0;         // symbols COMPLETED (ok or definitively failed)
  let stopReason = null;     // 'rate_limit' | 'time_budget' | null

  for (let i = 0; i < workList.length; i++) {
    if (Date.now() - t0 > TIME_BUDGET_MS) { stopReason = 'time_budget'; break; }

    const sym = workList[i];
    try {
      if (i > 0) await sleep(TD_PACE_MS);
      const r = await fetch(TD_DAILY(sym));
      const j = await r.json();

      if (j.status === 'ok' && Array.isArray(j.values) && j.values.length) {
        snap.candles[sym] = compressTwelveData(j.values);
        delete snap.meta.skipped[sym];
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
        delete snap.meta.skipped[sym];
        results.fallback.push(sym);
      } else {
        snap.meta.skipped[sym] = (snap.meta.skipped[sym] || 0) + 1;
        results.failed.push({
          sym,
          attempts: snap.meta.skipped[sym],
          reason: String(j.message || `TD code ${code}`).slice(0, 160),
        });
      }
      processed = i + 1;
    } catch (err) {
      snap.meta.skipped[sym] = (snap.meta.skipped[sym] || 0) + 1;
      results.failed.push({
        sym,
        attempts: snap.meta.skipped[sym],
        reason: String(err).slice(0, 120),
      });
      processed = i + 1;
    }
  }

  // Cursor only advances during normal rotation — seeding runs off its own list.
  if (!seeding) snap.meta.cursor = (start + processed) % CANDLE_UNIVERSE.length;
  snap.meta.lastRun        = new Date().toISOString();
  snap.meta.universe       = CANDLE_UNIVERSE.length;
  snap.meta.quoteUniverse  = QUOTE_UNIVERSE.length;
  snap.meta.candleUniverse = CANDLE_UNIVERSE.length;

  await put(CANDLES_PATH, JSON.stringify(snap), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true,
  });

  const parked  = Object.keys(snap.meta.skipped)
    .filter((s) => snap.meta.skipped[s] >= MAX_SEED_ATTEMPTS);
  const missing = CANDLE_UNIVERSE.filter((s) => !snap.candles[s]);

  return res.status(200).json({
    mode: seeding ? 'seed' : 'rotate',
    refreshed: results.ok,
    viaFallback: results.fallback,
    failed: results.failed,
    attempted: processed,
    stopReason,
    nextCursor: snap.meta.cursor,
    seeded: Object.keys(snap.candles).length,
    stillMissing: missing.length,
    missingSymbols: missing.slice(0, 40),
    parked,
    candleUniverse: CANDLE_UNIVERSE.length,
    quoteUniverse: QUOTE_UNIVERSE.length,
    universe: CANDLE_UNIVERSE.length,
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

  /* Optional filters. Both default to "no filter", so an unadorned GET
     returns exactly what v3 returned. */
  const wantSyms = parseSymbolFilter(req.query && req.query.symbols);
  const series   = parseSeriesFilter(req.query && req.query.series);
  if (wantSyms || series !== 'all') {
    candles = projectCandles(candles, wantSyms, series);
  }

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
      universe:        QUOTE_UNIVERSE.length,  // unchanged meaning: live quotes
      quoteUniverse:   QUOTE_UNIVERSE.length,
      candleUniverse:  CANDLE_UNIVERSE.length,
      series,
      filtered: !!wantSyms,
      servedAt: new Date().toISOString(),
    },
    quotes:  quotesDoc?.quotes || {},
    candles,
  });
}

/* ?symbols=NVDA,TSM → Set of sanitised tickers, or null when absent. */
function parseSymbolFilter(raw) {
  if (!raw) return null;
  const list = String(raw)
    .toUpperCase()
    .split(',')
    .map((s) => s.trim().replace(/[^A-Z0-9.\-^]/g, ''))
    .filter((s) => s && s.length <= 12)
    .slice(0, MAX_FILTER_SYMS);
  return list.length ? new Set(list) : null;
}

/* ?series=weekly|daily|all (anything unrecognised → all). */
function parseSeriesFilter(raw) {
  const v = String(raw || 'all').toLowerCase();
  return (v === 'weekly' || v === 'daily') ? v : 'all';
}

/* Narrow the candle map by ticker and/or series without mutating the source. */
function projectCandles(candles, wantSyms, series) {
  const out = {};
  for (const sym of Object.keys(candles)) {
    if (wantSyms && !wantSyms.has(sym)) continue;
    const b = candles[sym];
    if (!b) continue;
    if (series === 'all') { out[sym] = b; continue; }
    out[sym] = series === 'weekly'
      ? { weekly: b.weekly || [], updated: b.updated || null }
      : { daily:  b.daily  || [], updated: b.updated || null };
  }
  return out;
}

/* Live quotes from Finnhub. After-hours c===0 → fall back to pc.
   Iterates QUOTE_UNIVERSE only — these calls are unpaced and Finnhub's free
   tier allows 60/min, so this must never be pointed at CANDLE_UNIVERSE. */
async function refreshQuotes() {
  const quotes = {};
  const settled = await Promise.allSettled(
    QUOTE_UNIVERSE.map(async (sym) => {
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
   - weekly: last close of each ISO week, last WEEKLY_KEEP weeks (1Y/5Y + VaR) */
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
