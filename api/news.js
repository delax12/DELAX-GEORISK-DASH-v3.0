/**
 * /api/news.js — Vercel Serverless Function (Node.js / CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * Live geopolitical news feed for DELAX GEO-RISK dashboard.
 *
 * FIX NOTES (v3):
 *  • FIX 3.1: Replaced RSS scraping with NewsAPI.org JSON API.
 *    All 6 previous RSS feed URLs returned 403/DNS-failure from
 *    Vercel's cloud IPs. Major publishers (BBC, Reuters, NYT,
 *    MarketWatch) block programmatic access from AWS/serverless
 *    infrastructure. NewsAPI.org is designed for server-side use
 *    and works reliably from Vercel.
 *
 *  • FIX 3.2: Now reads NEWS_API_KEY env var (already in Vercel).
 *    Previously this key was configured but never used.
 *
 *  • FIX 3.3: Response always includes a non-empty 'news' array or
 *    a clear error message. The empty-response path is handled
 *    gracefully so #geopolitical-feed never stays on "Connecting…".
 *    If NewsAPI key is missing, a descriptive error is returned.
 *
 * Vercel env var required:
 *   NEWS_API_KEY  →  newsapi.org (free plan: 100 req/day)
 *
 * Endpoint:  GET /api/news?limit=12
 * Response:  { news: [...], fetchedAt, sources, count }
 */
'use strict';

/* Stories that are never market signal on this platform. A local fire, crash or
   crime is human tragedy, not an investable geopolitical event — and surfacing
   one under a green "CLIMATE & WEATHER" chip on an investor dashboard is both
   irrelevant and tonally wrong. Matched on title only, so a passing mention in
   a macro story does not exclude it. */
const LOCAL_NOISE = [
  'firefighter', 'helicopter crash', 'car crash', 'shooting', 'stabbing',
  'murder', 'homicide', 'arrested', 'sentenced', 'lawsuit filed', 'obituary',
  'missing person', 'amber alert', 'high school', 'county sheriff',
];

/* Minimum relevance score for inclusion. The previous build SORTED by score but
   never filtered, so once genuinely relevant stories ran out, score-zero local
   news padded the list to the requested limit. Returning six good items beats
   returning fifteen where nine are filler. */
const MIN_GEO_SCORE = 2;

/* Geopolitical relevance keywords for scoring/filtering */
const GEO_KEYWORDS = [
  'war','conflict','military','sanction','diplomat','tension','crisis',
  'invasion','nuclear','terror','missile','drone','navy','army',
  'ceasefire','peace','blockade','embargo','coup','assassination',
  'oil','gas','energy','brent','opec','crude','pipeline',
  'inflation','recession','fed rate','interest rate','central bank',
  'china','russia','iran','ukraine','israel','nato','middle east','taiwan',
  'sanctions','cybersecurity','espionage','intelligence',
  'trade war','tariff','supply chain','refugee','humanitarian',
];

/* ═══════════════════════════════════════════════════════════════════════
   SERVER-RENDERED INSIGHTS  (added Aug 2026)
   ═══════════════════════════════════════════════════════════════════════
   Routed here from vercel.json:
     /insights            → ?type=insights          (index)
     /insights/:slug      → ?type=article&slug=…    (single article)
     /sitemap.xml         → ?type=sitemap

   WHY THIS LIVES IN news.js RATHER THAN ITS OWN FUNCTION
   The Hobby plan caps a deployment at 12 functions and we are at 12. news.js
   already serves editorial content, so it is the honest place to hang this.
   No slot consumed.

   WHY SERVER-RENDER AT ALL
   The article text used to arrive via JavaScript from Supabase, so the raw HTML
   contained none of it. Google's renderer handles that; Bing's is unreliable and
   the AI crawlers (GPTBot, ClaudeBot, PerplexityBot) execute no JavaScript at
   all. Since the platform's whole distribution thesis is "be citable", content
   that a citing crawler cannot read is content that cannot be cited. This path
   puts the words in the first byte.

   CACHING
   Responses carry s-maxage + stale-while-revalidate so Vercel's CDN absorbs
   crawler traffic and a paused Supabase project still serves the last good copy.
   When the database is unreachable AND the cache is cold we return 503 with
   Retry-After rather than a 200 with an empty body — a crawler that receives an
   empty 200 may cache the emptiness, which is worse than a retry.
   ═══════════════════════════════════════════════════════════════════════ */

