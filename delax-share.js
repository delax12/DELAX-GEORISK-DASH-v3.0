/**
 * /delax-share.js — DELAX GEO-RISK — sharing
 * ─────────────────────────────────────────────────────────────────────────────
 * Progressive enhancement for the share row. The three platform links are
 * rendered server-side as plain anchors, so they work with JavaScript disabled
 * and are visible to anything crawling the page. This file adds the two things
 * an anchor cannot do: the native share sheet and the clipboard.
 *
 * ══ WHAT EACH PLATFORM ACTUALLY ACCEPTS ══
 * Only X takes pre-filled text. Facebook dropped custom parameters from
 * sharer.php years ago and LinkedIn deprecated its title/summary parameters —
 * both now build the card solely from the Open Graph tags on the destination
 * page. So the "one sentence" still appears for those two, but it comes from
 * og:description, which /api/news.js emits server-side.
 *
 * We deliberately do NOT append text parameters those platforms ignore. A
 * parameter that silently does nothing is worse than an absent one: it looks
 * like it should work, so nobody investigates when it doesn't.
 *
 * Instagram has no web sharing URL for links at all. The only routes are the
 * native share sheet (mobile) and copy-paste — which is why the Copy button is
 * permanent rather than a fallback.
 *
 * The X text budget matters: a link always counts as 23 characters regardless
 * of its real length, so the hook is truncated against that, on a word
 * boundary, rather than being cut mid-word by the platform.
 */
'use strict';

(function (global) {

  var X_LIMIT   = 280;
  var X_URL_LEN = 23;   // t.co wraps every link to a fixed length
  var X_MARGIN  = 2;    // newline between hook and link

  /* Trim to a word boundary. Returns text unchanged when it already fits. */
  function fit(text, max) {
    text = String(text || '').trim();
    if (!text || text.length <= max) return text;
    var cut = text.slice(0, max - 1);
    var sp  = cut.lastIndexOf(' ');
    return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, '') + '…';
  }

  function xText(hook) {
    return fit(hook, X_LIMIT - X_URL_LEN - X_MARGIN);
  }

  /* The text placed on the clipboard, and offered to the native share sheet.
     Hook then link on its own line — the shape that pastes cleanly into
     Instagram, LinkedIn, Threads or anywhere else that blocks pre-fill. */
  function postText(hook, url) {
    return hook ? hook + '\n\n' + url : url;
  }

  function toast(msg) {
    var el = document.getElementById('dxShareToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dxShareToast';
      el.className = 'dx-share-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  async function copy(text, btn) {
    var ok = false;
    try {
      if (global.navigator && navigator.clipboard && global.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) { /* fall through to the legacy path */ }

    if (!ok) {
      /* Older browsers, and any context where the async clipboard is refused. */
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { ok = false; }
    }

    if (btn) {
      var original = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', original);
      btn.textContent = ok ? '✓ Copied' : 'Copy failed';
      setTimeout(function () { btn.textContent = original; }, 2000);
    }
    toast(ok ? 'Post text copied — paste it anywhere.'
             : 'Could not copy automatically. Select the text and copy manually.');
    return ok;
  }

  async function nativeShare(payload, btn) {
    if (!(global.navigator && navigator.share)) return false;
    try {
      await navigator.share({ title: payload.title, text: payload.hook, url: payload.url });
      return true;
    } catch (e) {
      /* AbortError means the person closed the sheet — not a failure, and it
         must not trigger a fallback that reopens something. */
      if (e && e.name === 'AbortError') return true;
      return false;
    }
  }

  /* Wire one share row. Safe to call repeatedly; rows are marked once bound. */
  function bind(root) {
    var scope = root || document;
    var rows  = scope.querySelectorAll('.dx-share:not([data-share-bound])');

    Array.prototype.forEach.call(rows, function (row) {
      row.setAttribute('data-share-bound', 'true');

      var url   = row.getAttribute('data-url')   || location.href;
      var hook  = row.getAttribute('data-hook')  || '';
      var title = row.getAttribute('data-title') || document.title;
      var text  = postText(hook, url);

      var copyBtn = row.querySelector('[data-share="copy"]');
      if (copyBtn) {
        copyBtn.addEventListener('click', function (e) {
          e.preventDefault();
          copy(text, copyBtn);
        });
      }

      /* The native sheet is the only way to reach Instagram and friends, so the
         button is revealed only where the API actually exists. */
      var nativeBtn = row.querySelector('[data-share="native"]');
      if (nativeBtn) {
        if (global.navigator && navigator.share) {
          nativeBtn.hidden = false;
          nativeBtn.addEventListener('click', async function (e) {
            e.preventDefault();
            var ok = await nativeShare({ title: title, hook: hook, url: url }, nativeBtn);
            if (!ok) copy(text, nativeBtn);
          });
        } else {
          nativeBtn.remove();
        }
      }
    });
  }

  /* Build the row markup. Used by the admin console, which renders client-side;
     article pages emit the same structure server-side so it exists without JS. */
  function rowHtml(opts) {
    var url   = String(opts.url || '');
    var hook  = String(opts.hook || '');
    var title = String(opts.title || '');
    var e = function (s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    var u = encodeURIComponent(url);

    return '<div class="dx-share" data-url="' + e(url) + '" data-hook="' + e(hook) +
             '" data-title="' + e(title) + '">' +
      '<span class="dx-share-label">Share</span>' +
      /* X is the only one of the three that accepts pre-filled text. */
      '<a class="dx-share-btn" target="_blank" rel="noopener noreferrer" data-share="x"' +
        ' href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(xText(hook)) +
        '&url=' + u + '" aria-label="Share on X">X</a>' +
      /* Facebook and LinkedIn take the URL only and read the card from the
         page's Open Graph tags. */
      '<a class="dx-share-btn" target="_blank" rel="noopener noreferrer" data-share="facebook"' +
        ' href="https://www.facebook.com/sharer/sharer.php?u=' + u +
        '" aria-label="Share on Facebook">Facebook</a>' +
      '<a class="dx-share-btn" target="_blank" rel="noopener noreferrer" data-share="linkedin"' +
        ' href="https://www.linkedin.com/sharing/share-offsite/?url=' + u +
        '" aria-label="Share on LinkedIn">LinkedIn</a>' +
      '<button type="button" class="dx-share-btn" data-share="native" hidden' +
        ' aria-label="Share via your device, including Instagram">More…</button>' +
      '<button type="button" class="dx-share-btn" data-share="copy"' +
        ' aria-label="Copy post text and link">Copy</button>' +
    '</div>';
  }

  global.DelaxShare = {
    bind: bind,
    rowHtml: rowHtml,
    postText: postText,
    xText: xText,
    fit: fit,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bind(); });
  } else {
    bind();
  }

})(typeof window !== 'undefined' ? window : this);
