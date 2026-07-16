#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   scripts/retest-taiwan.mjs — the FROZEN Taiwan pricing re-test pipeline
   ────────────────────────────────────────────────────────────────────────────
   PURPOSE
   The TAIWAN structure's central claim ("the market does not price Taiwan risk")
   is empirical and decays: every new escalation is a test it hasn't run. This
   script freezes the ORIGINAL method so each re-test costs one Twelve Data pull
   and one command — not a research project. Runs locally in Terminal (Node 22).
   It is NOT a serverless function and does not count against the 12-function cap.

   METHOD (frozen — do not vary per event, or the ledger stops being comparable)
   • Fixed ticker set (below): the Taiwan-structure bellwethers + SPY + SMH
   • Weekly closes; BASELINE window mean vs SHOCK window mean
   • Market-excess: sector return MINUS SPY over the same windows
   • Dual netting for the semi complex: also reported vs SMH (strips the AI cycle)
   • PRICED threshold (locked 2026-07-15): foundry market-excess < −5% in the
     shock window ⇒ verdict PRICED. Foundry excess > +5% ⇒ INVERTED.
     Otherwise ⇒ NOT PRICED. (Precedent: Pelosi Aug-2022, the only real fear
     signal ever recorded, printed −8.3%; Dec-2025 escalation printed +20.6%.)

   USAGE
     1. node scripts/retest-taiwan.mjs --print-pull \
          --base 2026-05-01:2026-07-31 --shock 2026-08-04:2026-09-12
        → prints the exact Twelve Data curl loop for the needed history.
          Run it (paste TD key), producing retest-tickers.jsonl (~24 credits).
     2. node scripts/retest-taiwan.mjs --event "PLA quarantine drill, Aug 2026" \
          --base 2026-05-01:2026-07-31 --shock 2026-08-04:2026-09-12 \
          --data retest-tickers.jsonl
        → prints the verdict row. Paste it into pricingEvidence.tests in
          risk-structures.js, append to meta.review.log, update lastReviewed,
          flip the NEW_ESCALATION switch back to false.

   WINDOW-CHOICE PRECEDENT (the one judgment the script can't remove):
     baseline = ~2-3 calm months ending just before the episode;
     shock    = first trading day of the episode → ~2-8 weeks after peak intensity,
     ENDING BEFORE any unrelated macro shock (the Dec-2025 window was cut at
     20 Feb 2026 to avoid Iran-war contamination — that discipline is the method).

   VALIDATION: run with --validate to re-test the Dec 2025 escalation against
   the original calibration file; it must reproduce foundry +20.6% (±0.1) or the
   pipeline has drifted from the method that produced the ledger.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
import { readFileSync } from 'node:fs';

const TICKERS = [
  'TSM','UMC',                          // foundry — the verdict sector
  'ASML','LRCX','AMAT','KLAC',          // semi equipment
  'NVDA','AMD','AVGO','QCOM','TXN',     // fabless
  'INTC','MU',                          // memory / IDM (the contrarian pair)
  'EWT','FXI','MCHI','EWY','EWJ',       // Taiwan / China / Korea / Japan
  'AAPL','MSFT','DELL',                 // downstream tech
  'TM','GM',                            // autos (chip consumers)
  'ZIM',                                // container shipping
  'SPY','QQQ','SMH',                    // netting benchmarks
];
const SECTORS = {
  foundry: ['TSM','UMC'],
  semi_equipment: ['ASML','LRCX','AMAT','KLAC'],
  fabless: ['NVDA','AMD','AVGO','QCOM','TXN'],
  memory_idm: ['INTC','MU'],
  taiwan_equity: ['EWT'],
  china_equity: ['FXI','MCHI'],
  korea_japan: ['EWY','EWJ'],
  downstream_tech: ['AAPL','MSFT','DELL'],
  autos: ['TM','GM'],
  container_shipping: ['ZIM'],
};
const PRICED_THRESHOLD = -5;   // foundry market-excess %, locked 2026-07-15

/* ── args ── */
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : null; };
const has = (name) => process.argv.includes('--' + name);
const parseWin = (s) => { const [a, b] = String(s || '').split(':'); if (!a || !b) die(`bad window "${s}" — use YYYY-MM-DD:YYYY-MM-DD`); return [a, b]; };
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

if (has('validate')) { validate(); process.exit(0); }

const base = parseWin(arg('base')), shock = parseWin(arg('shock'));

if (has('print-pull')) {
  const start = new Date(new Date(base[0]).getTime() - 90 * 864e5).toISOString().slice(0, 10);
  console.log(`# Twelve Data pull for the re-test (${TICKERS.length} calls, ~4 min at rate-limit-safe spacing)`);
  console.log(`TD_KEY="PASTE_TWELVE_DATA_KEY_HERE"`);
  console.log(`OUT=retest-tickers.jsonl; > $OUT`);
  console.log(`for SYM in ${TICKERS.join(' ')}; do`);
  console.log(`  echo "  $SYM"; curl -s "https://api.twelvedata.com/time_series?symbol=\${SYM}&interval=1week&start_date=${start}&outputsize=200&apikey=\${TD_KEY}" | tr -d '\\n' >> $OUT; echo "" >> $OUT; sleep 9`);
  console.log(`done; echo "lines: $(wc -l < $OUT) (expect ${TICKERS.length})"`);
  process.exit(0);
}

