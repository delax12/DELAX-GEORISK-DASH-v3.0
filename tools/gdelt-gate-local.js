#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   DGSI — GDELT GATE, RUN LOCALLY
   ══════════════════════════════════════════════════════════════════
   Run:  node tools/gdelt-gate-local.js

   WHY THIS IS NOT A SERVERLESS FUNCTION
   The gate is a ONE-TIME methodological validation — does GDELT's
   TimelineVol series behave well enough to become a DGSI component? That
   question gets answered once and recorded. It never needed to run inside a
   request, and putting it there cost four failed live runs (8s abort → 429 →
   12s abort → UND_ERR_CONNECT_TIMEOUT).

   The 15 Aug PING diagnostic settled the cause: connections from Vercel to
   api.gdeltproject.org time out at the TCP level (UND_ERR_CONNECT_TIMEOUT),
   and even a successful 7-day query took 27 seconds. The gate's windows are
   365 days. That is not a tuning problem, it is the wrong place to run this.

   From a laptop there is no request budget, so each call can simply wait.

   OUTPUT
   Prints each test's numbers against its published threshold, then emits a
   JSON block to paste into the DGSI baseline (see END OF OUTPUT for how).
   ══════════════════════════════════════════════════════════════════ */
'use strict';

/* Must stay identical to api/market-data.js — if these drift, the recorded
   verdict stops describing what the platform actually measures. */
const GDELT_QUERY   = '(hormuz OR "strait of hormuz" OR iran OR "oil tanker")';
const TEST_A_WINDOW  = { start: '20260228000000', end: '20260408235959' };
const TEST_A_CONTROL = { start: '20250901000000', end: '20260131235959' };
const TEST_B_QUERY   = '(ukraine OR "russian invasion")';
const TEST_B_WINDOW  = { start: '20220224000000', end: '20221224235959' };
const TEST_C_EARLY   = { start: '20170101000000', end: '20171231235959' };
const TEST_C_RECENT  = { start: '20250101000000', end: '20251231235959' };

const TEST_A_BAR = 1.5;   // war coverage must be >= 1.5x the pre-war baseline
const TEST_C_BAR = 0.15;  // 2017 vs 2025 baselines must be <= 15% apart

const ATTEMPTS = 5;        // generous: no request budget to respect here
const PAUSE_MS = 4000;     // between calls — GDELT throttles rapid connections

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean  = a => a.reduce((x, y) => x + y, 0) / a.length;

async function timelineVol(query, win, label) {
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc'
    + '?query=' + encodeURIComponent(query)
    + '&mode=TimelineVol'
    + '&startdatetime=' + win.start
    + '&enddatetime=' + win.end
    + '&format=json';

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const t0 = Date.now();
    try {
      process.stdout.write(`    ${label} attempt ${attempt}/${ATTEMPTS} … `);
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.text()).trim();
      if (!body.startsWith('{')) throw new Error(`non-JSON: "${body.slice(0, 60)}"`);
      const data = JSON.parse(body);
      const series = Array.isArray(data.timeline) ? data.timeline[0] : null;
      const rows = series && Array.isArray(series.data) ? series.data : null;
      if (!rows) throw new Error('unexpected response shape');
      const points = rows
        .map(x => ({ date: x.date, value: parseFloat(x.value) }))
        .filter(x => x.date && !isNaN(x.value));
      console.log(`ok (${points.length} points, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      return points;
    } catch (err) {
      const cause = err.cause ? (err.cause.code || err.cause.message) : err.message;
      console.log(`failed (${cause}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      if (attempt === ATTEMPTS) throw new Error(String(cause));
      await sleep(PAUSE_MS * attempt); // widening backoff
    }
  }
}

