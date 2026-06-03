/**
 * /api/cron-snapshot.js — DELAX GEO-RISK — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────────────────
 * DAILY cron. Refreshes the candle snapshot for the risk-structure universe.
 *
 * WHY THIS SHAPE
 *   • Vercel Hobby cron = once/day max, fires anytime within the scheduled hour.
 *   • Alpha Vantage free = 25 calls/day. Universe (~37) > 25, so we ROTATE:
 *     each run fetches a batch of ≤ MAX_PER_RUN, advancing a cursor stored in the
 *     snapshot. The whole universe refreshes every ~2 days. Candles barely move
 *     day-to-day for a multi-year view, so the staleness is invisible.
 *   • Writes ONE Blob: snapshot/candles.json. Read by /api/snapshot.js.
 *
 * SETUP
 *   npm i @vercel/blob
 *   Connect a Blob store in Vercel → injects BLOB_READ_WRITE_TOKEN automatically.
 *   ENV: ALPHA_VANTAGE_KEY (confirmed name), CRON_SECRET (auto-set by Vercel).
 *   vercel.json: { "crons": [{ "path": "/api/cron-snapshot", "schedule": "0 9 * * *" }] }
 *
 * SECURITY
 *   Vercel sends `Authorization: Bearer ${CRON_SECRET}`. We verify it so the route
 *   can't be triggered by random traffic (which would burn the AV quota).
 */
'use strict';

const { put, list } = require('@vercel/blob');

// Keep this in sync with UNIVERSE in risk-structures.js. (Symbols only — sector
// tags live in the structure module; the snapshot just needs price history.)
const UNIVERSE = [
  'XLE','XOM','CVX','SHEL','KSA','ITA','RTX','LMT','NOC','BAESY',
  'FRO','STNG','TNK','LNG','FANG','GLD','GDX','NEM','JETS','DAL',
  'UAL','LVMUY','EEM','EWZ','EMB','FLR','ACM','PWR','CAT','VMC',
  'SPY','QQQ','DBC','GSG',
];

const CANDLES_PATH = 'snapshot/candles.json';
const MAX_PER_RUN  = 20;            // headroom under the 25/day AV cap
const AV = (sym) =>
  `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
  `&symbol=${encodeURIComponent(sym)}&outputsize=full&apikey=${process.env.ALPHA_VANTAGE_KEY}`;

module.exports = async function handler(req, res) {
  // ── Auth: only Vercel Cron (or someone with the secret) may run this ──
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (secret && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.ALPHA_VANTAGE_KEY) {
    return res.status(500).json({ error: 'ALPHA_VANTAGE_KEY not configured' });
  }

  // ── Load existing snapshot (for the rotation cursor + to merge new bars) ──
  let snap = { meta: { cursor: 0, lastRun: null }, candles: {} };
  try {
    const existing = await readJsonBlob(CANDLES_PATH);
    if (existing && existing.candles) snap = existing;
  } catch (_) { /* first run — start fresh */ }

  // ── Pick this run's batch via the rotating cursor ──
  const start = snap.meta.cursor % UNIVERSE.length;
  const batch = [];
  for (let i = 0; i < MAX_PER_RUN; i++) batch.push(UNIVERSE[(start + i) % UNIVERSE.length]);

  const results = { ok: [], failed: [] };
  for (const sym of batch) {
    try {
      const r = await fetch(AV(sym));
      const j = await r.json();
      const series = j['Time Series (Daily)'];
      if (!series) {
        // AV throttle note or empty — record and continue (don't kill the batch)
        results.failed.push({ sym, reason: j.Note || j.Information || 'no_data' });
        continue;
      }
      snap.candles[sym] = compress(series);
      results.ok.push(sym);
    } catch (err) {
      results.failed.push({ sym, reason: String(err).slice(0, 120) });
    }
  }

  // ── Advance cursor + stamp + persist ──
  snap.meta.cursor  = (start + MAX_PER_RUN) % UNIVERSE.length;
  snap.meta.lastRun = new Date().toISOString();
  snap.meta.universe = UNIVERSE.length;

  await put(CANDLES_PATH, JSON.stringify(snap), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true,
  });

  return res.status(200).json({
    refreshed: results.ok, failed: results.failed,
    nextCursor: snap.meta.cursor, at: snap.meta.lastRun,
  });
};

/* Compress an AV daily series into a compact dual-resolution shape:
   - daily:  last 120 trading days as [date,o,h,l,c]  → candlesticks (≤1Y view)
   - weekly: all Fridays' closes as [date,c]          → line charts (>1Y view)
   Keeps each ticker small while serving both of Batch B's chart modes. */
function compress(series) {
  const dates = Object.keys(series).sort();           // ascending
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

/* Read a JSON Blob by stable pathname (list → fetch its public URL). */
async function readJsonBlob(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
