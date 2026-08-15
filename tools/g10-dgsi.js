#!/usr/bin/env node
/* G10 — PHASE 2 (DGSI) SOURCE GATE
   Cannot exercise the live FRED/EIA/GDELT/Blob paths from this build
   environment — no egress to those domains from the sandbox this was built
   in. This gate is therefore SOURCE-LEVEL: it asserts the contract described
   in REVAMP PLAN v6.0 Amendment A1–A3 is actually what shipped, and that
   nothing fabricates a number when data is unavailable. Live verification of
   the backfill and the GDELT gate itself must happen from the deployed
   Vercel function, which has real internet egress. */
const fs = require('fs');
let fails = 0;
const ok  = m => console.log('  \x1b[32mPASS\x1b[0m ' + m);
const bad = m => { fails++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };

const md  = fs.readFileSync('api/market-data.js', 'utf8');
const gd  = fs.readFileSync('api/gdelt.js', 'utf8');
const idx = fs.readFileSync('index.html', 'utf8');
const meth= fs.readFileSync('methodology.html', 'utf8');

console.log('\nG10.1 — no new serverless function (12-function ceiling)');
const fnCount = fs.readdirSync('api').filter(f => f.endsWith('.js')).length;
fnCount <= 12 ? ok(`${fnCount} functions in /api — within the ceiling`)
              : bad(`${fnCount} functions in /api — OVER the 12-function ceiling`);
/type\s*===\s*'index-backfill'/.test(md) && /type\s*===\s*'index'/.test(md)
  ? ok('index + index-backfill both route through existing market-data.js')
  : bad('index routes not found on market-data.js — may have created a new function');

console.log('\nG10.2 — syntax');
try { require('child_process').execSync('node --check api/market-data.js'); ok('api/market-data.js parses'); }
catch (e) { bad('api/market-data.js syntax error: ' + e.message.split('\n')[0]); }
try { require('child_process').execSync('node --check api/gdelt.js'); ok('api/gdelt.js parses'); }
catch (e) { bad('api/gdelt.js syntax error: ' + e.message.split('\n')[0]); }

console.log('\nG10.3 — Amendment A1: SD units, never 0-100, never "score"');
/unit:\s*'sd'/.test(md) ? ok("response carries unit:'sd'") : bad("no unit:'sd' in index response");
!/dgsiScore|strainScore|indexScore/i.test(md + idx + meth)
  ? ok('no "score" naming anywhere in the DGSI code path')
  : bad('a "*Score" identifier exists in the DGSI path — violates A1');
// Scope this to the RENDER path, not the full corpus — methodology.html
// legitimately contains the phrase "never as a 0-100 score" as a negation,
// which a naive substring scan would misflag as violating the rule it is
// stating. What must never happen is the hero actually FORMATTING the value
// as a 0-100 number.
{
  const renderBlock = (idx.match(/async function renderDGSI\(\)[\s\S]*?\n}/) || [''])[0];
  !/Math\.round\([^)]*\*\s*100\)|\/\s*100\s*\)\s*;.*textContent|100\)\s*\+\s*'%'/.test(renderBlock)
    ? ok('renderDGSI() does not format the value on a 0-100 scale')
    : bad('renderDGSI() appears to format the value as 0-100');
  /toFixed\(2\)/.test(renderBlock) ? ok('renderDGSI() formats as a signed SD figure (toFixed(2))')
                                   : bad('renderDGSI() formatting changed — verify it is still SD units');
}

console.log('\nG10.4 — Amendment A2: Brent, not WTI');
/RBRTE/.test(md) ? ok('market-data.js reads RBRTE (Brent) for the index')
                 : bad('index does not reference RBRTE');
