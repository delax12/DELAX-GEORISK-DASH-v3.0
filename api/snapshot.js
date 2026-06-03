/**
 * /api/snapshot.js — DELAX GEO-RISK — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────────────────
 * The SINGLE read endpoint the frontend calls. Returns { meta, quotes, candles }.
 *
 *   candles → written daily by /api/cron-snapshot.js (Alpha Vantage). Read as-is.
 *   quotes  → STALE-WHILE-REVALIDATE: if the quotes Blob is older than QUOTE_TTL,
 *             refresh from Finnhub once and write back; otherwise serve cache.
 *             No cron needed — the first visitor in each 5-min window pays one
 *             refresh, everyone else gets it from cache / CDN. Scales with TIME,
 *             not traffic.
 *
 * CDN: s-maxage=300 + stale-while-revalidate means Vercel's edge serves most reads
 *      without even invoking this function.
 *
 * ENV: FINNHUB_API_KEY, BLOB_READ_WRITE_TOKEN (auto-injected when Blob store connected).
 */
'use strict';

const { put, list } = require('@vercel/blob');

const UNIVERSE = [
  'XLE','XOM','CVX','SHEL','KSA','ITA','RTX','LMT','NOC','BAESY',
  'FRO','STNG','TNK','LNG','FANG','GLD','GDX','NEM','JETS','DAL',
  'UAL','LVMUY','EEM','EWZ','EMB','FLR','ACM','PWR','CAT','VMC',
  'SPY','QQQ','DBC','GSG',
];

const CANDLES_PATH = 'snapshot/candles.json';
const QUOTES_PATH  = 'snapshot/quotes.json';
const QUOTE_TTL_MS = 5 * 60 * 1000;   // 5-minute freshness window
const FINNHUB = (sym) =>
  `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_API_KEY}`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Edge cache: serve from CDN for 5 min, then allow stale while refreshing.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  // ── Candles (read straight from the daily snapshot) ──
  let candles = {};
  let candleMeta = null;
  try {
    const c = await readJsonBlob(CANDLES_PATH);
    if (c) { candles = c.candles || {}; candleMeta = c.meta || null; }
  } catch (_) { /* snapshot not written yet — return empty candles */ }

  // ── Quotes (stale-while-revalidate) ──
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
    } catch (_) { /* keep serving the previous (stale) quotes on failure */ }
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
};

/* Fetch live quotes for the whole universe from Finnhub.
   Finnhub free ≈ 60 calls/min — a 34-symbol sweep fits in one window, and this
   only runs once per 5-min window regardless of traffic.
   After-hours guard: c===0 → fall back to pc (prevClose). */
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
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) quotes[s.value[0]] = s.value[1];
  }
  return { at: new Date().toISOString(), quotes };
}

async function readJsonBlob(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
