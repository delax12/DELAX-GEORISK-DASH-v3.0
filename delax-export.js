/**
 * /delax-export.js — DELAX GEO-RISK — result export
 * ─────────────────────────────────────────────────────────────────────────────
 * Turns a computed portfolio exposure into a shareable card, a spreadsheet, a
 * CSV or a PDF. All client-side. No function slot, no upload.
 *
 * ══ WHY THE PNG IS COMPOSED, NOT SCREENSHOTTED ══
 * A DOM capture returns whatever the page happens to look like at that moment:
 * narrow on a phone, mid-scroll, clipped at a panel edge, missing whatever the
 * font loader had not finished. The card is instead drawn onto a fixed
 * 1200×675 canvas, so a phone and a desktop produce byte-comparable output and
 * the thing that gets posted is the thing that was designed.
 *
 * ══ WHY THE TIER BADGE IS NOT OPTIONAL FURNITURE ══
 * Every artifact carries the structure's calibration tier. A Taiwan card that
 * travels without its UNPRICED marking is a number detached from its evidence
 * basis, which is the failure this platform exists to avoid. The badge is
 * drawn before the figures, in every format, and cannot be switched off.
 *
 * ══ WHY DOLLAR VALUES ARE OFF BY DEFAULT ON THE CARD ══
 * The PNG exists to be posted publicly. The spreadsheet and CSV exist for the
 * user's own records. So the card defaults to percentages and weights with
 * absolute values suppressed, behind an explicit opt-in; the private formats
 * carry everything. Sharing a screenshot should not be how someone discloses
 * their account size.
 */
'use strict';

