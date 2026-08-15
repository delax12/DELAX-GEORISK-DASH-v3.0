#!/usr/bin/env node
/* G11 — PHASE 3 GATE (Global Risk Landscape)
   Boots index.html and asserts the landscape renders from the registry
   rather than from authored markup, that every structure appears exactly
   once, and that each card shows its MOST PROBABLE scenario — the decision
   that surfaces Taiwan's 60% de-escalation case instead of burying it
   behind the blockade scenario. */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fails = 0;
const ok  = m => console.log('  \x1b[32mPASS\x1b[0m ' + m);
const bad = m => { fails++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };

const html = fs.readFileSync('index.html', 'utf8');
const rs   = fs.readFileSync('risk-structures.js', 'utf8');

console.log('\nG11.1 — source contract');
/id="dxLandscape"/.test(html) ? ok('landscape section present') : bad('landscape section missing');
/function renderLandscape/.test(html) ? ok('renderLandscape() defined') : bad('renderLandscape() missing');
/renderLandscape\(\);/.test(html) ? ok('renderLandscape() called at boot') : bad('never called at boot');
// The view must be DERIVED. If structure names are hardcoded in the landscape
// markup, a third structure would not appear without editing this file.
// Scoped to the landscape function and its markup — an unscoped scan spans
// unrelated parts of the file and false-positives on the breadcrumb and KPIs.
{
  const fn = (html.match(/function renderLandscape\(\)[\s\S]*?\n\}/) || [''])[0];
  const mk = (html.match(/<section class="dx-land"[\s\S]*?<\/section>/) || [''])[0];
  const names = ['Hormuz', 'Taiwan', 'hormuz-iran', 'taiwan-strait'];
  const leaked = names.filter(n => fn.includes(n) || mk.includes(n));
  fn && mk
    ? (leaked.length === 0
        ? ok('landscape is fully derived — no structure hardcoded in its code or markup')
        : bad('hardcoded structure reference(s): ' + leaked.join(', ')))
    : bad('could not locate renderLandscape() or the landscape markup to scan');
}
/dxMostLikely/.test(html) ? ok('most-likely scenario selector present')
                          : bad('no most-likely selector — cards would show baseline and bury Taiwan 60%');

console.log('\nG11.2 — boot');
const vc = new VirtualConsole(); const errs = [];
vc.on('jsdomError', e => errs.push(e.message));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', virtualConsole: vc, url: 'https://delaxcom.org/',
  beforeParse(w) {
    w.fetch = () => Promise.resolve({ ok:false, status:503, json:()=>Promise.resolve({}) });
    w.echarts = { init: () => ({ setOption(){},resize(){},dispose(){},on(){} }) };
    w.matchMedia = () => ({ matches:false, addListener(){},removeListener(){},addEventListener(){},removeEventListener(){} });
    w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function(){};
  },
});
const w = dom.window, d = w.document;
const inj = d.createElement('script'); inj.textContent = rs; d.head.appendChild(inj);
d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

const fatal = errs.filter(e => /not defined|not a function|Cannot read/.test(e));
fatal.length === 0 ? ok('no fatal script errors') : bad('fatal: ' + fatal.slice(0,2).join(' | '));

const structures = Object.values(w.RISK_STRUCTURES || {});
const cards = [...d.querySelectorAll('.dx-land-card')];
cards.length === structures.length
  ? ok(`every structure rendered exactly once (${cards.length})`)
  : bad(`${cards.length} cards for ${structures.length} structures`);

const groups = [...d.querySelectorAll('.dx-land-group')];
groups.length === 3 ? ok('all three groups rendered (Active / Watch / Historical)')
                    : bad(`${groups.length} groups — expected 3`);
// Empty groups must still render: "nothing is dormant" is information, and it
// means the view needs no change when a structure is later flipped.
const empties = [...d.querySelectorAll('.dx-land-empty')];
empties.length > 0 ? ok(`${empties.length} empty group(s) shown explicitly, not hidden`)
                   : ok('no empty groups (all populated)');

console.log('\nG11.3 — most probable scenario, not baseline');
for (const S of structures) {
  const likely = S.scenarios.reduce((a,b) => b.probability > a.probability ? b : a);
  const card = cards.find(c => c.querySelector('.dx-land-name').textContent.trim() === S.meta.short);
  if (!card) { bad(`no card for ${S.meta.short}`); continue; }
  const txt = (card.querySelector('.dx-land-likely') || {}).textContent || '';
  const pct = Math.round(likely.probability * 100);
  txt.includes(likely.label) && txt.includes(String(pct))
    ? ok(`${S.meta.short}: shows "${likely.label}" at ${pct}% (its most probable outcome)`)
    : bad(`${S.meta.short}: expected "${likely.label}" ${pct}%, got ${JSON.stringify(txt.replace(/\s+/g,' ').trim())}`);
  // The specific regression this guards: leading with `baseline` would show
  // Taiwan's blockade case instead of its 60% gray-zone case.
  const baseline = S.scenarios.find(x => x.id === 'baseline');
  if (baseline && baseline.id !== likely.id) {
    !txt.includes(baseline.label)
      ? ok(`${S.meta.short}: baseline ("${baseline.label}") correctly NOT shown as most likely`)
      : bad(`${S.meta.short}: showing baseline instead of the most probable scenario`);
  }
}

console.log('\nG11.4 — plain-English tier wording (per the standing instruction)');
const tiers = [...d.querySelectorAll('.dx-land-tier')].map(t => t.textContent.trim());
tiers.every(t => /Measured|Estimated|Rough draft/.test(t))
  ? ok('tiers read as plain English: ' + [...new Set(tiers)].join(', '))
  : bad('tier wording is not plain English: ' + JSON.stringify(tiers));
!tiers.some(t => /empirical|unpriced|draft$/i.test(t))
  ? ok('no raw model vocabulary shown to the reader')
  : bad('raw tier vocabulary leaked into the UI');

console.log('\nG11.5 — selecting a structure from the landscape');
try {
  const other = structures.find(S => S.id !== w.ACTIVE_STRUCTURE);
  w.dxLandSelect(other.id);
  w.ACTIVE_STRUCTURE === other.id
    ? ok(`selecting a card switches the active structure (→ ${other.meta.short})`)
    : bad(`ACTIVE_STRUCTURE did not change (still ${w.ACTIVE_STRUCTURE})`);
  const activeCards = [...d.querySelectorAll('.dx-land-card.is-active')];
  activeCards.length === 1 ? ok('exactly one card marked active after selection')
                           : bad(`${activeCards.length} cards marked active`);
} catch (e) { bad('dxLandSelect threw: ' + e.message); }

console.log('\n' + '-'.repeat(60));
console.log(fails === 0 ? '\x1b[32mG11 ALL PASS\x1b[0m' : `\x1b[31m${fails} FAIL\x1b[0m`);
process.exit(fails ? 1 : 0);
