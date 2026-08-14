#!/usr/bin/env node
/* G7 — PHASE 1 GATE
   Boots index.html in a real DOM, dispatches DOMContentLoaded, and asserts the
   Phase 1 contract: hero, insight block, derived deltas, no directional prompt,
   no decorative padlocks, and — the defect that started this — a GDP multiplier
   that actually equals the ratio it claims. */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fails = 0;
const ok  = m => console.log('  \x1b[32mPASS\x1b[0m ' + m);
const bad = m => { fails++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };
const eq  = (a, b, m) => (a === b ? ok(m) : bad(`${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`));

const html = fs.readFileSync('index.html', 'utf8');
const rs   = fs.readFileSync('risk-structures.js', 'utf8');

/* ── STATIC CHECKS (source level) ───────────────────────────────── */
console.log('\nG7.1 — source contract');
!/Should I be buying defense stocks right now\?/.test(html)
  ? ok('no directional prompt in source')
  : bad('directional prompt still present');
!/(Hold|Hedge|Add|Reduce)\s*\/\s*(Hedge|Add|Reduce|Watch)/.test(html)
  ? ok('no Hold/Hedge/Add/Reduce mandate string')
  : bad('directional mandate string present');
!/Iran War · Global Economic Impact/.test(html)
  ? ok('single-conflict breadcrumb retired')
  : bad('"Iran War" breadcrumb still present');
!/kpi-click-hint">🔒 Pro/.test(html)
  ? ok('no hardcoded padlocks')
  : bad('hardcoded padlock markup present');
!/body\.beginner-mode body\.beginner-mode/.test(html)
  ? ok('dangling beginner-mode selector removed')
  : bad('dangling CSS selector still present — footer rule is captured by it');
/3\.8× worse/.test(html) === false
  ? ok('hardcoded "3.8× worse" removed')
  : bad('hardcoded stale multiplier still present');
/id="dxHeroIndex"[^>]*hidden/.test(html)
  ? ok('DGSI slot reserved and empty')
  : bad('DGSI slot missing or pre-populated');
/watchTriggers/.test(rs)
  ? ok('watchTriggers present in risk-structures.js')
  : bad('watchTriggers missing from engine');

/* ── DERIVATION MATH (the actual defect) ────────────────────────── */
console.log('\nG7.2 — delta derivation arithmetic');
const KPI_MAP = {
  baseline:    {oil:'$102',cpi:'+1.2%',gdp:'−0.7%',ship:'+120%'},
  optimistic:  {oil:'$78', cpi:'+0.3%',gdp:'−0.3%',ship:'+25%' },
  pessimistic: {oil:'$165',cpi:'+4.2%',gdp:'−2.2%',ship:'+400%'},
};
const num = v => parseFloat(String(v).replace(/[^0-9.]/g, ''));
for (const [sc, m] of Object.entries(KPI_MAP)) {
  const gdpLoss = Math.abs(num(m.gdp));
  const mult    = (gdpLoss / 0.5).toFixed(1);
  const expect  = { baseline: '1.4', optimistic: '0.6', pessimistic: '4.4' }[sc];
  eq(mult, expect, `${sc}: GDP ${m.gdp} vs 2003 Iraq −0.5% = ${mult}×`);
  const prem = (((num(m.oil) / 70) - 1) * 100).toFixed(1);
  const expP = { baseline: '45.7', optimistic: '11.4', pessimistic: '135.7' }[sc];
  eq(prem, expP, `${sc}: oil ${m.oil} vs $70 = +${prem}%`);
}

/* ── BOOT GATE ──────────────────────────────────────────────────── */
console.log('\nG7.3 — boot (real DOM, DOMContentLoaded dispatched)');
const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => errs.push(e.message));
vc.on('error', e => errs.push(String(e)));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  virtualConsole: vc,
  url: 'https://delaxcom.org/',
  beforeParse(w) {
    // Stub the network + chart libs; we are testing OUR code, not ECharts.
    w.fetch = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    w.echarts = { init: () => ({ setOption(){}, resize(){}, dispose(){}, on(){} }) };
    w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = function () {};
  },
});
const w = dom.window, d = w.document;

// risk-structures.js is loaded via <script src>; jsdom won't fetch it. Inject.
const inject = d.createElement('script');
inject.textContent = rs;
d.head.appendChild(inject);

d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

const fatal = errs.filter(e => /is not defined|is not a function|Cannot read/.test(e));
fatal.length === 0 ? ok('no fatal script errors on boot')
                   : bad('fatal errors: ' + fatal.slice(0, 3).join(' | '));

