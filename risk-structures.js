/* ════════════════════════════════════════════════════════════════════════════
   risk-structures.js  —  DELAX GEO-RISK  ·  v1 structure model (DRAFT for review)
   ────────────────────────────────────────────────────────────────────────────
   PURPOSE
   The "engine" (simulator, Exposure Score, charts) lives in code and knows HOW to
   model a geopolitical risk but nothing ABOUT any specific one. Each risk structure
   is a DATA OBJECT in this file. Adding Taiwan, Red Sea, etc. later = authoring a
   new object here, with zero engine changes.

   WHAT'S IN HERE
     1. RISK_STRUCTURES        — the registry; v1 ships one: 'hormuz-iran'
     2. CHANNEL_NORMALIZERS    — turns raw model values into a 0..1 "stress" scale
     3. UNIVERSE               — DERIVED from the structures (union of bellwethers)
     4. computeExposure()      — reference Exposure Score math (pure, zero API calls)
     5. Worked example         — at the bottom

   CALIBRATION NOTES (need Komla's sign-off — flagged with ★)
     ★ Channel shocks are expressed vs PRE-CONFLICT normal (oil $78, 0% excess CPI).
       Your "baseline" scenario is the central WAR case (P=50%), not peacetime.
     ★ Sector betas are first-draft sensitivities (−1..+1). They're derived from your
       investor-action content (overweight energy/defense/reconstruction; underweight
       aviation/luxury/EM). Tune against history before locking.
     ★ MDR (McDermott) from your content was delisted; swapped to ACM/PWR.
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   1. CHANNEL NORMALIZERS
   Each structure reports shocks in a channel's natural unit (oil $/bbl, CPI points,
   shipping %). To make beta × shock comparable ACROSS channels, every raw value is
   mapped to a 0..1 "stress" scale via a per-channel reference span. Stress = 0 means
   pre-conflict normal; stress = 1 means a severe historical-tail level.
   These spans are tunable — they set how "hot" each channel reads.
   ════════════════════════════════════════════════════════════════════════════ */
const CHANNEL_NORMALIZERS = {
  // channel : (rawValue) => 0..1 stress
  oil:      (peakUsd)  => clamp((peakUsd - 78) / (220 - 78)),     // $78 normal → $220 tail
  shipping: (pctAbove) => clamp(pctAbove / 500),                  // +500% = max stress
  cpi:      (pts)      => clamp(pts / 7),                         // +7pts ≈ 1973 embargo
  gdp:      (lossPts)  => clamp(Math.abs(lossPts) / 5),           // −5% ≈ deep global recession
  fx:       (emDepPts) => clamp(Math.abs(emDepPts) / 25),         // −25% EM basket = max
  defense:  (extraB)   => clamp(extraB / 1000),                   // +$1T extra = max
  food:     (pctRise)  => clamp(pctRise / 50),                    // +50% FAO = max
};
function clamp(x, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, x)); }

/* ════════════════════════════════════════════════════════════════════════════
   2. RISK STRUCTURES REGISTRY
   ════════════════════════════════════════════════════════════════════════════ */
