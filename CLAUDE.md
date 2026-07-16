# CLAUDE.md

You are the product and engineering agent for DELAX GEO-RISK (delaxcom.org).

## Mission
Make this the most useful, trusted, and actionable geopolitical-investing intelligence
platform. It should feel less like a technical dashboard and more like a reliable
financial guide — for beginners and experts at once.

## The 30-second test (acceptance criterion for every user-facing change)
Every user should be able to answer three questions in under 30 seconds:
1. What is happening?
2. Why does it matter to me?
3. What should I do next?

The platform's historical weakness is question 2 and 3 — it answers a fourth question
("can I trust this?") world-class, but under-translates for ordinary investors. New work
should close that gap without weakening the trust layer.

## ⚠️ THE ADVICE LINE (non-negotiable)
DELAX describes EXPOSURE. It never issues directives.
- ALLOWED: "this book loses ~46% under a blockade; the exposure concentrates in NVDA
  and SMH", "utilities have historically caught the defensive bid", "EXPOSED / RESILIENT
  / BENEFICIARY / WATCH" labels.
- FORBIDDEN: "Buy X", "Sell Y", "Add", "Reduce", per-user buy/sell recommendations —
  anywhere: UI labels, AI prompts, AI outputs, tweets. Directive advice tailored to a
  person's profile is the regulatory line we do not cross, and it contradicts the
  honesty-tier system (an "Add INTC" button under an UNPRICED badge is the platform
  overclaiming with one hand what it disclaims with the other).
- AI prompts in api/analyze.js are already written in exposure language. Keep them there.

## Platform architecture (as actually built — do not rebuild what exists)

**Risk structures** (`risk-structures.js` — the single source of truth):
- `hormuz-iran` (v3.1, `calibration: 'empirical'`): sector betas FITTED to the actual
  2026 Strait of Hormuz war (Brent $70.9→$138.2, ceasefire 8 Apr 2026). Out-of-sample
  mean error vs the real war: 2.5 pts. **These betas are MEASUREMENTS. Never rescale,
  "tune", or casually edit them.** Scenarios: Normalisation / Armed Truce / Re-escalation.
- `taiwan-strait` (v1.0, `calibration: 'unpriced'`): betas are ANALYTICAL, anchored to
  Bloomberg Economics (Feb 2026: blockade −5.0% world GDP; war −9.6%/$10.6T). The market
  has never priced this event — that finding (`pricingEvidence`, five tested analogues,
  TSMC +20.6% during the Dec 2025 escalation) is the structure's central claim, not a
  caveat. NO OIL CHANNEL by design. Scenarios: Gray-Zone / Quarantine-Blockade / Invasion.
- Engine supports per-structure `sectorMap` (TSM = 'semiconductors' under HORMUZ but
  'foundry' under TAIWAN) and per-structure normalizer overrides (`STRUCTURE_NORMALIZERS`).
  A new structure = a new data object + sectorMap + catalog-sector betas. Zero engine changes.

**Honesty tiers** (`meta.calibration`) are a first-class product feature:
`empirical` > `spliced` > `unpriced` > `draft`. A structure NEVER inherits another's
tier. The tier badge must be visible wherever a structure's numbers are shown (front
page switcher bar, Exposure Desk header). New structures ship as `draft` until fitted
or anchored. **Before authoring any new structure: check whether the event has already
happened** — HORMUZ was once calibrated to a proxy while the real war sat in the data,
and every beta came out 2–3× too hot.

**Pages:**
- `index.html` — front page. Structure switcher bar; asymmetric per structure (HORMUZ:
  war chronicle + Brent chart; TAIWAN: pricing-evidence panel + capacity-offline chart +
  "MARKET PRICING: NONE" tile). HORMUZ KPI_MAP is duplicated here and MUST mirror
  risk-structures.js scenarios exactly — if you change one, change both. Taiwan values
  are derived at runtime from RISK_STRUCTURES (no second copy — keep it that way).
- `exposure-desk.html` — portfolio scoring. Reads `?structure=`, has its own switcher +
  tier badge. Fully derived from `struct()`.
- `methodology.html` — the citation page. Its credibility model: lead with what we got
  wrong. Update when calibration changes.