const hero = d.getElementById('dxHero');
hero && !hero.hidden ? ok('hero visible on first visit') : bad('hero missing or hidden on first visit');
const h1 = d.querySelector('.dx-hero-h');
h1 && /error bars/.test(h1.textContent) ? ok('approved headline present') : bad('headline missing');
!/predict|Predict/.test((h1 && h1.textContent) || '') ? ok('headline makes no prediction claim') : bad('headline claims prediction');

['dxInsChanged','dxInsMatters','dxInsWatch'].forEach(id => {
  const el = d.getElementById(id);
  el ? ok('insight row present: ' + id) : bad('insight row missing: ' + id);
});

/* Fail-closed: fetch is stubbed to fail, so "What changed" must say so and must
   contain NO price figure. This is the applyModelJitter lesson as a gate. */
const changed = (d.getElementById('dxInsChanged') || {}).textContent || '';
/No verified price update/.test(changed)
  ? ok('What-changed fails CLOSED with no live feed')
  : bad('What-changed did not degrade honestly: ' + JSON.stringify(changed.slice(0, 90)));
!/\$\d/.test(changed) ? ok('no fabricated price in degraded state')
                      : bad('price figure present despite failed feed');

const watch = (d.getElementById('dxInsWatch') || {}).textContent || '';
/Truce status/.test(watch) ? ok('What-to-watch sourced from engine watchTriggers')
                           : bad('watch triggers not rendered: ' + JSON.stringify(watch.slice(0, 80)));

const hint = d.querySelector('[data-gate="ai"]');
hint && !/🔒/.test(hint.textContent)
  ? ok('gate hint shows open state (paywall off)')
  : bad('gate hint still shows a lock while paywall is disabled');

const chips = d.getElementById('whatifChips');
const chipTxt = chips ? chips.textContent : '';
!/buying defense stocks/.test(chipTxt) ? ok('rendered chips carry no directional question')
                                       : bad('directional chip rendered');

/* Scenario sweep — every scenario must produce a self-consistent GDP delta. */
console.log('\nG7.4 — scenario sweep (rendered DOM)');
const expectMult = { baseline: '1.4×', optimistic: '0.6×', pessimistic: '4.4×' };
for (const sc of ['baseline', 'optimistic', 'pessimistic']) {
  try {
    w.setScenario(sc);
    const gdpVal = d.getElementById('kpiGDP').textContent;
    const card   = d.getElementById('kpiGDP').closest('.kpi-card');
    const delta  = card.querySelector('.kpi-delta').textContent;
    const loss   = Math.abs(parseFloat(gdpVal.replace(/[^0-9.]/g, '')));
    const claim  = parseFloat((delta.match(/([\d.]+)×/) || [])[1]);
    const truth  = +(loss / 0.5).toFixed(1);
    claim === truth
      ? ok(`${sc}: value ${gdpVal} · delta claims ${claim}× · arithmetic holds`)
      : bad(`${sc}: value ${gdpVal} but delta claims ${claim}× (should be ${truth}×)`);
    delta.includes(expectMult[sc]) ? ok(`${sc}: delta text matches expectation`)
                                   : bad(`${sc}: delta text ${JSON.stringify(delta)}`);
  } catch (e) { bad(`${sc}: setScenario threw — ${e.message}`); }
}

/* ── G7.6 — COMPUTED VISIBILITY ─────────────────────────────────────
   The original gate asserted el.hidden === true, which reads the ATTRIBUTE.
   It passed while `display:flex` silently outranked the UA stylesheet's
   display:none and the collapsed bar rendered on top of the expanded hero.
   Attribute state is not visibility. Assert the cascade. */
console.log('\nG7.6 — computed visibility (the hidden-attribute defect)');
const disp = el => w.getComputedStyle(el).display;
/* SOURCE-LEVEL guard. jsdom's cascade resolves [hidden] to display:none even
   without the !important rule, so it does NOT reproduce this defect — the
   computed-style checks below are necessary but NOT sufficient. Browsers give
   an author `display:flex` precedence over the UA stylesheet's hidden rule.
   Assert the rule exists in source; that is the check that actually bites. */
{
  const css = fs.readFileSync('index.html', 'utf8');
  /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css)
    ? ok('[hidden]{display:none!important} present — beats author display rules')
    : bad('no [hidden] !important rule: any display:flex will defeat the hidden attribute');
  const flexHidden = [];
  for (const id of ['dxHeroBar', 'dxHeroIndex']) {
    const cls = { dxHeroBar: 'dx-hero-bar', dxHeroIndex: 'dx-hero-index' }[id];
    const m = css.match(new RegExp('\\.' + cls + '\\{[^}]*display:\\s*(flex|grid|block|inline-flex)'));
    if (m) flexHidden.push(`${cls} → display:${m[1]}`);
  }
  flexHidden.length
    ? ok('components that declare display are covered by the !important rule: ' + flexHidden.join(', '))
    : ok('no conflicting display declarations on hidden components');
}
{
  const bar = d.getElementById('dxHeroBar');
  const idx = d.getElementById('dxHeroIndex');
  const hro = d.getElementById('dxHero');
  disp(hro) !== 'none' ? ok('hero computes visible on first visit')
                       : bad('hero computed display:none');
  disp(bar) === 'none' ? ok('collapsed bar computes display:none while hero is open')
                       : bad(`collapsed bar computes ${disp(bar)} — renders alongside hero`);
  disp(idx) === 'none' ? ok('DGSI slot computes display:none while reserved')
                       : bad(`DGSI slot computes ${disp(idx)} — occupying layout`);
  w.dxHeroCollapse(false);
  disp(hro) === 'none' && disp(bar) !== 'none'
    ? ok('collapse swaps computed visibility both ways')
    : bad(`after collapse: hero=${disp(hro)} bar=${disp(bar)}`);
  w.dxHeroExpand();
}

