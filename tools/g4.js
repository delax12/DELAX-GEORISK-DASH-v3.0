/* G4 — RUNTIME SIMULATION.
   Loads the real markup into a DOM, stubs the two external libs (echarts, Globe)
   and fetch, then drives every renderer across both structures x all three
   scenarios x horizon {0,12,36}. Any throw fails the gate.
   Also asserts the Definition-of-Done text rules on rendered output.            */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('georisk-intelligence.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://delaxcom.org/' });
const w = dom.window;

/* ── stubs ─────────────────────────────────────────────────────────────────── */
const chartStub = () => ({ setOption(){}, resize(){}, dispose(){}, on(){} });
w.echarts = { init: chartStub };
const globeStub = new Proxy(function(){}, {
  get: () => (...a) => globeProxy, apply: () => globeProxy,
});
const globeProxy = new Proxy({}, { get: () => () => globeProxy });
w.Globe = () => globeProxy;
w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ analysis: '', sections: [] }) });
w.requestAnimationFrame = cb => setTimeout(cb, 0);
w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });

/* silence expected noise, but capture real wiring errors */
const wiring = [];
w.console = Object.assign({}, console, {
  error: (...a) => { const s = a.join(' '); if (s.includes('[geo][WIRING]')) wiring.push(s); },
  warn: () => {}, log: () => {},
});

const scriptSrc = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc\s*=/.test(m[1])).map(m => m[2]).join('\n;\n');

let fails = 0;
const bad = m => { fails++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };
const ok  = m => console.log('  \x1b[32mPASS\x1b[0m ' + m);

/* Function declarations inside window.eval do not reliably attach to the window
   object, so the harness exports what it needs explicitly. */
const EXPORTS = ['applyStructureState','redrawAll','openCountryPanel','getCountryStress',
  'cstress','cCpiExcess','cGdpDrag','cFxStress','refreshGlobe','updateShockNodes',
  'buildShockImpactList','updateShockEngineMessage','updateTicker','updateSidebarMetrics',
  'buildAlertList','updateAlertScroll','buildOpportunityList','updateChokepoints',
  'applyStructureChrome','buildCountryCharts','buildCountryInsights','getHistoricalAnalog',
  'getPhaseLabel','investabilityScore','setScenario','refreshMarkets'];
const exportTail = '\n;window.__t = { set h(v){ timeHorizon = v; }, get h(){ return timeHorizon; } };'
  + '\n;Object.assign(window, { ' + EXPORTS.map(n => n + ': typeof ' + n + " === 'function' ? " + n + ' : undefined').join(', ') + ' });';
try { w.eval(scriptSrc + exportTail); ok('script evaluates in a DOM'); }
catch (e) { bad('script threw on load: ' + e.message); process.exit(1); }

