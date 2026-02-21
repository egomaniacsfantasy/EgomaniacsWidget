# Egomaniacs “What Are the Odds?” Full Audit (2026-02-20)

## 1) Executive summary

The product is visually strong, but logic quality is still inconsistent in ways users will notice quickly.

Big picture:
- Deterministic behavior under repeated identical prompts is good.
- Latency under load is good.
- Guardrails for direct betting-advice prompts are mostly good.
- Core sports logic is still fragile for paraphrases, generic scenarios, and some entity detection.
- Most importantly: your live app on port 3000 is not the latest build, so old bugs are still showing in Safari.

Conclusion:
- This is close to a credible MVP demo for controlled prompts.
- It is not yet production-grade for broad public usage.

## 2) What was tested

Test method:
- Health/config checks on local server.
- Large prompt suite across categories:
  - sportsbook-style phrasing
  - player career outcomes
  - retirement/comeback edge cases
  - generic stat thresholds
  - player-specific stat thresholds
  - non-sports/betting guardrails
  - semantic equivalence/paraphrase stability
  - horizon consistency (“this season” vs “ever”)
- Load test: 120 requests concurrent mix.
- Direct A/B checks of phrase variants expected to mean the same thing.

Key measured outputs:
- response status
- odds/probability
- source type (historical_model / hypothetical / hybrid_anchored / refused / snark)
- latency

## 3) Measured results

### 3.1 Reliability and performance
- 120/120 requests succeeded in load test.
- Latency (120 mixed requests):
  - p50: 560ms
  - p90: 678ms
  - p95: 697ms
  - p99: 706ms
  - max: 767ms
- Stability for repeated identical prompts: stable (same output each time in this run).

### 3.2 Configuration and deployment
- `localhost:3000` (your Safari app) currently reports cacheVersion `v32`.
- latest audited code in project is cacheVersion `v34`.
- This mismatch explains why you still see old failures even after fixes are made.

## 4) Critical findings (highest impact)

## F1) Live app is running older code
Severity: Critical

Evidence:
- `:3000` health reports `cacheVersion: v32`
- Latest code tested in project is `v34`
- On `:3000`, prompt “Drake Maye retires this year” still returns non-sports snark.

Business impact:
- You and testers lose trust immediately because fixes appear to “not work”.

Fix:
- Enforce version handshake in UI and API (`/api/health` must match UI expected version).
- Add startup banner in UI showing server version.
- Add “hard fail” if UI build expects higher server version than running backend.

---

## F2) Paraphrase fragility creates contradictory outcomes
Severity: Critical

Evidence:
- “Will Campbell catches 5 touchdowns next season” -> `NO CHANCE`
- “Will Campbell records 5 receiving touchdowns next season” -> `+510`

Same meaning, opposite outcome.

Business impact:
- Product feels random/manipulable.

Fix:
- Canonical intent schema before modeling:
  - action: receiving_touchdowns
  - subject: player
  - threshold: 5
  - horizon: next_season
- Route both phrasings to same deterministic validator.
- Expand synonym normalization (`catches`, `receiving`, `records`, `TD`, `touchdowns`).

---

## F3) Sports intent classifier still rejects valid sports phrasing
Severity: High

Evidence:
- “Brett Favre returns to play” -> refused (non-sports)
- “Brett Favre returns to play in the NFL” -> processed as sports and returns NO CHANCE

Business impact:
- Users can break flow with simple wording.

Fix:
- Upgrade sports-intent gating from regex-only to:
  - entity evidence + action evidence + weak sports lexicon
- Add synonym intents for comeback/return without explicit league tokens.

---

## F4) Generic stat logic coverage is incomplete
Severity: High

Evidence:
- “A quarterback throws for 20 touchdowns this season” now correct (~99.2%).
- But “A quarterback throws 20 interceptions this season” still falls back to hypothetical (`+350`/`+395` range).

Business impact:
- Inconsistent credibility across closely related stat prompts.

Fix:
- Add deterministic models for generic league-level thresholds:
  - QB passing TD
  - QB interceptions
  - passing yards
  - rushing yards
  - receiving yards
  - sacks
- Keep separate pathways for “any player”, “any QB”, and named player.

---