(async () => {
  console.log('\nDGSI — GDELT gate, running locally');
  console.log('Query:', GDELT_QUERY);
  console.log('This makes 5 calls with pauses; expect a few minutes.\n');

  const tests = {};

  // ── TEST A — positive control ────────────────────────────────────
  console.log('TEST A — does the 2026 Hormuz war show up as a clear excursion?');
  try {
    const war     = await timelineVol(GDELT_QUERY, TEST_A_WINDOW, 'war window  ');
    await sleep(PAUSE_MS);
    const control = await timelineVol(GDELT_QUERY, TEST_A_CONTROL, 'pre-war base');
    const warMean = mean(war.map(p => p.value));
    const ctlMean = mean(control.map(p => p.value));
    const ratio = warMean / (ctlMean || 1e-9);
    tests.A = { warMean, controlMean: ctlMean, ratio, pass: ratio >= TEST_A_BAR,
                points: { war: war.length, control: control.length } };
    console.log(`  war mean ${warMean.toFixed(4)} · baseline ${ctlMean.toFixed(4)}`);
    console.log(`  RATIO ${ratio.toFixed(2)}x  (bar: >= ${TEST_A_BAR})  → ${tests.A.pass ? 'PASS' : 'FAIL'}\n`);
  } catch (e) { tests.A = { error: e.message }; console.log(`  TEST A UNRESOLVED: ${e.message}\n`); }

  await sleep(PAUSE_MS);

  // ── TEST C — baseline drift ──────────────────────────────────────
  console.log('TEST C — has the baseline drifted between 2017 and 2025?');
  try {
    const early  = await timelineVol(GDELT_QUERY, TEST_C_EARLY,  '2017 window ');
    await sleep(PAUSE_MS);
    const recent = await timelineVol(GDELT_QUERY, TEST_C_RECENT, '2025 window ');
    const eM = mean(early.map(p => p.value));
    const rM = mean(recent.map(p => p.value));
    const drift = Math.abs(rM - eM) / (eM || 1e-9);
    tests.C = { earlyMean: eM, recentMean: rM, drift, pass: drift <= TEST_C_BAR,
                points: { early: early.length, recent: recent.length } };
    console.log(`  2017 mean ${eM.toFixed(4)} · 2025 mean ${rM.toFixed(4)}`);
    console.log(`  DRIFT ${(drift * 100).toFixed(1)}%  (bar: <= ${TEST_C_BAR * 100}%)  → ${tests.C.pass ? 'PASS' : 'FAIL'}\n`);
  } catch (e) { tests.C = { error: e.message }; console.log(`  TEST C UNRESOLVED: ${e.message}\n`); }

  await sleep(PAUSE_MS);

  // ── TEST B — attention decay (never gating) ──────────────────────
  console.log('TEST B — Ukraine attention decay (records level-vs-change; never gates)');
  try {
    const uk = await timelineVol(TEST_B_QUERY, TEST_B_WINDOW, 'ukraine 2022');
    const peak = Math.max(...uk.map(p => p.value));
    const last = uk[uk.length - 1].value;
    tests.B = { peak, endOfWindow: last, decayRatio: last / (peak || 1e-9), points: uk.length };
    console.log(`  peak ${peak.toFixed(4)} → end of window ${last.toFixed(4)}`);
    console.log(`  retained ${(tests.B.decayRatio * 100).toFixed(1)}% of peak after 10 months\n`);
  } catch (e) { tests.B = { error: e.message }; console.log(`  TEST B UNRESOLVED: ${e.message}\n`); }

  const enabled = !!(tests.A && tests.A.pass && tests.C && tests.C.pass);

  console.log('═'.repeat(62));
  console.log('VERDICT:', enabled
    ? 'BOTH GATES PASS — the conflict component may join the index.'
    : 'NOT ENABLED — DGSI ships on its four macro inputs, as planned.');
  console.log('═'.repeat(62));
  if (!enabled) {
    console.log('This is a sanctioned outcome, not a failure. REVAMP PLAN v6.0 §5');
    console.log('Phase 2: failing either gate keeps the index macro-only and the');
    console.log('fact gets stated in methodology.html rather than hidden.');
  }
  if (tests.B && tests.B.decayRatio !== undefined) {
    console.log(`\nTest B note: attention retained ${(tests.B.decayRatio * 100).toFixed(1)}% of peak.`);
    console.log(tests.B.decayRatio < 0.35
      ? '  Heavy decay → if the component ever ships, read it as CHANGE, not level.'
      : '  Attention held up → a level reading is defensible.');
  }

  console.log('\n── RECORD THIS VERDICT ──────────────────────────────────');
  console.log('Paste the block below to Claude, or store it as the `gdelt`');
  console.log('field of the DGSI baseline blob. Failures are kept on purpose:');
  console.log('an auditable gate records its misses, not just its passes.\n');
  console.log(JSON.stringify({
    enabled, tests, evaluatedAt: new Date().toISOString(),
    evaluatedBy: 'tools/gdelt-gate-local.js',
    note: 'Run locally: GDELT connections time out from Vercel (UND_ERR_CONNECT_TIMEOUT).',
  }, null, 2));
})();
