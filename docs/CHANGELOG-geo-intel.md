# GEO INTEL REMEDIATION — CHANGELOG

**Files changed:** `georisk-intelligence.html`, `index.html`, `api/whatif.js`
**Gates:** G0–G5 pass on the frame. G4 runtime: 324 renderer invocations across
2 structures × 3 scenarios × 3 horizons, zero throws, zero wiring errors.

Upload all three. `whatif.js` goes to `api/whatif.js`. No new dependencies, no
`package.json` change, no new serverless function — the 12-function ceiling holds.

---

## Two findings that changed the plan

**1.5 resolved the opposite way to the brief's hypothesis.** The brief said: if the
parent posts a scenario-keyed series, strip the local scenario shift. **It does not.**
The parent builds `regionalStress` from `STRUCT_DATA[structure].HEATMAP_RAW` — one
region × horizon matrix per structure with no scenario dimension. The identical array
is posted under baseline, pessimistic and optimistic. Confirmed at the payload builder
and again at the parent's own heatmap renderer. `applyScenarioShift` is therefore the
only place scenario enters country stress; stripping it would have made the scenario
buttons a no-op on the globe. **Kept, and documented in the same comment block as the
decay fix,** including the trigger to watch for if the parent ever moves to a
scenario-keyed series.

**1.6 was worse than "verify the handshake."** The handshake is fine. But
`setScenario` in the parent **never called `postStructureState()`** — it called
`syncGeoIntelScenario()`, which only rewrites a text label on the iframe chrome. So
changing scenario updated every chart on the dashboard, left the globe on the previous
scenario, and put a label above it claiming otherwise. Even a fully repaired
`redrawAll` would never have fired.

---

## Batch 1 — the bridge

- **1.1** `redrawAll` rewritten. All twelve dispatched names were phantoms; replaced
  with the real renderers per the brief's mapping. `updateChokepoints` had no
  equivalent, so rather than leave a phantom it was **written** — it now rebuilds the
  chokepoint grid per structure.
- **1.2** Guard split. Missing renderer → `console.error('[geo][WIRING] …')`. Renderer
  threw → `console.warn('[geo][RENDER] …')`. The old guard could not tell those apart,
  which is how a twelve-way no-op looked like a working bridge.
- **1.3** Alert scroll was keyed `base/esc/de` against a `scenario` that had moved to
  `baseline/pessimistic/optimistic`, writing literal `undefined` into the banner. Now
  keyed to the platform vocabulary **and** to the structure. Same bug found and fixed
  in the shock-engine scenario label, which was falling to its final ternary and
  labelling *every* scenario "DE-ESCALATION" — including the pessimistic one. Scenario
  buttons in markup now carry the platform vocabulary too.
- **1.4** `#structureBadge` added to the header (mobile-sized), so the frame always
  names the active structure and tier.
- **1.6** Parent now posts on scenario change. Two further parent bugs fixed:
  - `timeHorizon: 0` was posted on every send, snapping the user's timelapse slider
    back to NOW mid-session. Now `null`; the frame keeps its own horizon.
  - **Units bug:** the frame's slider is in *months* (0–36) and was indexed straight
    into a 10-element *per-year* array — at +12M the globe was reading year 10, and
    past that it clamped to the tail. Parent now declares `horizonUnit`;
    `horizonIndex()` converts.
- **1.7** See "The AI briefing" below.

## Batch 2 — honesty

- **2.4 (done first, as instructed).** Uncovered countries were scored `0` and painted
  with calm cyan — the calmest place on the map, with an AI briefing reasoning from
  `Stress 0.0/10 | Oil dep 0% | CPI 0.0%`. `null` is now a third state throughout:
  `stressColor(null)` → inert slate, `stressElevation(null)` → flat,
  `riskLabel(null)` → "Not Covered", `investabilityScore` → `null` (bar hidden, not
  drawn empty), and **the AI briefing does not fire at all**. Verified with Mauritania
  in G4.
- **2.1** Both country charts were generated from a random number generator on every
  panel open. **Not disclaimed — replaced.** They now walk the active structure's own
  regional series through the same projection the globe uses. Where the structure
  supplies no series the chart is removed and the panel says why. What is drawn is a
  forward *projection* and is labelled as one; the platform has no country-level
  history and no longer implies otherwise.
- **2.2** `jitterMarkets` → `refreshMarkets`. No random walk. Every row starts `stale`
  and only clears that flag when a fetch confirms it, so an `/api/eia-oil` timeout
  degrades to an em dash instead of to the 2026 seed drifting under a green LIVE dot.
  Seeded prices removed from the static markup too.
- **2.3** Historical analogue: anchor corrected $78 → **$70** (posted by the parent),
  gated on a confirmed price, and **structure-gated**. Under TAIWAN it returns `null`
  rather than matching a chip blockade to the 1973 oil embargo on spike percentage —
  numeric proximity is not analogy, and asserting one would contradict the `unpriced`
  tier on the same screen.

## Batch 3 — the de-fork

