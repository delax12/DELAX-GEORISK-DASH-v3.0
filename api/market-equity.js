/**
 * /api/market-equity.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * DELAX GEO-RISK — Equities Tab: quote, fundamentals, candles
 *
 * ARCHITECTURE — 3 parallel calls, all within Vercel 10s limit:
 *   [1] Finnhub /quote          → live price (< 1s)
 *   [2] Finnhub /stock/metric   → fundamentals (< 1s)
 *   [3] AV TIME_SERIES_DAILY    → candles, compact=100 days (1-3s)
 *
 * WHY COMPACT (not full) for AV candles:
 *   outputsize=full can take 5-8s and burns the same 1 API call.
 *   outputsize=compact returns the last 100 trading days (~5 months)
 *   in 1-3s — well within Vercel's 10s serverless limit.
 *   This covers the 6M default view. The canvas renderer adjusts
 *   range labels to reflect actual data received.
 *
 * WHY ONLY 1 AV CALL PER REQUEST:
 *   AV free tier = 25 calls/day total. Previously we fired 3 AV
 *   calls per lookup (candles + OVERVIEW + GLOBAL_QUOTE), burning
 *   the daily quota in 8 lookups. Now we fire 1 AV call (candles only).
 *   Finnhub handles quote and fundamentals with no daily quota.
 *
 * FALLBACK CHAIN:
 *   Quote:        Finnhub primary → AV GLOBAL_QUOTE only if Finnhub returns null
 *   Fundamentals: Finnhub primary → AV OVERVIEW only if Finnhub returns null
 *   Candles:      AV TIME_SERIES_DAILY only (Finnhub free blocks non-US candles)
 *
 * ENV VARS (already in Vercel):
 *   FINNHUB_API_KEY   — quote + metrics, 60 req/min free
 *   ALPHA_VANTAGE_KEY — candles, 25 req/day free
 */
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  // Allow dots and hyphens for international symbols: BP.L, 2222.SR, RR.L
  const symbol = (req.query.symbol || '').toUpperCase().trim().replace(/[^A-Z0-9.\-^]/g, '');
  if (!symbol || symbol.length > 15) {
    return res.status(400).json({ error: 'symbol required — e.g. ?symbol=XOM or ?symbol=BP.L' });
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const avKey      = process.env.ALPHA_VANTAGE_KEY;

  if (!finnhubKey && !avKey) {
    return res.status(500).json({ error: 'No market data API keys configured in Vercel' });
  }

  const result = {
    symbol,
    quote:        null,
    fundamentals: null,
    candles:      null,
    candleSource: null,
    candleDays:   0,
    fetchedAt:    new Date().toISOString(),
  };
  const errors = [];

  /* ═══════════════════════════════════════════════════════════════
     PHASE 1 — Parallel: Finnhub quote + metrics + AV candles
     All three fire simultaneously. Total time = slowest single call.
     ═══════════════════════════════════════════════════════════════ */
  const phase1 = [];

  /* ── [1] Finnhub quote ── */
  if (finnhubKey) {
    phase1.push(
      fetchJSON(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`,
        5000
      ).then(q => {
        const price     = (q.c && q.c !== 0) ? q.c : q.pc;
        const prevClose = q.pc || price;
        if (!price) return;
        const change = price - (prevClose || price);
        const pctChg = prevClose ? (change / prevClose) * 100 : 0;
        result.quote = {
          price:         +price.toFixed(2),
          change:        +change.toFixed(2),
          percentChange: +pctChg.toFixed(2),
          high:          q.h  || null,
          low:           q.l  || null,
          open:          q.o  || null,
          prevClose:     prevClose ? +prevClose.toFixed(2) : null,
          isEstimated:   (!q.c || q.c === 0),
          source:        'Finnhub',
        };
      }).catch(e => errors.push(`Finnhub quote: ${e.message}`))
    );

    /* ── [2] Finnhub metrics (fundamentals) ── */
    phase1.push(
      fetchJSON(
        `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${finnhubKey}`,
        5000
      ).then(data => {
        const m = data?.metric;
        if (!m) return;
        result.fundamentals = {
          marketCap:     m['marketCapitalization'] ? m['marketCapitalization'] * 1e6 : null,
          pe:            m['peNormalizedAnnual']   || m['peTTM']    || null,
          eps:           m['epsNormalizedAnnual']  || m['epsTTM']   || null,
          high52:        m['52WeekHigh']            || null,
          low52:         m['52WeekLow']             || null,
          beta:          m['beta']                  || null,
          dividendYield: m['dividendYieldIndicatedAnnual'] || null,
          profitMargin:  m['netProfitMarginAnnual'] || m['netProfitMarginTTM'] || null,
          analystTarget: m['targetPrice']           || null,
          revenueGrowth: m['revenueGrowthTTMYoy']  || null,
          source:        'Finnhub',
        };
      }).catch(e => errors.push(`Finnhub metrics: ${e.message}`))
    );
  }

  /* ── [3] Alpha Vantage TIME_SERIES_DAILY — candles ──
     outputsize=compact → last 100 trading days (~5 months), fast response.
     Covers US + major international exchanges (LSE, TSX, ASX, Euronext etc.)
     that Finnhub free blocks for candle data.
     Counts as 1 of your 25 AV free calls/day.
  ── */
  if (avKey) {
    phase1.push(
      fetchJSON(
        `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
        `&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${avKey}`,
        7000
      ).then(data => {
        if (data?.Note || data?.Information) {
          errors.push('AV daily limit reached (25/day) — candle data resets at midnight ET');
          return;
        }
        const series = data?.['Time Series (Daily)'];
        if (!series) return; // symbol not in AV universe

        const candles = Object.entries(series)
          .map(([dateStr, v]) => ({
            time:   Math.floor(new Date(dateStr).getTime() / 1000),
            open:   parseFloat(v['1. open']),
            high:   parseFloat(v['2. high']),
            low:    parseFloat(v['3. low']),
            close:  parseFloat(v['4. close']),
            volume: parseInt(v['5. volume'], 10),
          }))
          .filter(c => isFinite(c.open) && isFinite(c.close))
          .sort((a, b) => a.time - b.time); // oldest first for chart rendering

        if (candles.length > 0) {
          result.candles      = candles;
          result.candleSource = 'Alpha Vantage';
          result.candleDays   = candles.length;
        }
      }).catch(e => errors.push(`AV candles: ${e.message}`))
    );
  }

  await Promise.allSettled(phase1);

  /* ═══════════════════════════════════════════════════════════════
     PHASE 2 — Fallbacks only if phase 1 came up empty
     These only fire if Finnhub didn't return data (non-US symbols).
     Each costs 1 AV call — only triggered when necessary.
     ═══════════════════════════════════════════════════════════════ */
  const phase2 = [];

  if (avKey && !result.quote) {
    phase2.push(
      fetchJSON(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE` +
        `&symbol=${encodeURIComponent(symbol)}&apikey=${avKey}`,
        5000
      ).then(data => {
        const q = data?.['Global Quote'];
        if (!q?.['05. price']) return;
        if (data?.Note || data?.Information) return;
        const price = +q['05. price'];
        const prev  = +(q['08. previous close'] || price);
        result.quote = {
          price,
          change:        +(q['09. change']                           || 0),
          percentChange: +(q['10. change percent']?.replace('%', '') || 0),
          high:          +(q['03. high'] || 0) || null,
          low:           +(q['04. low']  || 0) || null,
          open:          +(q['02. open'] || 0) || null,
          prevClose:     prev,
          isEstimated:   false,
          source:        'Alpha Vantage',
        };
      }).catch(e => errors.push(`AV quote fallback: ${e.message}`))
    );
  }

  if (avKey && !result.fundamentals) {
    phase2.push(
      fetchJSON(
        `https://www.alphavantage.co/query?function=OVERVIEW` +
        `&symbol=${encodeURIComponent(symbol)}&apikey=${avKey}`,
        5000
      ).then(ov => {
        if (!ov?.Symbol || ov.Note || ov.Information) return;
        result.fundamentals = {
          marketCap:     ov.MarketCapitalization ? +ov.MarketCapitalization : null,
          pe:            ov.PERatio   !== 'None' ? +ov.PERatio   : null,
          eps:           ov.EPS       !== 'None' ? +ov.EPS       : null,
          high52:        ov['52WeekHigh'] !== 'None' ? +ov['52WeekHigh'] : null,
          low52:         ov['52WeekLow']  !== 'None' ? +ov['52WeekLow']  : null,
          beta:          ov.Beta      !== 'None' ? +ov.Beta      : null,
          dividendYield: ov.DividendYield !== 'None' ? +ov.DividendYield : null,
          profitMargin:  ov.ProfitMargin  !== 'None' ? +ov.ProfitMargin  : null,
          analystTarget: ov.AnalystTargetPrice !== 'None' ? +ov.AnalystTargetPrice : null,
          revenueGrowth: null,
          name:          ov.Name     || null,
          sector:        ov.Sector   || null,
          source:        'Alpha Vantage',
        };
      }).catch(e => errors.push(`AV overview fallback: ${e.message}`))
    );
  }

  if (phase2.length) await Promise.allSettled(phase2);

  /* ── Nothing came back from any source ── */
  if (!result.quote && !result.fundamentals) {
    return res.status(502).json({
      error:  'No data available for this symbol',
      symbol,
      hint:   'This symbol may not be in Finnhub or Alpha Vantage free tier coverage. ' +
              'Try the US-listed ADR equivalent (e.g. SHEL instead of SHEL.L).',
      errors,
    });
  }

  /* ── Cache: 6hr when candles present, 60s for live quote only ── */
  const cacheSeconds = result.candles ? 21600 : 60;
  res.setHeader('Cache-Control', `s-maxage=${cacheSeconds}, stale-while-revalidate=300`);

  return res.status(200).json({
    ...result,
    errors: errors.length ? errors : undefined,
  });
};

/* ── Fetch helper with per-call timeout ── */
async function fetchJSON(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError') throw new Error(`Timeout after ${timeoutMs}ms`);
    throw err;
  }
}
