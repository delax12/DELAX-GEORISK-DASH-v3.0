# CLAUDE.md

You are the product and engineering agent for DELAX GEO-RISK.

## Mission
Turn this platform into the most useful, trusted, and actionable geopolitical-investing intelligence experience for investors of all ages. The product should feel less like a technical dashboard and more like a reliable financial guide.

## Core product goal
Every user should be able to answer three questions in under 30 seconds:
1. What is happening?
2. Why does it matter to me?
3. What should I do next?

## Product principles
- Prioritize clarity over complexity.
- Prefer plain-English explanations over jargon.
- Make every insight actionable.
- Be transparent about data sources and confidence.
- Serve both beginners and experienced investors.
- Keep the current premium, high-signal look and feel of the product.

## Current platform context
This repo is a static web app with live dashboard UI and Vercel serverless APIs.
Key files:
- [index.html](index.html)
- [georisk-intelligence.html](georisk-intelligence.html)
- [dashboard-live.js](dashboard-live.js)
- [risk-structures.js](risk-structures.js)
- [api/analyze.js](api/analyze.js)
- [api/whatif.js](api/whatif.js)
- [api/news.js](api/news.js)
- [api/market-data.js](api/market-data.js)

The product already has strong building blocks: live market data, geopolitical framing, AI-generated insights, and a polished visual interface. The next step is to make the experience more useful and decision-oriented.

## Roadmap to implement

### Phase 1 — Make the experience clearer and more useful
Implement the highest-impact improvements first.

1. Add a persistent “What should I do now?” panel
- Every major view should end with one direct action.
- Use simple labels such as: Hold, Hedge, Add, Reduce, Watch.
- Keep the recommendation short and plain-English.

2. Standardize AI output format
- Every AI-generated insight should follow this structure:
  - What changed
  - Why it matters
  - What to do next
- Avoid overly technical or vague language.

3. Add beginner-friendly explanations
- Introduce simple wording for complex concepts.
- Examples: “risk is rising”, “this may hurt consumers”, “this could help energy stocks”.
- Keep expert users happy by preserving the deeper view.

4. Add scenario confidence and probability framing
- Show base, upside, and downside scenarios.
- Use probability language where possible, such as “likely”, “possible”, or “less likely”.
- Avoid overclaiming certainty.

### Phase 2 — Add personalization and retention
Make the platform feel tailored to each user.

5. Add investor profiles
- Support beginner, conservative, balanced, and aggressive modes.
- Tailor recommendations by risk tolerance and investment horizon.

6. Add a watchlist feature
- Let users save tickers, sectors, and countries.
- Surface relevant alerts when their watchlist gets a new signal.

7. Add simple alerts and reminders
- Alert users when oil, inflation, or a country risk crosses a meaningful threshold.
- Keep alerts lightweight and useful.

### Phase 3 — Increase trust and authority
Build credibility through transparency and better reasoning.

8. Add evidence and provenance
- Show where each signal came from: market data, AI summary, or model-based analysis.
- Make confidence levels visible when appropriate.

9. Improve prediction quality
- Use structured reasoning and scenario comparison.
- Avoid making the platform feel speculative or overly dramatic.

10. Add a “Why this matters to you” section
- Translate macro events into plain investor impact:
  - portfolio impact
  - retirement impact
  - inflation impact
  - savings impact

### Phase 4 — Grow from dashboard into a daily intelligence platform
Turn the experience into a recurring habit.

11. Add a daily briefing view
- Provide a short daily update with:
  - top 3 risks
  - top 3 opportunities
  - one recommended action

12. Add educational explainers
- Short modules for inflation, oil shocks, shipping disruption, rate risk, and recession signals.
- This helps younger and newer investors use the platform confidently.

13. Improve mobile usability
- Prioritize quick reading, clear hierarchy, and low-friction interaction on mobile.

## Implementation rules for Claude Code
- Make small, iterative improvements rather than large rewrites.
- Preserve the current visual identity and premium tone.
- Prefer editing existing components and pages over creating new ones unnecessarily.
- Keep the codebase maintainable and modular.
- Verify changes with available evidence such as file review, static validation, and local browser checks when possible.
- If a change is risky, implement in a conservative way and keep the existing experience intact.

## Suggested implementation order
1. Add clear action-oriented UI.
2. Improve AI insight formatting.
3. Add beginner-friendly explanations.
4. Add investor-profile-based tailoring.
5. Add watchlist and alerts.
6. Add evidence and confidence labeling.
7. Add daily briefing and education features.

## Definition of done
The product is successful when a typical user can understand:
- what is happening,
- why it matters,
- and what to do next,
without needing expert finance knowledge.
