/**
 * /delax-cms.js — DELAX GEO-RISK — public content layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads editable PROSE from Supabase and renders it into slots on public pages.
 *
 * ══ THE TWO RULES THIS FILE EXISTS TO ENFORCE ══
 *
 * 1. THE CMS NEVER TOUCHES A DATA FIGURE.
 *    Sector betas, prices, scenario multipliers, VaR inputs and tier
 *    assignments live in code and data files where the gate suite can see
 *    them. Nothing this file fetches is ever read by a calculation. An admin
 *    layer that could change a number would be a route around the entire
 *    evidence-tier system — which is the one thing the platform exists to
 *    prevent. Slots are prose; that is the whole contract.
 *
 * 2. THE CMS IS AN OVERRIDE, NEVER A DEPENDENCY.
 *    Every slot ships with its default copy already written into the HTML.
 *    This file only REPLACES that text when the database returns something.
 *    If Supabase is unreachable, paused, rate-limited or empty, the page keeps
 *    its built-in copy and nothing anywhere reports an error. That matters
 *    concretely: free-tier Supabase projects pause after about a week without
 *    requests, so "the database is down" is a normal Tuesday, not an incident.
 *
 * USAGE — put the default copy inside the element:
 *     <p data-cms-slot="home.hero_note">Default copy, shown if the CMS is down.</p>
 *     <script src="/delax-cms.js" defer><\/script>
 *  (the closing tag is escaped above on purpose: a literal </ script> sequence
 *   anywhere in this file — even inside a comment — ends the script element if
 *   the file is ever inlined into a page rather than linked by src.)
 * Hydration runs automatically on DOMContentLoaded.
 *
 * NO SDK ON PUBLIC PAGES. Reads go straight to PostgREST over fetch, so a
 * visitor downloads nothing extra. Only /admin.html loads supabase-js, and only
 * because it needs auth.
 *
 * THE KEY BELOW IS PUBLIC BY DESIGN. A publishable key identifies the project;
 * it grants nothing on its own. Row-level security decides what anonymous
 * callers may read (published articles and site copy) and what they may write
 * (nothing). Verified against the live database before this shipped.
 */
'use strict';

