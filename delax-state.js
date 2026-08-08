/**
 * /delax-state.js — DELAX GEO-RISK — shared cross-page state
 * ─────────────────────────────────────────────────────────────────────────────
 * The platform is moving from one monolithic page to several destinations
 * (index, workspace, intel, analysis). Those pages must agree on what the user
 * is currently looking at, or switching structure on one and navigating to
 * another silently desyncs the whole model.
 *
 * SCOPE — selection and display preference only:
 *     scenario         'baseline' | 'optimistic' | 'pessimistic'
 *     structure        risk-structure id, e.g. 'hormuz-iran' | 'taiwan-strait'
 *     theme            'cyberpunk' | 'classic'
 *     fontScale        number, 0.85–1.4
 *     colorblind       boolean
 *     beginner         boolean
 *
 *   Structure DEFINITIONS live in risk-structures.js. This file only records
 *   which one is selected. Keep that separation — it's what lets a page load
 *   state before the (larger) definitions file has parsed.
 *
 * PRECEDENCE — URL parameter → localStorage → default.
 *   A URL parameter wins so that a link is a complete description of what the
 *   recipient will see:
 *     /workspace.html?structure=taiwan-strait&scenario=pessimistic
 *   That shareability is the entire reason for splitting to real pages, so the
 *   precedence order is load-bearing, not a convenience.
 *
 *   A URL parameter is persisted on arrival, so a shared link becomes the
 *   visitor's state for subsequent navigation within the site.
 *
 * EVENTS — every write emits `delax:statechange` on window:
 *     window.addEventListener('delax:statechange', (e) => {
 *       e.detail.changed   // ['structure'] — keys that actually moved
 *       e.detail.state     // full state after the write
 *       e.detail.previous  // full state before the write
 *     });
 *   Subscribe rather than poll. A write that changes nothing emits nothing, so
 *   handlers can be naive about re-entrancy.
 *
 * STORAGE — one localStorage key, `delax-state`, holding a JSON object. The
 *   legacy per-key values (delax-theme, delax-font) are migrated on first load
 *   and then left alone, so a returning visitor keeps their preferences.
 *
 * NO DEPENDENCIES. Load this BEFORE any page script that reads state, and
 * before risk-structures.js so ACTIVE_STRUCTURE is populated on first paint.
 */
'use strict';

