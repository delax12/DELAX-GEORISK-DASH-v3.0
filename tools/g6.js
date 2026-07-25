#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════
   G6 — BOOT GATE.  Why this exists:

   G3 checked whether every identifier used with CALL syntax — `foo(` — resolved.
   It therefore could not see two real orphans that shipped:

       setInterval(jitterMarkets, 2500)     <- bare callback reference, no parens
       al.innerHTML = alertMessages.map(…)  <- bare const reference

   Both sat inside the DOMContentLoaded handler. A handler aborts on its first
   throw, and `setTimeout(initGlobe, 500)` came AFTER both — so the globe never
   initialised. Every static gate passed. G4 passed too, because G4 calls
   renderers directly and never fires DOMContentLoaded.

   The lesson is that no amount of pattern-matching over source text substitutes
   for executing the actual boot path. This gate dispatches the real event and
   asserts the handler runs to completion.
   ══════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const path = process.argv[2] || 'georisk-intelligence.html';
const html = fs.readFileSync(path, 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://delaxcom.org/' });
const w = dom.window;

let fails = 0;
const ok  = m => console.log('  \x1b[32mPASS\x1b[0m ' + m);
const bad = m => { fails++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };

/* Stub the two CDN libs and the network. Everything else must be real. */
w.echarts = { init: () => ({ setOption(){}, resize(){}, dispose(){}, on(){} }) };
const gp = new Proxy({}, { get: () => () => gp });
w.Globe = () => gp;
w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ features: [] }) });
w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });

/* Record every deferred callback the boot handler registers, by name. */
const scheduled = { timeouts: [], intervals: [] };
w.setTimeout  = (fn, ms) => { scheduled.timeouts.push(nameOf(fn));  return 0; };
w.setInterval = (fn, ms) => { scheduled.intervals.push(nameOf(fn)); return 0; };
function nameOf(fn) { return typeof fn === 'function' ? (fn.name || '(anon)') : String(fn); }

const js = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc\s*=/.test(m[1])).map(m => m[2]).join('\n;\n');

console.log('\nG6 — boot path');
try { w.eval(js); ok('script body evaluates'); }
catch (e) { bad('script body threw: ' + e.message); process.exit(1); }

/* Capture anything the handler throws. jsdom reports listener errors on window. */
const thrown = [];
w.addEventListener('error', e => thrown.push(e.error ? (e.error.message || String(e.error)) : e.message));
const realErr = w.console.error;
w.console.error = (...a) => { const s = a.join(' '); if (/\[geo\]\[WIRING\]/.test(s)) thrown.push(s); };

try { w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true })); }
catch (e) { thrown.push(e.message); }

if (thrown.length) thrown.forEach(t => bad('boot handler threw: ' + t));
else ok('DOMContentLoaded handler ran without throwing');

/* The handler aborts on first throw, so completion is proved by observing the
   callbacks registered at the END of it. initGlobe is the one that matters. */
const REQUIRED_TIMEOUTS  = ['initGlobe', 'fetchGDELTRings', 'fetchLiveAPIs', 'fetchFinnhubTicker', 'fetchDailyMarketRows'];
const REQUIRED_INTERVALS = ['updateClock', 'refreshMarkets', 'buildShockImpactList', 'updateShockEngineMessage'];

REQUIRED_TIMEOUTS.forEach(n => scheduled.timeouts.includes(n)
  ? ok(`setTimeout(${n}) reached`)
  : bad(`setTimeout(${n}) NEVER REACHED — handler aborted before it`));
REQUIRED_INTERVALS.forEach(n => scheduled.intervals.includes(n)
  ? ok(`setInterval(${n}) reached`)
  : bad(`setInterval(${n}) NEVER REACHED — handler aborted before it`));

/* Bare-reference sweep: identifiers used WITHOUT call syntax that resolve to
   nothing. This is the exact class G3 was blind to. */
console.log('\nG6b — bare identifier references');
const nc = js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const declared = new Set();
for (const r of [/function\s+([A-Za-z_$][\w$]*)/g, /(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
                 /class\s+([A-Za-z_$][\w$]*)/g]) { let m; while ((m = r.exec(nc))) declared.add(m[1]); }

/* Callbacks passed bare to the common schedulers/registrars. */
const bare = new Set();
const cbRe = /\.\s*(?:then|catch|forEach|map|filter|sort)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]|\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]|\baddEventListener\s*\(\s*'[^']*'\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
let m; while ((m = cbRe.exec(nc))) { const n = m[1] || m[2] || m[3]; if (n) bare.add(n); }
const RESERVED = new Set(['function','async','true','false','null','undefined','this','e','event']);
const orphans = [...bare].filter(n => !RESERVED.has(n) && !declared.has(n) && !(n in w));
orphans.length ? orphans.forEach(n => bad(`bare callback reference does not resolve: ${n}`))
               : ok(`all ${bare.size} bare callback references resolve`);

console.log(`\n${'-'.repeat(60)}\n${fails ? '\x1b[31m' : '\x1b[32m'}G6: ${fails} FAIL\x1b[0m\n`);
process.exit(fails ? 1 : 0);
