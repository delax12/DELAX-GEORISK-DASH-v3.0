/**
 * /delax-chrome.js — shared header + footer renderer
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders identical chrome into every DELAX surface so the four destinations
 * (Landing, Intel, Workspace, Analysis) cannot drift apart, and so the model
 * state a visitor is reading is always stated the same way in the same place.
 *
 * USAGE — put mount points in the page and call render:
 *     <div id="dxHeader"></div>  …  <div id="dxFooter"></div>
 *     DelaxChrome.render({ page: 'Investor Workspace', active: 'workspace' });
 *
 * Requires /delax-state.js (loaded first) and /delax-chrome.css.
 *
 * WHY JS AND NOT MARKUP: with no build step, duplicated header markup across
 * four pages is four places to forget. One renderer means a change to the tier
 * badge or the scenario control lands everywhere at once.
 *
 * The scenario control writes through DelaxState, so every page reacts through
 * the normal `delax:statechange` event — this file owns no state of its own.
 */
'use strict';

(function (global) {

  var SCENARIOS = [
    { id: 'optimistic',  label: 'Optimistic'  },
    { id: 'baseline',    label: 'Baseline'    },
    { id: 'pessimistic', label: 'Pessimistic' },
  ];

  /* Fallback structure metadata. risk-structures.js is authoritative when
     present; this keeps the header honest if it hasn't parsed yet. */
  var STRUCTURE_FALLBACK = {
    'hormuz-iran':   { name: 'Hormuz / Iran',  tier: 'EMPIRICAL' },
    'taiwan-strait': { name: 'Taiwan Strait',  tier: 'UNPRICED'  },
  };

  var NAV = [
    { key: 'dashboard', href: '/',                    label: 'Dashboard' },
    { key: 'workspace', href: '/workspace.html',      label: 'Workspace' },
    { key: 'exposure',  href: '/exposure-desk.html',  label: 'Exposure'  },
    { key: 'insights',  href: '/insights.html',       label: 'Insights'  },
    { key: 'method',    href: '/methodology.html',    label: 'Method'    },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function structureMeta() {
    var id = global.DelaxState ? DelaxState.get('structure') : 'hormuz-iran';
    var fb = STRUCTURE_FALLBACK[id] || { name: id, tier: '' };
    try {
      var reg = global.RISK_STRUCTURES;
      if (reg && reg[id]) {
        return {
          id: id,
          name: reg[id].shortName || reg[id].name || fb.name,
          tier: (reg[id].tier || fb.tier || '').toUpperCase(),
        };
      }
    } catch (e) {}
    return { id: id, name: fb.name, tier: fb.tier };
  }

  function navHtml(opts) {
    return NAV.map(function (n) {
      var current = (n.key === opts.active);
      var href = (global.DelaxState && !current) ? DelaxState.linkTo(n.href) : n.href;
      return '<a href="' + esc(href) + '" data-nav="' + n.key + '"' +
             (current ? ' aria-current="page"' : '') +
             ' title="' + esc(n.label) + '"><span class="dx-nav-label">' +
             esc(n.label) + '</span></a>';
    }).join('');
  }

  function headerHtml(opts) {
    var meta = structureMeta();
    var scenario = global.DelaxState ? DelaxState.get('scenario') : 'baseline';

    var seg = SCENARIOS.map(function (s) {
      var on = (s.id === scenario);
      return '<button type="button" data-scenario="' + s.id + '" ' +
             'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
             'title="' + esc(s.label) + ' scenario">' + esc(s.label.slice(0, 4)) + '</button>';
    }).join('');

    /* STATE CHIP — two modes.
       Display mode shows the active structure and its tier.
       Switcher mode hands the page an empty #structureBtns plus #tierBadge, which
       the host page's own buildStructureBar()/styleStructureBtns() populate. That
       keeps the dashboard's existing structure logic working untouched while the
       layout consolidates around it. The tier badge sits INSIDE the switcher so
       the evidence grade is visible at the moment of choosing, not after. */
    var stateChip = opts.structureSwitcher
      ? '<div class="dx-state dx-state-switch" id="dxState">' +
          '<span class="dx-state-label">Risk structure</span>' +
          '<div id="structureBtns" role="tablist" aria-label="Risk structure"></div>' +
          '<span class="dx-tier" id="tierBadge"></span>' +
        '</div>'
      : '<div class="dx-state" id="dxState" title="Active risk structure and evidence tier">' +
          '<span class="dx-state-name" id="dxStateName">' + esc(meta.name) + '</span>' +
          '<span class="dx-tier" id="dxStateTier" data-tier="' + esc(meta.tier) + '">' +
            esc(meta.tier) + '</span>' +
        '</div>';

    /* The scenario control is optional: the dashboard already carries its own,
       labelled with structure-specific scenario names ("Armed Truce"), which is
       more informative than the generic three. Two scenario controls on one page
       is worse than one good one. */
    var scenarioCtl = (opts.scenario === false) ? ''
      : '<div class="dx-scenario" id="dxScenario" role="group" aria-label="Scenario">' + seg + '</div>';

    /* LAYOUT — two bands, never three.
       Band 1 is identity and navigation: who this is, where you are, where you
       can go. Band 2 is the instrument row: which model is loaded, what it says
       right now, and the actions that change it.

       The state chip belongs in band 2 rather than beside the nav. Rendered at
       1280px with the nav it forced a wrap to a third line, which is the exact
       problem this consolidation exists to remove — and the tier badge reads
       better sitting with the live data it qualifies than floating in the
       navigation. It stays above the fold at every width. */
    var row1 =
      '<div class="dx-header-row">' +
        '<a class="dx-brand" href="/" aria-label="DELAX GEO-RISK home">' +
          '<span class="dx-mark" aria-hidden="true">◆</span>' +
          '<span class="dx-wordmark">DELAX <em>GEO-RISK</em></span>' +
        '</a>' +
        (opts.page ? '<span class="dx-divider" aria-hidden="true"></span>' +
                     '<span class="dx-page">' + esc(opts.page) + '</span>' : '') +
        (opts.subtitle ? '<span class="dx-subtitle" id="structSubtitle">' + esc(opts.subtitle) + '</span>' : '') +
        '<span class="dx-spacer"></span>' +
        scenarioCtl +
        '<nav class="dx-nav" aria-label="Primary">' + navHtml(opts) + '</nav>' +
      '</div>';

    var row2 = (opts.context || opts.structureSwitcher || !opts.structureSwitcher)
      ? '<div class="dx-context">' + stateChip +
        (opts.context ? '<span class="dx-spacer"></span>' + opts.context : '') +
        '</div>'
      : '';

    return row1 + row2;
  }

  function footerHtml(opts) {
    var links = NAV.concat([{ key: 'assumptions', href: '/methodology.html#assumptions', label: 'Model assumptions' }])
      .map(function (n) {
        var current = (n.key === opts.active);
        var href = (global.DelaxState && !current) ? DelaxState.linkTo(n.href) : n.href;
        return '<a href="' + esc(href) + '"' + (current ? ' aria-current="page"' : '') + '>' +
               esc(n.label) + '</a>';
      }).join('');

    return '' +
      '<div class="footer-line footer-brand">' +
        '<strong>DELAX GEO-RISK</strong> · Cross-asset geopolitical risk analytics' +
      '</div>' +
      '<div class="footer-line footer-meta">Model <span id="footerVersion">v5.0</span></div>' +
      '<div class="footer-line footer-dim" id="footerSources">' +
        'Sources: EIA · FRED · Twelve Data · GDELT · IMF WEO · SIPRI · FAO · Baltic Exchange' +
      '</div>' +
      '<nav class="footer-links" aria-label="Footer">' + links + '</nav>' +
      '<div class="footer-line footer-legal">' +
        'Analysis, not advice. Scenario outputs are probabilistic model estimates — not forecasts, ' +
        'not recommendations, and not personalised investment advice. Consult a qualified adviser ' +
        'before acting on anything you read here. © 2026 DELAXCOM LLC.' +
      '</div>';
  }

  /* Reflect current state into already-rendered chrome without a full rebuild,
     so focus is never stolen mid-interaction. */
  function sync() {
    var meta = structureMeta();
    var nameEl = document.getElementById('dxStateName');
    var tierEl = document.getElementById('dxStateTier');
    if (nameEl) nameEl.textContent = meta.name;
    if (tierEl) {
      tierEl.textContent = meta.tier;
      tierEl.setAttribute('data-tier', meta.tier);
      tierEl.style.display = meta.tier ? '' : 'none';
    }
    /* Nav hrefs carry the current selection, so they must be refreshed whenever
       structure or scenario moves — otherwise a link shares stale state. */
    var nav = document.querySelectorAll('.dx-nav a[data-nav]');
    Array.prototype.forEach.call(nav, function (a) {
      if (a.getAttribute('aria-current') === 'page') return;
      var key = a.getAttribute('data-nav');
      for (var i = 0; i < NAV.length; i++) {
        if (NAV[i].key === key && global.DelaxState) a.href = DelaxState.linkTo(NAV[i].href);
      }
    });

    var scenario = global.DelaxState ? DelaxState.get('scenario') : 'baseline';
    var wrap = document.getElementById('dxScenario');
    if (wrap) {
      Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-scenario') === scenario ? 'true' : 'false');
      });
    }
  }

  var DelaxChrome = {
    render: function (opts) {
      opts = opts || {};
      var head = document.getElementById(opts.headerMount || 'dxHeader');
      var foot = document.getElementById(opts.footerMount || 'dxFooter');

      if (head) {
        head.className = 'dx-header';
        head.setAttribute('role', 'banner');
        head.innerHTML = headerHtml(opts);

        var wrap = document.getElementById('dxScenario');
        if (wrap) {
          wrap.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('button[data-scenario]') : null;
            if (!btn || !global.DelaxState) return;
            DelaxState.set('scenario', btn.getAttribute('data-scenario'));
          });
        }
      }

      if (foot) {
        foot.className = 'footer';
        foot.setAttribute('role', 'contentinfo');
        foot.innerHTML = footerHtml(opts);
      }

      if (global.DelaxState) DelaxState.subscribe(function () { sync(); });
      sync();
      return true;
    },
    sync: sync,
    _structureMeta: structureMeta,
  };

  global.DelaxChrome = DelaxChrome;

})(typeof window !== 'undefined' ? window : this);