/* ── payload shaped exactly like the parent's ──────────────────────────────── */
const REGIONS = ['N. America','Europe','Mid. East','E. Asia','S. Asia','Africa','S. America','Oceania'];
const RAW = {
  'hormuz-iran': [[2.1,1.4,1.0,0.8,0.6,0.5,0.4,0.3,0.2,0.2],[3.8,2.9,2.1,1.5,1.1,0.8,0.6,0.5,0.4,0.3],
    [9.1,7.8,6.2,5.1,4.2,3.5,2.9,2.4,2.0,1.7],[2.8,2.0,1.4,1.0,0.7,0.5,0.4,0.3,0.2,0.2],
    [5.4,4.2,3.1,2.3,1.8,1.4,1.1,0.9,0.7,0.6],[6.8,5.9,4.8,3.9,3.1,2.5,2.0,1.6,1.3,1.1],
    [2.9,2.2,1.6,1.2,0.9,0.7,0.6,0.5,0.4,0.3],[1.4,0.9,0.6,0.5,0.4,0.3,0.2,0.2,0.2,0.1]],
  'taiwan-strait': [[6.8,5.6,4.4,3.6,3.0,2.6,2.2,1.9,1.7,1.5],[5.9,4.8,3.8,3.1,2.6,2.2,1.9,1.7,1.5,1.3],
    [2.6,2.1,1.7,1.4,1.2,1.0,0.9,0.8,0.7,0.6],[9.4,8.4,7.2,6.2,5.3,4.6,4.0,3.5,3.1,2.8],
    [4.6,3.8,3.1,2.6,2.2,1.9,1.6,1.4,1.2,1.1],[2.4,2.0,1.7,1.4,1.2,1.0,0.9,0.8,0.7,0.6],
    [3.2,2.6,2.1,1.8,1.5,1.3,1.1,1.0,0.9,0.8],[3.0,2.5,2.1,1.8,1.5,1.3,1.1,1.0,0.9,0.8]],
};
const CPI = { 'N. America':[1.8,1.2,0.7,0.3], Europe:[3.4,2.6,1.5,0.7], 'Mid. East':[5.8,4.9,3.6,2.1],
  'E. Asia':[2.5,1.9,1.1,0.5], 'S. Asia':[4.5,3.8,2.7,1.4], Africa:[5.4,4.6,3.3,1.9],
  'S. America':[2.8,2.1,1.3,0.6], Oceania:[1.5,1.0,0.5,0.2] };
const GDP = { 'N. America':[-0.3,-0.1,0.3], Europe:[-0.7,-0.3,0.2], 'Mid. East':[-3.0,-1.5,-0.4],
  'E. Asia':[-6.8,-3.7,-1.7], 'S. Asia':[-0.9,-0.4,0.0], Africa:[-1.1,-0.7,-0.2],
  'S. America':[-0.4,-0.3,0.1], Oceania:[-0.2,-0.1,0.3] };

function payload(sid, scen) {
  const rs = {}; REGIONS.forEach((r, i) => rs[r] = RAW[sid][i].slice());
  return { type:'STRUCTURE_STATE', structureId:sid,
    structureName: sid === 'taiwan-strait' ? 'Taiwan Strait' : 'Strait of Hormuz',
    tier: sid === 'taiwan-strait' ? 'unpriced' : 'calibrated',
    scenarioId: scen, scenarioLabels:{baseline:'Blockade',pessimistic:'Invasion',optimistic:'Gray-zone'},
    scenarioProbs:{baseline:.5,pessimistic:.28,optimistic:.22},
    regionalStress: rs, regionalCpi: CPI, regionalGdp: GDP,
    horizonUnit:'year', brentAnchor:70, liveBrent:null, timeHorizon:null, weights:null };
}

/* ── the sweep ─────────────────────────────────────────────────────────────── */
const RENDERERS = ['refreshGlobe','updateShockNodes','buildShockImpactList','updateShockEngineMessage',
  'updateTicker','updateSidebarMetrics','buildAlertList','updateAlertScroll','buildOpportunityList',
  'updateChokepoints','applyStructureChrome','redrawAll'];

let ran = 0;
for (const sid of ['hormuz-iran','taiwan-strait']) {
  for (const scen of ['baseline','pessimistic','optimistic']) {
    for (const hz of [0, 12, 36]) {
      try {
        w.applyStructureState(payload(sid, scen));
        w.__t.h = hz;
        RENDERERS.forEach(fn => { if (typeof w[fn] === 'function') { w[fn](); ran++; } });
        ['Taiwan','Japan','Iran','Brazil','Mauritania','Bolivia'].forEach(c => { w.openCountryPanel(c); ran++; });
      } catch (e) {
        bad(`${sid}/${scen}/+${hz}M -> ${e.message}`);
      }
    }
  }
}
if (!fails) ok(`${ran} renderer invocations across 2 structures x 3 scenarios x 3 horizons, no throws`);
if (wiring.length) { wiring.forEach(x => bad('wiring: ' + x)); } else ok('no [geo][WIRING] errors emitted');

