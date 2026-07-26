// /api/market.js — DELAX GEO-RISK oil market endpoint
// Dual benchmark (WTI + Brent), dual-source fallback chain.
// Chain per benchmark:
//   1. Yahoo Finance futures quote (CL=F / BZ=F) — near-real-time, no API key
//   2. AlphaVantage daily spot (WTI / BRENT) — 1-day lag, uses ALPHAVANTAGE_API_KEY
//   3. EIA official spot — authoritative but lagged, uses EIA_API_KEY, always labeled with its date
// Rule: NEVER substitute one benchmark's value into the other's field.
// If every source fails for a benchmark, that benchmark returns null and the
// frontend should render "unavailable".

const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;
const EIA_KEY = process.env.EIA_API_KEY;

// EIA v2 series IDs for daily spot prices
const EIA_SERIES = {
  wti: "RWTC",  // Cushing, OK WTI Spot Price FOB
  brent: "RBRTE" // Europe Brent Spot Price FOB
};

const YAHOO_SYMBOLS = { wti: "CL=F", brent: "BZ=F" };
const AV_FUNCTIONS = { wti: "WTI", brent: "BRENT" };

// ---------- Source 1: Yahoo Finance futures (live) ----------
async function fetchYahoo(benchmark) {
  const symbol = YAHOO_SYMBOLS[benchmark];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=7d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (DELAX GEO-RISK dashboard)" }
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  const data = await res.json();

  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number") throw new Error(`Yahoo ${symbol}: no price in response`);

  // 7d change from the oldest close in the 7d window
  let changePct7d = null;
  const closes = result?.indicators?.quote?.[0]?.close?.filter(v => typeof v === "number");
  if (closes && closes.length > 1) {
    const first = closes[0];
    if (first > 0) changePct7d = ((price - first) / first) * 100;
  }

  return {
    price: round2(price),
    changePct7d: changePct7d !== null ? round2(changePct7d) : null,
    source: "Yahoo Finance futures",
    symbol,
    asOf: meta?.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
    live: true
  };
}

// ---------- Source 2: AlphaVantage daily spot (1-day lag) ----------
async function fetchAlphaVantage(benchmark) {
  if (!AV_KEY) throw new Error("ALPHAVANTAGE_API_KEY not set");
  const fn = AV_FUNCTIONS[benchmark];
  const url = `https://www.alphavantage.co/query?function=${fn}&interval=daily&apikey=${AV_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AlphaVantage ${fn} HTTP ${res.status}`);
  const data = await res.json();

  const series = data?.data;
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error(`AlphaVantage ${fn}: empty series (rate limit or bad key)`);
  }

  // Series is newest-first; entries can have value "." on holidays — skip those
  const valid = series.filter(d => d.value !== "." && !isNaN(parseFloat(d.value)));
  if (valid.length === 0) throw new Error(`AlphaVantage ${fn}: no valid data points`);

  const latest = valid[0];
  const price = parseFloat(latest.value);

  // 7d change: find the point ~7 calendar days back
  let changePct7d = null;
  const latestDate = new Date(latest.date);
  const target = new Date(latestDate);
  target.setDate(target.getDate() - 7);
  const prior = valid.find(d => new Date(d.date) <= target);
  if (prior) {
    const priorPrice = parseFloat(prior.value);
    if (priorPrice > 0) changePct7d = ((price - priorPrice) / priorPrice) * 100;
  }

  return {
    price: round2(price),
    changePct7d: changePct7d !== null ? round2(changePct7d) : null,
    source: "AlphaVantage daily spot",
    asOf: latest.date,
    live: false
  };
}

// ---------- Source 3: EIA official spot (lagged, authoritative) ----------
async function fetchEIA(benchmark) {
  if (!EIA_KEY) throw new Error("EIA_API_KEY not set");
  const series = EIA_SERIES[benchmark];
  const url =
    `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_KEY}` +
    `&frequency=daily&data[0]=value&facets[series][]=${series}` +
    `&sort[0][column]=period&sort[0][direction]=desc&length=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EIA ${series} HTTP ${res.status}`);
  const data = await res.json();

  const rows = data?.response?.data;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`EIA ${series}: no data`);

  const latest = rows[0];
  const price = parseFloat(latest.value);
  if (isNaN(price)) throw new Error(`EIA ${series}: invalid value`);

  let changePct7d = null;
  const prior = rows[rows.length - 1];
  const priorPrice = parseFloat(prior?.value);
  if (!isNaN(priorPrice) && priorPrice > 0 && prior !== latest) {
    changePct7d = ((price - priorPrice) / priorPrice) * 100;
  }

  // Flag staleness so the frontend can show "EIA official · as of {date}"
  const ageDays = Math.floor((Date.now() - new Date(latest.period).getTime()) / 86400000);

  return {
    price: round2(price),
    changePct7d: changePct7d !== null ? round2(changePct7d) : null,
    source: "EIA official spot",
    asOf: latest.period,
    ageDays,
    stale: ageDays > 2,
    live: false
  };
}

// ---------- Fallback chain ----------
async function fetchBenchmark(benchmark) {
  const chain = [
    ["yahoo", fetchYahoo],
    ["alphavantage", fetchAlphaVantage],
    ["eia", fetchEIA]
  ];
  const errors = [];
  for (const [name, fn] of chain) {
    try {
      const result = await fn(benchmark);
      return { ...result, benchmark: benchmark.toUpperCase(), fallbacksTried: errors };
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  // All sources failed — return null, never a substitute value
  console.error(`All sources failed for ${benchmark}:`, errors);
  return null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const [wti, brent] = await Promise.all([
      fetchBenchmark("wti"),
      fetchBenchmark("brent")
    ]);

    // Optional: keep EIA as a "verified" secondary read even when live succeeds,
    // so the UI can show both the live quote and the official EIA print + date.
    let eiaVerified = null;
    try {
      const [eiaWti, eiaBrent] = await Promise.all([fetchEIA("wti"), fetchEIA("brent")]);
      eiaVerified = { wti: eiaWti, brent: eiaBrent };
    } catch (_) {
      // Non-fatal — verified block is a bonus, not a requirement
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      updatedAt: new Date().toISOString(),
      wti,     // null if all sources failed — frontend renders "unavailable"
      brent,   // null if all sources failed — frontend renders "unavailable"
      eiaVerified
    });
  } catch (err) {
    console.error("market.js fatal:", err);
    res.status(500).json({ error: "Market data unavailable" });
  }
}