const SITE   = 'https://delaxcom.org';
const SB_URL = 'https://hlxfhyspisejfnhncjyz.supabase.co';
const SB_KEY = 'sb_publishable_9RGWMyidXv6sPGtHqL5Dmw_r-yOmvJV';

function sbGet(path) {
  return fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Accept: 'application/json' },
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Markdown renderer — deliberately identical in behaviour to the one in
   /delax-cms.js, so the admin preview, the client path and this server path all
   produce the same HTML. If one changes, change all three.
   Everything is escaped BEFORE parsing, so no author input can become markup. */
function renderMarkdown(src) {
  const text = esc(src || '');
  const lines = text.split('\n');
  const out = [];
  let listType = null;

    /* HEADING NORMALISATION.
       The page supplies the h1 (the article title), so author headings start at
       h2. But authors differ: some write '#' for sections, others '##'. Mapping
       by raw depth meant a document using '##' throughout produced h3s directly
       under the h1 — a skipped level, which is an accessibility and SEO fault.
       Instead the SHALLOWEST heading actually present becomes h2 and the rest
       cascade from there, so both conventions come out correct. */
    let minH = 9;
    for (const l of lines) {
      const m = l.trim().match(/^(#{1,4})\s+\S/);
      if (m) minH = Math.min(minH, m[1].length);
    }
    const hOffset = (minH === 9) ? 1 : (2 - minH);

  const closeList = () => { if (listType) { out.push('</' + listType + '>'); listType = null; } };
  const openList  = (k) => { if (listType !== k) { closeList(); out.push('<' + k + '>'); listType = k; } };

  const inline = (s) => s
    .replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]{1,300}|\/[^\s)]{0,300})\)/g,
      (m, label, href) => '<a href="' + href + '"' +
        (/^https?:/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '') +
        '>' + label + '</a>')
    .replace(/`([^`\n]{1,200})`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]{1,200})\*(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }

    const h  = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^[-*+]\s+(.*)$/);
    const ol = line.match(/^\d{1,3}[.)]\s+(.*)$/);
    const bq = line.match(/^&gt;\s?(.*)$/);      // source is escaped by now
    const hr = /^(-{3,}|\*{3,}|_{3,})$/.test(line);

    if (hr)      { closeList(); out.push('<hr/>'); }
    else if (h)  { closeList();
                   const lvl = Math.min(Math.max(h[1].length + hOffset, 2), 5);
                   out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'); }
    else if (ul) { openList('ul'); out.push('<li>' + inline(ul[1]) + '</li>'); }
    else if (ol) { openList('ol'); out.push('<li>' + inline(ol[1]) + '</li>'); }
    else if (bq) { closeList(); out.push('<blockquote>' + inline(bq[1]) + '</blockquote>'); }
    else         { closeList(); out.push('<p>' + inline(line) + '</p>'); }
  }
  closeList();
  return out.join('\n');
}

/* Plain-text excerpt for meta description, from the body when no summary was
   written. Never invented — if there is nothing to describe, the tag is omitted
   rather than filled with boilerplate. */
function excerpt(md, max) {
  const flat = String(md || '')
    .replace(/^#{1,4}\s+.*$/gm, ' ')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB',
      { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) { return ''; }
}

/* Shared page shell. Styles are inlined rather than linked so the first paint
   needs no round trip and a crawler sees a complete document. */
function shell(opts) {
  const title = esc(opts.title);
  const desc  = opts.description ? esc(opts.description) : '';
  const url   = esc(opts.url);
  const img   = opts.image ? esc(opts.image) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${title}</title>
${desc ? `<meta name="description" content="${desc}"/>` : ''}
<link rel="canonical" href="${url}"/>
<meta name="theme-color" content="#050a14"/>
<link rel="manifest" href="/manifest.json"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"/>
<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>

<meta property="og:type" content="${opts.ogType || 'website'}"/>
<meta property="og:site_name" content="DELAX GEO-RISK"/>
<meta property="og:title" content="${title}"/>
${desc ? `<meta property="og:description" content="${desc}"/>` : ''}
<meta property="og:url" content="${url}"/>
${img ? `<meta property="og:image" content="${img}"/>
<meta property="og:image:alt" content="${esc(opts.imageAlt || opts.title)}"/>` : ''}
<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}"/>
<meta name="twitter:title" content="${title}"/>
${desc ? `<meta name="twitter:description" content="${desc}"/>` : ''}
${img ? `<meta name="twitter:image" content="${img}"/>` : ''}
${opts.jsonLd ? `<script type="application/ld+json">${opts.jsonLd}</script>` : ''}

<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/delax-chrome.css"/>
<style>
:root{
  --bg-deep:#080c14; --bg-card:#0d1525; --bg-panel:#111d33;
  --border:#1e3055; --border-dim:#152238;
  --text-pri:#e8f0ff; --text-sec:#9db2d4; --text-dim:#5a7299;
  --amber:#f5a623; --cyan:#00d4ff; --green:#00e6a0; --red:#ff3d4a;
  --mono:'IBM Plex Mono',ui-monospace,monospace;
  --display:'Rajdhani',system-ui,sans-serif;
  /* Long-form reading face. A system serif stack costs no extra network
     request and separates editorial voice from the instrument chrome — mono is
     right for tickers and tiers, wrong for 500 words of argument. */
  --read:ui-serif,Georgia,'Iowan Old Style','Times New Roman',serif;
  --font-scale:1;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg-deep);color:var(--text-sec);
  font-family:var(--mono);-webkit-font-smoothing:antialiased}
a{color:var(--cyan);text-decoration:none}
a:hover{text-decoration:underline}
main{max-width:44rem;margin:0 auto;padding:2.25rem 1.25rem 3rem}
@media(max-width:600px){main{padding:1.25rem 1rem 2.5rem}}

.ins-back{font-family:var(--mono);font-size:.62rem;letter-spacing:.1em;
  text-transform:uppercase;color:var(--text-dim);display:inline-block;margin-bottom:1.5rem}
.ins-back:hover{color:var(--cyan);text-decoration:none}
.ins-head{margin-bottom:2rem;padding-bottom:1.25rem;border-bottom:1px solid var(--border-dim)}
.ins-head h1{font-family:var(--display);font-size:2rem;letter-spacing:.04em;
  color:var(--text-pri);margin-bottom:.5rem;line-height:1.2}
.ins-standfirst{font-family:var(--mono);font-size:.72rem;color:var(--text-sec);line-height:1.8}
.ins-meta{font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;
  text-transform:uppercase;color:var(--text-dim);margin-bottom:.5rem}

.ins-item{display:block;padding:1.15rem 0;border-bottom:1px solid var(--border-dim)}
.ins-item:hover{text-decoration:none}
.ins-item:hover .ins-title{color:var(--amber)}
.ins-title{font-family:var(--display);font-size:1.2rem;color:var(--text-pri);
  display:block;margin-bottom:.3rem;transition:color .15s}
.ins-summary{font-family:var(--read);font-size:.95rem;color:var(--text-sec);line-height:1.6}
.ins-empty{font-family:var(--mono);font-size:.68rem;color:var(--text-dim);
  line-height:1.9;padding:1.5rem;border:1px dashed var(--border);
  border-radius:2px;background:var(--bg-card)}

article h1{font-family:var(--display);font-size:2.1rem;letter-spacing:.02em;
  color:var(--text-pri);line-height:1.18;margin-bottom:.6rem}
@media(max-width:600px){article h1{font-size:1.6rem}}
.ins-hero{width:100%;height:auto;border-radius:3px;margin:1.5rem 0;
  border:1px solid var(--border-dim);display:block}

/* Body copy: serif, ~66 characters per line, generous leading. The first
   version set 500 words in 12px monospace at ~108 characters per line, which
   read as terminal output rather than an argument. */
.ins-body{font-family:var(--read);font-size:1.06rem;line-height:1.72;
  color:#c8d6ee;margin-top:1.75rem;max-width:38rem}
.ins-body p{margin-bottom:1.15rem}
.ins-body h2{font-family:var(--display);font-size:1.35rem;color:var(--text-pri);
  letter-spacing:.02em;margin:2.25rem 0 .75rem;line-height:1.25}
.ins-body h3{font-family:var(--display);font-size:1.12rem;color:var(--text-pri);margin:1.75rem 0 .6rem}
.ins-body h4,.ins-body h5{font-family:var(--mono);font-size:.72rem;letter-spacing:.1em;
  text-transform:uppercase;color:var(--text-dim);margin:1.6rem 0 .5rem}
.ins-body ul,.ins-body ol{margin:0 0 1.15rem 1.3rem}
.ins-body li{margin-bottom:.45rem}
.ins-body blockquote{border-left:2px solid var(--amber);padding:.2rem 0 .2rem 1rem;
  margin:0 0 1.15rem;color:var(--text-sec);font-style:italic}
.ins-body hr{border:none;border-top:1px solid var(--border-dim);margin:2rem 0}
.ins-body code{font-family:var(--mono);font-size:.86em;background:var(--bg-card);
  border:1px solid var(--border-dim);padding:.1rem .35rem;border-radius:2px;color:var(--amber)}
.ins-body strong{color:var(--text-pri);font-weight:700}
.ins-foot{margin-top:2.5rem;padding-top:1.25rem;border-top:1px solid var(--border-dim);
  font-family:var(--mono);font-size:.6rem;color:var(--text-dim);line-height:1.9}
</style>
</head>
<body data-theme="cyberpunk">
<div id="dxHeader"></div>
<main>
${opts.body}
</main>
<div id="dxFooter"></div>
<script src="/delax-state.js"></script>
<script src="/delax-chrome.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', function () {
    if (window.DelaxChrome) DelaxChrome.render({ page: 'Insights', active: 'insights' });
  });
</script>
</body>
</html>`;
}

