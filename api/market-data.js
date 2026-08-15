/**
 * /api/market-data.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────
 * Unified market data proxy for DELAX GEO-RISK dashboard.
 * Merges Alpha Vantage (equities/forex), FRED (US macro),
 * and World Bank (GDP baselines) into a single endpoint.
 *
 * SETUP — add to Vercel Environment Variables:
 *   ALPHA_VANTAGE_KEY  → alphavantage.co  (free, instant)
 *   FRED_API_KEY       → fred.stlouisfed.org/docs/api (free)
 *   (World Bank needs no key)
 *
 * ENDPOINT:
 *   GET /api/market-data?type=equities
 *   GET /api/market-data?type=forex
 *   GET /api/market-data?type=macro
 *   GET /api/market-data?type=worldbank
 *   GET /api/market-data?type=all   ← dashboard uses this
 */
'use strict';

const { put, list } = require('@vercel/blob');
const gdelt = require('./gdelt.js'); // exports fetchTimelineVol alongside its own handler

/* ══════════════════════════════════════════════════════════════════
   PHASE 2 — DELAX GLOBAL STRAIN INDEX (DGSI)
   Two new routes on this SAME function (12-function Hobby ceiling — no new
   endpoint). Amendment A1/A2/A3 to REVAMP PLAN v6.0 govern this section:
     - Published in standard-deviation units. NEVER 0–100. NEVER "score".
     - Brent (RBRTE), not WTI — confirmedBrent() is the sanctioned path
       everywhere else on the platform; the index inherits that rule.
     - GDELT conflict-attention component is CONDITIONAL: it only joins the
       weighting if Tests A and C (below) both pass against real backfilled
       data. Test B sets level-vs-change, not go/no-go. Fail either A or C →
       the component stays off and the index ships macro-only, labelled as
       such in methodology.html.
     - Fails closed everywhere: a missing input degrades that day's reading
       to unavailable rather than silently reweighting around the gap or
       inventing a number. Same discipline as applyModelJitter's removal.
   ══════════════════════════════════════════════════════════════════ */

const DGSI_PATH = 'index/baseline.json';

/* FRED_SERIES_START — 2015 gives a decade-plus of history: enough for a
   stable mean/SD, and it spans both the 2022 Ukraine invasion and the 2026
   Hormuz war for sanity-checking the composite against known shocks. */
const FRED_SERIES_START = '2015-01-01';
const EIA_BRENT_START    = '2015-01-01';

/* GDELT gate windows — fixed, not tunable per run, so the test always means
   the same thing. Hormuz war: 28 Feb – 8 Apr 2026 (Test A, positive control).
   Baseline-drift check compares 2017–18 to 2024–25 (Test C). Ukraine decay
   (Test B) is recorded but does not gate. */
const GDELT_QUERY   = '(hormuz OR "strait of hormuz" OR iran OR "oil tanker")';
const TEST_A_WINDOW  = { start: '20260228000000', end: '20260408235959' };
const TEST_A_CONTROL = { start: '20250901000000', end: '20260131235959' }; // pre-war baseline to compare the excursion against
const TEST_B_QUERY   = '(ukraine OR "russian invasion")';
const TEST_B_WINDOW  = { start: '20220224000000', end: '20221224235959' };
const TEST_C_EARLY   = { start: '20170101000000', end: '20181231235959' };
const TEST_C_RECENT  = { start: '20240101000000', end: '20251231235959' };

async function readJsonBlobDGSI(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m) {
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}
function clipZ(z) { return Math.max(-3, Math.min(3, z)); }

/* Backfill-only FRED fetch — deliberately separate from the existing
   fetchFRED() below, which is capped at limit=10 for the dashboard's
   "latest reading" use. This one asks FRED for full history from
   FRED_SERIES_START and is only ever called from index-backfill. */
