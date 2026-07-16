/* ════════════════════════════════════════════════════════════════════════════
   risk-structures.js  —  DELAX GEO-RISK  ·  v4.0  ·  TWO STRUCTURES
   ────────────────────────────────────────────────────────────────────────────
   PURPOSE
   The "engine" (simulator, Exposure Score, charts) lives in code and knows HOW to
   model a geopolitical risk but nothing ABOUT any specific one. Each risk structure
   is a DATA OBJECT in this file. Adding Taiwan, Red Sea, etc. later = authoring a
   new object here, with zero engine changes.

   DELAX GEO-RISK models geopolitical risk as a CROSS-ASSET layer — equities, FX,
   credit, shipping, defense, commodities. Oil is ONE transmission channel among
   several, never the identity of the platform. HORMUZ is an instance, not the thesis.

   v4.0 PROVES THAT. The second structure — TAIWAN — declares NO OIL CHANNEL AT ALL.
   Same engine, same Exposure Desk, same score. Its channels are advanced-chip supply,
   the electronics supply chain, container shipping, growth, Asian FX and defense.
   If the platform still works with the oil channel removed entirely, the cross-asset
   claim is structural rather than rhetorical.

   ────────────────────────────────────────────────────────────────────────────
   HONESTY TIERS  (meta.calibration) — the tier is a first-class product feature
   ────────────────────────────────────────────────────────────────────────────
     'empirical'  Betas FITTED to the structure's own event, which actually happened.
                  Only HORMUZ has earned this.
     'spliced'    Betas fitted from proxy events for the same mechanism. (Unused.)
     'unpriced'   Betas are ANALYTICAL — derived from revenue exposure and supply-share
                  reasoning, NOT fitted to any market response, BECAUSE THE MARKET HAS
                  NEVER PRICED THE EVENT. TAIWAN is here, and the reason is evidence,
                  not laziness. See TAIWAN.pricingEvidence.
     'draft'      Unexamined first-pass betas. Nothing ships at this tier.

   A structure NEVER inherits another's tier. The tier must be visible in the UI.

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

  /* ── TAIWAN channels (v4.0). No oil anywhere in this block — by design. ── */
  // Share of the world's ADVANCED (≤7nm) wafer capacity taken offline. Taiwan holds
  // ~90% of it; 100 = the leading edge globally, including regional spillover.
  semiconductors: (pctAdvLost) => clamp(pctAdvLost / 100),
  // Lagging-edge / component shortfall. Span 70 covers Bloomberg's 62% war-case estimate.
  tech_supply:    (pctShort)   => clamp(pctShort / 70),
};

/* ════════════════════════════════════════════════════════════════════════════
   PER-STRUCTURE NORMALIZER OVERRIDES  (v4.0)
   ────────────────────────────────────────────────────────────────────────────
   A single global span cannot serve every structure. HORMUZ's central case is
   −0.7pts of global GDP; a Taiwan invasion is −9.6pts (Bloomberg Economics), with
   a −14% tail. Against the default gdp span of 5, EVERY Taiwan scenario past a
   blockade clamps to stress 1.0 — the model literally cannot tell a blockade from
   an invasion.

   Widening the span GLOBALLY was the obvious fix and it is the wrong one: it would
   force a rescale of HORMUZ's betas, and those are the only betas on this platform
   that were actually MEASURED. Rescaling a measurement to accommodate an estimate is
   backwards. So spans are declared PER STRUCTURE, and HORMUZ is left untouched.

   This is also the more honest model. "Stress 1.0" means "a severe tail FOR THIS
   STRUCTURE". A −5% global GDP hit IS the tail of an oil war. It is the MIDDLE of a
   Taiwan war. Betas were never comparable across structures; now the scales aren't
   pretending to be either.
   ════════════════════════════════════════════════════════════════════════════ */