/* Cache headers. Long stale window: an article changes rarely, and serving a
   slightly old copy beats serving nothing when Supabase has paused. */
function cacheable(res, seconds) {
  res.setHeader('Cache-Control',
    `public, s-maxage=${seconds}, stale-while-revalidate=86400`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
}

async function renderArticle(req, res, slug) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(slug || ''))) {
    return notFound(res, 'That address is not a valid article link.');
  }

  let rows;
  try {
    const r = await sbGet('articles?select=slug,title,summary,body,published_at,image_url,image_alt'
      + '&status=eq.published&slug=eq.' + encodeURIComponent(slug) + '&limit=1');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    rows = await r.json();
  } catch (e) {
    /* Database unreachable and no cached copy. 503 tells a crawler to come
       back; a 200 with an empty body would invite it to cache nothing. */
    res.setHeader('Retry-After', '600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(503).send(shell({
      title: 'Temporarily unavailable — DELAX GEO-RISK',
      url: SITE + '/insights/' + slug,
      body: '<div class="ins-empty">This article is temporarily unavailable. '
          + 'Please try again shortly.</div>',
    }));
  }

  const a = rows && rows[0];
  if (!a) return notFound(res, 'That article is not available. It may have been unpublished, or the address may be wrong.');

  const desc = a.summary || excerpt(a.body, 155);
  const url  = SITE + '/insights/' + a.slug;
  const img  = a.image_url || '';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: desc || undefined,
    datePublished: a.published_at || undefined,
    image: img || undefined,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author:    { '@type': 'Organization', name: 'DELAX GEO-RISK', url: SITE },
    publisher: { '@type': 'Organization', name: 'DELAXCOM LLC', url: SITE },
  });

  const body = `
  <a class="ins-back" href="/insights">&larr; All insights</a>
  <article>
    <h1>${esc(a.title)}</h1>
    <div class="ins-meta">${esc(fmtDate(a.published_at))}</div>
    ${img ? `<img class="ins-hero" src="${esc(img)}" alt="${esc(a.image_alt || a.title)}" loading="lazy"/>` : ''}
    <div class="ins-body">${renderMarkdown(a.body)}</div>
    <div class="ins-foot">
      DELAX GEO-RISK publishes cross-asset geopolitical risk analytics with an explicit
      evidence tier on every figure. <a href="/methodology.html">Methodology</a>.
    </div>
  </article>`;

  cacheable(res, 600);
  return res.status(200).send(shell({
    title: a.title + ' — DELAX GEO-RISK',
    description: desc, url, image: img, imageAlt: a.image_alt || a.title,
    ogType: 'article', jsonLd, body,
  }));
}

