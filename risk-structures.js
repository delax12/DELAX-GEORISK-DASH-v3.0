/* ════════════════════════════════════════════════════════════════════════════
   risk-structures.js  —  DELAX GEO-RISK  ·  v3.1 structure model
   ────────────────────────────────────────────────────────────────────────────
   PURPOSE
   The "engine" (simulator, Exposure Score, charts) lives in code and knows HOW to
   model a geopolitical risk but nothing ABOUT any specific one. Each risk structure
   is a DATA OBJECT in this file. Adding Taiwan, Red Sea, etc. later = authoring a
   new object here, with zero engine changes.

   DELAX GEO-RISK models geopolitical risk as a CROSS-ASSET layer — equities, FX,
   credit, shipping, defense, commodities. Oil is ONE transmission channel among
   several, never the identity of the platform. HORMUZ is an instance, not the thesis.

   ────────────────────────────────────────────────────────────────────────────
   v3.1  —  RECALIBRATED AGAINST THE 2026 STRAIT OF HORMUZ WAR  (2026-07-11)
   ────────────────────────────────────────────────────────────────────────────
   WHAT CHANGED, AND WHY IT MATTERS

   v3.0 fitted these betas to the 2022 Ukraine invasion as an ANALOGUE for a Hormuz
   event. That was a mistake: the Hormuz event actually happened. The US and Israel
   opened an air war against Iran on 28 Feb 2026; Iran closed the strait, mined it,
   and struck merchant shipping. Brent ran $70.9 → $138.2 (peak 7 Apr, FRED spot),
   a ceasefire landed 8 Apr, and Brent is back near $69 with traffic still far below
   pre-war and sporadic attacks continuing.

   The war is IN the price history. So v3.1 is fitted to the structure's OWN event.

   PRIMARY   2026 Hormuz war  · baseline Dec-25→27-Feb-26  vs shock 2-Mar→1-May-26
   SECONDARY 2022 Ukraine     · baseline Q4-2021           vs shock 24-Feb→30-Jun-22
   WEIGHTING 70 / 30 in favour of Hormuz. Method unchanged: every sector return is
             measured NET OF SPY over the same window, stripping the concurrent
             rate cycle (2022) and AI cycle (2026) out of the "war beta".

   THE HEADLINE FINDING: v3.0 OVERSTATED CONFLICT SENSITIVITY BY ROUGHLY 2-3x.
   Tested out-of-sample against the real war, v3.0 missed by a mean of 19.0 points.
   v3.1 misses by 2.5. The two events carried near-identical oil stress (Brent peaked
   $133 in 2022 vs $138 in 2026) — yet sectors moved LESS THAN HALF as much in 2026:

     energy_producers   Ukraine +46.1%   Hormuz +19.4%   (excess of market)
     shipping_tankers   Ukraine +50.7%   Hormuz +25.1%
     defense            Ukraine +26.5%   Hormuz  +6.1%

   Ukraine was not merely a different event — it was a structurally more generous one.
   2022 caught energy equities after a decade of underinvestment and delivered a
   one-time RE-RATING on top of the oil pass-through. That re-rating has now happened.
   Fitting to it inflates every future call. v3.1 deliberately does NOT chase those
   magnitudes, and the Ukraine residuals below are expected, not errors.

   FOUR SIGN ERRORS the real war exposed (v3.0 had these backwards):
     em_equity     predicted −17.8%, delivered +7.2% — and +7.8% in Ukraine too. The
                   "EM importer pain" thesis is refuted by BOTH events. The EM index is
                   commodity-EXPORTER heavy. Now scores positive on oil.
     utilities     predicted −6.0%, delivered +10.1%. Utilities catch a DEFENSIVE BID
                   in a war shock. Now a positive-gdp (safe-haven-like) sector.
     broad_market  predicted −16.3%, delivered +0.5%. The index barely moves. Betas cut
                   to near zero — a regional war is not an S&P event.
     semiconductors predicted −16.4%, delivered +11.4% (and −8.2% in Ukraine). The two
                   events disagree in SIGN: semis are driven by the AI cycle, not by
                   geopolitics. Beta set near zero and flagged LOW CONFIDENCE.

   MEASURED CHANNEL STRESS — 2026 Hormuz war (via CHANNEL_NORMALIZERS):
     oil  0.525  (Brent $138.2 peak — FRED DCOILBRENTEU)
     food 0.511  (global food index +25.6% — Hormuz carries ~30% of traded fertiliser)
     cpi  0.248  (US y/y 2.43% → 4.17%, i.e. +1.73pts of excess inflation)
     fx   0.059  (EM basket moved only +1.5% — see LIMITS)

   OIL BENCHMARK — THE FIX THAT MADE EVERYTHING ELSE POSSIBLE
   Hormuz is a SEABORNE-crude shock, so the oil channel must be BRENT, not WTI.
   In 2022 this didn't matter (WTI $124 / Brent $133 — spread ≈ $9). In the 2026 war
   the spread blew out to ~$23 (WTI $115 / Brent $138) because US domestic crude was
   insulated and seaborne Brent was not. Calibrating on WTI would have inflated every
   oil beta by ~1.6x. The normalizer is now explicitly Brent, anchored at $70 —
   empirically the pre-war level (Dec-25→Feb-26 Brent averaged $66.6; it sits at $69
   today), replacing the v3.0 anchor of $78 which matched no observed period.

   LIMITS (published verbatim in the methodology drawer — honesty is the product):
     • SHIPPING, GDP and DEFENSE stress are JUDGMENT-TIER. No free high-frequency
       series exists for tanker rates, real-time global GDP, or defense appropriations.
       Shipping is the channel Hormuz hit HARDEST (tanker traffic fell to near nil;
       war-risk premia spiked) and it is the channel we can measure least well. Stated,
       not hidden.
     • The FX channel remains the weakest-evidenced. The EM basket moved 1.5% in 2026
       and 0.7% in 2022 — in both cases exporters offset importers. EM betas are small
       and are the first thing to revisit when a better analogue arrives.
     • CPI betas are judgment-assisted: monthly CPI gives ~4 points per shock window.
     • ONE WAR IS ONE SAMPLE. The 2026 war ran six weeks to ceasefire. A longer closure
       could transmit through earnings in ways a six-week shock never did. These betas
       describe what HAS happened, not the tail that hasn't.
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   1. CHANNEL NORMALIZERS
   Each structure reports shocks in a channel's natural unit (oil $/bbl, CPI points,
   shipping %). To make beta × shock comparable ACROSS channels, every raw value is
   mapped to a 0..1 "stress" scale via a per-channel reference span. Stress = 0 means
   pre-conflict normal; stress = 1 means a severe historical-tail level.
   v3.1: the OIL span is now explicitly BRENT-denominated and re-anchored to $70 —
   the measured pre-war level (Dec-25→Feb-26 Brent averaged $66.6; $69 today). The old
   $78/WTI-shaped anchor matched no observed period. Hormuz is a seaborne shock: Brent
   is the correct benchmark, and liveBindings already declared `primary: 'brent'`.
   ════════════════════════════════════════════════════════════════════════════ */
