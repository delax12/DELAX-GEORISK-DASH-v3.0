/* ════════════════════════════════════════════════════════════════════════════
   risk-structures.js  —  DELAX GEO-RISK  ·  v3.0 structure model (CALIBRATED)
   ────────────────────────────────────────────────────────────────────────────
   PURPOSE
   The "engine" (simulator, Exposure Score, charts) lives in code and knows HOW to
   model a geopolitical risk but nothing ABOUT any specific one. Each risk structure
   is a DATA OBJECT in this file. Adding Taiwan, Red Sea, etc. later = authoring a
   new object here, with zero engine changes.

   DELAX GEO-RISK models geopolitical risk as a CROSS-ASSET layer — equities, FX,
   credit, shipping, defense, commodities. Oil is ONE transmission channel among
   several, never the identity of the platform. HORMUZ is an instance, not the thesis.

   WHAT'S IN HERE
     1. RISK_STRUCTURES        — the registry; v1 ships one: 'hormuz-iran'
     2. CHANNEL_NORMALIZERS    — turns raw model values into a 0..1 "stress" scale
     3. UNIVERSE               — DERIVED from the structures (union of bellwethers)
     4. computeExposure()      — reference Exposure Score math (pure, zero API calls)
     5. Worked example         — at the bottom

   ────────────────────────────────────────────────────────────────────────────
   CALIBRATION  (2026-07-11)  —  all ★ draft flags from v2.2 are now RESOLVED
   ────────────────────────────────────────────────────────────────────────────
   Sector betas were calibrated against two historical conflict analogues using
   6.5 years of weekly price history (41 tickers, Jan 2020 → Jul 2026, Twelve Data):

     • UKRAINE 2022  — primary analogue. Baseline Q4-2021 vs shock 24 Feb–30 Jun 2022.
                       Multi-channel: oil, food, defense, gdp all fired.
     • RED SEA 2024  — falsification test. Baseline Sep–Nov 2023 vs Dec 2023–Feb 2024.
                       Shipping-only: oil stress ~0.01, so oil-sensitive sectors
                       correctly did NOT move. Confirms betas aren't over-firing.

   METHOD: every sector's shock-window return is measured NET OF SPY over the same
   window (market-excess). This is the load-bearing choice — H1-2022 was also the
   fastest Fed hiking cycle in decades, and raw returns would attribute rate-driven
   drawdowns to "war beta". Market-netting strips the confound.

   MEASURED CHANNEL STRESS (Ukraine window, via CHANNEL_NORMALIZERS):
     oil 0.321 (WTI peaked $124 vs $78 pre-conflict anchor) · food 0.44 (+22% index)
     fx 0.03 (EM basket barely moved — exporters offset importers)
     cpi ~0.25 · defense ~0.25 · gdp ~0.16  (judgment — no clean weekly driver)

   VALIDATION ANCHORS (empirical, not assumed):
     • Q4-2021 WTI averaged $77 → confirms `preConflictOil: 78` is the right zero-point
     • DISPLAY_GAIN = 100 reproduces observed magnitudes across sectors → retained
     • gulf_producers predicted +19%, observed +19.4% → near-exact, beta unchanged

   KNOWN LIMITS (published in the methodology drawer — honesty is the product):
     • Ukraine and Red Sea are ANALOGUES for a Hormuz event, not replays. A Hormuz
       closure skews more oil/shipping and more EM-importer than Ukraine did.
     • The `fx` channel is the WEAKEST-EVIDENCED. The 2022 EM basket moved only +0.68%
       because EM exporters (Brazil +21% excess) offset EM importers (EEM −5.8%).
       Negative EM betas are retained on the importer-pain thesis but TEMPERED, and
       flagged as the channel most in need of a better analogue.
     • Tanker-rate stress has no free rate index. BDRY (dry bulk) FELL 21% in the
       Ukraine window while tanker equities gained 50% excess — wrong instrument.
       Shipping betas are therefore validated via the Red Sea event, where low tanker
       stress predicted +7.7% vs observed +5.3%. Documented, not hidden.
     • `cpi` betas remain judgment-tier: monthly CPI gives ~4 points per shock window,
       too few to calibrate empirically.
     • Confounds excluded by hand: 2022 value-rotation (energy residual), 2024 AI rally
       (semis +13.9% in Red Sea — unrelated to conflict), 2024 crop normalization (ag).
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   1. CHANNEL NORMALIZERS
   Each structure reports shocks in a channel's natural unit (oil $/bbl, CPI points,
   shipping %). To make beta × shock comparable ACROSS channels, every raw value is
   mapped to a 0..1 "stress" scale via a per-channel reference span. Stress = 0 means
   pre-conflict normal; stress = 1 means a severe historical-tail level.
   These spans are UNCHANGED in v3.0 — the $78 oil anchor was empirically confirmed
   by the Q4-2021 WTI average ($77), so the normalizers were left alone and the
   calibration work went entirely into the betas.
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
      modelVersion:    '3.0',
      modelDate:       '2026-07-11',
      calibration:     'empirical',      // 'draft' | 'empirical'
      calibrationDate: '2026-07-11',
      calibrationBasis: 'Ukraine 2022 (primary) + Red Sea 2024 (falsification); ' +
                        '41 tickers, weekly, 2020-01→2026-07; returns net of SPY.',
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
      preConflictOil: 78,   // ✓ EMPIRICALLY CONFIRMED: Q4-2021 WTI averaged $77
    },

    /* ════════════════════════════════════════════════════════════════════════
       EXPOSURE MODEL — the bridge to the portfolio score.
       sectors[sector][channel] = beta: sensitivity of that sector's return to a unit
       of stress in that channel. + = sector RISES as the channel stresses; − = falls.

       v3.0: CALIBRATED. Each line carries its evidence — the market-excess return
       observed in the Ukraine 2022 window (UKR) and, where informative, Red Sea 2024
       (RS). Tags: ✓ = draft validated, held · ↑↓ = magnitude adjusted on evidence
                  ⚑ = draft was WRONG, corrected
       ════════════════════════════════════════════════════════════════════════ */
    exposure: {
      sectors: {
        // ── VALIDATED: draft betas reproduced observed moves; held unchanged ──
        gulf_producers:   { oil: +0.60, fx: +0.10 },                     // ✓ UKR +19.4% vs predicted +19% — near-exact
        defense:          { defense: +0.90, gdp: -0.05 },                // ✓ UKR +26.5% vs predicted +22%
        shipping_tankers: { shipping: +0.85, oil: +0.20 },               // ✓ UKR +50.7%; RS test: predicted +7.7% vs observed +5.3%
        gold_safehaven:   { cpi: +0.40, fx: +0.30, gdp: +0.30 },         // ✓ GLD alone +14.4% vs predicted +17% (see DBC/GSG overrides)
        em_sovereign:     { fx: -0.80, gdp: -0.30 },                     // ✓ UKR −6.1% vs predicted −7%
        financials:       { gdp: -0.50, fx: -0.20, cpi: -0.10 },         // ✓ UKR −12.6% vs predicted −11.5%
        utilities:        { gdp: -0.05, cpi: -0.20 },                    // ✓ UKR −1.1% — defensive confirmed

        // ── ADJUSTED: right direction, wrong magnitude ──
        energy_producers: { oil: +0.95, shipping: +0.15, gdp: -0.10 },   // ↑ UKR +46.1% (residual = 2022 value-rotation confound)
        lng:              { oil: +0.60, shipping: +0.35 },               // ↑ UKR +38.1% (residual = Europe re-routing windfall)
        reconstruction:   { defense: +0.55, gdp: -0.20 },                // ↑ UKR +13.6%
        agriculture_food: { food: +0.80, cpi: +0.20, gdp: -0.10 },       // ↑ UKR +55.1% sector, but anchored to ADM (+42.5%) not MOS (fertilizer tail)
        broad_market:     { gdp: -0.50, cpi: -0.15, oil: -0.05 },        // ↓ tempered to reproduce observed raw market move
        semiconductors:   { gdp: -0.50, fx: -0.20, oil: -0.10 },         // ↓ UKR −8.2% (RS +13.9% = AI rally, excluded as confound)
        big_tech:         { gdp: -0.35, cpi: -0.10 },                    // ↓ UKR +0.5% — moved WITH the market, not worse than it
        autos:            { oil: -0.50, gdp: -0.45, cpi: -0.15 },        // ↓ UKR raw −22.7%; draft over-predicted at −35%
        luxury_consumer:  { gdp: -0.45, cpi: -0.20 },                    // ↓ UKR −8.8%; draft over-predicted ~2×

        // ── CORRECTED: draft was directionally wrong or hid a split ──
        aviation:         { oil: -0.55, gdp: -0.35 },                    // ⚑ BIGGEST FIX. Draft oil −0.90 was indefensible:
                                                                         //   airlines did NOT underperform in UKR (+2.4% excess;
                                                                         //   DAL +4.4%, UAL +3.5%). Fuel cost was offset by the
                                                                         //   COVID-reopening demand surge. Beta retained negative
                                                                         //   (fuel is a real cost channel) but nearly halved.
        em_equity:        { fx: -0.50, gdp: -0.35, oil: -0.15 },         // ⚑ SPLIT FOUND. The sector average hides OPPOSITE moves:
                                                                         //   EM exporters rallied (EWZ +21.3%), importers fell
                                                                         //   (EEM −5.8%). Betas tempered; the importer-pain thesis
                                                                         //   is retained because a Hormuz event skews importer-heavy.
                                                                         //   Weakest-evidenced sector in the model — see LIMITS.
      },

      /* Per-ticker overrides for names whose behavior diverges from their sector.
         v3.0: first use of this slot — and the data found the cases, not intuition.
         DBC and GSG sit in `gold_safehaven` but are BROAD COMMODITY trackers, not
         safe havens. In the Ukraine window they moved +41.5% and +48.2% excess vs
         GLD's +14.4% — they track the oil complex, not the fear bid. Scoring them
         as gold materially understated their conflict upside. */
      tickers: {
        DBC: { oil: +0.70, cpi: +0.20 },   // Invesco DB Commodity Index — UKR +41.5% excess
        GSG: { oil: +0.75, cpi: +0.20 },   // iShares S&P GSCI Commodity — UKR +48.2% excess (heaviest energy weight)
      },
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

    /* HISTORICAL PRECEDENTS — for the methodology/transparency panel.
       The two marked ▸ are the analogues the v3.0 betas were actually fitted against. */
    precedents: [
      { event: '1973 Oil Embargo',      note: 'CPI +9%, OECD GDP −2.9% (18-month lag)' },
      { event: '1990–91 Gulf War',      note: 'Oil spike +140%, receded in ~6 months' },
      { event: '1987–88 Tanker War',    note: 'Closest Hormuz analog — partial disruption' },
      { event: '2022 Russia–Ukraine',   note: '▸ CALIBRATION ANALOGUE. WTI $77→$124 peak. Energy +46%, defense +27%, tankers +51% (excess of market).' },
      { event: '2023–24 Red Sea',       note: '▸ CALIBRATION FALSIFICATION TEST. Shipping-only shock (oil stress ~0.01). Oil-sensitive sectors correctly did not move.' },
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
  NOTE: a new structure ships with calibration:'draft' in its meta until it has been
  fitted against its own analogues. Do not let a draft structure inherit HORMUZ's
  'empirical' badge — the honesty tiering is the product.
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
   Adding a structure that references new sectors auto-extends this. ~34 tickers.
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
  // hedges / commodities  (sector tag kept for grouping; see exposure.tickers overrides —
  // these two are scored as COMMODITY trackers, not safe havens)
  { sym: 'DBC',   sector: 'gold_safehaven',    kind: 'etf' },
  { sym: 'GSG',   sector: 'gold_safehaven',    kind: 'etf' },
];

/* Fast lookup: ticker → sector. Out-of-universe holdings get classified once
   (cached fundamentals call) into one of these sectors, then scored for free. */

/* ════════════════════════════════════════════════════════════════════════════
   3b. SEARCH CATALOG (101 names) — DECOUPLED from the priced UNIVERSE.
   The Exposure Desk searches & sector-tags against this 101-name catalog. Only the
   leaner snapshot UNIVERSE gets LIVE PRICES; catalog-only names are scored (by
   sector) and shown as 'score-only'. Expanding this list costs NO snapshot quota.
   ════════════════════════════════════════════════════════════════════════════ */
const CATALOG = [
  { sym: 'XOM', sector: 'energy_producers' },
  { sym: 'CVX', sector: 'energy_producers' },
  { sym: 'SHEL', sector: 'energy_producers' },
  { sym: 'BP', sector: 'energy_producers' },
  { sym: 'TTE', sector: 'energy_producers' },
  { sym: 'COP', sector: 'energy_producers' },
  { sym: 'EOG', sector: 'energy_producers' },
  { sym: 'OXY', sector: 'energy_producers' },
  { sym: 'SLB', sector: 'energy_producers' },
  { sym: 'VLO', sector: 'energy_producers' },
  { sym: 'XLE', sector: 'energy_producers' },
  { sym: 'KSA', sector: 'gulf_producers' },
  { sym: 'LNG', sector: 'lng' },
  { sym: 'EQT', sector: 'lng' },
  { sym: 'AR', sector: 'lng' },
  { sym: 'WMB', sector: 'lng' },
  { sym: 'KMI', sector: 'lng' },
  { sym: 'ET', sector: 'lng' },
  { sym: 'RTX', sector: 'defense' },
  { sym: 'LMT', sector: 'defense' },
  { sym: 'NOC', sector: 'defense' },
  { sym: 'GD', sector: 'defense' },
  { sym: 'BA', sector: 'defense' },
  { sym: 'HII', sector: 'defense' },
  { sym: 'LHX', sector: 'defense' },
  { sym: 'BAESY', sector: 'defense' },
  { sym: 'LDOS', sector: 'defense' },
  { sym: 'KTOS', sector: 'defense' },
  { sym: 'ITA', sector: 'defense' },
  { sym: 'FRO', sector: 'shipping_tankers' },
  { sym: 'STNG', sector: 'shipping_tankers' },
  { sym: 'TNK', sector: 'shipping_tankers' },
  { sym: 'INSW', sector: 'shipping_tankers' },
  { sym: 'DHT', sector: 'shipping_tankers' },
  { sym: 'ZIM', sector: 'shipping_tankers' },
  { sym: 'GLD', sector: 'gold_safehaven' },
  { sym: 'GDX', sector: 'gold_safehaven' },
  { sym: 'NEM', sector: 'gold_safehaven' },
  { sym: 'GOLD', sector: 'gold_safehaven' },
  { sym: 'AEM', sector: 'gold_safehaven' },
  { sym: 'FNV', sector: 'gold_safehaven' },
  { sym: 'WPM', sector: 'gold_safehaven' },
  { sym: 'DBC', sector: 'gold_safehaven' },
  { sym: 'JETS', sector: 'aviation' },
  { sym: 'DAL', sector: 'aviation' },
  { sym: 'UAL', sector: 'aviation' },
  { sym: 'AAL', sector: 'aviation' },
  { sym: 'LUV', sector: 'aviation' },
  { sym: 'EEM', sector: 'em_equity' },
  { sym: 'EWZ', sector: 'em_equity' },
  { sym: 'INDA', sector: 'em_equity' },
  { sym: 'FXI', sector: 'em_equity' },
  { sym: 'EWW', sector: 'em_equity' },
  { sym: 'VWO', sector: 'em_equity' },
  { sym: 'EMB', sector: 'em_sovereign' },
  { sym: 'EMLC', sector: 'em_sovereign' },
  { sym: 'FLR', sector: 'reconstruction' },
  { sym: 'ACM', sector: 'reconstruction' },
  { sym: 'PWR', sector: 'reconstruction' },
  { sym: 'CAT', sector: 'reconstruction' },
  { sym: 'VMC', sector: 'reconstruction' },
  { sym: 'MLM', sector: 'reconstruction' },
  { sym: 'ADM', sector: 'agriculture_food' },
  { sym: 'BG', sector: 'agriculture_food' },
  { sym: 'MOS', sector: 'agriculture_food' },
  { sym: 'NTR', sector: 'agriculture_food' },
  { sym: 'CF', sector: 'agriculture_food' },
  { sym: 'CTVA', sector: 'agriculture_food' },
  { sym: 'NVDA', sector: 'semiconductors' },
  { sym: 'TSM', sector: 'semiconductors' },
  { sym: 'AMD', sector: 'semiconductors' },
  { sym: 'INTC', sector: 'semiconductors' },
  { sym: 'ASML', sector: 'semiconductors' },
  { sym: 'MU', sector: 'semiconductors' },
  { sym: 'SMH', sector: 'semiconductors' },
  { sym: 'AAPL', sector: 'big_tech' },
  { sym: 'MSFT', sector: 'big_tech' },
  { sym: 'GOOGL', sector: 'big_tech' },
  { sym: 'AMZN', sector: 'big_tech' },
  { sym: 'META', sector: 'big_tech' },
  { sym: 'TSLA', sector: 'autos' },
  { sym: 'F', sector: 'autos' },
  { sym: 'GM', sector: 'autos' },
  { sym: 'RIVN', sector: 'autos' },
  { sym: 'NIO', sector: 'autos' },
  { sym: 'JPM', sector: 'financials' },
  { sym: 'BAC', sector: 'financials' },
  { sym: 'GS', sector: 'financials' },
  { sym: 'V', sector: 'financials' },
  { sym: 'NEE', sector: 'utilities' },
  { sym: 'DUK', sector: 'utilities' },
  { sym: 'SO', sector: 'utilities' },
  { sym: 'LVMUY', sector: 'luxury_consumer' },
  { sym: 'NKE', sector: 'luxury_consumer' },
  { sym: 'MCD', sector: 'luxury_consumer' },
  { sym: 'SPY', sector: 'broad_market' },
  { sym: 'QQQ', sector: 'broad_market' },
  { sym: 'DIA', sector: 'broad_market' },
  { sym: 'VTI', sector: 'broad_market' },
  { sym: 'KO', sector: 'broad_market' },
  { sym: 'T', sector: 'broad_market' },
];

const SYM_TO_SECTOR = CATALOG.reduce((m, u) => (m[u.sym] = u.sector, m), {});

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

  // score is ~ −1..+1. Map to a display % move.
  // DISPLAY_GAIN = 100 was VALIDATED in the v3.0 calibration: with the fitted betas,
  // predicted moves land in the same magnitude band as the observed market-excess
  // returns across all 18 sectors. Retained unchanged.
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
  window.CATALOG = CATALOG;
  window.UNIVERSE = UNIVERSE;
  window.computeExposure = computeExposure;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RISK_STRUCTURES, UNIVERSE, CATALOG, SYM_TO_SECTOR, CHANNEL_NORMALIZERS, computeExposure };
}