(function (global) {

  var CDN = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  };

  var _scripts = {};
  function loadScript(url) {
    if (_scripts[url]) return _scripts[url];
    _scripts[url] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete _scripts[url]; reject(new Error('Could not load the export library.')); };
      document.head.appendChild(s);
    });
    return _scripts[url];
  }
  function ensureXLSX() {
    if (global.XLSX) return Promise.resolve();
    return loadScript(CDN.xlsx);
  }
  function ensureJsPDF() {
    if (global.jspdf && global.jspdf.jsPDF) return Promise.resolve();
    return loadScript(CDN.jspdf);
  }

  /* ═════════════════════════════════════════
     PALETTE — mirrors the :root tokens. Canvas cannot read CSS custom
     properties, so these are duplicated deliberately and must be changed in
     both places if the theme moves.
     ═════════════════════════════════════════ */
  var C = {
    bgDeep:  '#080c14',
    bgCard:  '#0d1525',
    bgPanel: '#111d33',
    border:  '#1e3055',
    borderDim: '#152238',
    amber:   '#f5a623',
    cyan:    '#00d4ff',
    green:   '#00e676',
    red:     '#ff3d4a',
    yellow:  '#ffe040',
    textPri: '#e8edf5',
    textSec: '#7a91b3',
    textDim: '#7189ad',
  };
  var MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

  var W = 1200, H = 675, PAD = 56;

  var _cfg = { getSnapshot: null };
  var _opts = { includeValues: false };

  function configure(o) {
    if (o && typeof o.getSnapshot === 'function') _cfg.getSnapshot = o.getSnapshot;
  }

  function snap() {
    var s = _cfg.getSnapshot ? _cfg.getSnapshot() : null;
    if (!s || !s.rows || !s.rows.length) return null;
    return s;
  }

  /* ═════════════════════════════════════════
     FORMATTING
     ═════════════════════════════════════════ */
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(x, dp) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(dp === undefined ? 1 : dp) + '%'; }
  function stamp(d) {
    var dt = d ? new Date(d) : new Date();
    return dt.toISOString().slice(0, 10);
  }
  function stampLong(d) {
    var dt = d ? new Date(d) : new Date();
    return dt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  function fileStem(s) {
    return 'DELAX-Exposure-' + String(s.structure.id || 'structure') + '-' +
           String(s.scenario || 'baseline') + '-' + stamp(s.generatedAt);
  }

  /* ═════════════════════════════════════════
     CANVAS TEXT HELPERS
     Letter-spacing is drawn per glyph rather than via ctx.letterSpacing,
     which is absent in older Safari and would silently render the header
     without its tracking on exactly the devices most likely to be sharing.
     ═════════════════════════════════════════ */
  function tracked(ctx, text, x, y, spacing) {
    text = String(text);
    if (!spacing) { ctx.fillText(text, x, y); return ctx.measureText(text).width; }
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + spacing;
    }
    return cx - x - spacing;
  }
  function trackedWidth(ctx, text, spacing) {
    text = String(text);
    if (!spacing) return ctx.measureText(text).width;
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + spacing;
    return w - spacing;
  }
  function rightTracked(ctx, text, xRight, y, spacing) {
    tracked(ctx, text, xRight - trackedWidth(ctx, text, spacing), y, spacing);
  }
  function clip(ctx, text, maxW) {
    text = String(text);
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  function fontsReady() {
    if (!global.document || !document.fonts) return Promise.resolve();
    var loads = [
      '400 13px ' + MONO, '500 15px ' + MONO, '600 20px ' + MONO, '700 34px ' + MONO,
    ].map(function (f) {
      try { return document.fonts.load(f); } catch (e) { return Promise.resolve(); }
    });
    return Promise.all(loads).then(function () {
      return document.fonts.ready;
    }).catch(function () {});
  }

  /* ═════════════════════════════════════════
     CARD COMPOSITION
     ═════════════════════════════════════════ */
  function drawCard(s, includeValues) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var cv = document.createElement('canvas');
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.textBaseline = 'alphabetic';

    /* Background + faint grid — the panel texture the rest of the product uses */
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(30,48,85,0.35)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= W; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, H); ctx.stroke();
    }
    for (var gy = 0; gy <= H; gy += 40) {
      ctx.beginPath(); ctx.moveTo(0, gy + 0.5); ctx.lineTo(W, gy + 0.5); ctx.stroke();
    }
    /* Amber spine, matching the panel treatment on the site */
    ctx.fillStyle = C.amber;
    ctx.fillRect(0, 0, 4, H);

    /* ── Header ── */
    ctx.font = '700 34px ' + MONO;
    ctx.fillStyle = C.amber;
    var wDelax = tracked(ctx, 'DELAX', PAD, 78, 3);
    ctx.fillStyle = C.textPri;
    tracked(ctx, ' GEO-RISK', PAD + wDelax + 6, 78, 3);

    ctx.font = '500 13px ' + MONO;
    ctx.fillStyle = C.textDim;
    tracked(ctx, 'PORTFOLIO EXPOSURE REPORT', PAD, 102, 2.4);

    /* Structure + calibration tier, right aligned */
    var tier = String(s.structure.tier || '').toUpperCase();
    ctx.font = '600 20px ' + MONO;
    ctx.fillStyle = C.textPri;
    rightTracked(ctx, s.structure.name || '—', W - PAD, 72, 1);

    if (tier) {
      ctx.font = '600 12px ' + MONO;
      var tw = trackedWidth(ctx, tier, 2.2) + 20;
      var tx = W - PAD - tw, ty = 86;
      var tcol = tier === 'EMPIRICAL' ? C.green : C.amber;
      ctx.strokeStyle = tcol;
      ctx.fillStyle = tier === 'EMPIRICAL' ? 'rgba(0,230,118,0.10)' : 'rgba(245,166,35,0.10)';
      ctx.lineWidth = 1;
      ctx.fillRect(tx, ty, tw, 22);
      ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 21);
      ctx.fillStyle = tcol;
      tracked(ctx, tier, tx + 10, ty + 15.5, 2.2);
    }

    ctx.strokeStyle = C.border;
    ctx.beginPath(); ctx.moveTo(PAD, 122.5); ctx.lineTo(W - PAD, 122.5); ctx.stroke();

    /* ── Scenario strip ── */
    ctx.font = '500 12px ' + MONO;
    ctx.fillStyle = C.textDim;
    var sx = tracked(ctx, 'SCENARIO', PAD, 150, 2.2);
    ctx.fillStyle = C.cyan;
    tracked(ctx, String(s.scenarioLabel || s.scenario || 'Baseline').toUpperCase(), PAD + sx + 14, 150, 2.2);

    ctx.fillStyle = C.textDim;
    rightTracked(ctx, 'POSITIONS ' + s.rows.length +
      (s.uncoveredCount ? '  ·  UNMODELLED ' + s.uncoveredCount : ''), W - PAD, 150, 2.2);

    /* ── Holdings table ── */
    var colT = PAD, colS = PAD + 128, colW = 700, col12 = 900, col36 = W - PAD;
    var y = 190;

    ctx.font = '500 11px ' + MONO;
    ctx.fillStyle = C.textDim;
    tracked(ctx, 'TICKER', colT, y, 2);
    tracked(ctx, 'SECTOR', colS, y, 2);
    rightTracked(ctx, includeValues ? 'VALUE' : 'WEIGHT', colW, y, 2);
    rightTracked(ctx, '12M', col12, y, 2);
    rightTracked(ctx, '3-YEAR', col36, y, 2);

    ctx.strokeStyle = C.borderDim;
    ctx.beginPath(); ctx.moveTo(PAD, y + 10.5); ctx.lineTo(W - PAD, y + 10.5); ctx.stroke();

    var MAX_ROWS = 7;
    var shown = s.rows.slice(0, MAX_ROWS);
    var hidden = s.rows.length - shown.length;
    var totalValue = s.totalValue || 0;

    y += 34;
    shown.forEach(function (r) {
      ctx.font = '600 15px ' + MONO;
      ctx.fillStyle = r.covered ? C.textPri : C.textSec;
      tracked(ctx, r.ticker, colT, y, 1);

      ctx.font = '400 12px ' + MONO;
      ctx.fillStyle = C.textDim;
      ctx.fillText(clip(ctx, r.covered ? (r.sector || '—') : 'not modelled', colW - colS - 90), colS, y);

      ctx.font = '500 14px ' + MONO;
      ctx.fillStyle = C.textSec;
      var weightTxt = includeValues
        ? money(r.value)
        : (totalValue > 0 ? ((r.value / totalValue) * 100).toFixed(1) + '%' : '—');
      rightTracked(ctx, weightTxt, colW, y, 0.5);

      if (r.covered) {
        ctx.font = '600 14px ' + MONO;
        ctx.fillStyle = r.adj12 >= 0 ? C.green : C.red;
        rightTracked(ctx, pct(r.adj12), col12, y, 0.5);
        ctx.fillStyle = r.adj36 >= 0 ? C.green : C.red;
        rightTracked(ctx, pct(r.adj36), col36, y, 0.5);
      } else {
        ctx.font = '500 14px ' + MONO;
        ctx.fillStyle = C.textDim;
        rightTracked(ctx, '—', col12, y, 0.5);
        rightTracked(ctx, '—', col36, y, 0.5);
      }
      y += 30;
    });

    if (hidden > 0) {
      ctx.font = '400 12px ' + MONO;
      ctx.fillStyle = C.textDim;
      tracked(ctx, '+ ' + hidden + ' further position' + (hidden === 1 ? '' : 's'), colT, y, 1.5);
      y += 30;
    }

    /* ── Result band ── */
    var bandY = 466, bandH = 96;
    ctx.fillStyle = C.bgPanel;
    ctx.fillRect(PAD, bandY, W - PAD * 2, bandH);
    ctx.strokeStyle = C.border;
    ctx.strokeRect(PAD + 0.5, bandY + 0.5, W - PAD * 2 - 1, bandH - 1);
    ctx.fillStyle = C.amber;
    ctx.fillRect(PAD, bandY, 3, bandH);

    var cellW = (W - PAD * 2) / 3;
    var cells = [
      { label: '12-MONTH MODELLED IMPACT', value: pct(s.p12), colour: s.p12 >= 0 ? C.green : C.red },
      { label: '3-YEAR MODELLED IMPACT',   value: pct(s.p36), colour: s.p36 >= 0 ? C.green : C.red },
      {
        /* VaR is quoted as an absolute loss on screen. On a card with values
           suppressed that single figure would disclose the portfolio size the
           rest of the card is withholding, so the percentage form is used. */
        label: '1-WEEK 95% VALUE AT RISK',
        value: s.varStatus !== 'ok' ? 'not available'
             : includeValues ? s.varText
             : (isFinite(s.varPct) ? '−' + (s.varPct * 100).toFixed(1) + '%' : 'hidden'),
        colour: s.varStatus === 'ok' ? C.yellow : C.textDim,
      },
    ];
    cells.forEach(function (cell, i) {
      var cx = PAD + cellW * i + 26;
      ctx.font = '500 11px ' + MONO;
      ctx.fillStyle = C.textDim;
      tracked(ctx, cell.label, cx, bandY + 32, 2);
      ctx.font = '700 30px ' + MONO;
      ctx.fillStyle = cell.colour;
      tracked(ctx, cell.value, cx, bandY + 74, 1);
      if (i > 0) {
        ctx.strokeStyle = C.borderDim;
        ctx.beginPath();
        ctx.moveTo(PAD + cellW * i + 0.5, bandY + 16);
        ctx.lineTo(PAD + cellW * i + 0.5, bandY + bandH - 16);
        ctx.stroke();
      }
    });

    /* Modelled base — the denominator is not decoration, it is the reason the
       percentage is what it is. */
    ctx.font = '400 11px ' + MONO;
    ctx.fillStyle = C.textDim;
    var baseTxt = includeValues
      ? 'Impact measured on ' + money(s.coveredValue) + ' of modelled holdings' +
        (s.uncoveredValue > 0 ? '; ' + money(s.uncoveredValue) + ' unmodelled and excluded' : '')
      : 'Impact measured on modelled holdings only' +
        (s.uncoveredValue > 0 && s.totalValue
          ? '; ' + Math.round((s.uncoveredValue / s.totalValue) * 100) + '% of the portfolio is unmodelled and excluded'
          : '');
    tracked(ctx, baseTxt, PAD, bandY + bandH + 24, 0.6);

    /* ── Footer ── */
    ctx.strokeStyle = C.borderDim;
    ctx.beginPath(); ctx.moveTo(PAD, H - 62.5); ctx.lineTo(W - PAD, H - 62.5); ctx.stroke();

    ctx.font = '600 14px ' + MONO;
    ctx.fillStyle = C.amber;
    tracked(ctx, 'delaxcom.org', PAD, H - 36, 1.5);

    ctx.font = '400 11px ' + MONO;
    ctx.fillStyle = C.textDim;
    tracked(ctx, 'Modelled estimate under a stated scenario — not a forecast, not investment advice.',
      PAD, H - 18, 0.5);

    rightTracked(ctx, stampLong(s.generatedAt), W - PAD, H - 36, 1);
    if (tier === 'UNPRICED') {
      ctx.fillStyle = C.amber;
      rightTracked(ctx, 'Sector betas for this structure are not empirically calibrated.',
        W - PAD, H - 18, 0.5);
    } else {
      rightTracked(ctx, 'Sector betas published in full at /methodology.html', W - PAD, H - 18, 0.5);
    }

    return cv;
  }

  function renderCanvas(includeValues) {
    var s = snap();
    if (!s) return Promise.reject(new Error('Add holdings first — there is nothing to export yet.'));
    return fontsReady().then(function () { return drawCard(s, !!includeValues); });
  }

  /* ═════════════════════════════════════════
     DOWNLOAD PLUMBING
     ═════════════════════════════════════════ */
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function canvasBlob(cv) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('Could not render the image.'));
      }, 'image/png');
    });
  }

  /* ═════════════════════════════════════════
     PNG
     ═════════════════════════════════════════ */
  function exportPNG() {
    var s = snap();
    if (!s) return toast('Add holdings first — there is nothing to export yet.', true);
    return renderCanvas(_opts.includeValues)
      .then(canvasBlob)
      .then(function (blob) {
        download(blob, fileStem(s) + '.png');
        toast('Image saved');
      })
      .catch(function (e) { toast(e.message, true); });
  }

  function sharePNG() {
    var s = snap();
    if (!s) return toast('Add holdings first — there is nothing to export yet.', true);
    return renderCanvas(_opts.includeValues)
      .then(canvasBlob)
      .then(function (blob) {
        var file = new File([blob], fileStem(s) + '.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({
            files: [file],
            title: 'DELAX GEO-RISK — portfolio exposure',
            text: 'Modelled exposure under ' + s.structure.name + ' · ' + s.scenarioLabel,
          }).catch(function (e) { if (e && e.name !== 'AbortError') throw e; });
        }
        download(blob, fileStem(s) + '.png');
        toast('Image saved — sharing is not available in this browser');
      })
      .catch(function (e) { toast(e.message, true); });
  }

  /* ═════════════════════════════════════════
     SPREADSHEET
     The third sheet is the point of the file. An exported number with no
     provenance is exactly how a modelled estimate gets re-cited as a fact, so
     the structure, its calibration tier, the scenario multiplier and the
     disclaimer travel inside the workbook rather than alongside it.
     ═════════════════════════════════════════ */
  function exportXLSX() {
    var s = snap();
    if (!s) return toast('Add holdings first — there is nothing to export yet.', true);

    return ensureXLSX().then(function () {
      var XLSX = global.XLSX;
      var wb = XLSX.utils.book_new();

      var hold = [[
        'Ticker', 'Sector', 'Modelled', 'Shares', 'Avg cost', 'Position value',
        '12M impact %', '3Y impact %', '12M impact $', '3Y impact $',
      ]];
      s.rows.forEach(function (r) {
        hold.push([
          r.ticker,
          r.covered ? (r.sector || '') : 'Not modelled by this structure',
          r.covered ? 'Yes' : 'No',
          r.shares,
          round2(r.cost),
          round2(r.value),
          r.covered ? round4(r.adj12) : '',
          r.covered ? round4(r.adj36) : '',
          r.covered ? round2(r.value * r.adj12) : '',
          r.covered ? round2(r.value * r.adj36) : '',
        ]);
      });
      var wsH = XLSX.utils.aoa_to_sheet(hold);
      wsH['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
                      { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, wsH, 'Holdings');

      var imp = [
        ['Scenario impact summary'], [],
        ['Risk structure', s.structure.name],
        ['Calibration tier', s.structure.tier],
        ['Scenario', s.scenarioLabel],
        ['Scenario intensity multiplier', s.mult],
        [],
        ['Total portfolio value', round2(s.totalValue)],
        ['Modelled subtotal', round2(s.coveredValue)],
        ['Unmodelled and excluded', round2(s.uncoveredValue)],
        ['Unmodelled share of portfolio', s.totalValue ? round4(s.uncoveredValue / s.totalValue) : 0],
        [],
        ['12-month modelled impact %', round4(s.p12)],
        ['3-year modelled impact %', round4(s.p36)],
        ['12-month modelled impact $', round2(s.coveredValue * s.p12)],
        ['3-year modelled impact $', round2(s.coveredValue * s.p36)],
        [],
        ['1-week 95% Value at Risk', s.varStatus === 'ok' ? s.varText : 'Not available'],
        ['Value at Risk basis', s.varDetail || ''],
      ];
      var wsI = XLSX.utils.aoa_to_sheet(imp);
      wsI['!cols'] = [{ wch: 34 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, wsI, 'Scenario Impact');

      var meth = [
        ['Methodology and provenance'], [],
        ['Generated', stampLong(s.generatedAt)],
        ['Source', 'DELAX GEO-RISK — delaxcom.org'],
        ['Full methodology', 'https://delaxcom.org/methodology.html'],
        [],
        ['Risk structure', s.structure.name],
        ['Calibration tier', s.structure.tier],
        ['What the tier means', s.structure.tier === 'EMPIRICAL'
          ? 'Sector sensitivities are fitted to observed market behaviour during the referenced conflict.'
          : 'Sector sensitivities are not empirically calibrated. They are structural estimates and should be read as directional, not quantitative.'],
        [],
        ['Impact model',
          'Each modelled holding carries a published sector beta for a 12-month and a 3-year horizon. ' +
          'The beta is scaled by the scenario intensity multiplier and applied to position value.'],
        ['Denominator',
          'Percentages are computed on modelled holdings only. Holdings the structure does not cover are ' +
          'excluded from both impact and risk rather than scored as zero, which would understate the ' +
          'percentage by exactly the uncovered share.'],
        ['Value at Risk',
          'Historical simulation of realised weekly returns, read at the 5th percentile. Not parametric: ' +
          'correlation between holdings is inherited from realised data. Price risk only — foreign-listed ' +
          'holdings are measured in their own quote currency, so currency movement is excluded.'],
        [],
        ['Disclaimer',
          'This file contains modelled estimates under a stated scenario. It is not a forecast, not a ' +
          'prediction, and not financial, investment or legal advice. Figures are probabilistic model ' +
          'outputs. Consult a qualified financial adviser before making investment decisions.'],
      ];
      var wsM = XLSX.utils.aoa_to_sheet(meth);
      wsM['!cols'] = [{ wch: 26 }, { wch: 110 }];
      XLSX.utils.book_append_sheet(wb, wsM, 'Methodology');

      XLSX.writeFile(wb, fileStem(s) + '.xlsx');
      toast('Spreadsheet saved');
    }).catch(function (e) { toast(e.message, true); });
  }

  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  function round4(n) { return Math.round((+n || 0) * 10000) / 10000; }

  /* ═════════════════════════════════════════
     CSV
     ═════════════════════════════════════════ */
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCSVFile() {
    var s = snap();
    if (!s) return toast('Add holdings first — there is nothing to export yet.', true);

    var lines = [];
    lines.push(['# DELAX GEO-RISK — portfolio exposure'].map(csvCell).join(','));
    lines.push(['# Structure', s.structure.name, 'Calibration', s.structure.tier].map(csvCell).join(','));
    lines.push(['# Scenario', s.scenarioLabel, 'Generated', stampLong(s.generatedAt)].map(csvCell).join(','));
    lines.push(['# Modelled estimate under a stated scenario — not a forecast, not investment advice.'].map(csvCell).join(','));
    lines.push(['# Methodology: https://delaxcom.org/methodology.html'].map(csvCell).join(','));
    lines.push('');
    lines.push(['Ticker', 'Sector', 'Modelled', 'Shares', 'Avg cost', 'Position value',
                '12M impact %', '3Y impact %', '12M impact $', '3Y impact $'].join(','));
    s.rows.forEach(function (r) {
      lines.push([
        r.ticker,
        r.covered ? (r.sector || '') : 'Not modelled by this structure',
        r.covered ? 'Yes' : 'No',
        r.shares, round2(r.cost), round2(r.value),
        r.covered ? round4(r.adj12) : '',
        r.covered ? round4(r.adj36) : '',
        r.covered ? round2(r.value * r.adj12) : '',
        r.covered ? round2(r.value * r.adj36) : '',
      ].map(csvCell).join(','));
    });
    lines.push('');
    lines.push(['Modelled subtotal', round2(s.coveredValue)].map(csvCell).join(','));
    lines.push(['Unmodelled and excluded', round2(s.uncoveredValue)].map(csvCell).join(','));
    lines.push(['12M modelled impact %', round4(s.p12)].map(csvCell).join(','));
    lines.push(['3Y modelled impact %', round4(s.p36)].map(csvCell).join(','));
    lines.push(['1-week 95% VaR', s.varStatus === 'ok' ? s.varText : 'Not available'].map(csvCell).join(','));

    download(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), fileStem(s) + '.csv');
    toast('CSV saved');
  }

  /* ═════════════════════════════════════════
     PDF — card on page one, full detail on page two
     ═════════════════════════════════════════ */
  function exportPDF() {
    var s = snap();
    if (!s) return toast('Add holdings first — there is nothing to export yet.', true);

    return Promise.all([ensureJsPDF(), renderCanvas(true)]).then(function (r) {
      var cv = r[1];
      var jsPDF = global.jspdf.jsPDF;
      var doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [W, H] });
      doc.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, W, H);

      /* Page two: the detail the card cannot hold, on paper-friendly stock. */
      doc.addPage([W, H], 'landscape');
      doc.setFillColor(8, 12, 20);
      doc.rect(0, 0, W, H, 'F');

      var y = 60;
      doc.setFont('courier', 'bold'); doc.setFontSize(16);
      doc.setTextColor(245, 166, 35);
      doc.text('POSITION DETAIL', PAD, y);
      doc.setFontSize(9); doc.setFont('courier', 'normal');
      doc.setTextColor(113, 137, 173);
      doc.text(s.structure.name + '  ·  ' + s.structure.tier + '  ·  ' + s.scenarioLabel +
               '  ·  ' + stampLong(s.generatedAt), PAD, y + 18);

      y += 48;
      var cols = [PAD, PAD + 90, PAD + 330, PAD + 440, PAD + 560, PAD + 690, PAD + 810];
      doc.setTextColor(113, 137, 173); doc.setFontSize(8);
      ['TICKER', 'SECTOR', 'SHARES', 'AVG COST', 'VALUE', '12M', '3-YEAR'].forEach(function (h, i) {
        doc.text(h, cols[i], y);
      });
      doc.setDrawColor(30, 48, 85);
      doc.line(PAD, y + 6, W - PAD, y + 6);

      y += 22;
      doc.setFontSize(9);
      s.rows.forEach(function (row) {
        if (y > H - 96) return;
        doc.setTextColor(232, 237, 245);
        doc.text(String(row.ticker), cols[0], y);
        doc.setTextColor(113, 137, 173);
        doc.text(String(row.covered ? (row.sector || '—') : 'not modelled').slice(0, 30), cols[1], y);
        doc.setTextColor(122, 145, 179);
        doc.text(String(row.shares), cols[2], y);
        doc.text(money(row.cost), cols[3], y);
        doc.text(money(row.value), cols[4], y);
        if (row.covered) {
          if (row.adj12 >= 0) doc.setTextColor(0, 230, 118); else doc.setTextColor(255, 61, 74);
          doc.text(pct(row.adj12), cols[5], y);
          if (row.adj36 >= 0) doc.setTextColor(0, 230, 118); else doc.setTextColor(255, 61, 74);
          doc.text(pct(row.adj36), cols[6], y);
        } else {
          doc.setTextColor(113, 137, 173);
          doc.text('—', cols[5], y); doc.text('—', cols[6], y);
        }
        y += 18;
      });

      doc.setDrawColor(30, 48, 85);
      doc.line(PAD, H - 84, W - PAD, H - 84);
      doc.setFontSize(8); doc.setTextColor(113, 137, 173);
      var note = s.structure.tier === 'UNPRICED'
        ? 'Sector sensitivities for this structure are NOT empirically calibrated — read them as directional, not quantitative.'
        : 'Sector sensitivities are fitted to observed market behaviour during the referenced conflict.';
      doc.text(note, PAD, H - 62);
      doc.text('Percentages are computed on modelled holdings only; unmodelled holdings are excluded rather than scored as zero.', PAD, H - 48);
      doc.text('Value at Risk is a historical simulation of realised weekly returns, price risk only. ' +
               'Full methodology: delaxcom.org/methodology.html', PAD, H - 34);
      doc.setTextColor(245, 166, 35);
      doc.text('Modelled estimate under a stated scenario — not a forecast, not financial advice.', PAD, H - 18);

      doc.save(fileStem(s) + '.pdf');
      toast('PDF saved');
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ═════════════════════════════════════════
     PREVIEW MODAL
     ═════════════════════════════════════════ */
  function toast(msg, isError) {
    if (typeof global.showToast === 'function') { global.showToast(msg, !!isError); return; }
    if (isError) console.error('[export]', msg); else console.log('[export]', msg);
  }

  function ensurePreview() {
    var el = document.getElementById('dxExportOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dxExportOverlay';
    el.className = 'dx-export-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'dxExportTitle');
    el.innerHTML =
      '<div class="dx-export-modal">' +
        '<div class="dx-export-head">' +
          '<h4 id="dxExportTitle">Share card</h4>' +
          '<button class="btn" id="dxExportClose" aria-label="Close preview">✕</button>' +
        '</div>' +
        '<div class="dx-export-preview" id="dxExportPreview"></div>' +
        '<label class="dx-export-toggle">' +
          '<input type="checkbox" id="dxExportValues"/>' +
          '<span>Include position and portfolio values</span>' +
        '</label>' +
        '<div class="dx-export-privacy" id="dxExportPrivacy"></div>' +
        '<div class="dx-export-actions">' +
          '<button class="btn" id="dxExportShare">Share</button>' +
          '<button class="btn green" id="dxExportDownload">Download PNG</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    el.addEventListener('click', function (e) { if (e.target === el) closePreview(); });
    document.getElementById('dxExportClose').addEventListener('click', closePreview);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.classList.contains('open')) closePreview();
    });
    document.getElementById('dxExportValues').addEventListener('change', function (e) {
      _opts.includeValues = !!e.target.checked;
      refreshPreview();
    });
    document.getElementById('dxExportDownload').addEventListener('click', exportPNG);
    document.getElementById('dxExportShare').addEventListener('click', sharePNG);
    return el;
  }

  function refreshPreview() {
    var host = document.getElementById('dxExportPreview');
    var priv = document.getElementById('dxExportPrivacy');
    if (!host) return;
    priv.textContent = _opts.includeValues
      ? 'This card will show what your positions are worth. Anyone you send it to can see your portfolio size.'
      : 'Values are hidden. The card shows weights and percentages only — safe to post publicly.';
    priv.className = 'dx-export-privacy' + (_opts.includeValues ? ' warn' : '');

    renderCanvas(_opts.includeValues).then(function (cv) {
      cv.style.width = '100%';
      cv.style.height = 'auto';
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', 'Portfolio exposure card preview');
      host.innerHTML = '';
      host.appendChild(cv);
    }).catch(function (e) {
      host.innerHTML = '<div class="dx-export-err">' + String(e.message || e) + '</div>';
    });
  }

  function openPreview() {
    if (!snap()) return toast('Add holdings first — there is nothing to export yet.', true);
    ensurePreview().classList.add('open');
    document.body.style.overflow = 'hidden';
    var box = document.getElementById('dxExportValues');
    if (box) box.checked = _opts.includeValues;
    refreshPreview();
  }

  function closePreview() {
    var el = document.getElementById('dxExportOverlay');
    if (el) el.classList.remove('open');
    document.body.style.overflow = '';
  }

  global.DelaxExport = {
    configure: configure,
    openPreview: openPreview,
    closePreview: closePreview,
    png: exportPNG,
    share: sharePNG,
    xlsx: exportXLSX,
    csv: exportCSVFile,
    pdf: exportPDF,
    /* Fixture hooks */
    _renderCanvas: renderCanvas,
    _drawCard: drawCard,
  };

})(typeof window !== 'undefined' ? window : this);