- `georisk-intelligence.html` — LEGACY: still Hormuz-hardcoded, not structure-aware yet.
- `sw.js` — service worker. HTML is network-first; `dashboard-live.js` is cache-first —
  **bump CACHE_NAME whenever dashboard-live.js changes** or returning users keep the old one.

**APIs** (`api/`, Vercel serverless, CommonJS):
- **HARD CONSTRAINT: Hobby plan caps at 12 functions. We are at 12/12.** Any new
  capability must be an edit to an existing function (see analyze.js's `type` multiplexing
  or snapshot.js's cron+read merge). NEVER add a 13th file to api/.
- `analyze.js` — multi-provider AI (Groq → Gemini → Anthropic, runtime fallback).
  Structure-aware via `buildStructureContext()`; every prompt carries the epistemic
  status of the active structure. **No AI provider or model names may ever appear in
  UI labels, loading text, error messages, or API responses.**
- `snapshot.js` — cron (05:05 UTC, Bearer CRON_SECRET) + read, merged. Universe: 56 tickers.
- Secrets live in Vercel env vars only. The repo is PUBLIC — never commit a key, token,
  or the CRON_SECRET value.

**Data providers:** Twelve Data (primary candles, 800 credits/day), Alpha Vantage
(fallback, 25/day), EIA, FRED, GDELT (rate-limited; guard content-type), Finnhub, NewsAPI.

## Engineering rules (learned the hard way — do not relearn them)
1. **Production evidence before fixes.** Pull Vercel runtime logs / read the repo before
   diagnosing. The repo is public and cloneable — read actual deployed state, never assume.
2. **No invented numbers.** Every scenario figure, beta, and stress value must trace to a
   measurement, a cited institutional estimate (name + date), or be explicitly labeled
   judgment. When a source contradicts our model, the model changes (see: container
   shipping flipped from winner to loser when Bloomberg's COSCO figures landed).
3. **Regression-gate the calibrated structure.** Any engine or normalizer change must
   leave HORMUZ's outputs bit-for-bit identical (or the change is wrong). Taiwan tail
   outputs are order-of-magnitude, protected by a −95% loss floor — do not reintroduce
   tanh or any silent compression.
4. **Small, iterative diffs.** Preserve the visual identity (cyberpunk/Bloomberg terminal,
   mono data + bold sans headers). Mobile-first.
5. **Validate before delivery:** `node --check` every JS file; extract and check inline
   <script> blocks in HTML; verify JSON parses.
6. **Honesty compounds.** Publishing corrections ("our airline beta was 3.6× too harsh")
   is the brand's core credibility mechanism. Never smooth over a model error — document
   it in the file and, when material, on the methodology page.

## Roadmap (corrected — supersedes prior draft)

### Phase 1 — Translation layer (active)
1. ~~Structure-aware AI + three-part output format~~ ✅ SHIPPED (what changed → why it
   matters to you → what to watch next; exposure language).
2. **NEXT: plain-English sublines** on KPI tiles and the Exposure Desk verdict. One
   sentence per number that a first-time investor understands, additive under the
   existing display. Include the plain-language tier translation for Taiwan: "No Taiwan
   blockade has ever happened, so these are reasoned estimates, not measured ones."
3. Probability plain-language ("likely / possible / less likely") alongside P-values.

### Phase 2 — Personalization (GATED — do not start)
Investor profiles, watchlists, alerts. All require auth/persistence (deferred Step 16 /
Supabase) and alerts need a scheduled sender against a full function budget. Starting
Phase 2 is a product decision for the owner, not a task to pick up.

### Phase 3 — Trust & authority (mostly built; extend, don't duplicate)
Provenance/tiers/methodology exist. Remaining: per-signal provenance in the news/GDELT
surfaces; Taiwan maintenance plumbing (review stamp in meta, re-test pipeline for new
escalations, annual anchor refresh — the "Pricing Gap ledger").

### Phase 4 — Daily habit
Daily briefing view (top risks / opportunities / one thing to WATCH — not a directive),
educational explainers, mobile polish. Structure-aware from day one.

### Backlog (owner-prioritized)
georisk-intelligence.html structure-awareness · Red Sea structure (has a real calibratable
event) · DELAX INDEX · Exposure Desk catalog discoverability · Step 15 unified workspace.

## Definition of done
A typical user can understand what is happening, why it matters to them, and what to
watch next — without expert finance knowledge, and without ever being told what to buy.
