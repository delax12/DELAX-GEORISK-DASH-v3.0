/**
 * tools/g12-og.js — SHARE CARD GATE
 * ─────────────────────────────────────────────────────────────────
 * Asserts that server-rendered /insights pages emit link-preview metadata
 * that X, Facebook and LinkedIn will actually accept.
 *
 * WHY THIS GATE EXISTS
 * A broken og:image is the quietest failure surface in the product. The page
 * renders perfectly, the crawler rejects the card, and nothing is logged
 * anywhere — no 500, no console error, no Vercel log line. The only signal is
 * a link that looks bare when pasted, which is discovered by a stranger on X
 * rather than by us. Everything asserted here is therefore invisible in
 * ordinary use and untestable by looking at the site.
 *
 * The central rule is FAIL CLOSED, matching numbersAreVerified() and the
 * "what changed" block: when the image cannot be verified as an absolute HTTPS
 * URL we emit NO og:image at all and drop to twitter:card=summary. A small card
 * is a degraded result. A card pointing at an unreachable image is no card at
 * all — strictly worse, because the post then looks broken rather than plain.
 *
 * Run:  node tools/g12-og.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://delaxcom.org';

let pass = 0, fail = 0;
const check = (cond, label) => {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m  ' + label); }
  else      { fail++; console.log('  \x1b[31mFAIL\x1b[0m  ' + label); }
};

/* Row shapes mirror the three states the articles table can be in: image with
   alt, image without alt (alt falls back to title), and no image at all. */
const ROWS = {
  'with-image-and-alt': {
    slug: 'with-image-and-alt', title: 'With image and alt', summary: 'Summary.',
    body: '## Heading\n\nBody text.', published_at: '2026-08-10T00:00:00Z',
    image_url: 'https://hlxfhyspisejfnhncjyz.supabase.co/storage/v1/object/public/article-images/hero/a.jpg',
    image_alt: 'A chart',
  },
  'with-image-no-alt': {
    slug: 'with-image-no-alt', title: 'With image no alt', summary: 'Summary.',
    body: 'Body.', published_at: '2026-08-05T00:00:00Z',
    image_url: 'https://hlxfhyspisejfnhncjyz.supabase.co/storage/v1/object/public/article-images/hero/b.jpg',
    image_alt: null,
  },
  'no-image': {
    slug: 'no-image', title: 'No image', summary: 'Summary.',
    body: 'Body.', published_at: '2026-08-01T00:00:00Z',
    image_url: null, image_alt: null,
  },
  /* Regression row. A legacy or hand-edited row can hold a site-relative path;
     it must be resolved against SITE, not emitted raw. */
  'relative-path': {
    slug: 'relative-path', title: 'Relative path', summary: 'Summary.',
    body: 'Body.', published_at: '2026-07-01T00:00:00Z',
    image_url: '/og-card.png', image_alt: null,
  },
  /* Rejection row. http:// is not upgraded to https:// on a guess. */
  'insecure-image': {
    slug: 'insecure-image', title: 'Insecure image', summary: 'Summary.',
    body: 'Body.', published_at: '2026-06-01T00:00:00Z',
    image_url: 'http://example.com/a.jpg', image_alt: null,
  },
};

/* Load the real handler with only the network boundary stubbed. Everything
   under test — absImage, shell, renderArticle, renderIndex — is the shipped
   code, not a copy that can drift from it. */
function loadHandler() {
  let src = fs.readFileSync(path.join(ROOT, 'api/news.js'), 'utf8');
  const before = src;
  src = src.replace(/function sbGet\(path\) \{[\s\S]*?\n\}/,
`function sbGet(path){
  const m = /slug=eq\\.([a-z0-9-]+)/.exec(path);
  let data = [];
  if (m) data = ROWS[m[1]] ? [ROWS[m[1]]] : [];
  else if (path.indexOf('articles') === 0) data = Object.values(ROWS);
  return Promise.resolve({ ok:true, json: () => Promise.resolve(data) });
}`);
  if (src === before) throw new Error('sbGet stub did not apply — api/news.js shape changed');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'ROWS', 'fetch', src)(
    mod, mod.exports, require, ROWS, () => { throw new Error('unexpected network call'); });
  return mod.exports;
}