async function renderIndex(req, res) {
  let items = [], content = {};
  try {
    const [ra, rc] = await Promise.all([
      sbGet('articles?select=slug,title,summary,published_at,image_url'
        + '&status=eq.published&order=published_at.desc&limit=50'),
      sbGet('site_content?select=key,value&key=eq.insights.intro'),
    ]);
    if (ra.ok) items = (await ra.json()) || [];
    if (rc.ok) {
      const rows = (await rc.json()) || [];
      rows.forEach(r => { if (r.value && r.value.trim()) content[r.key] = r.value; });
    }
  } catch (e) { /* fall through to defaults — the page still renders */ }

  const intro = content['insights.intro']
    || 'Notes on method, structure and evidence from the DELAX GEO-RISK desk.';

  const list = items.length
    ? items.map(a => `
      <a class="ins-item" href="/insights/${esc(a.slug)}">
        ${a.published_at ? `<div class="ins-meta">${esc(fmtDate(a.published_at))}</div>` : ''}
        <span class="ins-title">${esc(a.title)}</span>
        ${a.summary ? `<div class="ins-summary">${esc(a.summary)}</div>` : ''}
      </a>`).join('')
    : `<div class="ins-empty">No insights published yet. Method and model
       documentation is available on the <a href="/methodology.html">methodology page</a>.</div>`;

  cacheable(res, 300);
  return res.status(200).send(shell({
    title: 'Insights — DELAX GEO-RISK',
    description: intro,
    url: SITE + '/insights',
    body: `<div class="ins-head"><h1>Insights</h1>
             <p class="ins-standfirst">${esc(intro)}</p></div>${list}`,
  }));
}

