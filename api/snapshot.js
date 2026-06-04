/**
 * /api/snapshot.js — DELAX GEO-RISK — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────────────────
 * MERGED endpoint (Hobby plan caps a deployment at 12 functions, so the daily
 * candle refresh and the read path live in ONE function, dispatched by request):
 *
 *   • Authenticated call  (Authorization: Bearer ${CRON_SECRET})
 *       → runs the DAILY CANDLE REFRESH. This is what the Vercel cron hits, and
 *         what you call manually to seed. Rotates ≤20 Alpha Vantage symbols/run
 *         (under the 25/day cap), advancing a cursor stored in the snapshot, and
 *         writes snapshot/candles.json to Vercel Blob.
 *
 *   • Normal visitor GET  (no/!matching bearer)
 *       → SERVES the snapshot: candles as-is, plus quotes with stale-while-
 *         revalidate (refresh from Finnhub only when older than 5 min; first
 *         visitor in the window pays one fetch, everyone else gets cache/CDN).
 *
 * SETUP
 *   Upload package.json (declares @vercel/blob). Connect a Blob store → injects
 *   BLOB_READ_WRITE_TOKEN. ENV also needs: ALPHA_VANTAGE_KEY, FINNHUB_API_KEY,
 *   CRON_SECRET (auto-set by Vercel once a cron exists).
 *   vercel.json cron → { "path": "/api/snapshot", "schedule": "0 9 * * *" }
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
const QUOTE_TTL_MS = 5 * 60 * 1000;   // 5-minute quote freshness window
const MAX_PER_RUN  = 20;              // headroom under Alpha Vantage's 25/day cap

const AV = (sym) =>
  `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
  `&symbol=${encodeURIComponent(sym)}&outputsize=full&apikey=${process.env.ALPHA_VANTAGE_KEY}`;
const FINNHUB = (sym) =>
  `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_API_KEY}`;

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

  let snap = { meta: { cursor: 0, lastRun: null }, candles: {} };
  try {
    const existing = await readJsonBlob(CANDLES_PATH);
    if (existing && existing.candles) snap = existing;
  } catch (_) { /* first run — start fresh */ }

  const start = snap.meta.cursor % UNIVERSE.length;
  const batch = [];
  for (let i = 0; i < MAX_PER_RUN; i++) batch.push(UNIVERSE[(start + i) % UNIVERSE.length]);

  const results = { ok: [], failed: [] };
  for (const sym of batch) {
    try {
      const r = await fetch(AV(sym));
      const j = await r.json();
      const series = j['Time Series (Daily)'];
      if (!series) { results.failed.push({ sym, reason: j.Note || j.Information || 'no_data' }); continue; }
      snap.candles[sym] = compress(series);
      results.ok.push(sym);
    } catch (err) {
      results.failed.push({ sym, reason: String(err).slice(0, 120) });
    }
  }

  snap.meta.cursor   = (start + MAX_PER_RUN) % UNIVERSE.length;
  snap.meta.lastRun  = new Date().toISOString();
  snap.meta.universe = UNIVERSE.length;

  await put(CANDLES_PATH, JSON.stringify(snap), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true,
  });

  return res.status(200).json({
    mode: 'refresh', refreshed: results.ok, failed: results.failed,
    nextCursor: snap.meta.cursor, at: snap.meta.lastRun,
  });
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

/* Compress an AV daily series: last 120 daily OHLC (candlesticks ≤1Y) + all
   weekly closes (line charts >1Y). Keeps each ticker small. */
function compress(series) {
  const dates = Object.keys(series).sort();
  const daily = dates.slice(-120).map((d) => {
    const o = series[d];
    return [d, +o['1. open'], +o['2. high'], +o['3. low'], +o['4. close']];
  });
  const weekly = [];
  let lastWeek = -1;
  for (const d of dates) {
    const wk = weekOf(d);
    if (wk !== lastWeek) { weekly.push([d, +series[d]['4. close']]); lastWeek = wk; }
  }
  return { daily, weekly, updated: dates[dates.length - 1] };
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
