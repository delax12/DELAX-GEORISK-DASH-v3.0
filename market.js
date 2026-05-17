'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rawSymbol = (req.query.symbol || '').toUpperCase().trim();
  const symbol = rawSymbol.replace(/[^A-Z0-9.\-]/g, '');
  if (!symbol) {
    return res.status(400).json({ error: 'symbol query parameter required (e.g. ?symbol=XOM)' });
  }
  if (symbol.length > 16) {
    return res.status(400).json({ error: 'symbol query parameter too long' });
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const avKey = process.env.ALPHA_VANTAGE_KEY;
  if (!finnhubKey && !avKey) {
    return res.status(500).json({ error: 'No market data API keys configured' });
  }

  const errors = [];
  let data = null;

  if (finnhubKey) {
    try {
      data = await fetchFinnhub(symbol, finnhubKey);
    } catch (err) {
      errors.push(`Finnhub: ${err.message}`);
    }
  }

  if ((!data || data.price == null) && avKey) {
    try {
      data = await fetchAlphaVantage(symbol, avKey);
    } catch (err) {
      errors.push(`Alpha Vantage: ${err.message}`);
    }
  }

  if (!data || data.price == null) {
    return res.status(502).json({ error: 'All data sources failed', symbol, errors });
  }

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
  return res.status(200).json({ ...data, errors: errors.length ? errors : undefined });
};

async function fetchFinnhub(symbol, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Finnhub HTTP ${resp.status}`);
    const data = await resp.json();

    const currentPrice = data.c;
    const prevClose = data.pc;

    if ((!currentPrice || currentPrice === 0) && (!prevClose || prevClose === 0)) {
      return null; // symbol genuinely not found
    }

    const price = (currentPrice && currentPrice !== 0) ? currentPrice : prevClose;
    const isEstimated = (!currentPrice || currentPrice === 0);

    const change = prevClose ? price - prevClose : 0;
    const percentChange = prevClose ? (change / prevClose) * 100 : 0;

    return {
      symbol,
      price: parseFloat(price.toFixed(4)),
      change: parseFloat(change.toFixed(4)),
      percentChange: parseFloat(percentChange.toFixed(4)),
      high: data.h || null,
      low: data.l || null,
      open: data.o || null,
      prevClose: prevClose || null,
      isEstimated,
      currency: 'USD',
      source: 'Finnhub',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Finnhub timeout');
    throw err;
  }
}

async function fetchAlphaVantage(symbol, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Alpha Vantage HTTP ${resp.status}`);
    const json = await resp.json();

    if (json?.Note || json?.Information) {
      throw new Error('Alpha Vantage rate limit reached (25 req/day on free tier)');
    }

    const q = json?.['Global Quote'];
    if (!q || !q['05. price']) return null;

    const price = parseFloat(q['05. price']);
    const prevClose = parseFloat(q['08. previous close'] || q['05. price']);
    const change = parseFloat(q['09. change'] || '0');
    const pctRaw = (q['10. change percent'] || '0%').replace('%', '');
    const pct = parseFloat(pctRaw);

    if (!price || isNaN(price)) return null;

    return {
      symbol,
      price: parseFloat(price.toFixed(4)),
      change: parseFloat(change.toFixed(4)),
      percentChange: parseFloat(pct.toFixed(4)),
      prevClose: parseFloat(prevClose.toFixed(4)),
      isEstimated: false,
      currency: 'USD',
      source: 'Alpha Vantage',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Alpha Vantage timeout');
    throw err;
  }
}
