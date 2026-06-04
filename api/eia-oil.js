/**
 * /api/eia-oil.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────
 * Secure proxy for EIA v2 Petroleum Spot Prices API.
 * Returns BOTH WTI (RWTC) and Brent (RBRTE) in a single response.
 * Keeps EIA_API_KEY server-side — never exposed to the browser.
 *
 * BATCH A FIX (May 2026):
 *   Fetches both series in one EIA v2 call and returns them as nested
 *   { wti, brent } objects. Top-level fields mirror WTI for back-compat.
 *
 * TIMEOUT FIX (Jun 2026):
 *   The EIA fetch previously had NO timeout. When EIA was slow the function
 *   hung until Vercel's ~10s platform limit killed it → 504 Gateway Timeout.
 *   Now the fetch is wrapped in an AbortController (8s). A slow EIA fails fast
 *   with a clean, no-store error instead of a 504; meanwhile the 6-hour edge
 *   cache keeps serving the last good value to visitors. 8s < the 10s platform
 *   limit, so we control the failure instead of the platform forcing a 504.
 *
 * ENDPOINT:  GET /api/eia-oil
 * CACHING:   CDN edge 6h (EIA publishes ~once daily); stale-while-revalidate 1h
 */
'use strict';

const EIA_TIMEOUT_MS = 8000; // must stay under the ~10s platform limit

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({
      error: 'EIA_API_KEY environment variable is not set.',
      fix:   'Vercel Dashboard → Settings → Environment Variables → Add EIA_API_KEY',
    });
  }

  /* EIA v2 Petroleum Spot Prices — RWTC (WTI Cushing) + RBRTE (Europe Brent),
     daily, newest first. length=60 ≈ 30 trading days per series after split. */
  const EIA_URL =
    'https://api.eia.gov/v2/petroleum/pri/spt/data/' +
    '?api_key=' + encodeURIComponent(apiKey) +
    '&frequency=daily' +
    '&data[0]=value' +
    '&facets[series][]=RWTC' +
    '&facets[series][]=RBRTE' +
    '&sort[0][column]=period' +
    '&sort[0][direction]=desc' +
    '&length=60';

  try {
    const upstream = await fetchWithTimeout(EIA_URL, EIA_TIMEOUT_MS);

    if (!upstream.ok) {
      const body = await upstream.text();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(upstream.status).json({
        error:  'EIA API returned an error',
        status: upstream.status,
        detail: body.slice(0, 400),
      });
    }

    const json = await upstream.json();
    const rows = json && json.response && json.response.data;

    if (!rows || rows.length === 0) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'EIA returned an empty dataset' });
    }

    const wtiRows   = rows.filter(function (r) { return r.series === 'RWTC';  });
    const brentRows = rows.filter(function (r) { return r.series === 'RBRTE'; });

    const wti   = buildSeriesPayload(wtiRows,   'RWTC',  'WTI Cushing Spot Price FOB');
    const brent = buildSeriesPayload(brentRows, 'RBRTE', 'Brent Crude Spot Price FOB');

    if (!wti && !brent) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'EIA returned data but no valid price values' });
    }

    const topLevel = wti || brent;
    const payload = {
      price:      topLevel.price,
      date:       topLevel.date,
      series:     topLevel.series,
      seriesName: topLevel.seriesName,
      unit:       topLevel.unit,
      trend7d:    topLevel.trend7d,
      history:    topLevel.history,
      wti:        wti,
      brent:      brent,
      fetchedAt:  new Date().toISOString(),
    };

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(payload);

  } catch (err) {
    /* AbortError (our timeout) or network failure — fail fast, never cache.
       The previous good response remains served from the 6h edge cache. */
    const isTimeout = err && err.name === 'AbortError';
    console.error('[eia-oil] fetch error:', isTimeout ? 'EIA timeout (8s)' : err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(isTimeout ? 503 : 500).json({
      error:  isTimeout ? 'EIA upstream timed out' : 'Upstream fetch to EIA failed',
      detail: isTimeout ? `No response within ${EIA_TIMEOUT_MS}ms` : err.message,
    });
  }
};

/* fetch() with a hard timeout via AbortController. Prevents the function from
   hanging past the platform limit (which would surface as a 504). */
async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  try {
    return await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* Build a normalized payload for a single EIA series. */
function buildSeriesPayload(rows, seriesId, seriesName) {
  if (!rows || rows.length === 0) return null;

  const latest = rows[0];
  const price  = parseFloat(latest.value);
  if (isNaN(price)) return null;

  const weekAgo      = rows[Math.min(6, rows.length - 1)];
  const weekAgoPrice = parseFloat(weekAgo && weekAgo.value ? weekAgo.value : price);
  const trend7d      = weekAgoPrice
    ? parseFloat((((price - weekAgoPrice) / weekAgoPrice) * 100).toFixed(2))
    : 0;

  const history = rows
    .map(function (r) { return { date: r.period, price: parseFloat(r.value) }; })
    .filter(function (r) { return !isNaN(r.price); });

  return {
    price:      price,
    date:       latest.period,
    series:     seriesId,
    seriesName: seriesName,
    unit:       'Dollars per Barrel',
    trend7d:    trend7d,
    history:    history,
  };
}