async function fetchFredHistory(key, seriesId, observationStart) {
  const url = `https://api.stlouisfed.org/fred/series/observations`
    + `?series_id=${seriesId}&api_key=${key}&file_type=json`
    + `&observation_start=${observationStart}&sort_order=asc`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED HTTP ${r.status} (${seriesId})`);
  const data = await r.json();
  if (data && data.error_code) throw new Error(data.error_message || `FRED error (${seriesId})`);
  const obs = (data && data.observations) || [];
  return obs
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }));
}

/* Backfill-only Brent history — separate from api/eia-oil.js, which returns
   only the last ~30 trading days (length=60 across two series) for the live
   ticker pill. This asks EIA for a date-bounded range directly rather than
   paginating with offset, which keeps a decade of daily Brent inside one
   request comfortably under Vercel's execution limit. */
async function fetchEiaBrentHistory(key, startDate) {
  const url = 'https://api.eia.gov/v2/petroleum/pri/spt/data/'
    + '?api_key=' + encodeURIComponent(key)
    + '&frequency=daily&data[0]=value'
    + '&facets[series][]=RBRTE'
    + '&start=' + startDate
    + '&sort[0][column]=period&sort[0][direction]=asc'
    + '&length=5000';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`EIA HTTP ${r.status} (Brent history)`);
  const json = await r.json();
  const rows = (json && json.response && json.response.data) || [];
  return rows
    .filter(r => r.series === 'RBRTE' && r.value != null)
    .map(r => ({ date: r.period, value: parseFloat(r.value) }));
}

/* fetchEiaBrentLatest — single most-recent Brent print, for the live
   ?type=index reading. Separate small call rather than reusing eia-oil.js's
   handler directly, since that is a distinct deployed function and calling
   it would mean an internal HTTP hop between two serverless invocations. */
async function fetchEiaBrentLatest(key) {
  const url = 'https://api.eia.gov/v2/petroleum/pri/spt/data/'
    + '?api_key=' + encodeURIComponent(key)
    + '&frequency=daily&data[0]=value&facets[series][]=RBRTE'
    + '&sort[0][column]=period&sort[0][direction]=desc&length=1';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`EIA HTTP ${r.status} (Brent latest)`);
  const json = await r.json();
  const row = json && json.response && json.response.data && json.response.data[0];
  if (!row || row.value == null) return null;
  return { date: row.period, value: parseFloat(row.value) };
}

/* runGdeltGate — Tests A and C, run once during backfill. Returns
   {enabled, tests} so the decision AND its evidence are both stored, not
   just the boolean — an auditable gate, not a silent switch. */
/* runGdeltGate — Tests A and C gate; Test B is recorded, never gating.
   All FIVE timelinevol calls fire in ONE Promise.allSettled batch — not
   Promise.all, and Test B is no longer a second sequential await after the
   first batch resolves. Two real problems that showed up on the first live
   run motivated this:
     1. Promise.all is all-or-nothing: one slow GDELT call nulled out every
        test, including two that had actually already succeeded.
     2. Test B running AFTER the batch doubled the worst-case serial time
        (timeout + timeout) — with the per-call timeout raised to 30s to fix
        the original abort, that pushed worst case to 60s, which the Vercel
        platform ceiling can kill outright (a raw platform timeout, worse
        than the graceful {tests:{error}} response this is supposed to
        produce). Ceiling is now stated explicitly via module.exports.config
        below rather than left to the account default. */
async function runGdeltGate() {
  const out = { enabled: false, tests: {}, evaluatedAt: new Date().toISOString() };
  const jobs = [
    gdelt.fetchTimelineVol(GDELT_QUERY, TEST_A_WINDOW.start, TEST_A_WINDOW.end),
    gdelt.fetchTimelineVol(GDELT_QUERY, TEST_A_CONTROL.start, TEST_A_CONTROL.end),
    gdelt.fetchTimelineVol(GDELT_QUERY, TEST_C_EARLY.start, TEST_C_EARLY.end),
    gdelt.fetchTimelineVol(GDELT_QUERY, TEST_C_RECENT.start, TEST_C_RECENT.end),
    gdelt.fetchTimelineVol(TEST_B_QUERY, TEST_B_WINDOW.start, TEST_B_WINDOW.end),
  ];
  const settled = await Promise.allSettled(jobs);
  const val = i => (settled[i].status === 'fulfilled' ? settled[i].value : null);
  const [warWindow, warControl, early, recent, ukraine] = [val(0), val(1), val(2), val(3), val(4)];
  const failure = i => settled[i].status === 'rejected' ? settled[i].reason.message : 'unparseable response shape';

  if (warWindow && warControl) {
    const warMean     = mean(warWindow.map(p => p.value));
    const controlMean = mean(warControl.map(p => p.value));
    const testA = { warMean, controlMean, ratio: warMean / (controlMean || 1e-9) };
    // Positive control: coverage during the war should be a CLEAR multiple
    // of the pre-war baseline, not a marginal bump.
    testA.pass = testA.ratio >= 1.5;
    out.tests.A = testA;
  } else {
    out.tests.A = { error: !warWindow ? failure(0) : failure(1) };
  }

  if (early && recent) {
    const earlyMean  = mean(early.map(p => p.value));
    const recentMean = mean(recent.map(p => p.value));
    const testC = { earlyMean, recentMean, drift: Math.abs(recentMean - earlyMean) / (earlyMean || 1e-9) };
    // Drift check: if the 2017–18 and 2024–25 baselines have wandered apart
    // by more than 15%, timelinevol's normalization is not doing its job and
    // the corpus-growth trap is back.
    testC.pass = testC.drift <= 0.15;
    out.tests.C = testC;
  } else {
    out.tests.C = { error: !early ? failure(2) : failure(3) };
  }

  // Test B recorded, never gating — sets level-vs-change for the UI, not a
  // pass/fail condition. Failing to fetch it does not block A or C.
  if (ukraine && ukraine.length) {
    const peak = Math.max(...ukraine.map(p => p.value));
    const last = ukraine[ukraine.length - 1].value;
    out.tests.B = { peak, endOfWindow: last, decayRatio: last / (peak || 1e-9) };
  } else {
    out.tests.B = { error: failure(4) };
  }

  out.enabled = !!(out.tests.A && out.tests.A.pass && out.tests.C && out.tests.C.pass);
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || 'all';

  /* ── type=index-backfill ── Bearer CRON_SECRET only. Expensive, rare-run:
     pulls years of history, computes baseline mean/SD, runs the GDELT gate,
     writes ONE blob that every ?type=index request then reads cheaply.
     Mirrors the CRON_SECRET pattern already used by api/snapshot.js. */
  if (type === 'index-backfill') {
    const auth = req.headers.authorization || '';
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'index-backfill requires Authorization: Bearer $CRON_SECRET' });
    }
    const fredKey = process.env.FRED_API_KEY;
    const eiaKey  = process.env.EIA_API_KEY;
    if (!fredKey || !eiaKey) {
      return res.status(500).json({ error: 'FRED_API_KEY and EIA_API_KEY are both required for backfill' });
    }
    try {
      const [cpi, food, gas, brent, gdeltGate] = await Promise.all([
        fetchFredHistory(fredKey, 'CPIAUCSL',    FRED_SERIES_START),
        fetchFredHistory(fredKey, 'PFOODINDEXM', FRED_SERIES_START),
        fetchFredHistory(fredKey, 'DHHNGSP',     FRED_SERIES_START),
        fetchEiaBrentHistory(eiaKey, EIA_BRENT_START),
        runGdeltGate(),
      ]);
      const series = { CPIAUCSL: cpi, PFOODINDEXM: food, DHHNGSP: gas, RBRTE: brent };
      const stats = {};
      for (const [id, rows] of Object.entries(series)) {
        if (!rows || rows.length < 10) {
          return res.status(502).json({ error: `insufficient history for ${id} (${rows ? rows.length : 0} points)` });
        }
        const values = rows.map(r => r.value);
        const m = mean(values);
        stats[id] = { mean: m, sd: stdev(values, m), n: values.length,
          from: rows[0].date, to: rows[rows.length - 1].date };
      }
      const baseline = {
        computedAt: new Date().toISOString(),
        seriesStart: FRED_SERIES_START,
        stats,
        gdelt: gdeltGate,
      };
      await put(DGSI_PATH, JSON.stringify(baseline), {
        access: 'public', contentType: 'application/json',
        addRandomSuffix: false, allowOverwrite: true,
      });
      return res.status(200).json({ ok: true, baseline });
    } catch (err) {
      return res.status(502).json({ error: 'backfill failed', detail: err.message });
    }
  }

  /* ── type=index ── Public GET. Cheap: reads the cached baseline from Blob,
     fetches TODAY's four values fresh, z-scores and weights. Never
     recomputes the backfill itself — that only happens in index-backfill. */
  if (type === 'index') {
    const baseline = await readJsonBlobDGSI(DGSI_PATH);
    if (!baseline) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json({ available: false, reason: 'baseline not yet computed — run index-backfill' });
    }
    const fredKey = process.env.FRED_API_KEY;
    const eiaKey  = process.env.EIA_API_KEY;
    if (!fredKey || !eiaKey) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ available: false, reason: 'FRED_API_KEY or EIA_API_KEY not set' });
    }
    try {
      const [cpiRes, foodRes, gasRes, brentRes] = await Promise.all([
        fetchFRED(fredKey, 'CPIAUCSL'),
        fetchFRED(fredKey, 'PFOODINDEXM'),
        fetchFRED(fredKey, 'DHHNGSP'),
        fetchEiaBrentLatest(eiaKey),
      ]);
      const latest = id => {
        const obs = ((id === 'CPIAUCSL' ? cpiRes : id === 'PFOODINDEXM' ? foodRes : gasRes) || {}).observations;
        const v = obs && obs.filter(o => o.value !== '.').slice(-1)[0];
        return v ? { date: v.date, value: parseFloat(v.value) } : null;
      };
      const today = {
        CPIAUCSL:    latest('CPIAUCSL'),
        PFOODINDEXM: latest('PFOODINDEXM'),
        DHHNGSP:     latest('DHHNGSP'),
        RBRTE:       brentRes,
      };
      // FAIL CLOSED: any missing input means no reading today. No silent
      // reweighting around the gap, no fabricated fill-in value.
      const missing = Object.entries(today).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ available: false, reason: `missing today's value for: ${missing.join(', ')}` });
      }
      const zscores = {};
      for (const id of Object.keys(today)) {
        const s = baseline.stats[id];
        zscores[id] = s ? clipZ((today[id].value - s.mean) / (s.sd || 1e-9)) : null;
      }
      const gdeltOn = !!(baseline.gdelt && baseline.gdelt.enabled);
      // Weights: equal-weight the four macro/energy inputs. If GDELT is
      // enabled, it takes HALF a normal slot (deliberately down-weighted —
      // it is the noisiest input on the board, per REVAMP PLAN v6.0 §5
      // Phase 2). Computed, not hand-tuned to round numbers, so
      // methodology.html always matches what actually ran.
      const macroIds = ['RBRTE', 'CPIAUCSL', 'PFOODINDEXM', 'DHHNGSP'];
      const shares = gdeltOn ? macroIds.length + 0.5 : macroIds.length;
      const weights = {};
      macroIds.forEach(id => { weights[id] = 1 / shares; });
      let gdeltZ = null;
      if (gdeltOn) {
        // Conflict-attention component: today's timelinevol reading is a
        // live-window fetch, not part of the four-input Promise.all above,
        // since it is conditional and shares no code path with the FRED/EIA
        // fetches. Kept out of `missing` fail-closed logic on purpose: if
        // GDELT alone is unreachable today, the index still prints on its
        // macro components rather than going dark for a component that is
        // explicitly optional.
        try {
          const nowISO = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
          const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
          const pts = await gdelt.fetchTimelineVol(GDELT_QUERY, weekAgo, nowISO);
          if (pts && pts.length) {
            const todayVal = pts[pts.length - 1].value;
            const s = baseline.gdelt.stats; // computed at backfill time if present
            if (s) gdeltZ = clipZ((todayVal - s.mean) / (s.sd || 1e-9));
          }
        } catch (e) { /* GDELT optional — silently absent today, weights.gdelt still published */ }
        weights.GDELT = 0.5 / shares;
      }

      const components = macroIds.map(id => ({
        id, weight: weights[id], z: zscores[id], contribution: weights[id] * zscores[id],
      }));
      let dgsi = components.reduce((a, c) => a + c.contribution, 0);
      if (gdeltOn && gdeltZ !== null) {
        const c = { id: 'GDELT', weight: weights.GDELT, z: gdeltZ, contribution: weights.GDELT * gdeltZ };
        components.push(c);
        dgsi += c.contribution;
      }

      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
      return res.status(200).json({
        available: true,
        value: parseFloat(dgsi.toFixed(2)),
        unit: 'sd',
        asOf: today.RBRTE.date,
        gdeltEnabled: gdeltOn,
        components,
        baselineComputedAt: baseline.computedAt,
      });
    } catch (err) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ available: false, reason: err.message });
    }
  }

  const avKey   = process.env.ALPHA_VANTAGE_KEY;
  const fredKey = process.env.FRED_API_KEY;

  const results = {};
  const errors  = {};

  // Decide what to fetch
  const fetchEquities  = type === 'all' || type === 'equities';
  const fetchForex     = type === 'all' || type === 'forex';
  const fetchMacro     = type === 'all' || type === 'macro';
  const fetchWorldBank = type === 'all' || type === 'worldbank';

  const tasks = [];


  /* ══ 1. ALPHA VANTAGE — Equity quotes ══
     Symbols: XOM, LMT, RTX, DAL, GLD, SPY, GDX, CCJ
     Free tier: 25 calls/day → we batch with BATCH_STOCK_QUOTES
  ══════════════════════════════════════════ */
  if (fetchEquities && avKey) {
    tasks.push(
      fetchAV(avKey, 'BATCH_STOCK_QUOTES', { symbols: 'XOM,LMT,RTX,DAL,GLD,SPY' })
        .then(data => {
          const quotes = data?.['Stock Quotes'] || [];
          results.equities = quotes.map(q => ({
            symbol:  q['1. symbol'],
            price:   parseFloat(q['2. price']),
            change:  parseFloat(q['4. change']),
            changePct: parseFloat(q['5. change percent']?.replace('%','')),
            volume:  parseInt(q['3. volume']),
          }));
        })
        .catch(e => { errors.equities = e.message; })
    );
  } else if (fetchEquities) {
    errors.equities = 'ALPHA_VANTAGE_KEY not set';
  }

  /* ══ 2. ALPHA VANTAGE — Forex rates ══
     Pairs: USD/EUR, USD/INR, USD/TRY, USD/BRL, USD/EGP, USD/PKR
     Powers the EM FX basket KPI with real data
  ══════════════════════════════════════════ */
  if (fetchForex && avKey) {
    // Fetch one representative pair — USD/EUR as DXY proxy + key EM pairs
    const fxPairs = ['EUR', 'INR', 'TRY', 'BRL'];
    const fxTasks = fxPairs.map(currency =>
      fetchAV(avKey, 'CURRENCY_EXCHANGE_RATE', {
        from_currency: 'USD',
        to_currency:   currency,
      }).then(data => {
        const r = data?.['Realtime Currency Exchange Rate'];
        return r ? {
          pair:  `USD/${currency}`,
          rate:  parseFloat(r['5. Exchange Rate']),
          time:  r['6. Last Refreshed'],
        } : null;
      }).catch(() => null)
    );
    tasks.push(
      Promise.all(fxTasks).then(rates => {
        results.forex = rates.filter(Boolean);
      })
    );
  } else if (fetchForex) {
    errors.forex = 'ALPHA_VANTAGE_KEY not set';
  }

  /* ══ 3. FRED API — US Macro indicators ══
     Series pulled:
       CPIAUCSL  → CPI (Consumer Price Index, All Urban)
       UNRATE    → Unemployment Rate
       FEDFUNDS  → Federal Funds Rate
       T10Y2Y    → 10Y-2Y Yield Curve Spread (recession signal)
       DCOILWTICO→ WTI Crude Oil spot (cross-check vs EIA Brent)
       DHHNGSP   → Natural Gas (Henry Hub)
  ══════════════════════════════════════════ */
  if (fetchMacro && fredKey) {
    const fredSeries = [
      { id: 'CPIAUCSL',   label: 'CPI',           unit: 'Index'   },
      { id: 'UNRATE',     label: 'Unemployment',  unit: '%'       },
      { id: 'FEDFUNDS',   label: 'Fed Rate',       unit: '%'       },
      { id: 'T10Y2Y',     label: 'Yield Curve',    unit: '%'       },
      { id: 'DGS10',      label: 'US 10Y Yield',   unit: '%'       },
      { id: 'DCOILWTICO', label: 'WTI Crude',      unit: '$/bbl'   },
      { id: 'DHHNGSP',    label: 'Natural Gas',    unit: '$/MMBtu' },
      { id: 'PFOODINDEXM',label: 'Global Food Index', unit: 'Index 2016=100' },
    ];

    const fredTasks = fredSeries.map(s =>
      fetchFRED(fredKey, s.id).then(data => {
        const obs = data?.observations;
        if (!obs || !obs.length) return null;
        // Get last 2 valid readings for delta
        const valid = obs.filter(o => o.value !== '.').slice(-2);
        const latest = valid[valid.length - 1];
        const prev   = valid[valid.length - 2];
        const val    = parseFloat(latest?.value);
        const prevVal= parseFloat(prev?.value);
        return {
          id:      s.id,
          label:   s.label,
          unit:    s.unit,
          value:   val,
          prev:    prevVal,
          change:  isNaN(val) || isNaN(prevVal) ? 0 : parseFloat((val - prevVal).toFixed(3)),
          date:    latest?.date,
        };
      }).catch(() => null)
    );

    tasks.push(
      Promise.all(fredTasks).then(macro => {
        results.macro = macro.filter(Boolean);
      })
    );
  } else if (fetchMacro) {
    errors.macro = 'FRED_API_KEY not set — get free key at fred.stlouisfed.org/docs/api';
  }

  /* ══ 4. WORLD BANK — GDP growth baselines ══
     No API key needed. Pulls latest GDP growth %
     for the 8 dashboard regions as real anchors.
     Countries used as region proxies:
       USA → North America
       DEU → Europe
       SAU → Middle East
       CHN → East Asia
       IND → South Asia
       NGA → Africa
       BRA → South America
       AUS → Oceania
  ══════════════════════════════════════════ */
  if (fetchWorldBank) {
    const wbCountries = [
      { code:'US',  label:'North America' },
      { code:'DE',  label:'Europe'        },
      { code:'SA',  label:'Middle East'   },
      { code:'CN',  label:'East Asia'     },
      { code:'IN',  label:'South Asia'    },
      { code:'NG',  label:'Africa'        },
      { code:'BR',  label:'South America' },
      { code:'AU',  label:'Oceania'       },
    ];

    tasks.push(
      Promise.all(wbCountries.map(c =>
        fetchWorldBankGDP(c.code).then(val => ({
          region:  c.label,
          country: c.code,
          gdpGrowth: val,
        })).catch(() => ({ region: c.label, country: c.code, gdpGrowth: null }))
      )).then(wb => { results.worldbank = wb; })
    );
  }

  // Run all fetches in parallel
  await Promise.allSettled(tasks);

  return res.status(200).json({
    results,
    errors,
    fetchedAt: new Date().toISOString(),
    keysPresent: {
      alphaVantage: !!avKey,
      fred:         !!fredKey,
      worldBank:    true, // no key needed
    },
  });
};