## F5) Sportsbook anchoring is not consistently used where expected
Severity: High

Evidence:
- In current project test env: `oddsApiConfigured=false`, so no live market anchors.
- In your desktop env: `oddsApiConfigured=true`, but many common futures still return hypothetical fallback.

Business impact:
- Large discrepancies vs real books for mainstream markets.

Fix:
- Strengthen market normalization and synonym mapping:
  - “AFC winner” == “AFC Championship winner” == “to win the AFC”
  - “WS” == “World Series”
- Add market-resolution trace object so you can see why anchor was/was not used.
- Add fallback policy: if direct market missing, use adjacent markets with documented transform.

## 5) Major logic-quality findings

## F6) Too much fallback-hypothetical output
Severity: Medium-High

Evidence:
- Many prompts return `sourceType: hypothetical` + “Fast fallback estimate used due to API latency.”
- This is often where odd numbers appear.

Fix:
- Require deterministic route first.
- Use LLM only for parsing/explanation, not final odds.
- If deterministic/anchor path unavailable, show “limited confidence mode” explicitly.

---

## F7) Confidence labels are weak signal
Severity: Medium

Evidence:
- “Low/Medium/High” often doesn’t explain *why* confidence is low.

Fix:
- Replace with confidence drivers:
  - Data freshness
  - Market anchor present?
  - Deterministic model vs fallback
  - Entity match quality

---

## F8) Domain coverage gaps (user-desired scope)
Severity: Medium

Missing broad categories for Phase 2 vision:
- awards distribution (0,1,2…)
- playoff wins distribution
- hall-of-fame probability
- longevity thresholds
- earnings projections
- record-breaking probabilities

Fix:
- Build dedicated outcome modules with calibrated distributions, not one generic estimator.

## 6) Product/UX risks

## F9) Source transparency not prominent enough
Severity: Medium

Need explicit line in result card:
- “Reference odds via DraftKings/FanDuel” when anchored
- “Historical model estimate” when modeled
- “Fallback estimate” when not anchored/model-complete

---

## F10) “Try one” and placeholder suggestions can drift from current season context
Severity: Medium

Fix:
- Suggestion generator should be season-aware and pull current champions/rosters from live state cache.

## 7) Architecture and maintainability risks

## F11) `server.js` is too large and branch-heavy
Severity: Medium-High

Evidence:
- `server.js` ~2908 lines.
- Many overlapping guardrail and fallback branches.

Risk:
- New fixes can regress old paths.

Fix:
- Split into modules:
  - intent parser
  - entity resolver
  - deterministic model router
  - sportsbook anchor resolver
  - consistency validator
  - response formatter
- Add a single orchestration graph with explicit state transitions.

## 8) Priority remediation plan

## P0 (today)
- Ensure live app runs latest backend (version lock).
- Fix sports intent false-refusal for comeback phrasings.
- Canonicalize receiving-TD wording so equivalent prompts map identically.
- Add deterministic generic QB interception threshold model.

## P1 (next 1-2 days)
- Expand sportsbook market normalization dictionary.
- Add output trace diagnostics (hidden debug mode).
- Add gold test suite for equivalence and monotonic constraints.

## P2 (next 3-7 days)
- Implement full deterministic modules by outcome family.
- Calibrate against historical distributions + market anchors.
- Add observability dashboard for fallback-rate, refusal-rate, anchor-hit-rate.

## 9) Acceptance criteria to declare “fixed”

You should only call this “stable” when all pass:
- Equivalent prompts differ by <= 1.5 percentage points in implied probability.
- No valid sports prompt is misclassified as non-sports in gold set.
- `fallback hypothetical` usage < 10% for top 200 prompt intents.
- Sportsbook anchor hit-rate > 80% for mainstream futures phrasings.
- Hard logic constraints always pass:
  - P(2+) <= P(1+)
  - “ever” >= “this season” for same event class
  - impossible scenarios => NO CHANCE
- p95 latency <= 2.0s under 100 concurrent mixed requests.

## 10) Straight answer on current product quality

Current quality today:
- UI: good
- Speed: good
- Logical consistency: improved but still fragile
- Business trustworthiness: not ready yet for broad release

It can demo well, but it still needs the above fixes to avoid obvious “that makes no sense” moments.