const STRUCTURE_NORMALIZERS = {
  'taiwan-strait': {
    // Bloomberg Economics: blockade −5.0% world GDP; war −9.6% (2026) / −10.2% (2024);
    // −14% if Taiwanese chips prove wholly unreplaceable. Span 15 keeps headroom above
    // the worst published estimate instead of clamping at it.
    gdp: (lossPts) => clamp(Math.abs(lossPts) / 15),
    // TWD/regional Asian FX. A wider span than HORMUZ's EM basket: Bloomberg has Korea
    // at −23.3% and Japan −13.5% of GDP in the war case — this is not an EM wobble.
    fx:  (depPts)  => clamp(Math.abs(depPts) / 40),
  },
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
      review: {
        lastReviewed:  '2026-07-15',
        nextScheduled: '2027-01-15',
        cadence:       'semi-annual',
        switches: {
          TRUCE_STATUS_CHANGE: false,
          /* ON when: the armed truce materially changes (full normalisation, or
             re-escalation/second closure). ACTION: re-author scenarios around the
             new reality — the Armed Truce base case describes July 2026 and stops
             being true the day the truce breaks either way. Log; flip back.    */
          NEW_WAR_WINDOW_DATA: false,
          /* ON when: a re-escalation produces a new measurable shock window.
             ACTION: refit betas with the new window added (the 2026 fit pipeline
             pattern), regression-gate, bump version, update methodology.html.  */
        },
        log: [
          { date: '2026-07-15', version: '3.1',
            note: 'v3.1 shipped: recalibrated to the real 2026 war (was Ukraine-proxy). ' +
                  'Out-of-sample mean error 2.5pts. Scenarios re-authored post-ceasefire.' },
        ],
      },
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


  /* ══════════════════════════════════════════════════════════════════════════
     STRUCTURE 2 — TAIWAN STRAIT
     Authored 2026-07-11. calibration: 'unpriced'.
     NOTE: declares NO OIL CHANNEL. Same engine, same score. That is the point.
     ══════════════════════════════════════════════════════════════════════════ */
  'taiwan-strait': {
    id: 'taiwan-strait',
    meta: {
      name:    'Taiwan Strait / Semiconductor Chokepoint',
      short:   'Taiwan',
      type:    'chokepoint',
      region:  'East Asia',
      status:  'active',
      coords:  { lat: 24.00, lng: 119.50 },
      flow:    '~90% of the world\'s advanced (≤7nm) chip capacity; a major container artery',
      context: 'Taiwan manufactures the overwhelming majority of the world\'s leading-edge ' +
               'silicon. TSMC alone reported 74% of Q1-2026 wafer revenue from 7nm and below, ' +
               'and guided to 2026 revenue growth above 30%. Nothing substitutes for it inside ' +
               'a five-year horizon. Coercion is already running: PLA median-line crossings, ' +
               'China Coast Guard patrols around Kinmen and Pratas, and on 29-30 Dec 2025 the ' +
               'sharpest episode in decades — 100+ aircraft, 90 crossing the median line, and ' +
               'rockets fired from Fujian landing inside Taiwan\'s 24nm contiguous zone. No ' +
               'blockade or quarantine has occurred. Chip supply has never been geopolitically ' +
               'interrupted. That is precisely the problem below.',

      modelVersion:    '1.0',
      modelDate:       '2026-07-11',
      calibration:     'unpriced',        // ← NOT 'empirical'. Read pricingEvidence.
      calibrationDate:  null,
      calibrationBasis: 'NONE. Betas are ANALYTICAL — derived from revenue exposure and ' +
                        'supply-share reasoning, not fitted to any observed market response. ' +
                        'Five candidate analogues were tested and ALL FAILED to yield a usable ' +
                        'signal. See pricingEvidence.',

      /* ═══ MAINTENANCE CONTRACT (v4.1) ══════════════════════════════════════
         An unpriced structure decays: its finding must be RE-TESTED against every
         new escalation or it becomes a 2026 artifact. This block is the contract.
         The UI renders lastReviewed/nextScheduled next to the tier badge, turns
         AMBER when nextScheduled is past, and shows "REVIEW TRIGGERED" when any
         switch below is ON. Flipping a switch is therefore a real action: the
         site itself starts announcing that maintenance is due.               ═══ */
      review: {
        lastReviewed:  '2026-07-15',
        nextScheduled: '2027-01-15',        // semi-annual floor: Jan 15 / Jul 15
        cadence:       'semi-annual',

        /* ── TRIGGER SWITCHES ─────────────────────────────────────────────────
           Flip false → true THE DAY the trigger fires. The site badge goes amber
           ("REVIEW TRIGGERED") until you complete the ACTION and flip it back.
           Each switch documents its exact action — no memory required.        */
        switches: {

          NEW_ESCALATION: false,
          /* ON when: any major PLA escalation / Taiwan incident (median-line mass
             crossing, live-fire near the island, vessel seizure, quarantine drill).
             ACTION:
               1. node scripts/retest-taiwan.mjs --event "NAME" \
                    --base YYYY-MM-DD:YYYY-MM-DD --shock YYYY-MM-DD:YYYY-MM-DD
                  (script prints the exact Twelve Data curl for the pull first)
               2. Paste the printed verdict row into pricingEvidence.tests below
               3. Append a row to review.log; update lastReviewed
               4. Flip this back to false                                       */

          NEW_INSTITUTIONAL_ESTIMATE: false,
          /* ON when: Bloomberg Economics / Rhodium / CSIS publish a new Taiwan
             blockade or war cost estimate.
             ACTION: update scenario raw{gdp, semiconductors, tech_supply} and the
             desc citations to the new figures; update pricingEvidence.anchor;
             bump meta.modelVersion; log; flip back to false.                   */

          CAPACITY_SHARE_SHIFT: false,
          /* ON when: Taiwan's share of world ≤7nm capacity moves >5pts from the
             ~90% assumed here (watch: TSMC Arizona ramp, Japan fabs, Samsung).
             ACTION: update meta.flow + context %, re-derive the semiconductors-
             channel betas proportionally (foundry, fabless, semi_equipment,
             memory_idm scarcity premium), re-run the anchor check in the header
             of scripts/retest-taiwan.mjs; bump version; log; flip back.        */

          BLOCKADE_OR_QUARANTINE_REAL: false,
          /* ON when: an actual quarantine or blockade begins. THE BIG ONE.
             ACTION (same day): stop treating this as maintenance — the event is
             now observable. Re-author scenarios around the live situation
             (HORMUZ 2026 precedent: forecast pages describing a resolved or
             ongoing event destroy credibility fastest). Begin measuring real
             sector responses; structure graduates toward 'empirical' when a
             post-event window can be fitted. Flip back only after re-author.   */
        },

        /* ── REVIEW LOG — append-only. "Reviewed, no change" is itself data. ── */
        log: [
          { date: '2026-07-15', version: '1.0',
            note: 'Initial authoring. Anchored to Bloomberg Economics (Feb 2026). ' +
                  'Five analogues tested, none priced — unpriced tier assigned. ' +
                  'PRICED threshold locked: foundry market-excess < −5% in the shock window.' },
        ],
      },
    },

    /* ════════════════════════════════════════════════════════════════════════
       PRICING EVIDENCE — why this structure is 'unpriced', with receipts.
       This is not a caveat. It is the structure's central claim.
       ════════════════════════════════════════════════════════════════════════ */
    pricingEvidence: {
      headline: 'The market has never priced a Taiwan supply cut. The most severe military ' +
                'escalation in decades sent TSMC UP 20% against the market.',
      finding:  'Five analogues were tested for a Taiwan risk premium. Four produced no signal ' +
                'or the WRONG signal. The AI cycle dominates semiconductor pricing so completely ' +
                'that geopolitical escalation is not merely muted — it is inverted.',
      tests: [
        { event: 'PLA escalation, 29 Dec 2025 – 20 Feb 2026',
          expected: 'Foundry and Taiwan equity should fall on a severe escalation.',
          observed: 'Foundry +20.6% vs market (+8.5% vs its OWN sector, SMH). Semi equipment ' +
                    '+31.8%. Taiwan equity +5.7%. Every leg went UP.',
          verdict:  'INVERTED. TSMC was guiding +30% revenue growth; the market priced AI demand ' +
                    'and ignored the rockets. Window deliberately closed 20 Feb — eight days ' +
                    'before the Iran war would have contaminated it.' },
        { event: 'Pelosi visit, Aug 2022',
          expected: 'A Taiwan-risk repricing.',
          observed: 'Foundry −8.3%, Taiwan equity −6.5%, China equity −13.5%, container shipping −17.9%.',
          verdict:  'THE ONLY COHERENT FEAR SIGNAL EVER RECORDED — and it is small. One event, ' +
                    'single-digit magnitude, from a diplomatic visit. It cannot be extrapolated ' +
                    'to a blockade without inventing the multiplier.' },
        { event: 'Hualien earthquake, Apr 2024',
          expected: 'Physical damage to TSMC fabs should hit foundry.',
          observed: 'Foundry +1.8% vs market.',
          verdict:  'NON-EVENT. Fabs recovered in days. Physical disruption at this scale does ' +
                    'not transmit to price.' },
        { event: 'Global chip shortage, 2021',
          expected: 'Real chip scarcity should crush chip-consuming sectors.',
          observed: 'Autos +23.2% vs market — the reopening rally swamped the shortage entirely.',
          verdict:  'NO SIGNAL. The only period chips were genuinely scarce, and it is invisible ' +
                    'in prices.' },
        { event: 'US export controls, Oct 2022',
          expected: 'A supply/policy shock to the chip complex.',
          observed: 'Foundry −1.1%. China equity −10.8%.',
          verdict:  'HIT CHINA, NOT TAIWAN. A policy shock, not a conflict shock.' },
      ],
      driverFailure: 'The semiconductor PPI (FRED PCU334413334413) sat at 30.0–30.2 straight ' +
                     'through the 2021 shortage. It is hedonically adjusted and registers scarcity ' +
                     'as nothing. There is no usable price driver for the supply channel.',
      implication:  'These betas are what a blockade WOULD cost, derived from where revenue ' +
                    'actually comes from. They are NOT what the market currently thinks it would ' +
                    'cost — because the market is not thinking about it at all. Treat the gap as ' +
                    'the thesis, not as an error bar.',
      anchor:       'The scenario GDP and chip-loss figures are NOT ours. They are Bloomberg ' +
                    'Economics: blockade −5.0% of world GDP, war −9.6% ($10.6T) in the first year, ' +
                    'lagging-edge output −35% / −62%, Taiwan −12.2% / −40%, China −8.9% / −16.7%. ' +
                    'Sector betas are then set so the model reproduces outcomes consistent with ' +
                    'those figures. So the betas are unfitted — but they are not unmoored.',
      correction:   'Bloomberg overturned one of our own calls. Container shipping was modelled as ' +
                    'a WINNER by analogy to the Red Sea, where rerouting spiked rates. Bloomberg has ' +
                    'COSCO revenue down 63-68% and HMM down 38-43%. The difference: in the Red Sea ' +
                    'the cargo still existed and merely travelled further. In a Taiwan blockade the ' +
                    'cargo itself disappears. The beta was flipped.',
    },

    /* NO OIL. The cross-asset claim, made structural. */
    channels: ['semiconductors', 'tech_supply', 'shipping', 'gdp', 'fx', 'defense'],

    /* SCENARIOS — GDP and chip-loss figures ANCHORED TO BLOOMBERG ECONOMICS
       ("The $10 Trillion Fight", Feb 2026; and the Jan 2024 two-scenario study).
       Probabilities are DELAX judgment. Everything else below is cited. */
    scenarios: [
      {
        id: 'optimistic', label: 'Gray-Zone Pressure', severity: 1, probability: 0.60,
        desc: 'The status quo, and the base case: ADIZ incursions, Coast Guard patrols, periodic ' +
              'live-fire. Coercion without interruption. PLA sorties have actually DECLINED since ' +
              'the start of 2026 from their post-2024 peak. Chips keep shipping. Nothing breaks.',
        raw: { semiconductors: 2, tech_supply: 2, shipping: 8, gdp: -0.1, fx: -2, defense: 180 },
        durationMonths: [12, 60],
      },
      {
        id: 'baseline', label: 'Quarantine / Blockade', severity: 4, probability: 0.28,
        desc: 'A year-long PLA blockade or "customs inspection" regime. Bloomberg Economics models ' +
              'this at −5.0% of WORLD GDP in the first year (Taiwan −12.2%, China −8.9%, US −3.3%). ' +
              'Critically, the world loses access to ALL of Taiwan\'s chips — the smaller hit vs. war ' +
              'comes from the OTHER shocks being scaled down, not from the chips coming through. ' +
              'Lagging-edge sectors (autos, electronics) lose ~35% of output.',
        raw: { semiconductors: 90, tech_supply: 35, shipping: 220, gdp: -5.0, fx: -12, defense: 600 },
        durationMonths: [6, 24],
      },
      {
        id: 'pessimistic', label: 'Invasion / Fab Denial', severity: 5, probability: 0.12,
        desc: 'Kinetic conflict drawing in the US. Bloomberg Economics: −9.6% of world GDP ($10.6T) in ' +
              'the FIRST YEAR — Taiwan −40%, China −16.7%, Korea −23.3%, Japan −13.5%, US −6.7%. ' +
              'Lagging-edge output falls ~62% as Chinese, Japanese and Korean supply is lost too. If ' +
              'Taiwanese chips prove wholly unreplaceable, the global hit rises to −14%.',
        raw: { semiconductors: 100, tech_supply: 62, shipping: 420, gdp: -9.6, fx: -30, defense: 1000 },
        durationMonths: [12, 120],
      },
    ],

    timeline: {
      start: '2026-07', end: '2031-12',
      labels: ['Q3 26','Q4 26','Q1 27','Q2 27','Q3 27','Q4 27','H1 28','H2 28','H1 29','H2 29','2030','2031'],
      /* Advanced (≤7nm) wafer capacity OFFLINE, % of world total. This is the Taiwan
         structure's signature series — the analogue of HORMUZ's oil path, and it is
         deliberately NOT a price. Nothing here is measured; it is all scenario logic. */
      semiCapacityOffline: {
        optimistic:  [ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        baseline:    [ 0, 0,90,90,80,68,55,42,32,24,18,14],   // ALL Taiwan capacity, decaying as substitution builds
        pessimistic: [ 0, 0,100,100,98,95,90,84,76,66,56,46], // + regional spillover; EUV cannot be improvised
      },
      preConflictSemi: 2,   // gray-zone friction floor
    },

    exposure: {
      /* ══════════════════════════════════════════════════════════════════════
         ANALYTICAL BETAS — NOT FITTED. Every line states its REASONING, because
         reasoning is all there is. If you disagree with a number, you are
         disagreeing with an argument, not with a measurement. That is the honest
         position and it is on the face of the product.
         ══════════════════════════════════════════════════════════════════════ */
      sectors: {
        /* Anchored so the LINEAR model lands on Bloomberg-consistent outcomes.
           Shown per line: → blockade% / invasion% (the model's own output).           */

        // ── The epicentre ──
        foundry:            { semiconductors: -0.65, fx: -0.22, gdp: -0.10 },   // → −68% / −88%
        // TSM, UMC. A blockade takes the revenue to zero — the asset IS the chokepoint.
        // Bloomberg: Taiwan GDP −12.2% (blockade) / −40% (war). Equity moves further than GDP.

        fabless:            { semiconductors: -0.60, gdp: -0.15 },              // → −59% / −70%
        // NVDA, AMD, AVGO, QCOM. THE MOST UNDER-APPRECIATED EXPOSURE IN THE MODEL.
        // They own no fabs. A cutoff is not a margin hit — they cannot make the product.
        // Bloomberg puts the combined market cap of TSMC's top 10 customers near $14T.

        semi_equipment:     { semiconductors: -0.45, gdp: -0.20 },              // → −47% / −58%
        // ASML, LRCX, AMAT, KLAC. TSMC is the anchor customer; a blockade freezes the order
        // book. Cushioned somewhat by the US/Japan fab buildout that a crisis would accelerate.

        taiwan_equity:      { semiconductors: -0.48, fx: -0.32, gdp: -0.25 },   // → −61% / −88%
        // EWT. Equity and currency hit at once. Bloomberg: Taiwan GDP −40% in the war case.

        downstream_tech:    { tech_supply: -0.40, gdp: -0.20, semiconductors: -0.12 }, // → −38% / −60%
        // AAPL, MSFT, DELL. Bloomberg's phrase for Taiwan's high-end chips is the
        // irreplaceable "golden screw": laptop, tablet and smartphone lines simply stall.

        china_equity:       { gdp: -0.45, fx: -0.25, semiconductors: -0.12 },   // → −33% / −60%
        // FXI, MCHI. The aggressor is NOT a winner. Bloomberg has China taking a HEAVIER
        // hit than the US in both scenarios: −8.9% (blockade), −16.7% (war).

        // ── Winners, and why ──
        memory_idm:         { semiconductors: +0.50, gdp: -0.30 },              // → +35% / +31%
        // INTC, MU. THE STANDOUT CALL. They own fabs OUTSIDE Taiwan (US, Ireland, Israel,
        // Japan). If Taiwan's leading edge goes dark, non-Taiwanese capacity is the scarcest
        // asset on earth. NOTE the shape: invasion scores WORSE than blockade, because the
        // global demand collapse starts to outrun the scarcity premium. That is the model
        // working, not a bug.

        defense:            { defense: +0.70, gdp: -0.20 },                     // → +35% / +57%
        utilities:          { gdp: +0.45 },                                     // → +15% / +29%
        // The defensive bid. The ONLY Taiwan beta with empirical support: HORMUZ MEASURED
        // utilities at +10.1% excess in the 2026 war.
        gold_safehaven:     { gdp: +0.30, fx: +0.15 },                          // → +15% / +31%
        // Deliberately modest: gold delivered just +0.9% in the actual 2026 Hormuz war.
        // The haven bid is weaker than folklore, and we have the receipt.

        korea_japan:        { semiconductors: +0.25, gdp: -0.65, fx: -0.22 },   // → −6% / −33%
        // EWY, EWJ. Samsung and SK Hynix are the only credible substitute capacity — but
        // Bloomberg has Korea at −23.3% and Japan −13.5% of GDP in the war case. The
        // substitution bid roughly offsets in a blockade and is buried in a war.

        // ── Casualties via the supply chain ──
        autos:              { tech_supply: -0.45, gdp: -0.25 },                 // → −31% / −56%
        // Bloomberg quantifies exactly this: lagging-edge output −35% (blockade) / −62% (war).

        container_shipping: { shipping: +0.25, gdp: -0.60 },                    // → −9% / −17%
        // ⚑ CORRECTED BY THE SOURCE. This was modelled as a WINNER (+0.60 shipping) on the
        // Red Sea analogy — rerouting spikes rates. Bloomberg says otherwise: COSCO revenue
        // −63% to −68%, HMM −38% to −43%. The distinction matters: in the Red Sea the CARGO
        // still existed and merely travelled further. In a Taiwan blockade THE CARGO ITSELF
        // DISAPPEARS. Rates cannot save a carrier with nothing to carry.

        broad_market:       { gdp: -0.25, tech_supply: -0.10, semiconductors: -0.22 }, // → −33% / −47%
        // ⚠ THE SHARPEST CONTRAST WITH HORMUZ, where broad_market was ~zero — a regional war
        // is not an S&P event. HERE IT IS. Semis and the tech complex ARE the index, and
        // Bloomberg is explicit that the biggest hit in every scenario comes from the missing
        // semiconductors. Taiwan is the geopolitical risk that reaches the median portfolio.

        // ── Global catalog sectors: defined so unmapped holdings still score ──
        semiconductors:     { semiconductors: -0.55, gdp: -0.15 },
        big_tech:           { tech_supply: -0.40, gdp: -0.20, semiconductors: -0.12 },
        em_equity:          { gdp: -0.50, fx: -0.30 },
        em_sovereign:       { fx: -0.30, gdp: -0.35 },
        financials:         { gdp: -0.45, fx: -0.20 },
        luxury_consumer:    { gdp: -0.60 },                    // China demand collapse
        aviation:           { gdp: -0.55 },                    // demand destruction, not fuel
        energy_producers:   { gdp: -0.25 },                    // NO oil channel in this structure
        gulf_producers:     { gdp: -0.20 },
        lng:                { gdp: -0.20 },
        shipping_tankers:   { shipping: +0.20, gdp: -0.45 },   // same trade-collapse logic as containers
        reconstruction:     { defense: +0.40, gdp: -0.25 },
        agriculture_food:   { gdp: -0.20 },
      },

      /* Structure-specific taxonomy — remaps tickers into TAIWAN's sector names.
         Without this, TSM would resolve to the global 'semiconductors' tag and score
         against a near-zero HORMUZ beta instead of being the epicentre. */
      sectorMap: {
        TSM:'foundry', UMC:'foundry',
        NVDA:'fabless', AMD:'fabless', AVGO:'fabless', QCOM:'fabless', TXN:'fabless',
        ASML:'semi_equipment', LRCX:'semi_equipment', AMAT:'semi_equipment', KLAC:'semi_equipment',
        INTC:'memory_idm', MU:'memory_idm',
        EWT:'taiwan_equity',
        FXI:'china_equity', MCHI:'china_equity',
        EWY:'korea_japan', EWJ:'korea_japan',
        AAPL:'downstream_tech', MSFT:'downstream_tech', DELL:'downstream_tech',
        TM:'autos', GM:'autos', F:'autos', TSLA:'autos',
        ZIM:'container_shipping',
        SMH:'semiconductors',
      },

      tickers: {
        // NVDA — the purest expression of the fabless argument: no fabs, essentially the
        // entire leading edge fabricated in Taiwan, and the largest single weight in the
        // index most retail portfolios actually hold.  → −66% / −78%
        NVDA: { semiconductors: -0.68, gdp: -0.15 },
        // INTC — the sharpest contrarian call on the platform. Owns fabs, outside Taiwan.
        // The much-derided fab strategy becomes a strategic monopoly.  → +46% / +43%
        INTC: { semiconductors: +0.62, gdp: -0.30 },
      },
    },

    narratives: [
      { tone: 'red', title: 'The Unpriced Risk', points: [
        'The Dec 2025 escalation sent TSMC UP 20% against the market',
        'The AI cycle is drowning out geopolitical signal entirely',
        'No blockade has ever occurred — so no blockade has ever been priced',
        'The gap between exposure and pricing IS the trade' ] },
      { tone: 'amber', title: 'No Second Source', points: [
        'Taiwan holds ~90% of ≤7nm capacity; TSMC took 74% of Q1-26 wafer revenue from it',
        'Fabless designers (NVDA, AMD, AVGO) own no fabs at all',
        'US and Japanese fab buildouts are 3–5 years from mattering',
        'EUV-class capacity cannot be improvised' ] },
      { tone: 'green', title: 'Who Actually Wins', points: [
        'Intel and Micron: fabs OUTSIDE Taiwan become a strategic monopoly',
        'Samsung / SK Hynix: the only credible substitute at the leading edge',
        'Container shipping: rerouting spikes rates (the tanker trade, different cargo)',
        'Defense: Indo-Pacific rearmament at scale' ] },
      { tone: 'amber', title: 'Why This Reaches Your Portfolio', points: [
        'HORMUZ barely moved the S&P — a regional war is not an index event',
        'Taiwan IS an index event: semis and big tech ARE the index',
        'The median retail portfolio is long this risk without knowing it' ] },
    ],

    precedents: [
      { event: 'PLA escalation, Dec 2025',   note: '▸ TESTED. Foundry +20.6% vs market. The signal is INVERTED — see pricingEvidence.' },
      { event: 'Pelosi visit, Aug 2022',     note: '▸ TESTED. Foundry −8.3%, Taiwan −6.5%, China −13.5%. The only coherent fear signal ever recorded, and it is small.' },
      { event: 'Hualien earthquake, Apr 2024', note: '▸ TESTED. Foundry +1.8%. Physical fab damage was a non-event.' },
      { event: 'Global chip shortage, 2021', note: '▸ TESTED. The only real chip scarcity on record — invisible in prices.' },
      { event: '2026 Hormuz War',            note: 'The counter-example: an event that DID happen, and could therefore be calibrated. Taiwan cannot.' },
    ],

    liveBindings: { primary: 'smh', secondary: ['tsm', 'ewt'] },
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
  v4.0 shipped TAIWAN. A THIRD structure (Red Sea/Suez — which, unlike Taiwan, has a real
  calibratable event) needs only: a new object here, its channels, its normalizers, its
  sectorMap, and betas for the global catalog sectors. ZERO engine changes.

  NOTE: a new structure ships with calibration:'draft' until fitted against its OWN
  analogues. Do not let it inherit HORMUZ's 'empirical' badge — the honesty tiering IS
  the product. And learn HORMUZ's lesson: check whether the event has already happened
  before reaching for a proxy. v3.0 fitted Ukraine as an analogue for a war that was
  already in the price history, and overstated every sector by 2-3x as a result.
  */
};

/* Compute each scenario's normalized `stress` vector from its `raw` values.
   v4.0: loops EVERY structure — adding a third requires no change here. */
for (const structure of Object.values(RISK_STRUCTURES)) {
  const overrides = STRUCTURE_NORMALIZERS[structure.id] || {};
  for (const s of structure.scenarios) {
    s.stress = {};
    for (const ch of structure.channels) {
      const norm = overrides[ch] || CHANNEL_NORMALIZERS[ch];   // structure span wins
      s.stress[ch] = norm ? +norm(s.raw[ch]).toFixed(3) : 0;
    }
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

  /* ══ TAIWAN structure bellwethers (v4.0) ══
     `sector` here is the GLOBAL catalog tag. The TAIWAN structure remaps these into its
     own taxonomy via exposure.sectorMap (TSM → foundry, NVDA → fabless, INTC → memory_idm…).
     Snapshot cost: UNIVERSE goes 34 → 55 quotes/day. Twelve Data free tier is 800/day. */
  { sym: 'TSM',   sector: 'semiconductors' },
  { sym: 'UMC',   sector: 'semiconductors' },
  { sym: 'SMH',   sector: 'semiconductors',    kind: 'etf' },
  { sym: 'NVDA',  sector: 'semiconductors' },
  { sym: 'AMD',   sector: 'semiconductors' },
  { sym: 'AVGO',  sector: 'semiconductors' },
  { sym: 'QCOM',  sector: 'semiconductors' },
  { sym: 'TXN',   sector: 'semiconductors' },
  { sym: 'ASML',  sector: 'semiconductors' },
  { sym: 'LRCX',  sector: 'semiconductors' },
  { sym: 'AMAT',  sector: 'semiconductors' },
  { sym: 'KLAC',  sector: 'semiconductors' },
  { sym: 'INTC',  sector: 'semiconductors' },
  { sym: 'MU',    sector: 'semiconductors' },
  { sym: 'EWT',   sector: 'em_equity',         kind: 'etf' },   // Taiwan
  { sym: 'FXI',   sector: 'em_equity',         kind: 'etf' },   // China large-cap
  { sym: 'MCHI',  sector: 'em_equity',         kind: 'etf' },   // China broad
  { sym: 'EWY',   sector: 'em_equity',         kind: 'etf' },   // Korea
  { sym: 'EWJ',   sector: 'em_equity',         kind: 'etf' },   // Japan
  { sym: 'DELL',  sector: 'big_tech' },
  { sym: 'TM',    sector: 'autos' },
  { sym: 'ZIM',   sector: 'shipping_tankers' },                 // container, remapped by TAIWAN
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
  // ══ added v4.0 for the TAIWAN structure ══
  { sym: 'UMC', sector: 'semiconductors' },
  { sym: 'AVGO', sector: 'semiconductors' },
  { sym: 'QCOM', sector: 'semiconductors' },
  { sym: 'TXN', sector: 'semiconductors' },
  { sym: 'LRCX', sector: 'semiconductors' },
  { sym: 'AMAT', sector: 'semiconductors' },
  { sym: 'KLAC', sector: 'semiconductors' },
  { sym: 'EWT', sector: 'em_equity' },
  { sym: 'MCHI', sector: 'em_equity' },
  { sym: 'EWY', sector: 'em_equity' },
  { sym: 'EWJ', sector: 'em_equity' },
  { sym: 'DELL', sector: 'big_tech' },
  { sym: 'TM', sector: 'autos' },
  { sym: 'ZIM', sector: 'shipping_tankers' },
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
    /* v4.0 — PER-STRUCTURE TAXONOMY.
       A ticker's sector is structure-dependent: TSM is 'semiconductors' under HORMUZ
       (a growth-cyclical, near-zero beta) but 'foundry' under TAIWAN (the epicentre).
       Resolution order:
         1. structure.exposure.sectorMap  — the structure's own taxonomy, wins
         2. h.sector                      — explicit tag from the UI / custom row
         3. SYM_TO_SECTOR                 — the global catalog default
         4. 'broad_market'                — last resort
       Every structure MUST also define betas for the global catalog sector names, so an
       unmapped holding still scores instead of silently contributing zero. */
    const sectorMap = structure.exposure.sectorMap || {};
    const sector = sectorMap[h.sym] || h.sector || SYM_TO_SECTOR[h.sym] || 'broad_market';
    const betas = tickerOverrides[h.sym] || betasBySector[sector] || {};

    let rawImpact = 0;
    const rawByChannel = {};
    for (const ch of structure.channels) {
      const beta = betas[ch];
      if (!beta) continue;
      const contrib = beta * (scenario.stress[ch] || 0);   // sensitivity × stress
      rawImpact += contrib;
      rawByChannel[ch] = contrib;
    }

    /* ── v4.0: LOSS FLOOR, NOT COMPRESSION ─────────────────────────────────
       An earlier build ran the raw impact through tanh to tame the tail. That was
       wrong: it silently moved every number away from the value it had been ANCHORED
       to, and it perturbed HORMUZ's measured betas (+4.4% → +4.3%) for no reason.

       Instead: TAIWAN's betas are anchored so the LINEAR model already lands on
       Bloomberg-consistent values, and the only guard is the one fact that is not a
       modelling choice — an equity holding cannot lose more than 100%. The floor sits
       at −95% and almost never binds. HORMUZ never approaches it, so HORMUZ is exactly,
       bit-for-bit unchanged.

       What this does NOT do is make the tail precise. A Taiwan blockade is a
       never-observed event and no model earns three significant figures out there.
       Read the tier before the number.                                              */
    const holdingImpact = clamp(rawImpact, -0.95, 2.0);
    const shrink = rawImpact !== 0 ? holdingImpact / rawImpact : 1;
    for (const ch in rawByChannel) {
      byChannel[ch] = (byChannel[ch] || 0) + w * rawByChannel[ch] * shrink;
    }

    score += w * holdingImpact;
    byHolding.push({
      sym: h.sym, sector, weight: +w.toFixed(3),
      impact: +holdingImpact.toFixed(3),
      impactRaw: +rawImpact.toFixed(3),   // pre-floor, for transparency
    });
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
  module.exports = { RISK_STRUCTURES, UNIVERSE, CATALOG, SYM_TO_SECTOR, CHANNEL_NORMALIZERS, STRUCTURE_NORMALIZERS, computeExposure };
}
