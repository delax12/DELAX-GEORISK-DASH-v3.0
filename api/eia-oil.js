/**
 * /api/eia-oil.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────
 * Secure proxy for EIA v2 Petroleum Spot Prices API.
 * Returns BOTH WTI (RWTC) and Brent (RBRTE) in a single response.
 * Keeps EIA_API_KEY server-side — never exposed to the browser.
 *
 * BATCH A FIX (May 2026):
 *   Previous version fetched only RWTC (WTI) but the response shape
 *   was ambiguous. GEO Intel iframe was assigning the WTI value to the
 *   BRENT ticker row, causing the WTI/Brent mismatch between the main
 *   header pill and the GEO Intel sidebar.
 *
 *   This version fetches both series in one API call (EIA v2 supports
 *   repeated facets[series][] params) and returns them as nested
 *   { wti: {...}, brent: {...} } objects. Top-level fields remain WTI
 *   for back-compat with the main index.html WTI pill.
 *
 * SETUP (one-time in Vercel Dashboard):
 *   1. vercel.com → Your Project → Settings → Environment Variables
 *   2. Add:  Name = EIA_API_KEY  |  Value = <your key from eia.gov/opendata>
 *   3. Check: Production, Preview, Development
 *   4. Save → Deployments → Redeploy
 *
 * ENDPOINT:
 *   GET /api/eia-oil
 *   Returns:
 *     {
 *       // Top-level = WTI (back-compat with index.html)
 *       price, date, series, seriesName, unit, trend7d, history,
 *       // Nested explicit series objects (use these in new code)
 *       wti:   { price, date, series, seriesName, unit, trend7d, history },
 *       brent: { price, date, series, seriesName, unit, trend7d, history },
 *       fetchedAt
 *     }
 *
 * CACHING:
 *   CDN edge cache: 6 hours (EIA publishes once daily ~4pm ET)
 *   stale-while-revalidate: 1 hour
 */

module.exports = async function handler(req, res) {

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read key from Vercel environment — never from client
  const apiKey = process.env.EIA_API_KEY;

  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({
      error: 'EIA_API_KEY environment variable is not set.',
      fix:   'Vercel Dashboard → Your Project → Settings → Environment Variables → Add EIA_API_KEY',
      docs:  'https://vercel.com/docs/projects/environment-variables'
    });
  }

  /**
   * EIA v2 API — Petroleum Spot Prices
   * Series fetched:
   *   RWTC  = Cushing, OK WTI Spot Price FOB (Dollars per Barrel, daily)
   *   RBRTE = Europe Brent Spot Price FOB    (Dollars per Barrel, daily)
   * Docs: https://www.eia.gov/opendata/browser/petroleum/pri/spt
   *
   * length=60 covers ~30 trading days per series after server splits them.
   */
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
    const upstream = await fetch(EIA_URL, {
      headers: { 'Accept': 'application/json' }
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(upstream.status).json({
        error:  'EIA API returned an error',
        status: upstream.status,
        detail: body.slice(0, 400)
      });
    }

    const json = await upstream.json();
    const rows = json && json.response && json.response.data;

    if (!rows || rows.length === 0) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'EIA returned an empty dataset' });
    }

    // Split rows by series. EIA returns them mixed when multiple facets[series][] are sent.
    const wtiRows   = rows.filter(function(r) { return r.series === 'RWTC';  });
    const brentRows = rows.filter(function(r) { return r.series === 'RBRTE'; });

    const wti   = buildSeriesPayload(wtiRows,   'RWTC',  'WTI Cushing Spot Price FOB');
    const brent = buildSeriesPayload(brentRows, 'RBRTE', 'Brent Crude Spot Price FOB');

    if (!wti && !brent) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'EIA returned data but no valid price values' });
    }

    // Back-compat: top-level fields mirror WTI (the original behavior).
    // The main index.html WTI pill reads data.price and stays correct.
    const topLevel = wti || brent;

    const payload = {
      // Top-level = WTI (or Brent fallback if WTI failed) — preserves existing index.html behavior
      price:      topLevel.price,
      date:       topLevel.date,
      series:     topLevel.series,
      seriesName: topLevel.seriesName,
      unit:       topLevel.unit,
      trend7d:    topLevel.trend7d,
      history:    topLevel.history,

      // Explicit nested objects — new callers should use these
      wti:   wti,
      brent: brent,

      fetchedAt: new Date().toISOString()
    };

    // Cache at CDN edge for 6 hours; serve stale for 1hr while revalidating
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('[eia-oil] fetch error:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({
      error:  'Upstream fetch to EIA failed',
      detail: err.message
    });
  }
};

/**
 * Build a normalized payload for a single EIA series.
 * Returns null if the rows array is empty or contains no valid price.
 */
function buildSeriesPayload(rows, seriesId, seriesName) {
  if (!rows || rows.length === 0) return null;

  const latest = rows[0];
  const price  = parseFloat(latest.value);
  if (isNaN(price)) return null;

  // 7-day price trend
  const weekAgo      = rows[Math.min(6, rows.length - 1)];
  const weekAgoPrice = parseFloat(weekAgo && weekAgo.value ? weekAgo.value : price);
  const trend7d      = weekAgoPrice
    ? parseFloat((((price - weekAgoPrice) / weekAgoPrice) * 100).toFixed(2))
    : 0;

  // 30-day history array (newest first) for optional sparkline use
  const history = rows
    .map(function(r) { return { date: r.period, price: parseFloat(r.value) }; })
    .filter(function(r) { return !isNaN(r.price); });

  return {
    price:      price,
    date:       latest.period,
    series:     seriesId,
    seriesName: seriesName,
    unit:       'Dollars per Barrel',
    trend7d:    trend7d,
    history:    history
  };
}
