#!/usr/bin/env node
/* GATE HARNESS — run after every batch. Exits non-zero on any failure. */
const fs = require('fs');
const path = process.argv[2] || 'georisk-intelligence.html';
const src = fs.readFileSync(path, 'utf8');
let fails = 0, warns = 0;
const ok = m => console.log('  \x1b[32mPASS\x1b[0m ' + m);
const bad = m => { fails++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };
const warn = m => { warns++; console.log('  \x1b[33mWARN\x1b[0m ' + m); };

/* ── G0 structural ─────────────────────────────────────────────── */
console.log('\nG0 — structural');
src.trimStart().startsWith('<!DOCTYPE html>') ? ok('starts <!DOCTYPE html>')
  : bad('does not start with <!DOCTYPE html> — got: ' + JSON.stringify(src.slice(0, 40)));
src.trimEnd().endsWith('</html>') ? ok('ends </html>') : bad('does not end </html>');
const opens = (src.match(/<script\b[^>]*>/g) || []).length;
const closes = (src.match(/<\/script>/g) || []).length;
opens === closes ? ok(`script tags balanced (${opens})`) : bad(`script open ${opens} / close ${closes}`);

/* ── extract inline JS ─────────────────────────────────────────── */
const blocks = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(src))) {
  if (/\bsrc\s*=/.test(m[1])) continue;            // external, no body
  blocks.push({ body: m[2], offset: m.index, attrs: m[1] });
}
const js = blocks.map(b => b.body).join('\n;\n');
/* comment-stripped copy: prose inside /* *\/ blocks reads as call syntax and
   floods G2/G3 with phantom names. Analysis runs on this, not on raw source. */
const jsNC = js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
fs.writeFileSync('/tmp/_inline.js', js);

/* ── G1 syntax ─────────────────────────────────────────────────── */
console.log('\nG1 — syntax');
try {
  new (require('vm').Script)(js, { filename: 'inline.js' });
  ok(`node parses ${blocks.length} inline block(s), ${js.split('\n').length} lines`);
} catch (e) { bad('syntax error: ' + e.message); }

/* ── collect declared names ────────────────────────────────────── */
const declared = new Set();
for (const r of [/function\s+([A-Za-z_$][\w$]*)/g,
                 /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
                 /window\.([A-Za-z_$][\w$]*)\s*=/g,
                 /class\s+([A-Za-z_$][\w$]*)/g,
                 /\(([^()]*)\)\s*=>/g,                    // arrow params
                 /function[^(]*\(([^()]*)\)/g,             // function params
                 /\b([A-Za-z_$][\w$]*)\s*=>/g,             // single-param arrow
                 /(?:const|let|var)\s*\{([^}]*)\}/g]) {     // destructured
  let x; while ((x = r.exec(jsNC)))
    String(x[1]).split(',').forEach(t => {
      const nm = t.trim().replace(/[=:].*$/, '').replace(/^\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) declared.add(nm);
    });
}

/* ── G2 dispatch resolution ────────────────────────────────────── */
/* THE GATE THAT DID NOT EXIST. redrawAll dispatches renderer names through a
   string table; a typo or a renamed function fails silently at runtime. Every
   name it dispatches must resolve to a real definition in this file.          */
console.log('\nG2 — dispatch resolution (redrawAll)');
const rd = jsNC.match(/function\s+redrawAll\s*\([\s\S]*?\n\}/);
if (!rd) bad('redrawAll not found');
else {
  const body = rd[0];
  const names = new Set();
  // string-literal dispatch table entries
  let x; const sre = /'([A-Za-z_$][\w$]*)'/g;
  while ((x = sre.exec(body))) names.add(x[1]);
  // direct call sites
  const cre = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  while ((x = cre.exec(body))) {
    if (!['if','for','while','switch','catch','function','return','typeof','forEach'].includes(x[1]))
      names.add(x[1]);
  }
  names.delete('redrawAll');
  if (!names.size) bad('redrawAll dispatches nothing');
  let dead = 0;
  [...names].sort().forEach(n => {
    if (declared.has(n)) ok(`${n} -> defined`);
    else { bad(`${n} -> NO DEFINITION (silent no-op at runtime)`); dead++; }
  });
  if (!dead) ok(`all ${names.size} dispatched names resolve`);
}

/* ── G3 undeclared identifiers ─────────────────────────────────── */
console.log('\nG3 — undeclared identifiers');
const GLOBALS = new Set(['window','document','console','Math','JSON','Object','Array','String','Number',
  'Boolean','Date','Promise','fetch','setTimeout','setInterval','clearInterval','clearTimeout','parseFloat',
  'parseInt','isNaN','encodeURIComponent','decodeURIComponent','echarts','Globe','THREE','d3','localStorage',
  'sessionStorage','navigator','location','alert','Error','RegExp','Map','Set','Infinity','NaN','undefined',
  'requestAnimationFrame','CustomEvent','Intl','AbortController','URLSearchParams','performance','topojson']);
const called = new Set();
let y; const callRe = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
while ((y = callRe.exec(jsNC))) called.add(y[1]);
const KW = new Set(['if','for','while','switch','catch','function','return','typeof','new','delete','void',
  'in','of','do','else','try','throw','await','async','case','yield','instanceof','get','set','constructor']);
const missing = [...called].filter(n => !KW.has(n) && !GLOBALS.has(n) && !declared.has(n));
if (!missing.length) ok('every called identifier resolves');
else missing.sort().forEach(n => warn(`called but not declared in-file: ${n}()`));

/* ── G5 no fabrication ─────────────────────────────────────────── */
console.log('\nG5 — no fabrication');
const rnd = [];
src.split('\n').forEach((l, i) => { if (l.includes('Math.random')) rnd.push((i + 1) + ': ' + l.trim()); });
rnd.length === 0 ? ok('Math.random count = 0') : rnd.forEach(r => bad('Math.random -> ' + r));

/* ── provider hygiene ──────────────────────────────────────────── */
console.log('\nEXTRA — provider-name hygiene (public repo, view-source)');
const prov = [];
src.split('\n').forEach((l, i) => {
  if (/\b(groq|gemini|anthropic|openai|mistral|mixtral|llama|grok|gpt-\d|claude-)\b/i.test(l))
    prov.push((i + 1) + ': ' + l.trim().slice(0, 110));
});
prov.length === 0 ? ok('no provider/model names in source') : prov.forEach(p => bad('provider leak -> ' + p));

console.log(`\n${'-'.repeat(60)}\n${fails ? '\x1b[31m' : '\x1b[32m'}${fails} FAIL\x1b[0m  ${warns} warn  (${path})\n`);
process.exit(fails ? 1 : 0);
