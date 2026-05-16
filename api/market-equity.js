/**
 * /api/market-equity.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * DELAX GEO-RISK — Equities Tab fundamentals + historical candles
 *
 * DATA SOURCES (all parallel — no sequential waterfall):
 *   Finnhub            → live quote + basic metrics (primary)
 *   Alpha Vantage      → TIME_SERIES_DAILY candles (36 months)
 *   Alpha Vantage      → OVERVIEW fundamentals fallback
 *   Alpha Vantage      → GLOBAL_QUOTE quote fallback
 *
 * WHY AV FOR CANDLES (not Finnhub):
 *   Finnhub free tier blocks /stock/candle for non-US symbols.
 *   BP.L, SHEL.L, 2222.SR etc return s:"no_data" on Finnhub free.
 *   Alpha Vantage TIME_SERIES_DAILY covers all major global exchanges
 *   and returns up to 20 years of daily OHLCV in one call.
 *
 * CACHING:
 *   Candles: 6hr CDN cache (daily data changes once per market day)
 *   Quote only: 60s CDN cache
 *
 * ENDPOINT:
 *   GET /api/market-equity?symbol=XOM
 *   GET /api/market-equity?symbol=BP.L
 *   GET /api/market-equity?symbol=2222.SR
 *   Returns: { quote, fundamentals, candles, candleSource, candleMonths, fetchedAt }
 *
 * ENV VARS (already in Vercel):
 *   FINNHUB_API_KEY   — quote + metrics
 *   ALPHA_VANTAGE_KEY — candles + fundamentals fallback
 */
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  // Allow dots and hyphens for international symbols (BP.L, 2222.SR, RR.L)
  const symbol = (req.query.symbol || '').toUpperCase().trim().replace(/[^A-Z0-9.\-^]/g, '');
  if (!symbol || symbol.length > 15) {
    return res.status(400).json({ error: 'symbol query parameter required (e.g. ?symbol=XOM)' });
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const avKey      = process.env.ALPHA_VANTAGE_KEY;

  if (!finnhubKey && !avKey) {
    return res.status(500).json({ error: 'No market data API keys configured' });
  }

  const result = {
    symbol,
    quote:        null,
    fundamentals: null,
    candles:      null,
    candleSource: null,
    candleMonths: 0,
    fetchedAt:    new Date().toISOString(),
  };
  const errors = [];

  /* ═══════════════════════════════════════════════════════════
     ALL FETCHES RUN IN PARALLEL — no sequential waterfall.
     Each source has its own timeout so one slow call
     never blocks the others from completing.
     ═══════════════════════════════════════════════════════════ */
  const tasks = [];

  /* ── 1a. Finnhub live quote ── */
  if (finnhubKey) {
    tasks.push(
      fetchJSON(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`,
        5000
      )
        .then(q => {
          // Finnhub returns c=0 after hours — fall back to prevClose (isEstimated flag)
          const price     = (q.c && q.c !== 0) ? q.c : q.pc;
          const prevClose = q.pc || price;
          if (!price) return; // symbol not on Finnhub free tier
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
        })
        .catch(e => errors.push(`Finnhub quote: ${e.message}`))
    );

    /* ── 1b. Finnhub metrics (fundamentals) ── */
    tasks.push(
      fetchJSON(
        `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${finnhubKey}`,
        5000
      )
        .then(data => {
          const m = data?.metric;
          if (!m) return;
          result.fundamentals = {
            marketCap:     m['marketCapitalization'] ? (m['marketCapitalization'] * 1e6) : null,
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
        })
        .catch(e => errors.push(`Finnhub metrics: ${e.message}`))
    );
  }

  /* ── 2. Alpha Vantage TIME_SERIES_DAILY — 36+ months of candles ──
     outputsize=full returns up to 20 years of daily OHLCV.
     We slice to 3 years (756 trading days) before sending to browser.
     Covers US + all major international exchanges that AV supports.
     AV uses native exchange format: BP.L, SHEL.L, 7203.T work correctly.
  ── */
  if (avKey) {
    tasks.push(
      fetchJSON(
        `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
        `&symbol=${encodeURIComponent(symbol)}&outputsize=full&apikey=${avKey}`,
        9000  // larger timeout — full output is a large payload
      )
        .then(data => {
          if (data?.Note || data?.Information) {
            errors.push('Alpha Vantage daily limit reached — candle data unavailable until tomorrow');
            return;
          }
          const series = data?.['Time Series (Daily)'];
          if (!series) return; // symbol not in AV universe

          // Convert object to array, sort newest→oldest, slice 3yr, reverse to oldest→newest
          const candles = Object.entries(series)
            .map(([dateStr, v]) => ({
              time:   Math.floor(new Date(dateStr).getTime() / 1000),
              open:   parseFloat(v['1. open']),
              high:   parseFloat(v['2. high']),
              low:    parseFloat(v['3. low']),
              close:  parseFloat(v['4. close']),
              volume: parseInt(v['5. volume'], 10),
            }))
            .filter(c => !isNaN(c.open) && !isNaN(c.close))
            .sort((a, b) => b.time - a.time)  // newest first for slicing
            .slice(0, 756)                      // 3 years ≈ 756 trading days
            .reverse();                         // oldest first for rendering

          if (candles.length > 0) {
            result.candles      = candles;
            result.candleSource = 'Alpha Vantage';
            result.candleMonths = Math.round(candles.length / 21); // ~21 trading days/month
          }
        })
        .catch(e => errors.push(`AV candles: ${e.message}`))
    );

    /* ── 3. AV OVERVIEW fundamentals fallback (parallel) ── */
    tasks.push(
      fetchJSON(
        `https://www.alphavantage.co/query?function=OVERVIEW` +
        `&symbol=${encodeURIComponent(symbol)}&apikey=${avKey}`,
        7000
      )
        .then(ov => {
          if (result.fundamentals) return; // Finnhub already got it
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
            industry:      ov.Industry || null,
            source:        'Alpha Vantage',
          };
        })
        .catch(e => errors.push(`AV overview: ${e.message}`))
    );

    /* ── 4. AV GLOBAL_QUOTE quote fallback (parallel) ── */
    tasks.push(
      fetchJSON(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE` +
        `&symbol=${encodeURIComponent(symbol)}&apikey=${avKey}`,
        6000
      )
        .then(data => {
          if (result.quote) return; // Finnhub already got it
          const q = data?.['Global Quote'];
          if (!q?.['05. price']) return;
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
        })
        .catch(e => errors.push(`AV quote: ${e.message}`))
    );
  }

  /* ── Wait for ALL fetches to settle ── */
  await Promise.allSettled(tasks);

  /* ── Nothing came back from any source ── */
  if (!result.quote && !result.fundamentals) {
    return res.status(502).json({
      error:  'No data available for this symbol',
      symbol,
      hint:   'This symbol may not be covered by Finnhub or Alpha Vantage free tiers. ' +
              'International exchange symbols (Tadawul, smaller Asian/African exchanges) ' +
              'have limited free-tier coverage. Try the US-listed ADR equivalent.',
      errors,
    });
  }

  /* ── Cache: 6 hours when candle data present, 60s for live quote only ── */
  const cacheSeconds = result.candles ? 21600 : 60;
  res.setHeader('Cache-Control', `s-maxage=${cacheSeconds}, stale-while-revalidate=300`);

  return res.status(200).json({
    ...result,
    errors: errors.length ? errors : undefined,
  });
};

/* ── HTTP fetch helper with configurable per-call timeout ── */
async function fetchJSON(url, timeoutMs = 6000) {
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