const CHANNEL_NORMALIZERS = {
  // channel : (rawValue) => 0..1 stress
  oil:      (peakBrent)=> clamp((peakBrent - 70) / (200 - 70)),   // BRENT. $70 = measured pre-war normal → $200 tail
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
      flow:    '~20% of global oil, ~18% of LNG and up to ~30% of traded fertiliser',
      context: 'The chokepoint stopped being hypothetical on 28 Feb 2026, when a US-Israeli ' +
               'air war against Iran triggered the closure of the strait. Iran mined the waterway, ' +
               'struck merchant shipping, and traffic collapsed to near nil; the IEA called it the ' +
               'largest supply disruption in the history of the oil market. Brent ran $70.9 → $138.2 ' +
               '(peak 7 Apr). A ceasefire held from 8 Apr and an MOU followed, but the strait has ' +
               'NOT normalised: transits remain far below pre-war, mines and war-risk premia persist, ' +
               'sporadic vessel attacks continue, and Iran now asserts standing authority over ' +
               'passage. Brent has round-tripped to ~$69. The live question is no longer WHETHER ' +
               'a Hormuz shock happens — it is whether this armed truce holds, normalises, or breaks.',
      modelVersion:    '3.1',
      modelDate:       '2026-07-11',
      calibration:     'empirical',      // 'draft' | 'empirical'
      calibrationDate: '2026-07-11',
      calibrationBasis: 'THE 2026 STRAIT OF HORMUZ WAR ITSELF (primary, 70%) + Ukraine 2022 ' +
                        '(secondary, 30%). 41 tickers, weekly, 2020-01→2026-07; returns net of ' +
                        'SPY; oil channel Brent-denominated (FRED DCOILBRENTEU).',
    },

    /* Which economic channels THIS structure actually moves. Variable per structure —
       Taiwan would declare ['semiconductors','tech','gdp','fx'] instead. The engine
       only ever touches the channels a structure declares. */
    channels: ['oil', 'shipping', 'cpi', 'gdp', 'fx', 'defense', 'food'],

    /* SCENARIOS — values are pulled straight from KPI_MAP in index.html.
       `raw`    = human-readable model output (for display, matches your KPI cards)
       `stress` = `raw` run through CHANNEL_NORMALIZERS (computed below, for the math) */
    /* SCENARIOS — RE-AUTHORED 2026-07-11, forward from the armed truce.
       The pre-war scenario set ("will there be a war? oil peaks $148") described a
       future that has already resolved. It has been replaced. `raw.oil` is a peak
       BRENT print. `stress` is computed from `raw` via CHANNEL_NORMALIZERS below. */
    scenarios: [
      {
        id: 'optimistic', label: 'Normalisation', severity: 1, probability: 0.25,
        desc: 'The MOU holds. Mines are cleared, war-risk premia decay, transits return to pre-war ' +
              'volumes. Brent settles $70–78, supported only by inventory rebuild. Reconstruction and ' +
              'Gulf capex resume.',
        raw: { oil: 78, shipping: 25, cpi: 0.3, gdp: -0.3, fx: -2, defense: 320, food: 5 },
        durationMonths: [6, 12],
      },
      {
        id: 'baseline', label: 'Armed Truce', severity: 3, probability: 0.50,
        desc: 'The status quo persists: no formal war, but Iran retains leverage over the strait. ' +
              'Sporadic vessel attacks, elevated war-risk insurance, transits stuck below pre-war. ' +
              'Brent grinds $75–95 with headline spikes toward ~$102. A persistent stagflationary tax, ' +
              'not a crisis. THIS IS THE MODEL DEFAULT — it describes the present.',
        raw: { oil: 102, shipping: 120, cpi: 1.2, gdp: -0.7, fx: -5, defense: 480, food: 12 },
        durationMonths: [12, 30],
      },
      {
        id: 'pessimistic', label: 'Re-escalation / Second Closure', severity: 5, probability: 0.25,
        desc: 'The truce collapses and the strait closes again — from a worse starting point than ' +
              'February: inventories drawn down, mines already laid, Gulf energy infrastructure ' +
              'damaged, insurers withdrawn. Brent $150–180. Global recession risk returns.',
        raw: { oil: 165, shipping: 400, cpi: 4.2, gdp: -2.2, fx: -12, defense: 780, food: 30 },
        durationMonths: [12, 36],
      },
    ],

    /* TIMELINE — the OIL_DATA arrays from index.html, kept as the structure's signature
       trajectory. granularity matches OIL_LABELS (M1–M12, then quarterly, then yearly). */
    timeline: {
      start: '2026-02', end: '2029-12',

      /* ACTUAL — measured monthly-average Brent (FRED DCOILBRENTEU). Not a model output.
         This is the war that happened, and it is the spine of the calibration. */
      actual: {
        labels: ['Feb 26','Mar 26','Apr 26','May 26','Jun 26','Jul 26'],
        brent:  [70.9, 103.1, 117.3, 107.1, 85.4, 69.0],
        peak:   138.2,          // 7 Apr 2026, the day before the ceasefire
        note:   'Closure 28 Feb → ceasefire 8 Apr. Round-tripped, but not normalised.',
      },

      /* FORWARD — from Aug 2026. Peaks reconcile to each scenario's raw.oil. */
      labels: ['Aug 26','Sep 26','Oct 26','Nov 26','Dec 26','Q1 27','Q2 27','Q3 27','Q4 27','H1 28','H2 28','2029'],
      oil: {
        optimistic:  [ 69, 70, 71, 72, 73, 74, 75, 76, 77, 77, 78, 78],
        baseline:    [ 72, 78, 85, 92,102, 95, 88, 84, 82, 80, 79, 78],
        pessimistic: [ 80,105,138,165,158,146,135,124,116,108,102, 98],
      },
      preConflictOil: 70,   // BRENT. Measured: Dec-25→Feb-26 avg $66.6; $69 today.
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
      /* sectors[sector][channel] = beta: sensitivity of that sector's return to one unit
         of stress in that channel. + = sector RISES as the channel stresses; − = falls.

         v3.1 — FITTED TO THE 2026 HORMUZ WAR (70%) + UKRAINE 2022 (30%).
         Each line carries its evidence: (H) = 2026 Hormuz observed market-excess return,
         (U) = Ukraine 2022 observed. Tags:
           ✓ fits both events   ↓ v3.0 overstated, cut   ⚑ v3.0 had the SIGN wrong
           ⚠ the two events disagree — low confidence, stated openly                     */
      sectors: {
        // ── Beneficiaries ──
        energy_producers: { oil: +0.35, shipping: +0.06, gdp: -0.04 },  // ↓ H +19.4% · U +46.1%. v3.0 said +56.8%. The 2022 re-rating is spent.
        lng:              { oil: +0.30, shipping: +0.18 },              // ↓ H +26.4% · U +38.1%. Best-fitting winner in the model.
        shipping_tankers: { shipping: +0.35, oil: +0.10 },              // ↓ H +25.1% · U +50.7%. Rates spike; equities follow, ~half as hard as 2022.
        agriculture_food: { food: +0.55, cpi: +0.15, gdp: -0.05 },      // ↓ U +55.1%. Hormuz carries ~30% of traded fertiliser — food is a REAL Hormuz channel.
        reconstruction:   { defense: +0.55, gdp: -0.10 },               // ✓ H +6.3% · U +13.6%
        defense:          { defense: +0.45, gdp: -0.03 },               // ↓ H +6.1% · U +26.5%. Defense re-rated in 2022; it did not re-rate twice.
        gulf_producers:   { oil: +0.15, gdp: -0.15 },                   // ⚑ RESPEC. H only +3.3% vs U +19.4%. In a HORMUZ event the Gulf is INSIDE
                                                                        //   the blast radius — its own export infrastructure was struck and it could not
                                                                        //   ship. It is an oil winner in someone else's war, not in this one.
        gold_safehaven:   { cpi: +0.10, gdp: +0.12, fx: +0.08 },        // ↓ H +0.9% (!) · U +14.4%. Gold did NOT bid in 2026. Cut hard.
        utilities:        { gdp: +0.35, cpi: -0.10 },                   // ⚑ SIGN FIXED. v3.0 said −6.0%; H delivered +10.1%. Utilities catch the
                                                                        //   DEFENSIVE bid in a war shock. They are a haven, not a victim.
        em_equity:        { oil: +0.20, gdp: -0.15, fx: -0.10 },        // ⚑ SIGN FIXED. v3.0 said −17.8%; H +7.2% AND U +7.8%. The "EM importer pain"
                                                                        //   thesis is refuted by BOTH events — the EM index is commodity-EXPORTER heavy.

        // ── Casualties ──
        luxury_consumer:  { gdp: -0.55, cpi: -0.25 },                   // ↑ H −19.7% · U −8.8%. The one sector v3.0 UNDER-predicted. Demand destruction is real.
        autos:            { oil: -0.15, gdp: -0.15, cpi: -0.05 },       // ↓ H −11.3% · U −13.1%. v3.0 said −38.9%.
        aviation:         { oil: -0.20, gdp: -0.10 },                   // ↓ H −9.9% · U +2.4%. Hormuz CONFIRMS airlines lose (jet fuel spiked ~95%;
                                                                        //   Spirit ceased ops 2 May 2026) — Ukraine's +2.4% was the COVID-reopening
                                                                        //   confound. But the magnitude is modest: v3.0's −35.9% was 3.6x too harsh.
        big_tech:         { gdp: -0.20, cpi: -0.06 },                   // ✓ H −5.7% · U +0.5%
        em_sovereign:     { fx: -0.30, gdp: -0.15 },                    // ↓ H −0.4% · U −6.1%
        financials:       { gdp: -0.15, fx: -0.06, cpi: -0.03 },        // ↓ H −3.9% · U −12.6%

        // ── Near-zero: the honest answer is "this sector doesn't trade on it" ──
        broad_market:     { gdp: -0.08, cpi: -0.03 },                   // ⚑ H +0.5% · U −4.1%. A regional war is NOT an S&P event. v3.0 said −16.3%.
        semiconductors:   { gdp: -0.10 },                               // ⚠ LOW CONFIDENCE. H +11.4% but U −8.2% — the two events disagree in SIGN.
                                                                        //   Semis trade on the AI cycle, not on geopolitics. Beta set near zero rather
                                                                        //   than pretending we can read a signal that isn't there.
      },

      /* Per-ticker overrides for names whose behaviour diverges from their sector.
         DBC and GSG sit in `gold_safehaven` but are BROAD COMMODITY trackers, not havens.
         In the 2026 war they returned +24.5% and +32.8% over market, while gold managed
         +0.9%. They track the oil complex, not the fear bid. Refitted to Hormuz. */
      tickers: {
        DBC: { oil: +0.40, cpi: +0.10 },   // Invesco DB Commodity — fits H +24.5% (pred +23.5%)
        GSG: { oil: +0.55, cpi: +0.10 },   // iShares GSCI (heaviest energy weight) — fits H +32.8% (pred +31.4%)
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
      { event: '2026 Hormuz War',     note: '▸▸ PRIMARY CALIBRATION EVENT — the structure\'s own war. Closure 28 Feb → ceasefire 8 Apr. Brent $70.9→$138.2. Energy +19.4%, tankers +25.1%, LNG +26.4%, aviation −9.9%, luxury −19.7% (all excess of market).' },
      { event: '2022 Russia–Ukraine', note: '▸ SECONDARY (30% weight). Brent peaked $133 — near-identical oil stress, yet sectors moved ~2x harder. That gap is a one-time energy re-rating, now spent.' },
      { event: '2023–24 Red Sea',     note: 'Falsification test for the shipping channel: a shipping-only shock with almost no oil stress. Oil-sensitive sectors correctly did not move.' },
      { event: '1973 Oil Embargo',    note: 'CPI +9%, OECD GDP −2.9% (18-month lag). The tail this model does not claim to have observed.' },
      { event: '1987–88 Tanker War',  note: 'The pre-2026 Hormuz analogue — partial disruption, no closure.' },
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
  NOTE: a new structure ships with calibration:'draft' until fitted against its OWN
  analogues. Do not let it inherit HORMUZ's 'empirical' badge — the honesty tiering IS
  the product. And learn HORMUZ's lesson: check whether the event has already happened
  before reaching for a proxy. v3.0 fitted Ukraine as an analogue for a war that was
  already in the price history, and overstated every sector by 2-3x as a result.
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
  // DISPLAY_GAIN = 100. The v3.1 betas are fitted DIRECTLY in units of observed
  // market-excess percentage return at measured stress, so score × 100 IS the modelled
  // move. Mean absolute error vs the 2026 Hormuz war: 2.5 pts (v3.0 scored 19.0).
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
