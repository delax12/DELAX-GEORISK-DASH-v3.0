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

  function headerHtml(opts) {
    var meta = structureMeta();
    var scenario = global.DelaxState ? DelaxState.get('scenario') : 'baseline';

    var nav = NAV.map(function (n) {
      var current = (n.key === opts.active);
      var href = (global.DelaxState && !current) ? DelaxState.linkTo(n.href) : n.href;
      return '<a href="' + esc(href) + '"' + (current ? ' aria-current="page"' : '') + '>' +
             esc(n.label) + '</a>';
    }).join('');

    var seg = SCENARIOS.map(function (s) {
      var on = (s.id === scenario);
      return '<button type="button" data-scenario="' + s.id + '" ' +
             'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
             'title="' + esc(s.label) + ' scenario">' + esc(s.label.slice(0, 4)) + '</button>';
    }).join('');

    return '' +
      '<div class="dx-header-row">' +
        '<a class="dx-brand" href="/" aria-label="DELAX GEO-RISK home">' +
          '<span class="dx-mark" aria-hidden="true">◆</span>' +
          '<span class="dx-wordmark">DELAX <em>GEO-RISK</em></span>' +
        '</a>' +
        (opts.page ? '<span class="dx-divider" aria-hidden="true"></span>' +
                     '<span class="dx-page">' + esc(opts.page) + '</span>' : '') +
        '<span class="dx-spacer"></span>' +
        '<div class="dx-state" id="dxState" title="Active risk structure and evidence tier">' +
          '<span class="dx-state-name" id="dxStateName">' + esc(meta.name) + '</span>' +
          '<span class="dx-tier" id="dxStateTier" data-tier="' + esc(meta.tier) + '">' +
            esc(meta.tier) + '</span>' +
        '</div>' +
        '<div class="dx-scenario" id="dxScenario" role="group" aria-label="Scenario">' + seg + '</div>' +
        '<nav class="dx-nav" aria-label="Primary">' + nav + '</nav>' +
      '</div>';
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