const event = arg('event') || die('--event "NAME" required');
const dataPath = arg('data') || 'retest-tickers.jsonl';
run(event, base, shock, dataPath);

/* ── core (the frozen method) ── */
function loadBars(path) {
  const bars = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim(); if (!t) continue;
    let d; try { d = JSON.parse(t); } catch { continue; }
    if (d.meta && d.values) bars[d.meta.symbol] = d.values.map(v => [v.datetime, +v.close]).sort();
    else if (d.status === 'error') console.error('  ⚠ pull error row:', (d.message || '').slice(0, 80));
  }
  return bars;
}
function wmean(b, [a, z]) { const v = b.filter(([d]) => d >= a && d <= z).map(([, c]) => c); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
function ret(bars, sym, base, shock) { const b = wmean(bars[sym] || [], base), s = wmean(bars[sym] || [], shock); return (b && s) ? (s / b - 1) * 100 : null; }

function analyze(bars, base, shock) {
  const spy = ret(bars, 'SPY', base, shock); if (spy === null) die('SPY missing from data — wrong file or windows outside pulled range');
  const smh = ret(bars, 'SMH', base, shock);
  const rows = {};
  for (const [sec, ts] of Object.entries(SECTORS)) {
    const rs = ts.map(t => ret(bars, t, base, shock)).filter(x => x !== null);
    if (!rs.length) { console.error(`  ⚠ ${sec}: no data`); continue; }
    const raw = rs.reduce((s, x) => s + x, 0) / rs.length;
    rows[sec] = { raw, exSPY: raw - spy, exSMH: smh !== null ? raw - smh : null };
  }
  return { spy, smh, rows };
}

function run(event, base, shock, dataPath) {
  const { spy, smh, rows } = analyze(loadBars(dataPath), base, shock);
  const f = rows.foundry?.exSPY; if (f === undefined) die('foundry sector missing');
  const verdictWord = f < PRICED_THRESHOLD ? 'PRICED' : f > -PRICED_THRESHOLD ? 'INVERTED' : 'NOT PRICED';

  console.log(`\n═══ RE-TEST: ${event} ═══`);
  console.log(`windows  base ${base.join('→')}  shock ${shock.join('→')}   SPY ${spy.toFixed(1)}%  SMH ${smh?.toFixed(1)}%`);
  console.log(`${'sector'.padEnd(20)}${'raw'.padStart(8)}${'vs SPY'.padStart(9)}${'vs SMH'.padStart(9)}`);
  for (const [sec, r] of Object.entries(rows))
    console.log(`${sec.padEnd(20)}${r.raw.toFixed(1).padStart(8)}${r.exSPY.toFixed(1).padStart(9)}${(r.exSMH ?? NaN).toFixed(1).padStart(9)}`);
  console.log(`\nVERDICT: ${verdictWord}  (foundry excess ${f.toFixed(1)}% vs threshold ${PRICED_THRESHOLD}%)`);

  const obs = `Foundry ${fmt(rows.foundry)} vs market. Taiwan equity ${fmt(rows.taiwan_equity)}. China ${fmt(rows.china_equity)}. Fabless ${fmt(rows.fabless)}.`;
  console.log(`\n── PASTE into pricingEvidence.tests (risk-structures.js) ──\n`);
  console.log(`        { event: '${event}',`);
  console.log(`          expected: 'Foundry and Taiwan equity should fall if the market prices the escalation.',`);
  console.log(`          observed: '${obs}',`);
  console.log(`          verdict:  '${verdictWord}. Foundry market-excess ${f.toFixed(1)}% vs the −5% PRICED threshold. Windows: base ${base.join('→')}, shock ${shock.join('→')}.' },`);
  console.log(`\n── AND append to meta.review.log ──\n`);
  console.log(`          { date: '${new Date().toISOString().slice(0, 10)}', version: '<bump>',`);
  console.log(`            note: 'Re-test: ${event} → ${verdictWord} (foundry ${f.toFixed(1)}% excess). Ledger updated.' },`);
  console.log(`\nThen: update review.lastReviewed, flip NEW_ESCALATION back to false.\n`);
}
function fmt(r){ return r ? `${r.exSPY >= 0 ? '+' : ''}${r.exSPY.toFixed(1)}%` : 'n/a'; }

/* ── validation against the original calibration data ── */
function validate() {
  const path = arg('data') || 'calibration-data/calibration-tickers.jsonl';
  console.log(`Validating pipeline against the original Dec-2025 finding using ${path}`);
  console.log('(pass --data <path> if your calibration pull lives elsewhere; needs the taiwan-tickers file merged in for full coverage)');
  const bars = loadBars(path);
  const { rows } = analyze(bars, ['2025-10-01', '2025-12-26'], ['2025-12-29', '2026-02-20']);
  const f = rows.foundry?.exSPY;
  console.log(`foundry excess, Dec-2025 window: ${f?.toFixed(1)}%  (original finding: +20.6%)`);
  if (f !== null && Math.abs(f - 20.6) <= 0.15) console.log('✓ PIPELINE VALID — reproduces the original finding');
  else { console.log('✗ DRIFT — does not reproduce +20.6%. Do not trust new verdicts until resolved.'); process.exit(1); }
}