const RISK_STRUCTURES = {

  'hormuz-iran': {
    id: 'hormuz-iran',
    meta: {
      name:    'Strait of Hormuz / Iran Conflict',
      short:   'Hormuz / Iran',
      type:    'chokepoint',            // chokepoint | conflict | economic | climate
      region:  'Persian Gulf',
      status:  'active',                // active | dormant | historical  ← flip to 'dormant' if Hormuz reopens; structure stays scoreable
      coords:  { lat: 26.57, lng: 56.25 },
      flow:    '~20% of global oil & ~18% of LNG transit daily',
      context: 'A centuries-old maritime chokepoint. ~21M bbl/day transit Hormuz; ' +
               'Iran produces ~3.3M bbl/day pre-conflict. Saudi spare capacity ~2.5M ' +
               'bbl/day offers short-term relief; US shale needs a 6–9 month ramp; SPR ' +
               'releases cover only ~8–12 weeks of any supply gap.',
      modelVersion: '2.2',
      modelDate:    '2026-04-05',
    },

    /* Which economic channels THIS structure actually moves. Variable per structure —
       Taiwan would declare ['semiconductors','tech','gdp','fx'] instead. The engine
       only ever touches the channels a structure declares. */
    channels: ['oil', 'shipping', 'cpi', 'gdp', 'fx', 'defense', 'food'],

    /* SCENARIOS — values are pulled straight from KPI_MAP in index.html.
       `raw`    = human-readable model output (for display, matches your KPI cards)
       `stress` = `raw` run through CHANNEL_NORMALIZERS (computed below, for the math) */
    scenarios: [
      {
        id: 'optimistic', label: 'Ceasefire / De-escalation', severity: 1, probability: 0.22,
        desc: 'Ceasefire by Month 10, Hormuz reopens ~Month 8. Oil settles ~$105–112. Reconstruction demand lifts MENA equities.',
        raw: { oil: 112, shipping: 185, cpi: 1.9, gdp: -0.8, fx: -7,  defense: 480, food: 14 },
        durationMonths: [8, 14],
      },
      {
        id: 'baseline', label: 'Central War Case', severity: 3, probability: 0.50,
        desc: '24-month conflict, partial Hormuz disruption. Oil peaks ~$148. Stagflation risk HIGH. This is the model default.',
        raw: { oil: 148, shipping: 310, cpi: 3.8, gdp: -1.9, fx: -14, defense: 680, food: 27 },
        durationMonths: [18, 36],
      },
      {
        id: 'pessimistic', label: 'Full Hormuz Closure', severity: 5, probability: 0.28,
        desc: 'Full Hormuz closure 6+ months, regional expansion. Oil $195–220. Global recession Yr 1–2. Petrodollar fracture risk.',
        raw: { oil: 195, shipping: 490, cpi: 6.1, gdp: -3.4, fx: -22, defense: 920, food: 42 },
        durationMonths: [36, 60],
      },
    ],

    /* TIMELINE — the OIL_DATA arrays from index.html, kept as the structure's signature
       trajectory. granularity matches OIL_LABELS (M1–M12, then quarterly, then yearly). */
    timeline: {
      start: '2026-01', end: '2033-12',
      labels: ['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12',
               'Q1Y2','Q2Y2','Q3Y2','Q4Y2','Q1Y3','Q2Y3','Q3Y3','Q4Y3','Y4','Y5','Y6','Y7'],
      oil: {
        optimistic:  [84,93,105,112,108,104,100,97,95,93,91,90,88,87,86,85,84,83,83,82,82,81],
        baseline:    [88,102,125,148,141,136,132,128,122,118,114,110,107,104,100,97,96,95,93,92,90,89],
        pessimistic: [92,115,148,188,195,185,172,163,155,148,140,133,128,122,116,112,110,108,106,104,102,100],
      },
      preConflictOil: 78,
    },

    /* ════════════════════════════════════════════════════════════════════════
       EXPOSURE MODEL — the bridge to the portfolio score. THIS is the new piece.
       sectors[sector][channel] = beta: sensitivity of that sector's return to a unit
       of stress in that channel. + = sector RISES as the channel stresses; − = falls.
       Derived from your investor-action content. ★ first-draft — tune before lock.
       ════════════════════════════════════════════════════════════════════════ */
    exposure: {
      sectors: {
        energy_producers: { oil: +0.90, shipping: +0.20, gdp: -0.10 },   // XOM, CVX, SHEL — big oil winner
        gulf_producers:   { oil: +0.60, fx: +0.10 },                     // KSA — Gulf NOC proxy
        defense:          { defense: +0.90, gdp: -0.05 },                // RTX, LMT, NOC
        shipping_tankers: { shipping: +0.85, oil: +0.20 },               // FRO, STNG — rates spike
        lng:              { oil: +0.55, shipping: +0.30 },               // LNG, FANG — reroute beneficiary
        gold_safehaven:   { cpi: +0.40, fx: +0.30, gdp: +0.30 },         // GLD, GDX — rises with stress
        reconstruction:   { defense: +0.50, gdp: -0.20 },                // FLR, ACM — post-ceasefire upside
        aviation:         { oil: -0.90, gdp: -0.40 },                    // JETS, DAL — fuel + demand hit
        luxury_consumer:  { gdp: -0.60, cpi: -0.30 },                    // LVMUY — demand destruction
        em_equity:        { fx: -0.70, gdp: -0.40, oil: -0.20 },         // EEM, EWZ — importer pain
        em_sovereign:     { fx: -0.80, gdp: -0.30 },                     // EMB — debt-crisis exposed
        broad_market:     { gdp: -0.50, cpi: -0.20, oil: -0.10 },        // SPY, QQQ
      },
      /* Per-ticker overrides for names whose behavior diverges from their sector.
         (empty for v1 — add idiosyncratic cases here as you find them) */
      tickers: {},
    },

    /* NARRATIVES — your assumption cards, as data. tone drives the UI color. */
    narratives: [
      { tone: 'red',   title: 'NATO Article 5 Ambiguity', points: [
        'Turkish geopolitical pivot strains the alliance',
        'Energy crisis 2.0 via forced LNG re-routing',
        'Spillover risk to broader Eastern Med' ] },
      { tone: 'amber', title: 'Chinese Sanctions Defiance', points: [
        'China buys sanctioned Iranian oil at ~40% discount',
        'Secondary sanctions on Chinese banks → decoupling',
        'USD reserve share drops 3–5% by 2030',
        'Trade fragmentation accelerates 2–3 years' ] },
      { tone: 'amber', title: 'EM Sovereign Debt Crisis', points: [
        'Pakistan, Egypt, Ghana, Sri Lanka forex crunch',
        'IMF bailout pipeline overwhelmed; frontier contagion',
        'Political instability in 5–8 countries by Year 2',
        'Refugee surge into Europe and Gulf states' ] },
      { tone: 'green', title: 'Reconstruction Opportunity', points: [
        'Post-conflict $800B–$1.2T demand (MENA, 5–15yr)',
        'Defense/dual-use stocks surge 40–80% at ceasefire',
        'Gulf SWFs deploy into Western infrastructure',
        'EU LNG terminal investment boom',
        'Green energy: $500B+ solar/wind mandates by 2030' ] },
    ],

    /* HISTORICAL PRECEDENTS — for the methodology/transparency panel */
    precedents: [
      { event: '1973 Oil Embargo',      note: 'CPI +9%, OECD GDP −2.9% (18-month lag)' },
      { event: '1990–91 Gulf War',      note: 'Oil spike +140%, receded in ~6 months' },
      { event: '1987–88 Tanker War',    note: 'Closest Hormuz analog — partial disruption' },
      { event: '2022 Russia–Ukraine',   note: 'Energy +200%, Europe CPI +10%' },
    ],

    /* Which live snapshot feeds this structure cares about (for the cron universe) */
    liveBindings: { primary: 'brent', secondary: ['wti', 'bdi'] },
  },

  /* ── Future structures slot in here as pure data, e.g.: ──
  'taiwan-strait': {
    id: 'taiwan-strait',
    meta: { name: 'Taiwan Strait', type: 'chokepoint', status: 'dormant',
            flow: '~90% of advanced semiconductors', ... },
    channels: ['semiconductors', 'tech', 'gdp', 'fx'],     // note: no oil
    scenarios: [ { id: 'blockade', ... } ],
    exposure: { sectors: { tech: { semiconductors: -0.9 }, defense: { conflict: +0.7 }, ... } },
    ...
  },
  */
};