function mkRes() {
  const r = { _status: 200, _body: '', headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = s => { r._status = s; return r; };
  r.send   = b => { r._body = b; return r; };
  r.json   = b => { r._body = JSON.stringify(b); return r; };
  return r;
}

const tag = (html, prop) => {
  const m = new RegExp('<meta (?:property|name)="' + prop + '" content="([^"]*)"').exec(html);
  return m ? m[1] : null;
};

(async () => {
  console.log('\nG12 — INSIGHTS SHARE CARD GATE');
  console.log('─'.repeat(60));

  const handler = loadHandler();

  const call = async (query) => {
    const res = mkRes();
    await handler({ query, method: 'GET' }, res);
    return res;
  };

  /* ── Articles that carry a usable image ── */
  for (const slug of ['with-image-and-alt', 'with-image-no-alt', 'relative-path']) {
    console.log('\n/insights/' + slug);
    const res = await call({ type: 'article', slug });
    const h = res._body;
    const og = tag(h, 'og:image');
    const expected = ROWS[slug].image_url.startsWith('/')
      ? SITE + ROWS[slug].image_url
      : ROWS[slug].image_url;

    check(res._status === 200, 'HTTP 200');
    check(og === expected, 'og:image resolved to absolute HTTPS URL');
    check(og !== null && /^https:\/\//.test(og), 'og:image scheme is https');
    check(tag(h, 'og:image:secure_url') === og, 'og:image:secure_url mirrors og:image');
    check(tag(h, 'twitter:image') === og, 'twitter:image mirrors og:image');
    check(tag(h, 'twitter:card') === 'summary_large_image', 'large card requested');
    check(!!tag(h, 'og:image:alt'), 'og:image:alt non-empty (falls back to title)');
    check(tag(h, 'og:type') === 'article', 'og:type is article');
    check(tag(h, 'og:url') === SITE + '/insights/' + slug, 'og:url canonical and self-referential');
    check(!!tag(h, 'og:title') && !!tag(h, 'og:description'), 'og:title and og:description present');

    /* No dimensions are asserted anywhere. The CMS stores a URL, not a size,
       so any width/height we emitted would be a figure we had not measured —
       and a wrong one makes Facebook render the card worse than none at all. */
    check(!/og:image:width|og:image:height/.test(h),
      'no unmeasured image dimensions asserted');
  }

  /* ── Articles with no usable image must fail closed ── */
  for (const slug of ['no-image', 'insecure-image']) {
    console.log('\n/insights/' + slug + '  (expect fail-closed)');
    const res = await call({ type: 'article', slug });
    const h = res._body;

    check(res._status === 200, 'HTTP 200 — page still renders');
    check(tag(h, 'og:image') === null, 'no og:image emitted');
    check(!/og:image:secure_url|twitter:image|og:image:alt/.test(h), 'no orphan image tags');
    check(tag(h, 'twitter:card') === 'summary', 'degrades to summary card');
    check(tag(h, 'og:url') === SITE + '/insights/' + slug, 'og:url still correct');
  }

  /* ── The hub ── */
  console.log('\n/insights');
  const idx = await call({ type: 'insights' });
  check(idx._status === 200, 'HTTP 200');
  check(tag(idx._body, 'og:image') === SITE + '/og-card.png', 'index carries the site card');
  check(tag(idx._body, 'twitter:card') === 'summary_large_image', 'index shares large');
  check(tag(idx._body, 'og:url') === SITE + '/insights', 'index og:url correct');
  check(fs.existsSync(path.join(ROOT, 'og-card.png')),
    'og-card.png exists in the repo — a 404 here costs the card silently');

  /* ── 404 ── */
  console.log('\n/insights/<unknown>');
  const nf = await call({ type: 'article', slug: 'does-not-exist' });
  check(nf._status === 404, 'unknown slug 404s');
  check(tag(nf._body, 'og:image') === null, 'error page emits no og:image');

  /* ── Global ── */
  console.log('\nglobal');
  const all = [
    ...(await Promise.all(Object.keys(ROWS).map(s => call({ type: 'article', slug: s })))),
    idx,
  ].map(r => r._body).join('\n');
  check(!/content="(undefined|null)"/.test(all), 'no undefined/null leaked into any meta tag');
  check(!/content="[^"]*\bhttp:\/\//.test(all), 'no plain-http URL in any meta tag');

  console.log('\n' + '─'.repeat(60));
  if (fail === 0) console.log('\x1b[32mG12 ALL PASS\x1b[0m  (' + pass + ' assertions)');
  else            console.log('\x1b[31mG12: ' + fail + ' FAIL\x1b[0m  (' + pass + ' pass)');
  process.exit(fail ? 1 : 0);
})();