/* ══ Alpha Vantage helper ══ */
async function fetchAV(key, func, params = {}) {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', func);
  url.searchParams.set('apikey', key);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Alpha Vantage HTTP ${r.status}`);
  const data = await r.json();
  if (data?.Note?.includes('call frequency')) throw new Error('Alpha Vantage rate limit — 25 calls/day on free tier');
  if (data?.['Error Message']) throw new Error(data['Error Message']);
  return data;
}

/* ══ FRED helper ══ */
async function fetchFRED(key, seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&limit=10&sort_order=desc`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED HTTP ${r.status}`);
  const data = await r.json();
  if (data?.error_code) throw new Error(data.error_message || 'FRED error');
  // Reverse so latest is last
  if (data.observations) data.observations.reverse();
  return data;
}

/* ══ World Bank helper ══ */
async function fetchWorldBankGDP(countryCode) {
  // NY.GDP.MKTP.KD.ZG = GDP growth (annual %)
  const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/NY.GDP.MKTP.KD.ZG?format=json&mrv=2&per_page=2`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`World Bank HTTP ${r.status}`);
  const data = await r.json();
  const obs = data?.[1];
  if (!obs || !obs.length) return null;
  const latest = obs.find(o => o.value !== null);
  return latest ? parseFloat(latest.value.toFixed(2)) : null;
}

/* Explicit Vercel function timeout. index-backfill's worst case is now one
   Promise.allSettled batch of five GDELT calls (each up to the 30s
   AbortController timeout in gdelt.js) running alongside the FRED/EIA
   fetches — not two sequential batches, per the fix above, but still
   comfortably able to exceed a default account ceiling if left unstated.
   60s keeps this a controlled, diagnosable timeout via our own AbortController
   rather than an abrupt platform kill. This is an admin/CRON-triggered path,
   not user-facing, so the extra budget costs nothing in perceived latency.
   Confirm 60s is within your Vercel plan's allowed maxDuration range — Hobby
   plans have raised this ceiling over time but it is account/plan-dependent. */
module.exports.config = { maxDuration: 60 };