- **3.1 does not need `risk-structures.js`.** The parent already holds per-structure,
  per-scenario `INFLATION_BY_REGION` and `GDP_DATA`. Payload extended with
  `regionalCpi` / `regionalGdp` plus a region-name normaliser (the three data blocks
  disagree on `Mid. East` vs `Middle East`, `E. Asia` vs `East Asia`).
  **Units changed deliberately:** the old fields were absolute levels (Iran "38.0%"
  CPI) that were never measurements — they were one structure's fitted outputs wearing
  the costume of national statistics. Tiles now read **EXCESS CPI** (pp above trend)
  and **GDP EFFECT** (pp). `trade` had no structure-level source, so per the house rule
  the tile is **retired**, not carried forward. `fxVol` became a relabelled relative
  index (0–100), no longer claiming a 30-day implied-vol quote.
- **3.2** Both prompts de-hardcoded. `fetchAIBriefing` sends structured fields;
  `runNLQuery` now passes structure name, tier and scenario label. **Second bug found
  there:** it asked for strict JSON while `/api/whatif` wrapped everything in a
  four-section prose template — it could never receive JSON, so the parse threw on
  *every* call and the substring-matching fallback was silently doing all the work.
  Fixed with `mode:'json'`.
- **3.3** Structure-keyed registries: shock chain (`IRAN CONFLICT → OIL SPIKE` →
  `TAIWAN BLOCKADE → CHIP SUPPLY CUT`), timeline phases (**no SPR under Taiwan** —
  there is no strategic reserve of leading-edge logic, which is the point of the
  structure), chokepoint grid, sidebar market rows, alert sets, opportunity scanner,
  and the ticker itself. The opportunity scanner had been recommending countries for
  Cape-of-Good-Hope rerouting in a conflict with no Cape leg; **container shipping is
  correctly absent from the Taiwan beneficiary rules** — cargo disappears, it does not
  reroute.
- **3.4** House vocabulary ▲ Beneficiary / ● Watch / ▼ Exposed in the country panel,
  opportunity cards and stock popup. Legacy BUY/HOLD/SELL still map through so cached
  responses render.

## Batch 4 — data

- **4.1** Six `oilDep` sign errors corrected (unambiguous net crude exporters coded as
  import-dependent, which flipped them from beneficiary to victim in the scanner):
  `Iraq +82→−85`, `Nigeria +85→−55`, `Iran +45→−55`, `Colombia +22→−35`,
  `Brazil +18→−35`, `Bahrain +78→−40`.
  **Left alone per your instruction:** US +20, Argentina +28, Mexico +42,
  Malaysia +55, Australia +12 — all marginal net positions where the sign is
  defensible. The US is the live one: it has been a net petroleum exporter since 2020,
  so +20 is arguably wrong, but flipping it changes its insight card and opportunity
  ranking **under Hormuz**, which is calibrated. Flagged, not touched.
- **4.2** `pmi` deleted from all 64 rows (zero readers in the file), so the `pmI` typo
  on the Iran row is moot.
- **4.3** Provider names stripped from source comments — six in the frame, **plus two
  more found in `index.html`** (same class, same public-repo exposure, zero
  behavioural risk).

---

## Deliberately left alone

- **Hormuz calibration.** G4 asserts ordering is intact: Iran 9.41 > Japan 3.88 at
  baseline/+0M, and the Taiwan structure inverts correctly (Taiwan 9.67 > Saudi 1.43).
- The five marginal `oilDep` rows above.
- The frame's `SOVEREIGN_DEBT`, `CB_STANCE` and `climateScore` tables — structure-
  neutral by nature, out of scope, not audited.

## Needs your call

1. **`applyModelJitter()` in `index.html` (~L2685)** — fires on EIA fetch failure and
   randomly perturbs the parent's `OIL_DATA` scenario curves by ±1.5%. Same class as
   2.2, but it sits on the **calibrated Hormuz oil curves**, and the brief forbids
   touching Hormuz behaviour without sign-off. Flagged, unchanged.
2. **`api/analyze.js` still not seen.** The stock popup's prompt now *asks* for the
   house vocabulary and the renderer maps legacy values, so it is safe either way —
   but if `analyze.js` has its own template it should get the same structure framing
   `whatif.js` just got.
3. **Verify the GDELT `/api/gdelt` 500 fix actually deployed.** Unrelated to this
   sweep but `updateShockEngineMessage` consumes `gdeltData`, so it is adjacent.

## Test after deploy

Switch structure to TAIWAN, then cycle all three scenarios. Expect: globe recolors to
East Asia, shock chain reads TAIWAN BLOCKADE → CHIP SUPPLY CUT, ticker drops Brent/WTI,
chokepoint grid leads with Taiwan Strait, header badge reads `TAIWAN STRAIT · UNPRICED`.
Click Taiwan — GDP EFFECT should be negative, not +3.2%. Click **Mauritania** — expect an
explicit NOT COVERED card and no AI request in the network tab.