/* ── Definition of Done assertions ─────────────────────────────────────────── */
console.log('\nDoD — TAIWAN must not name the wrong conflict');
w.applyStructureState(payload('taiwan-strait','baseline'));
w.__t.h = 0;
w.redrawAll();
const surfaces = ['left-panel','bottom-panel','right-panel','ticker-bar','shock-center'];
/* Collect only VISIBLE text: applyMarketRows() hides non-applicable rows with
   display:none, and textContent reads straight through that. Hidden markup is not
   a surface the user sees, but it must genuinely be hidden — so assert that. */
function visibleText(root) {
  if (!root) return '';
  let out = '';
  const walk = n => {
    if (n.nodeType === 3) { out += n.nodeValue + ' '; return; }
    if (n.nodeType !== 1) return;
    const st = n.getAttribute && n.getAttribute('style') || '';
    if (/display\s*:\s*none/.test(st)) return;
    for (const c of n.childNodes) walk(c);
  };
  walk(root); return out;
}
const wtiRow = w.document.getElementById('m-wti');
const wtiHidden = wtiRow && wtiRow.closest('.metric-row') &&
  /display\s*:\s*none/.test(wtiRow.closest('.metric-row').getAttribute('style') || '');
wtiHidden ? ok('Brent/WTI sidebar rows hidden under TAIWAN') : bad('WTI sidebar row not hidden under TAIWAN');
let text = surfaces.map(id => visibleText(w.document.getElementById(id))).join(' ');
w.openCountryPanel('Taiwan');
text += ' ' + visibleText(w.document.getElementById('country-detail'));
const banned = ['Hormuz','Iran','Brent','SPR','WTI'];
const hits = banned.filter(b => new RegExp('\\b' + b + '\\b').test(text));
// HORMUZ appears once by design in the Taiwan chokepoint grid, marked OPEN / "no channel here"
const allowed = /HORMUZ[\s\S]{0,80}no channel here/.test(text);
const real = hits.filter(h => !(h === 'Hormuz' && allowed));
real.length ? bad('TAIWAN surfaces still name: ' + real.join(', ')) : ok('no Hormuz/Iran/Brent/SPR/WTI on TAIWAN surfaces');

console.log('\nDoD — uncovered country');
w.openCountryPanel('Mauritania');
const panel = visibleText(w.document.getElementById('country-detail'));
/0\.0\/10/.test(panel) ? bad('Mauritania still reports 0.0/10') : ok('Mauritania shows no 0.0/10 reading');
/Not Covered|not in this structure|Outside modelled universe/i.test(panel)
  ? ok('Mauritania shows an explicit not-covered state') : bad('no explicit not-covered state');
w.getCountryStress('Mauritania') === null ? ok('getCountryStress(Mauritania) === null') : bad('stress not null');

console.log('\nDoD — Hormuz behaviour preserved');
w.applyStructureState(payload('hormuz-iran','baseline'));
w.__t.h = 0;
const iran = w.getCountryStress('Iran'), japan = w.getCountryStress('Japan');
(iran > 9 && japan > 0 && japan < iran) ? ok(`Hormuz ordering intact (Iran ${iran.toFixed(2)} > Japan ${japan.toFixed(2)})`)
  : bad(`Hormuz ordering suspect: Iran ${iran} Japan ${japan}`);
w.applyStructureState(payload('taiwan-strait','baseline'));
const tw = w.getCountryStress('Taiwan'), sa = w.getCountryStress('Saudi Arabia');
(tw > sa) ? ok(`Taiwan structure inverts correctly (Taiwan ${tw.toFixed(2)} > Saudi ${sa.toFixed(2)})`)
  : bad(`Taiwan ${tw} not above Saudi ${sa}`);

console.log(`\n${'-'.repeat(60)}\n${fails ? '\x1b[31m' : '\x1b[32m'}G4: ${fails} FAIL\x1b[0m\n`);
process.exit(fails ? 1 : 0);
