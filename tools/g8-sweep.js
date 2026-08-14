#!/usr/bin/env node
/* G8 — cross-structure sweep. Both structures x both hero/insight renderers. */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');
const rs   = fs.readFileSync('risk-structures.js', 'utf8');
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

let fails = 0;
for (const id of ['hormuz-iran', 'taiwan-strait']) {
  w.ACTIVE_STRUCTURE = id;
  try { w.renderHeroProof(); w.renderInsight(); } catch (e) { fails++; console.log('  FAIL', id, e.message); continue; }
  const cal   = d.getElementById('dxHeroCal').textContent;
  const watch = d.getElementById('dxInsWatch').textContent;
  const matt  = d.getElementById('dxInsMatters').textContent;
  console.log('---', id);
  console.log('   badge  :', cal);
  console.log('   matters:', matt.slice(0, 110).replace(/\s+/g,' ') + '…');
  console.log('   watch  :', watch.slice(0, 100).replace(/\s+/g,' ') + '…');
  if (!watch || watch.length < 40) { fails++; console.log('   FAIL: watch line empty'); }
  if (!matt  || matt.length  < 40) { fails++; console.log('   FAIL: matters line empty'); }
  if (id === 'taiwan-strait' && !/Unpriced/i.test(cal)) { fails++; console.log('   FAIL: taiwan not marked unpriced'); }
  if (id === 'hormuz-iran'  && !/Empirical/i.test(cal)) { fails++; console.log('   FAIL: hormuz not marked empirical'); }
  if (/±2\.5/.test(cal) === false && id === 'hormuz-iran') { fails++; console.log('   FAIL: error figure missing from badge'); }
}
const fatal = errs.filter(e => /not defined|not a function|Cannot read/.test(e));
console.log('\nfatal script errors:', fatal.length);
if (fatal.length) { fails++; console.log(fatal.slice(0,3).join('\n')); }
console.log(fails === 0 ? '\x1b[32mG8 ALL PASS\x1b[0m' : `\x1b[31m${fails} FAIL\x1b[0m`);
process.exit(fails ? 1 : 0);