/* Compute each scenario's normalized `stress` vector from its `raw` values. */
for (const s of RISK_STRUCTURES['hormuz-iran'].scenarios) {
  s.stress = {};
  for (const ch of RISK_STRUCTURES['hormuz-iran'].channels) {
    const norm = CHANNEL_NORMALIZERS[ch];
    s.stress[ch] = norm ? +norm(s.raw[ch]).toFixed(3) : 0;
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   3. DERIVED UNIVERSE
   The snapshot universe is the UNION of bellwethers across all structures' sectors —
   NOT a separate hand-maintained list. Each sector = 1 ETF proxy + a few liquid names.
   Adding a structure that references new sectors auto-extends this. ~37 tickers.
   `sector` tags double as the classifier target for the Exposure Score.
   ════════════════════════════════════════════════════════════════════════════ */
const UNIVERSE = [
  // energy_producers
  { sym: 'XLE',   sector: 'energy_producers', kind: 'etf' },
  { sym: 'XOM',   sector: 'energy_producers' },
  { sym: 'CVX',   sector: 'energy_producers' },
  { sym: 'SHEL',  sector: 'energy_producers' },
  // gulf_producers
  { sym: 'KSA',   sector: 'gulf_producers',   kind: 'etf' },
  // defense
  { sym: 'ITA',   sector: 'defense',          kind: 'etf' },
  { sym: 'RTX',   sector: 'defense' },
  { sym: 'LMT',   sector: 'defense' },
  { sym: 'NOC',   sector: 'defense' },
  { sym: 'BAESY', sector: 'defense' },
  // shipping_tankers
  { sym: 'FRO',   sector: 'shipping_tankers' },
  { sym: 'STNG',  sector: 'shipping_tankers' },
  { sym: 'TNK',   sector: 'shipping_tankers' },
  // lng
  { sym: 'LNG',   sector: 'lng' },
  { sym: 'FANG',  sector: 'lng' },
  // gold_safehaven
  { sym: 'GLD',   sector: 'gold_safehaven',   kind: 'etf' },
  { sym: 'GDX',   sector: 'gold_safehaven',   kind: 'etf' },
  { sym: 'NEM',   sector: 'gold_safehaven' },
  // aviation
  { sym: 'JETS',  sector: 'aviation',         kind: 'etf' },
  { sym: 'DAL',   sector: 'aviation' },
  { sym: 'UAL',   sector: 'aviation' },
  // luxury_consumer
  { sym: 'LVMUY', sector: 'luxury_consumer' },
  // em_equity
  { sym: 'EEM',   sector: 'em_equity',        kind: 'etf' },
  { sym: 'EWZ',   sector: 'em_equity',        kind: 'etf' },
  // em_sovereign
  { sym: 'EMB',   sector: 'em_sovereign',     kind: 'etf' },
  // reconstruction
  { sym: 'FLR',   sector: 'reconstruction' },
  { sym: 'ACM',   sector: 'reconstruction' },   // ← replaces delisted MDR
  { sym: 'PWR',   sector: 'reconstruction' },
  { sym: 'CAT',   sector: 'reconstruction' },
  { sym: 'VMC',   sector: 'reconstruction' },
  // broad_market
  { sym: 'SPY',   sector: 'broad_market',      kind: 'etf' },
  { sym: 'QQQ',   sector: 'broad_market',      kind: 'etf' },
  // hedges / commodities
  { sym: 'DBC',   sector: 'gold_safehaven',    kind: 'etf' },
  { sym: 'GSG',   sector: 'gold_safehaven',    kind: 'etf' },
];

/* Fast lookup: ticker → sector. Out-of-universe holdings get classified once
   (cached fundamentals call) into one of these sectors, then scored for free. */
const SYM_TO_SECTOR = UNIVERSE.reduce((m, u) => (m[u.sym] = u.sector, m), {});

/* ════════════════════════════════════════════════════════════════════════════
   4. EXPOSURE SCORE — reference implementation
   Pure math over the structure object + the portfolio. ZERO API calls. Runs in the
   browser. Works on ANY ticker (in-universe by lookup, out-of-universe by classifier).
   ────────────────────────────────────────────────────────────────────────────
   portfolio : [{ sym, weight, sector? }]   weights need not sum to 1 (normalized here)
   structureId, scenarioId : which risk + which severity
   returns   : { score, byChannel, byHolding, label }
   ════════════════════════════════════════════════════════════════════════════ */
function computeExposure(portfolio, structureId, scenarioId) {
  const structure = RISK_STRUCTURES[structureId];
  if (!structure) throw new Error('Unknown structure: ' + structureId);
  const scenario = structure.scenarios.find(s => s.id === scenarioId);
  if (!scenario) throw new Error('Unknown scenario: ' + scenarioId);

  const betasBySector = structure.exposure.sectors;
  const tickerOverrides = structure.exposure.tickers || {};
  const totalW = portfolio.reduce((a, h) => a + (h.weight || 0), 0) || 1;

  const byChannel = {};
  const byHolding = [];
  let score = 0;

  for (const h of portfolio) {
    const w = (h.weight || 0) / totalW;
    const sector = h.sector || SYM_TO_SECTOR[h.sym] || 'broad_market';   // fallback
    const betas = tickerOverrides[h.sym] || betasBySector[sector] || {};

    let holdingImpact = 0;
    for (const ch of structure.channels) {
      const beta = betas[ch];
      if (!beta) continue;
      const contrib = beta * (scenario.stress[ch] || 0);   // sensitivity × stress
      holdingImpact += contrib;
      byChannel[ch] = (byChannel[ch] || 0) + w * contrib;
    }
    const weighted = w * holdingImpact;
    score += weighted;
    byHolding.push({ sym: h.sym, sector, weight: +w.toFixed(3), impact: +holdingImpact.toFixed(3) });
  }

  // score is ~ −1..+1. Map to a display % move (★ DISPLAY_GAIN tunable to history).
  const DISPLAY_GAIN = 100;
  const pct = +(score * DISPLAY_GAIN).toFixed(1);
  byHolding.sort((a, b) => a.impact - b.impact);   // worst-hit first

  return {
    score: +score.toFixed(4),
    pct,                                            // illustrative portfolio move, %
    label: pct >= 0 ? `+${pct}% (net beneficiary)` : `${pct}% (net exposed)`,
    byChannel: Object.fromEntries(Object.entries(byChannel).map(([k, v]) => [k, +(v * DISPLAY_GAIN).toFixed(1)])),
    byHolding,
    scenario: { id: scenario.id, label: scenario.label, probability: scenario.probability },
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   5. WORKED EXAMPLE  (uncomment to run with `node risk-structures.js`)
   A typical retail portfolio under the central war case:
   ════════════════════════════════════════════════════════════════════════════ */
// const demo = [
//   { sym: 'AAPL', weight: 30, sector: 'broad_market' },  // out-of-universe → classified
//   { sym: 'DAL',  weight: 20 },                           // aviation — oil-crushed
//   { sym: 'XOM',  weight: 20 },                           // energy — oil winner
//   { sym: 'EEM',  weight: 15 },                           // EM — fx pain
//   { sym: 'GLD',  weight: 15 },                           // hedge
// ];
// console.log(JSON.stringify(computeExposure(demo, 'hormuz-iran', 'baseline'), null, 2));

/* ── Exports: browser global + CommonJS (matches your dual frontend/serverless use) ── */
if (typeof window !== 'undefined') {
  window.RISK_STRUCTURES = RISK_STRUCTURES;
  window.UNIVERSE = UNIVERSE;
  window.computeExposure = computeExposure;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RISK_STRUCTURES, UNIVERSE, SYM_TO_SECTOR, CHANNEL_NORMALIZERS, computeExposure };
}