async function renderSitemap(req, res) {
  let items = [];
  try {
    const r = await sbGet('articles?select=slug,published_at,updated_at'
      + '&status=eq.published&order=published_at.desc&limit=500');
    if (r.ok) items = (await r.json()) || [];
  } catch (e) { /* static pages still listed */ }

  const statics = [
    ['/', '1.0', 'daily'], ['/insights', '0.8', 'weekly'],
    ['/workspace.html', '0.8', 'weekly'], ['/exposure-desk.html', '0.8', 'weekly'],
    ['/methodology.html', '0.6', 'monthly'],
  ];

  const urls = statics.map(([p, pri, freq]) =>
      `<url><loc>${SITE}${p}</loc><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`)
    .concat(items.map(a => {
      const mod = a.updated_at || a.published_at;
      return `<url><loc>${SITE}/insights/${esc(a.slug)}</loc>`
        + (mod ? `<lastmod>${String(mod).slice(0, 10)}</lastmod>` : '')
        + `<changefreq>monthly</changefreq><priority>0.7</priority></url>`;
    }));

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}

function notFound(res, message) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(404).send(shell({
    title: 'Not found — DELAX GEO-RISK',
    url: SITE + '/insights',
    body: `<a class="ins-back" href="/insights">&larr; All insights</a>
           <div class="ins-empty">${esc(message)}</div>`,
  }));
}


/* ── HTML ROUTES ──
   vercel.json rewrites /insights, /insights/:slug and /sitemap.xml here. These
   are checked before the JSON news path so an HTML request never falls through
   into the NewsAPI branch (which would return JSON to a browser). */