(function (global) {

  var CMS = {
    url: 'https://hlxfhyspisejfnhncjyz.supabase.co',
    key: 'sb_publishable_9RGWMyidXv6sPGtHqL5Dmw_r-yOmvJV',
  };

  /* Short client-side cache so several slots on one page cost one request, and
     a navigation within the session does not re-fetch. */
  var TTL_MS = 5 * 60 * 1000;
  var cache  = { at: 0, map: null };

  function rest(path) {
    return fetch(CMS.url + '/rest/v1/' + path, {
      headers: {
        apikey: CMS.key,
        Authorization: 'Bearer ' + CMS.key,
        Accept: 'application/json',
      },
    });
  }

  /* ── site copy ──────────────────────────────────────────────── */

  async function loadContent() {
    if (cache.map && (Date.now() - cache.at) < TTL_MS) return cache.map;
    try {
      var r = await rest('site_content?select=key,value');
      if (!r.ok) return cache.map || {};
      var rows = await r.json();
      var map = {};
      (rows || []).forEach(function (row) {
        if (row && row.key && typeof row.value === 'string' && row.value.trim()) {
          map[row.key] = row.value;
        }
      });
      cache = { at: Date.now(), map: map };
      return map;
    } catch (e) {
      /* Offline, paused project, blocked request — the page keeps its defaults.
         Deliberately silent: this is an expected state, not a fault. */
      return cache.map || {};
    }
  }

  /* Fill every slot that has an override. Text only — assigning textContent
     rather than innerHTML means an editor cannot inject markup into a public
     page, deliberately or otherwise. */
  async function hydrate(root) {
    var scope = root || document;
    var slots = scope.querySelectorAll('[data-cms-slot]');
    if (!slots.length) return {};
    var map = await loadContent();
    Array.prototype.forEach.call(slots, function (el) {
      var v = map[el.getAttribute('data-cms-slot')];
      if (typeof v === 'string' && v.trim()) {
        el.textContent = v;
        el.setAttribute('data-cms-filled', 'true');
      }
    });
    return map;
  }

  /* ── articles ───────────────────────────────────────────────── */

  async function listArticles(limit) {
    try {
      var n = Math.min(Math.max(parseInt(limit || 20, 10), 1), 50);
      var r = await rest('articles?select=slug,title,summary,published_at,author_email' +
                         '&status=eq.published&order=published_at.desc&limit=' + n);
      return r.ok ? (await r.json()) || [] : [];
    } catch (e) { return []; }
  }

  async function getArticle(slug) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(slug || ''))) return null;
    try {
      var r = await rest('articles?select=slug,title,summary,body,published_at,author_email' +
                         '&status=eq.published&slug=eq.' + encodeURIComponent(slug) + '&limit=1');
      if (!r.ok) return null;
      var rows = await r.json();
      return (rows && rows[0]) || null;
    } catch (e) { return null; }
  }

  /* ── rendering helpers ──────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Minimal markdown. Everything is HTML-escaped FIRST, then a small, closed
     set of formatting is applied to the escaped text — so no editor input can
     ever become markup. No raw HTML passthrough, no image or script syntax.
     Links are restricted to http(s) and relative paths, which blocks
     javascript: and data: URLs.

     PARAGRAPH RULE (changed Aug 2026): a SINGLE newline ends a paragraph.
     Strict markdown needs a blank line, and that is what shipped first — with
     the result that an article pasted from a rendered source, where the blank
     lines had already been stripped, fused into one unreadable block. An author
     pressing Enter once means "new paragraph", so that is what this does. Blank
     lines still work and still collapse, so anything already written is
     unaffected. */
  function renderMarkdown(src) {
    var text = esc(src || '');
    var lines = text.split('\n');
    var out = [], listType = null;

    /* HEADING NORMALISATION.
       The page supplies the h1 (the article title), so author headings start at
       h2. But authors differ: some write '#' for sections, others '##'. Mapping
       by raw depth meant a document using '##' throughout produced h3s directly
       under the h1 — a skipped level, which is an accessibility and SEO fault.
       Instead the SHALLOWEST heading actually present becomes h2 and the rest
       cascade from there, so both conventions come out correct. */
    var minH = 9;
    for (var q = 0; q < lines.length; q++) {
      var mh = lines[q].trim().match(/^(#{1,4})\s+\S/);
      if (mh) minH = Math.min(minH, mh[1].length);
    }
    var hOffset = (minH === 9) ? 1 : (2 - minH);

    function closeList() {
      if (listType) { out.push('</' + listType + '>'); listType = null; }
    }
    function openList(kind) {
      if (listType !== kind) { closeList(); out.push('<' + kind + '>'); listType = kind; }
    }

    function inline(s) {
      return s
        .replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]{1,300}|\/[^\s)]{0,300})\)/g,
                 function (m, label, href) {
                   var ext = /^https?:/.test(href);
                   return '<a href="' + href + '"' +
                          (ext ? ' target="_blank" rel="noopener noreferrer"' : '') +
                          '>' + label + '</a>';
                 })
        .replace(/`([^`\n]{1,200})`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]{1,200})\*(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>');
    }

    for (var i = 0; i < lines.length; i++) {
      var raw  = lines[i];
      var line = raw.trim();

      if (!line) { closeList(); continue; }          // blank line: just closes a list

      var h  = line.match(/^(#{1,4})\s+(.*)$/);
      var ul = line.match(/^[-*+]\s+(.*)$/);
      var ol = line.match(/^\d{1,3}[.)]\s+(.*)$/);
      /* Matches &gt; not > — the source is HTML-escaped before parsing, so by
         this point a blockquote marker is already an entity. */
      var bq = line.match(/^&gt;\s?(.*)$/);
      var hr = /^(-{3,}|\*{3,}|_{3,})$/.test(line);

      if (hr)      { closeList(); out.push('<hr/>'); }
      else if (h)  { closeList();
                     var lvl = Math.min(Math.max(h[1].length + hOffset, 2), 5);
                     out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'); }
      else if (ul) { openList('ul'); out.push('<li>' + inline(ul[1]) + '</li>'); }
      else if (ol) { openList('ol'); out.push('<li>' + inline(ol[1]) + '</li>'); }
      else if (bq) { closeList(); out.push('<blockquote>' + inline(bq[1]) + '</blockquote>'); }
      else         { closeList(); out.push('<p>' + inline(line) + '</p>'); }
    }
    closeList();
    return out.join('\n');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-GB',
        { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) { return ''; }
  }

  global.DelaxCMS = {
    config: CMS,
    hydrate: hydrate,
    loadContent: loadContent,
    listArticles: listArticles,
    getArticle: getArticle,
    renderMarkdown: renderMarkdown,
    escapeHtml: esc,
    formatDate: formatDate,
    _resetCache: function () { cache = { at: 0, map: null }; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { hydrate(); });
  } else {
    hydrate();
  }

})(typeof window !== 'undefined' ? window : this);
