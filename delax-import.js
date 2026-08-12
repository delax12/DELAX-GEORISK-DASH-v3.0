/**
 * /delax-import.js — DELAX GEO-RISK — holdings import
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads a brokerage statement or exported spreadsheet and turns it into
 * portfolio rows. Everything happens in the browser. The file is never
 * uploaded, never posted to an endpoint, never seen by a model. That is the
 * whole design constraint, and it is why this file exists as a static asset
 * rather than a serverless function.
 *
 * ══ SUPPORTED ══
 *   .xlsx .xls .csv .tsv   via SheetJS
 *   .pdf (text layer)      via pdf.js — position-clustered back into rows
 *
 * Scanned PDFs and photographs are NOT supported. A scan has no text layer,
 * so we say so plainly instead of importing nothing and looking broken. OCR
 * was considered and deferred: a misread share count produces a number that
 * looks completely ordinary and is completely wrong, which is the one failure
 * mode this platform does not tolerate.
 *
 * ══ WHY THE REVIEW STEP IS NOT OPTIONAL ══
 * Every format collapses to the same intermediate — an array of raw cell rows —
 * and then a single mapper runs over it. That mapper is heuristic, because
 * every broker names its columns differently. Heuristics are fine when a human
 * confirms the result and catastrophic when they don't, so nothing reaches the
 * portfolio without passing through an editable review table.
 *
 * The specific trap worth naming: "Cost Basis" means total cost at one broker
 * and per-share cost at another. Reading a total as a per-share figure inflates
 * a position by the share count — a 100x error that renders as a plausible
 * dollar amount. When the source is ambiguous we ask, once, rather than guess.
 */
'use strict';