/* ── G7.7 — LAYOUT GRID ─────────────────────────────────────────── */
console.log('\nG7.7 — hero shares the page grid');
{
  const css = fs.readFileSync('index.html', 'utf8');
  /\.dx-hero-inner\{[^}]*max-width:\s*940px/.test(css)
    ? bad('hero still imposes its own 940px container — off the page rail')
    : ok('hero declares no competing container');
  const inner = d.querySelector('.dx-hero-inner');
  disp(inner) !== 'none' ? ok('hero content column renders') : bad('hero inner not rendering');
  d.querySelector('.dx-hero-inner .dx-hero-dismiss')
    ? ok('dismiss button sits inside the content column')
    : bad('dismiss button still positioned against the full-bleed section');
}

/* ── G7.8 — BRENT IS BRENT ──────────────────────────────────────── */
console.log('\nG7.8 — oil series labelling (A2)');
{
  const src = fs.readFileSync('index.html', 'utf8');
  !/liveBrentPrice\s*=\s*data\.price/.test(src)
    ? ok('liveBrentPrice no longer reads the wti||brent top-level field')
    : bad('liveBrentPrice still reads data.price (resolves to WTI upstream)');
  /liveWtiPrice/.test(src) ? ok('separate WTI global exists for the WTI-labelled pill')
                           : bad('no separate WTI global — pill and hero share one number');
  /data\.brent/.test(src) ? ok('Brent series read explicitly') : bad('Brent series not read explicitly');
}

/* ── G7.9 — PLAIN-LANGUAGE TOGGLE ───────────────────────────────── */
console.log('\nG7.9 — plain-language toggle surfaced');
{
  const toggles = d.querySelectorAll('[data-mode-toggle]');
  toggles.length >= 1 ? ok(`${toggles.length} mode toggle(s) present outside Settings`)
                      : bad('no surfaced mode toggle');
  const inline = d.getElementById('modeToggleInline');
  inline && disp(inline) !== 'none' ? ok('inline toggle is visible') : bad('inline toggle hidden');
  try {
    w.toggleMode();
    d.body.classList.contains('beginner-mode') ? ok('toggle enables beginner-mode') : bad('beginner-mode not applied');
    /On/.test(inline.textContent) ? ok('toggle label reflects state') : bad('toggle label stale: ' + inline.textContent);
    w.toggleMode();
    !d.body.classList.contains('beginner-mode') ? ok('toggle round-trips') : bad('toggle did not round-trip');
  } catch (e) { bad('toggleMode threw: ' + e.message); }
}

/* Hero collapse round-trip */
console.log('\nG7.5 — hero collapse persistence');
try {
  w.dxHeroCollapse(true);
  d.getElementById('dxHero').hidden === true && d.getElementById('dxHeroBar').hidden === false
    ? ok('collapse hides hero, shows bar') : bad('collapse state wrong');
  w.localStorage.getItem('delax.hero.collapsed') === '1' ? ok('collapse persisted') : bad('collapse not persisted');
  w.dxHeroExpand();
  d.getElementById('dxHero').hidden === false ? ok('expand restores hero') : bad('expand failed');
  w.localStorage.getItem('delax.hero.collapsed') === null ? ok('expand clears flag') : bad('flag not cleared');
} catch (e) { bad('hero collapse threw: ' + e.message); }

console.log('\n' + '-'.repeat(60));
console.log(fails === 0 ? '\x1b[32mG7 ALL PASS\x1b[0m' : `\x1b[31m${fails} FAIL\x1b[0m`);
process.exit(fails ? 1 : 0);