!/facets\[series\]\[\]=RWTC/.test(md.split('index-backfill')[1] ? md.split(/type === 'index/)[1] || '' : '')
  ? ok('WTI series not requested inside the index code paths')
  : bad('WTI series requested inside an index-labelled path');

console.log('\nG10.5 — fail-closed (no fabrication)');
/available:\s*false/.test(md) ? ok('index response can report unavailable')
                              : bad('no unavailable path found — may fabricate on missing data');
/missing\.length/.test(md) ? ok('missing-input check present before computing a reading')
                           : bad('no explicit missing-input guard found');
!/dgsi\s*=\s*[\d.]+;/.test(md) && !/value:\s*[\d.]+,\s*\n?\s*unit:\s*'sd'/.test(md)
  ? ok('no hardcoded numeric DGSI fallback in source')
  : bad('a hardcoded DGSI figure exists in source — check for a fabricated fallback');

console.log('\nG10.6 — Amendment A3: GDELT is conditional, evidence-based, not silently deferred');
/TimelineVol/.test(gd) ? ok('gdelt.js implements the TimelineVol mode') : bad('TimelineVol mode missing from gdelt.js');
/module\.exports\.fetchTimelineVol/.test(gd) ? ok('fetchTimelineVol exported for reuse') : bad('fetchTimelineVol not exported');
/testA\.pass\s*=.*>=\s*1\.5/.test(md) ? ok('Test A threshold (>=1.5x baseline) present')
                                     : bad('Test A threshold not found or changed');
/testC\.pass\s*=.*<=\s*0\.15/.test(md) ? ok('Test C threshold (<=15% drift) present')
                                      : bad('Test C threshold not found or changed');
/out\.enabled\s*=\s*!!\(out\.tests\.A\s*&&\s*out\.tests\.A\.pass\s*&&\s*out\.tests\.C\s*&&\s*out\.tests\.C\.pass\)/.test(md)
  ? ok('gdeltEnabled requires BOTH Test A and Test C to pass')
  : bad('gdelt enable condition does not require both A and C');
/UNVERIFIED/.test(gd) ? ok('response-shape uncertainty is flagged in source, not asserted as fact')
                      : bad('no uncertainty flag on the unverified GDELT response shape');

console.log('\nG10.7 — hero slot (Phase 1 contract honoured)');
/id="dxHeroIndex"[^>]*hidden/.test(idx) ? ok('DGSI slot still ships hidden by default')
                                        : bad('DGSI slot no longer hidden by default');
/if \(!d \|\| !d\.available\) return;/.test(idx)
  ? ok('renderDGSI() no-ops on unavailable rather than rendering a placeholder')
  : bad('renderDGSI() does not guard on d.available — risk of placeholder render');
/renderDGSI\(\);/.test(idx) ? ok('renderDGSI() is called at boot') : bad('renderDGSI() never called');

console.log('\nG10.8 — methodology published (non-negotiable per plan §5 Phase 2)');
/id="dgsi"/.test(meth) ? ok('methodology.html has a #dgsi anchor the hero links to')
                       : bad('no #dgsi anchor in methodology.html');
/energy-and-household-cost strain index/.test(meth)
  ? ok('honest macro-only characterization is stated in methodology')
  : bad('honest characterization sentence missing from methodology');
/1\.5.*baseline|baseline.*1\.5/.test(meth) && /15%/.test(meth)
  ? ok('GDELT gate thresholds are published, not just implemented')
  : bad('GDELT gate thresholds not stated in methodology.html');
const linkHref = idx.match(/href="\/methodology\.html#dgsi"/);
linkHref ? ok('hero links directly to the methodology anchor') : bad('hero does not link to #dgsi');

console.log('\nG10.9 — timeout architecture (from the live backfill run, 15 Aug 2026)');
/module\.exports\.config\s*=\s*\{\s*maxDuration:\s*60\s*\}/.test(md)
  ? ok('explicit maxDuration:60 set — not left to the account default')
  : bad('no explicit maxDuration — function can be killed by the platform mid-GDELT-gate');
/Promise\.allSettled\(jobs\)/.test(md)
  ? ok('all 5 GDELT calls run in ONE allSettled batch (not split across two sequential awaits)')
  : bad('GDELT calls still split into sequential batches — worst-case time risk remains');
!/const ukraine = await gdelt\.fetchTimelineVol\(TEST_B_QUERY/.test(md)
  ? ok('Test B no longer runs as a second sequential await after the main batch')
  : bad('Test B still sequential — doubles worst-case gate time');


console.log('\n' + '-'.repeat(60));
console.log(fails === 0 ? '\x1b[32mG10 ALL PASS\x1b[0m' : `\x1b[31m${fails} FAIL\x1b[0m`);
console.log('\nREMINDER: this gate is static. Live verification still required:');
console.log('  1. Confirm gdelt.js timelinevol response shape against one real call.');
console.log('  2. Trigger index-backfill once deployed:');
console.log('     curl -X GET "https://delaxcom.org/api/market-data?type=index-backfill" \\');
console.log('       -H "Authorization: Bearer $CRON_SECRET"');
console.log('  3. Read the returned baseline.gdelt.tests block — confirm A and C before trusting gdeltEnabled.');
console.log('  4. Update methodology.html\'s stamp row once the real verdict is known.');
process.exit(fails ? 1 : 0);