(function (global) {

  /* ═════════════════════════════════════════
     LAZY CDN LOADING
     Neither library loads on page view. Both are large enough that pulling
     them in for the majority of visitors who never import anything would be
     an unforced mobile performance cost.
     ═════════════════════════════════════════ */

  var CDN = {
    xlsx:      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    pdf:       'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  };

  var _scriptCache = {};

  function loadScript(url) {
    if (_scriptCache[url]) return _scriptCache[url];
    _scriptCache[url] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        delete _scriptCache[url];
        reject(new Error('Could not load the reader library. Check your connection and try again.'));
      };
      document.head.appendChild(s);
    });
    return _scriptCache[url];
  }

  function ensureXLSX() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    return loadScript(CDN.xlsx).then(function () {
      if (!global.XLSX) throw new Error('Spreadsheet reader failed to initialise.');
      return global.XLSX;
    });
  }

  function ensurePDF() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    return loadScript(CDN.pdf).then(function () {
      if (!global.pdfjsLib) throw new Error('PDF reader failed to initialise.');
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
      return global.pdfjsLib;
    });
  }

  /* ═════════════════════════════════════════
     VALUE PARSING
     ═════════════════════════════════════════ */

  /* Accounting negatives, thousands separators, currency symbols, stray
     footnote markers, and the several ways a broker writes "nothing here". */
  function parseNum(raw) {
    if (raw === null || raw === undefined) return NaN;
    if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
    var s = String(raw).trim();
    if (!s) return NaN;
    if (/^[-–—\u2013\u2014]+$/.test(s)) return NaN;
    if (/^(n\/?a|nil|none|null)$/i.test(s)) return NaN;

    var negative = /^\(.*\)$/.test(s);
    s = s.replace(/^\(|\)$/g, '');
    s = s.replace(/[\u00A0\s]/g, '');
    s = s.replace(/[$£€¥₹]/g, '');
    s = s.replace(/[*†‡]+$/, '');

    /* Separator disambiguation. European statements write 1.234,56 where US
       statements write 1,234.56, and a share count of "1,5" is one and a half
       shares in Frankfurt and fifteen nowhere. Getting this wrong scales a
       position by 100, so it is resolved explicitly rather than by stripping
       every comma and hoping.

       Rule: when both separators appear, the rightmost is the decimal point.
       When only commas appear, a single comma trailing one or two digits is a
       decimal point; anything else is a thousands separator. */
    var hasDot = s.indexOf('.') >= 0;
    var hasCom = s.indexOf(',') >= 0;
    if (hasDot && hasCom) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (hasCom) {
      if (/^[+-]?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    }
    s = s.replace(/^([+-])/, '$1');

    var m = s.match(/^[+-]?\d*\.?\d+/);
    if (!m) return NaN;
    var n = parseFloat(m[0]);
    if (!isFinite(n)) return NaN;
    return negative ? -n : n;
  }

  /* Words that occupy a ticker column but are not tickers. Totals rows are the
     common case and would otherwise import as a holding called "TOTAL". */
  var NON_TICKER = /^(total|totals|subtotal|sub-total|grand ?total|cash|cash ?&? ?equivalents?|money ?market|balance|account|sum|net|n\/?a|symbol|ticker|security|holdings?|position|summary|other|misc|various|pending|—|-)$/i;

  var TICKER_RE = /^[A-Z]{1,5}(?:[.\-][A-Z]{1,3})?$/;

  function cleanTicker(raw) {
    if (raw === null || raw === undefined) return '';
    var s = String(raw).trim().toUpperCase();
    if (!s) return '';
    /* "XOM - EXXON MOBIL CORP" and "EXXON MOBIL (XOM)" both appear in the wild. */
    var paren = s.match(/\(([A-Z]{1,5}(?:[.\-][A-Z]{1,3})?)\)\s*$/);
    if (paren) return paren[1];
    s = s.split(/\s+[-–—]\s+/)[0].trim();
    s = s.replace(/[*†‡]+$/, '').trim();
    if (NON_TICKER.test(s)) return '';
    if (!TICKER_RE.test(s)) return '';
    return s;
  }

  function looksLikeTicker(raw) { return cleanTicker(raw) !== ''; }

  /* ═════════════════════════════════════════
     COLUMN SYNONYMS
     Ordered most-specific-first inside each group. "avg cost" must be tested
     before "cost" or a per-share column gets classified as a total.
     ═════════════════════════════════════════ */

  var SYNONYMS = [
    { field: 'ticker', patterns: [
      /^(ticker|symbol|sym|security ?(id|symbol)?|stock ?symbol|instrument)$/i,
      /^(ticker|symbol)\b/i,
      /^(security|stock|holding|investment|description|name|fund|asset)\b/i,
      /\b(stock|fund|security|symbol|ticker)\b/i,
    ] },
    { field: 'shares', patterns: [
      /^(quantity|qty|shares?|units?|share ?(qty|quantity|count)|no\.? of shares)$/i,
      /\b(quantity|shares|units)\b/i,
    ] },
    { field: 'costPer', patterns: [
      /^(avg|average|mean)?\.? ?(unit )?cost ?(per ?share|\/ ?share|basis ?per ?share)$/i,
      /^(avg|average)\.? ?(price|cost)( paid)?$/i,
      /^(cost|price) ?(per ?share|\/ ?share)$/i,
      /^(purchase|acquisition|book) ?price$/i,
      /\b(per ?share|\/ ?sh)\b/i,
    ] },
    { field: 'costTotal', patterns: [
      /^(total )?cost ?basis$/i,
      /^(total ?cost|book ?value|amount ?invested|total ?invested|purchase ?amount)$/i,
      /\bcost ?basis\b/i,
    ] },
    { field: 'price', patterns: [
      /^(last|current|market|closing|close) ?price$/i,
      /^(price|last|mark)$/i,
      /\bshare ?price\b/i,
    ] },
    { field: 'value', patterns: [
      /^(current|market|mkt|position|total) ?value$/i,
      /^value$/i,
      /\bmarket ?value\b/i,
    ] },
  ];

  function classifyHeader(cell) {
    var s = String(cell === null || cell === undefined ? '' : cell).trim();
    if (!s) return null;
    for (var i = 0; i < SYNONYMS.length; i++) {
      var group = SYNONYMS[i];
      for (var j = 0; j < group.patterns.length; j++) {
        if (group.patterns[j].test(s)) return group.field;
      }
    }
    return null;
  }

  /* A header row is one where at least two distinct fields resolve AND one of
     them is the ticker column. One match is noise — plenty of statements have
     a stray "Value" label floating in a summary block. */
  function findHeaderRow(rows) {
    var limit = Math.min(rows.length, 40);
    for (var i = 0; i < limit; i++) {
      var row = rows[i] || [];
      var map = {};
      var hits = 0;
      for (var c = 0; c < row.length; c++) {
        var f = classifyHeader(row[c]);
        if (f && !(f in map)) { map[f] = c; hits++; }
      }
      if (hits >= 2 && 'ticker' in map) return { index: i, map: map };
    }
    return null;
  }

  /* ═════════════════════════════════════════
     HEADERLESS INFERENCE
     Used when no header row resolves — some PDF statements lose their header
     to the page furniture. Every row produced this way is flagged, because the
     column roles are a guess and the user is the only one who can confirm them.
     ═════════════════════════════════════════ */

  function inferColumns(rows) {
    var width = 0;
    rows.forEach(function (r) { if (r.length > width) width = r.length; });
    if (width < 2) return null;

    var tickerCol = -1, bestScore = 0;
    for (var c = 0; c < width; c++) {
      var hits = 0, seen = 0;
      for (var i = 0; i < rows.length; i++) {
        var v = rows[i][c];
        if (v === undefined || v === null || String(v).trim() === '') continue;
        seen++;
        if (looksLikeTicker(v)) hits++;
      }
      if (seen >= 2) {
        var score = hits / seen;
        if (score > 0.6 && score > bestScore) { bestScore = score; tickerCol = c; }
      }
    }
    if (tickerCol < 0) return null;

    var numericCols = [];
    for (var c2 = tickerCol + 1; c2 < width; c2++) {
      var num = 0, tot = 0;
      for (var k = 0; k < rows.length; k++) {
        var val = rows[k][c2];
        if (val === undefined || val === null || String(val).trim() === '') continue;
        tot++;
        if (!isNaN(parseNum(val))) num++;
      }
      if (tot >= 2 && num / tot > 0.7) numericCols.push(c2);
    }
    if (numericCols.length < 2) return null;

    return { ticker: tickerCol, shares: numericCols[0], costPer: numericCols[1], _inferred: true };
  }

  /* ═════════════════════════════════════════
     FILE READERS → raw cell rows
     ═════════════════════════════════════════ */

  function readSpreadsheet(file) {
    return ensureXLSX().then(function (XLSX) {
      return file.arrayBuffer();
    }).then(function (buf) {
      var wb = global.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
      if (!wb.SheetNames || !wb.SheetNames.length) throw new Error('That workbook has no sheets.');

      /* Multi-sheet workbooks are common — pick the sheet with the most
         ticker-shaped cells rather than blindly taking the first. */
      var best = null, bestHits = -1;
      wb.SheetNames.forEach(function (name) {
        var rows = global.XLSX.utils.sheet_to_json(wb.Sheets[name], {
          header: 1, raw: false, defval: '', blankrows: false,
        });
        var hits = 0;
        rows.forEach(function (r) {
          for (var c = 0; c < r.length; c++) { if (looksLikeTicker(r[c])) { hits++; break; } }
        });
        if (hits > bestHits) { bestHits = hits; best = rows; }
      });
      return best || [];
    });
  }

  /* PDF text arrives as positioned fragments with no row structure. Cluster by
     baseline y, then order each cluster by x. Tolerance is proportional to the
     glyph height so it survives both 8pt statement tables and 14pt summaries. */
  function readPDF(file) {
    return ensurePDF().then(function () {
      return file.arrayBuffer();
    }).then(function (buf) {
      return global.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (doc) {
      var pages = [];
      for (var p = 1; p <= doc.numPages; p++) pages.push(p);
      return pages.reduce(function (chain, pageNo) {
        return chain.then(function (acc) {
          return doc.getPage(pageNo)
            .then(function (page) { return page.getTextContent(); })
            .then(function (content) {
              var items = (content.items || []).filter(function (it) {
                return it.str && String(it.str).trim() !== '';
              });
              var lines = [];
              items.forEach(function (it) {
                var y = it.transform[5];
                var x = it.transform[4];
                var h = Math.abs(it.transform[3]) || 10;
                var tol = Math.max(2, h * 0.5);
                var line = null;
                for (var i = 0; i < lines.length; i++) {
                  if (Math.abs(lines[i].y - y) <= tol) { line = lines[i]; break; }
                }
                if (!line) { line = { y: y, cells: [] }; lines.push(line); }
                line.cells.push({ x: x, text: String(it.str).trim() });
              });
              lines.sort(function (a, b) { return b.y - a.y; });
              lines.forEach(function (line) {
                line.cells.sort(function (a, b) { return a.x - b.x; });
                /* Merge fragments that are visually adjacent — pdf.js splits a
                   single table cell whenever kerning changes. */
                var merged = [];
                var prev = null;
                line.cells.forEach(function (cell) {
                  if (prev && cell.x - prev.endX < 6) {
                    prev.text += (cell.x - prev.endX > 1 ? ' ' : '') + cell.text;
                    prev.endX = cell.x + cell.text.length * 4;
                    return;
                  }
                  prev = { text: cell.text, x: cell.x, endX: cell.x + cell.text.length * 4 };
                  merged.push(prev);
                });
                acc.push(merged.map(function (m) { return m.text; }));
              });
              return acc;
            });
        });
      }, Promise.resolve([]));
    }).then(function (rows) {
      var hasText = rows.some(function (r) {
        return r.some(function (c) { return String(c).trim() !== ''; });
      });
      if (!hasText) {
        throw new Error(
          'This PDF has no text layer — it looks like a scan or a photograph of a statement. ' +
          'Scanned documents are not supported. Export a CSV or Excel file from your broker, ' +
          'or enter the holdings manually.'
        );
      }
      return rows;
    });
  }

  /* ═════════════════════════════════════════
     MAPPING — raw rows → candidate holdings
     ═════════════════════════════════════════ */

  var FLAG = {
    DERIVED_COST:   'Per-share cost derived from total cost basis',
    PRICE_AS_COST:  'No cost column found — current market price used as cost basis',
    INFERRED_COLS:  'No column headers found — column roles were inferred',
    HIGH_COST:      'Unusually high per-share cost — check this is not a total',
    NOT_COVERED:    'Not modelled by the active risk structure',
    NO_SHARES:      'Share count missing or zero',
    NO_COST:        'Cost missing or zero',
  };

  function mapRows(rawRows) {
    var header = findHeaderRow(rawRows);
    var map, dataRows, inferred = false;

    if (header) {
      map = header.map;
      dataRows = rawRows.slice(header.index + 1);
    } else {
      map = inferColumns(rawRows);
      if (!map) {
        throw new Error(
          'No holdings table found in this file. Expected columns for ticker, ' +
          'quantity and cost. If your broker offers a CSV export, that usually works best.'
        );
      }
      inferred = true;
      dataRows = rawRows;
    }

    var out = [];
    var globalFlags = [];
    if (inferred) globalFlags.push(FLAG.INFERRED_COLS);

    /* Whether an ambiguous cost column is per-share or total is a property of
       the file, not of individual rows, so it is resolved once, globally. */
    var ambiguity = null;

    dataRows.forEach(function (row) {
      if (!row || !row.length) return;
      var ticker = cleanTicker(row[map.ticker]);
      if (!ticker) return;

      var shares = parseNum(map.shares !== undefined ? row[map.shares] : NaN);
      var flags  = [];

      var costPer   = map.costPer   !== undefined ? parseNum(row[map.costPer])   : NaN;
      var costTotal = map.costTotal !== undefined ? parseNum(row[map.costTotal]) : NaN;
      var price     = map.price     !== undefined ? parseNum(row[map.price])     : NaN;
      var value     = map.value     !== undefined ? parseNum(row[map.value])     : NaN;

      var cost = NaN;

      if (!isNaN(costPer)) {
        cost = costPer;
        /* A "per share" column carrying a figure that divides cleanly into a
           sane share price is the classic mislabelled-total case. */
        if (!isNaN(shares) && shares > 1 && !isNaN(price) && price > 0) {
          var asTotal = costPer / shares;
          if (Math.abs(costPer - price) > Math.abs(asTotal - price) * 4) {
            ambiguity = ambiguity || { field: 'costPer', resolved: false };
          }
        }
      } else if (!isNaN(costTotal) && !isNaN(shares) && shares > 0) {
        cost = costTotal / shares;
        flags.push(FLAG.DERIVED_COST);
      } else if (!isNaN(price) && price > 0) {
        cost = price;
        flags.push(FLAG.PRICE_AS_COST);
      } else if (!isNaN(value) && !isNaN(shares) && shares > 0) {
        cost = value / shares;
        flags.push(FLAG.PRICE_AS_COST);
      }

      if (isNaN(shares) || shares <= 0) flags.push(FLAG.NO_SHARES);
      if (isNaN(cost) || cost <= 0)     flags.push(FLAG.NO_COST);
      if (!isNaN(cost) && cost > 50000) flags.push(FLAG.HIGH_COST);

      out.push({
        ticker: ticker,
        shares: isNaN(shares) ? 0 : shares,
        cost:   isNaN(cost)   ? 0 : cost,
        flags:  flags,
        include: !(isNaN(shares) || shares <= 0 || isNaN(cost) || cost <= 0),
      });
    });

    if (!out.length) {
      throw new Error(
        'Found a table but no recognisable ticker symbols in it. ' +
        'Check the file contains a holdings list rather than a transaction history.'
      );
    }

    /* Duplicate tickers across account sections are common. Merge on a
       share-weighted average cost so the combined position is correct. */
    var byTicker = {};
    var merged = [];
    out.forEach(function (r) {
      if (byTicker[r.ticker] && r.include && byTicker[r.ticker].include) {
        var e = byTicker[r.ticker];
        var totalShares = e.shares + r.shares;
        e.cost = totalShares > 0 ? (e.cost * e.shares + r.cost * r.shares) / totalShares : e.cost;
        e.shares = totalShares;
        if (e.flags.indexOf('Merged from multiple lines') < 0) e.flags.push('Merged from multiple lines');
        return;
      }
      byTicker[r.ticker] = r;
      merged.push(r);
    });

    return { rows: merged, globalFlags: globalFlags, ambiguous: !!ambiguity, inferred: inferred };
  }

  /* ═════════════════════════════════════════
     PUBLIC PARSE
     ═════════════════════════════════════════ */

  function parseFile(file) {
    var name = String(file.name || '').toLowerCase();
    var reader;
    if (/\.pdf$/.test(name)) reader = readPDF(file);
    else if (/\.(xlsx|xlsm|xls|csv|tsv|txt)$/.test(name)) reader = readSpreadsheet(file);
    else {
      return Promise.reject(new Error(
        'Unsupported file type. Accepted: .xlsx, .xls, .csv, .tsv and text-layer .pdf. ' +
        'Images and scanned documents are not supported.'
      ));
    }
    return reader.then(function (rawRows) { return mapRows(rawRows); });
  }

  /* ═════════════════════════════════════════
     UI — modal, review table, commit
     ═════════════════════════════════════════ */

  var _cfg = { onCommit: null, isCovered: null };
  var _state = { rows: [], globalFlags: [], fileName: '' };

  function configure(opts) {
    if (!opts) return;
    if (typeof opts.onCommit === 'function')  _cfg.onCommit  = opts.onCommit;
    if (typeof opts.isCovered === 'function') _cfg.isCovered = opts.isCovered;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureModal() {
    var el = document.getElementById('dxImportOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dxImportOverlay';
    el.className = 'dx-import-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'dxImportTitle');
    el.innerHTML =
      '<div class="dx-import-modal">' +
        '<div class="dx-import-head">' +
          '<h4 id="dxImportTitle">Import holdings</h4>' +
          '<button class="btn" id="dxImportClose" aria-label="Close import">✕</button>' +
        '</div>' +
        '<div class="dx-import-body" id="dxImportBody"></div>' +
      '</div>';
    document.body.appendChild(el);

    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.getElementById('dxImportClose').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.classList.contains('open')) close();
    });
    return el;
  }

  function body() { return document.getElementById('dxImportBody'); }

  function open() {
    ensureModal().classList.add('open');
    document.body.style.overflow = 'hidden';
    renderPicker();
  }

  function close() {
    var el = document.getElementById('dxImportOverlay');
    if (el) el.classList.remove('open');
    document.body.style.overflow = '';
  }

  function renderPicker() {
    body().innerHTML =
      '<p class="dx-import-note">' +
        '<strong>Your file is read on this device and never leaves it.</strong> ' +
        'Nothing is uploaded, stored on a server, or sent to any third party. ' +
        'Only the ticker, quantity and cost you confirm on the next screen are kept, ' +
        'in this browser.' +
      '</p>' +
      '<div class="dx-drop" id="dxDrop" tabindex="0" role="button" ' +
        'aria-label="Choose a holdings file or drop one here">' +
        '<div class="dx-drop-icon" aria-hidden="true">📄</div>' +
        '<div class="dx-drop-main">Choose a file or drop it here</div>' +
        '<div class="dx-drop-sub">.xlsx · .xls · .csv · .tsv · .pdf with selectable text</div>' +
      '</div>' +
      '<input type="file" id="dxFileInput" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt,.pdf" ' +
        'style="display:none" aria-hidden="true"/>' +
      '<div class="dx-import-hint">' +
        'Scans and photographs of statements are not supported — they carry no text to read. ' +
        'A CSV export from your broker is the most reliable source.' +
      '</div>' +
      '<div id="dxImportError" class="dx-import-error" role="alert" style="display:none"></div>';

    var drop  = document.getElementById('dxDrop');
    var input = document.getElementById('dxFileInput');

    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) handleFile(input.files[0]);
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });
  }

  function showError(msg) {
    var el = document.getElementById('dxImportError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
  }

  function handleFile(file) {
    _state.fileName = file.name || 'file';
    body().innerHTML =
      '<div class="dx-import-loading">' +
        '<div class="dx-spinner" aria-hidden="true"></div>' +
        '<div>Reading ' + esc(_state.fileName) + '…</div>' +
        '<div class="dx-import-hint" style="margin-top:.5rem">On this device only.</div>' +
      '</div>';

    parseFile(file).then(function (result) {
      _state.rows = result.rows;
      _state.globalFlags = result.globalFlags;
      renderReview();
    }).catch(function (err) {
      renderPicker();
      showError(err && err.message ? err.message : 'Could not read that file.');
    });
  }

  function coveredFor(ticker) {
    if (!_cfg.isCovered) return null;
    try { return !!_cfg.isCovered(ticker); } catch (e) { return null; }
  }

  function money(n) {
    return '$' + Math.round(n).toLocaleString();
  }

  function renderReview() {
    var rows = _state.rows;
    var warnCount = rows.filter(function (r) { return r.flags.length; }).length;

    var head =
      '<p class="dx-import-note">' +
        'Read <strong>' + esc(_state.fileName) + '</strong> — found ' + rows.length +
        (rows.length === 1 ? ' position' : ' positions') + '. ' +
        'Check the figures below before importing. Nothing has been added to your portfolio yet.' +
      '</p>';

    var globalWarn = '';
    if (_state.globalFlags.length) {
      globalWarn = '<div class="dx-import-warn">' +
        _state.globalFlags.map(function (f) { return esc(f) + '.'; }).join(' ') +
        ' Please verify every row.</div>';
    } else if (warnCount) {
      globalWarn = '<div class="dx-import-warn">' + warnCount +
        (warnCount === 1 ? ' row needs' : ' rows need') +
        ' a look — flagged below.</div>';
    }

    var table =
      '<div class="dx-rev-head">' +
        '<span></span><span>TICKER</span><span>SHARES</span><span>AVG COST</span><span>VALUE</span>' +
      '</div>' +
      '<div class="dx-rev-body">' +
      rows.map(function (r, i) {
        var cov = coveredFor(r.ticker);
        var flagged = r.flags.length > 0;
        var value = (r.shares > 0 && r.cost > 0) ? money(r.shares * r.cost) : '—';
        var badge = cov === null ? ''
          : cov ? '<span class="dx-rev-cov ok">covered</span>'
                : '<span class="dx-rev-cov no">uncovered</span>';
        return '<div class="dx-rev-row' + (flagged ? ' flagged' : '') + '">' +
          '<input type="checkbox" class="dx-rev-check" data-i="' + i + '"' +
            (r.include ? ' checked' : '') + ' aria-label="Include ' + esc(r.ticker) + '"/>' +
          '<div class="dx-rev-tick">' +
            '<input class="dx-rev-input" type="text" value="' + esc(r.ticker) + '" ' +
              'data-i="' + i + '" data-f="ticker" aria-label="Ticker"/>' + badge +
          '</div>' +
          '<input class="dx-rev-input" type="number" step="any" value="' + (r.shares || '') + '" ' +
            'data-i="' + i + '" data-f="shares" aria-label="Shares"/>' +
          '<input class="dx-rev-input" type="number" step="any" value="' +
            (r.cost ? Math.round(r.cost * 100) / 100 : '') + '" ' +
            'data-i="' + i + '" data-f="cost" aria-label="Average cost"/>' +
          '<span class="dx-rev-val" data-val="' + i + '">' + value + '</span>' +
          (flagged
            ? '<div class="dx-rev-flags">' + r.flags.map(esc).join(' · ') + '</div>'
            : '') +
        '</div>';
      }).join('') +
      '</div>';

    var included = rows.filter(function (r) { return r.include; });
    var totalVal = included.reduce(function (a, r) { return a + r.shares * r.cost; }, 0);

    var foot =
      '<div class="dx-rev-total" id="dxRevTotal">' +
        '<span>' + included.length + ' of ' + rows.length + ' selected</span>' +
        '<span>' + money(totalVal) + '</span>' +
      '</div>' +
      '<div class="dx-import-actions">' +
        '<button class="btn" id="dxRevCancel">Cancel</button>' +
        '<button class="btn" id="dxRevReplace" title="Discard current holdings and use these">Replace all</button>' +
        '<button class="btn green" id="dxRevMerge">Add to portfolio</button>' +
      '</div>' +
      '<div class="dx-import-hint">' +
        '“Add to portfolio” keeps what you already have and merges these in. ' +
        '“Replace all” clears your existing holdings first.' +
      '</div>';

    body().innerHTML = head + globalWarn + table + foot;

    body().addEventListener('input', onReviewInput);
    body().addEventListener('change', onReviewInput);
    document.getElementById('dxRevCancel').addEventListener('click', close);
    document.getElementById('dxRevMerge').addEventListener('click', function () { commit(false); });
    document.getElementById('dxRevReplace').addEventListener('click', function () { commit(true); });
  }

  function onReviewInput(e) {
    var t = e.target;
    if (!t) return;

    if (t.classList && t.classList.contains('dx-rev-check')) {
      var ci = +t.getAttribute('data-i');
      if (_state.rows[ci]) _state.rows[ci].include = t.checked;
      refreshTotal();
      return;
    }
    if (!t.classList || !t.classList.contains('dx-rev-input')) return;

    var i = +t.getAttribute('data-i');
    var f = t.getAttribute('data-f');
    var row = _state.rows[i];
    if (!row) return;

    if (f === 'ticker') {
      row.ticker = String(t.value || '').trim().toUpperCase();
    } else {
      var n = parseFloat(t.value);
      row[f] = isFinite(n) && n > 0 ? n : 0;
    }

    var cell = body().querySelector('[data-val="' + i + '"]');
    if (cell) cell.textContent = (row.shares > 0 && row.cost > 0) ? money(row.shares * row.cost) : '—';
    refreshTotal();
  }

  function refreshTotal() {
    var el = document.getElementById('dxRevTotal');
    if (!el) return;
    var inc = _state.rows.filter(function (r) { return r.include; });
    var tot = inc.reduce(function (a, r) { return a + r.shares * r.cost; }, 0);
    el.innerHTML = '<span>' + inc.length + ' of ' + _state.rows.length + ' selected</span>' +
                   '<span>' + money(tot) + '</span>';
  }

  function commit(replace) {
    var rows = _state.rows.filter(function (r) {
      return r.include && r.ticker && r.shares > 0 && r.cost > 0;
    }).map(function (r) {
      return { ticker: r.ticker, shares: r.shares, cost: Math.round(r.cost * 10000) / 10000 };
    });

    if (!rows.length) {
      var warn = document.createElement('div');
      warn.className = 'dx-import-error';
      warn.textContent = 'Nothing selected with a valid ticker, share count and cost.';
      var actions = document.querySelector('.dx-import-actions');
      if (actions && actions.parentNode) actions.parentNode.insertBefore(warn, actions);
      return;
    }

    if (_cfg.onCommit) _cfg.onCommit(rows, { replace: !!replace, source: _state.fileName });
    close();
  }

  global.DelaxImport = {
    configure: configure,
    open: open,
    close: close,
    /* Exported for the fixture suite — pure functions, no DOM. */
    _parseNum: parseNum,
    _cleanTicker: cleanTicker,
    _mapRows: mapRows,
    _findHeaderRow: findHeaderRow,
    _inferColumns: inferColumns,
  };

})(typeof window !== 'undefined' ? window : this);