module.exports = async function handler(req, res) {
  const type = String((req.query && req.query.type) || '').toLowerCase();
  if (type === 'article')  return renderArticle(req, res, (req.query && req.query.slug) || '');
  if (type === 'insights') return renderIndex(req, res);
  if (type === 'sitemap')  return renderSitemap(req, res);


  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const newsKey = process.env.NEWS_API_KEY;
  if (!newsKey) {
    return res.status(500).json({
      error:  'NEWS_API_KEY environment variable not set.',
      fix:    'Vercel Dashboard → Settings → Environment Variables → Add NEWS_API_KEY',
      docs:   'https://newsapi.org — free plan: 100 req/day',
      news:   [],  // empty array so frontend doesn't crash
    });
  }

  const limit = Math.min(parseInt(req.query.limit || '15', 10), 30);

  try {
    /* ── Fetch from two NewsAPI categories in parallel ── */
    const [worldRes, bizRes] = await Promise.allSettled([
      fetchNewsAPI(newsKey, 'general',  20),
      fetchNewsAPI(newsKey, 'business', 15),
    ]);

    const allItems = [];

    if (worldRes.status === 'fulfilled') allItems.push(...worldRes.value);
    if (bizRes.status   === 'fulfilled') allItems.push(...bizRes.value);

    if (!allItems.length) {
      /* FIX 3.3: Return structured empty response — never leave frontend hanging */
      return res.status(200).json({
        news:      [],
        fetchedAt: new Date().toISOString(),
        sources:   [],
        count:     0,
        warning:   'NewsAPI returned no articles — check key validity or daily quota',
      });
    }

    /* ── Score by geopolitical relevance, then FILTER ── */
    const scored = allItems.map(item => {
      const title = String(item.title || '').toLowerCase();
      const text  = `${title} ${String(item.description || '').toLowerCase()}`;
      const score = GEO_KEYWORDS.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
      const noisy = LOCAL_NOISE.some(kw => title.includes(kw));
      return { ...item, _score: score, _noisy: noisy };
    });

    const relevant = scored.filter(i => !i._noisy && i._score >= MIN_GEO_SCORE);

    /* Sort: most relevant first, then newest */
    relevant.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return new Date(b.pubDate) - new Date(a.pubDate);
    });

    /* De-duplicate by title prefix */
    const seen   = new Set();
    const deduped = [];
    for (const item of relevant) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
      if (!seen.has(key)) { seen.add(key); deduped.push(item); }
      if (deduped.length >= limit) break;
    }

    const sources = [...new Set(deduped.map(i => i.source).filter(Boolean))].slice(0, 6);
    const news    = deduped.map(({ _score, _noisy, ...item }) => item); // strip internal fields

    /* Cache successful responses for 5 min — protects NewsAPI 100 req/day free quota.
       At 5-min CDN cache: fetchNewsArticles (20-min poll) + DashboardLive (8-min poll)
       = at most ~12 real NewsAPI calls/day per edge node. Well within free tier. */
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

    return res.status(200).json({
      news,
      fetchedAt: new Date().toISOString(),
      sources,
      count:     news.length,
    });

  } catch (err) {
    console.error('[api/news] Unhandled error:', err.message);
    return res.status(500).json({
      error:  'News fetch failed',
      detail: err.message,
      news:   [],
    });
  }
};

/* ─── NewsAPI.org fetcher ───────────────────────────────────────── */
async function fetchNewsAPI(apiKey, category, pageSize) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 7000);

  try {
    const url = 'https://newsapi.org/v2/top-headlines' +
      `?category=${category}` +
      `&language=en` +
      `&pageSize=${pageSize}` +
      `&apiKey=${apiKey}`;

    const resp = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'DELAX-GeoRisk/3.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(`NewsAPI HTTP ${resp.status}: ${body.message || 'unknown error'}`);
    }

    const data = await resp.json();
    const articles = data.articles || [];

    /* Normalise to the shape the frontend expects */
    return articles
      .filter(a => a.title && a.title !== '[Removed]')
      .map(a => ({
        title:       (a.title       || '').slice(0, 200),
        description: (a.description || '').slice(0, 300),
        link:        a.url          || '',
        pubDate:     a.publishedAt  || new Date().toISOString(),
        source:      a.source?.name || 'NewsAPI',
      }));

  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[api/news] NewsAPI category=${category} failed: ${err.message}`);
    return []; // non-fatal — other category may succeed
  }
}