(function (global) {

  var STORAGE_KEY = 'delax-state';

  /* Structure ids are validated against this list rather than accepted blind —
     a typo'd URL parameter must not put the platform into a state with no
     matching definition. Extend when a structure ships. */
  var VALID_STRUCTURES = ['hormuz-iran', 'taiwan-strait'];
  var VALID_SCENARIOS  = ['baseline', 'optimistic', 'pessimistic'];
  var VALID_THEMES     = ['cyberpunk', 'classic'];

  var FONT_MIN = 0.85, FONT_MAX = 1.4;

  var DEFAULTS = {
    scenario:   'baseline',
    structure:  'hormuz-iran',
    theme:      'cyberpunk',
    fontScale:  1,
    colorblind: false,
    beginner:   false,
  };

  /* URL parameter names → state keys. Both spellings accepted for structure
     because existing links in the wild use ?structure=. */
  var URL_KEYS = {
    structure:  'structure',
    struct:     'structure',
    scenario:   'scenario',
    theme:      'theme',
  };

  var state = null;   // resolved once on load
  var ready = false;

  /* ── validation ───────────────────────────────────────────── */

  function coerce(key, value) {
    if (value === null || value === undefined) return undefined;
    switch (key) {
      case 'scenario':
        value = String(value).toLowerCase();
        return VALID_SCENARIOS.indexOf(value) >= 0 ? value : undefined;
      case 'structure':
        value = String(value).toLowerCase();
        return VALID_STRUCTURES.indexOf(value) >= 0 ? value : undefined;
      case 'theme':
        value = String(value).toLowerCase();
        return VALID_THEMES.indexOf(value) >= 0 ? value : undefined;
      case 'fontScale': {
        var n = parseFloat(value);
        if (!isFinite(n)) return undefined;
        return Math.min(FONT_MAX, Math.max(FONT_MIN, n));
      }
      case 'colorblind':
      case 'beginner':
        if (typeof value === 'boolean') return value;
        value = String(value).toLowerCase();
        if (value === 'true'  || value === '1') return true;
        if (value === 'false' || value === '0') return false;
        return undefined;
      default:
        return undefined;
    }
  }

  /* ── storage ──────────────────────────────────────────────── */

  function readStored() {
    var out = {};
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (var k in DEFAULTS) {
            if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
            var v = coerce(k, parsed[k]);
            if (v !== undefined) out[k] = v;
          }
        }
      }
    } catch (_) { /* private mode / quota / malformed — fall through to defaults */ }

    /* Migrate the pre-split single-purpose keys once. */
    try {
      if (out.theme === undefined) {
        var t = coerce('theme', global.localStorage.getItem('delax-theme'));
        if (t !== undefined) out.theme = t;
      }
      if (out.fontScale === undefined) {
        var f = coerce('fontScale', global.localStorage.getItem('delax-font'));
        if (f !== undefined) out.fontScale = f;
      }
    } catch (_) { /* ignore */ }

    return out;
  }

  function persist() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      /* Mirror to the legacy keys so any page not yet migrated keeps working. */
      global.localStorage.setItem('delax-theme', state.theme);
      global.localStorage.setItem('delax-font',  String(state.fontScale));
    } catch (_) { /* non-fatal: state still lives in memory for this page */ }
  }

  function readUrl() {
    var out = {};
    try {
      var params = new global.URLSearchParams(global.location.search);
      for (var param in URL_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(URL_KEYS, param)) continue;
        if (!params.has(param)) continue;
        var key = URL_KEYS[param];
        var v = coerce(key, params.get(param));
        if (v !== undefined) out[key] = v;
      }
    } catch (_) { /* no URLSearchParams / odd query — ignore */ }
    return out;
  }

  /* ── resolution ───────────────────────────────────────────── */

  function resolve() {
    var stored = readStored();
    var url    = readUrl();
    var next   = {};
    for (var k in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
      next[k] = (url[k] !== undefined) ? url[k]
              : (stored[k] !== undefined) ? stored[k]
              : DEFAULTS[k];
    }
    state = next;
    ready = true;
    /* A URL parameter becomes the visitor's state, so a shared link carries
       through to whatever they navigate to next. */
    persist();
    return state;
  }

  function snapshot() {
    var copy = {};
    for (var k in state) {
      if (Object.prototype.hasOwnProperty.call(state, k)) copy[k] = state[k];
    }
    return copy;
  }

  function emit(changed, previous) {
    if (!changed.length) return;
    var detail = { changed: changed, state: snapshot(), previous: previous };
    try {
      global.dispatchEvent(new global.CustomEvent('delax:statechange', { detail: detail }));
    } catch (_) {
      /* Very old engines: CustomEvent constructor unavailable. */
      try {
        var ev = global.document.createEvent('CustomEvent');
        ev.initCustomEvent('delax:statechange', false, false, detail);
        global.dispatchEvent(ev);
      } catch (__) { /* give up quietly — writes still applied */ }
    }
  }

  /* ── public API ───────────────────────────────────────────── */

  var DelaxState = {

    /* Full current state (a copy — mutating it does nothing). */
    all: function () { if (!ready) resolve(); return snapshot(); },

    get: function (key) { if (!ready) resolve(); return state[key]; },

    /* set('structure', 'taiwan-strait') or set({structure: …, scenario: …}).
       Invalid values are ignored rather than throwing, so a bad value can never
       take a page down. Returns the keys that actually changed. */
    set: function (keyOrObj, maybeValue) {
      if (!ready) resolve();
      var patch = {};
      if (typeof keyOrObj === 'string') patch[keyOrObj] = maybeValue;
      else if (keyOrObj && typeof keyOrObj === 'object') patch = keyOrObj;
      else return [];

      var previous = snapshot();
      var changed  = [];
      for (var k in patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
        var v = coerce(k, patch[k]);
        if (v === undefined) continue;
        if (state[k] === v) continue;
        state[k] = v;
        changed.push(k);
      }
      if (changed.length) { persist(); emit(changed, previous); }
      return changed;
    },

    /* Subscribe to changes. Returns an unsubscribe function.
       { immediate: true } also fires once with the current state. */
    subscribe: function (handler, options) {
      if (typeof handler !== 'function') return function () {};
      var wrapped = function (e) { handler(e.detail); };
      global.addEventListener('delax:statechange', wrapped);
      if (options && options.immediate) {
        handler({ changed: [], state: DelaxState.all(), previous: null });
      }
      return function () { global.removeEventListener('delax:statechange', wrapped); };
    },

    /* Build a link to another page carrying the current selection, so anything
       shared from one destination lands identically on another. */
    linkTo: function (path, extra) {
      if (!ready) resolve();
      var qs = 'structure=' + encodeURIComponent(state.structure) +
               '&scenario=' + encodeURIComponent(state.scenario);
      if (extra && typeof extra === 'object') {
        for (var k in extra) {
          if (!Object.prototype.hasOwnProperty.call(extra, k)) continue;
          qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]);
        }
      }
      return path + (path.indexOf('?') >= 0 ? '&' : '?') + qs;
    },

    /* Reflect state onto <body> so CSS can respond without page-specific glue.
       Safe to call on any page; missing elements are skipped. */
    applyToDocument: function () {
      if (!ready) resolve();
      try {
        var b = global.document.body;
        if (!b) return;
        b.setAttribute('data-theme', state.theme);
        b.setAttribute('data-colorblind', state.colorblind ? 'true' : 'false');
        b.setAttribute('data-structure', state.structure);
        b.classList.toggle('beginner-mode', !!state.beginner);
        global.document.documentElement.style.setProperty('--font-scale', state.fontScale);
      } catch (_) { /* pre-body call — caller re-invokes after DOM ready */ }
    },

    /* Introspection, used by the gate suite. */
    VALID: {
      structures: VALID_STRUCTURES.slice(),
      scenarios:  VALID_SCENARIOS.slice(),
      themes:     VALID_THEMES.slice(),
      fontRange:  [FONT_MIN, FONT_MAX],
    },
    DEFAULTS: (function () {
      var d = {};
      for (var k in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) d[k] = DEFAULTS[k];
      }
      return d;
    })(),
    STORAGE_KEY: STORAGE_KEY,

    /* Test hook only — re-runs resolution against current URL + storage. */
    _reset: function () { ready = false; state = null; return resolve(); },
  };

  resolve();

  global.DelaxState = DelaxState;

  /* Legacy globals kept in sync so existing inline code that reads `scenario`
     or `ACTIVE_STRUCTURE` continues to work during the page-by-page migration.
     New code should call DelaxState.get() instead. */
  if (global.ACTIVE_STRUCTURE === undefined) global.ACTIVE_STRUCTURE = state.structure;
  DelaxState.subscribe(function (d) {
    if (d.changed.indexOf('structure') >= 0) global.ACTIVE_STRUCTURE = d.state.structure;
  });

})(typeof window !== 'undefined' ? window : this);
