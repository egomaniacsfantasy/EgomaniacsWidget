You are now acting as principal architect + implementation lead for Egomaniacs Fantasy Football “What Are the Odds?”.

Goal:
Upgrade the current product from brittle MVP behavior to a production-grade, logically consistent probability engine.

Non-negotiables:
1) Do NOT use raw LLM guessing for final probabilities.
2) LLM is allowed only for:
   - intent parsing
   - entity extraction/normalization
   - explanation text
3) Final odds must come from deterministic models, market anchors, and constrained simulation.
4) Every response must pass consistency validators before return.
5) Equivalent phrasings must produce materially equivalent outputs.
6) Impossible scenarios must return NO CHANCE.
7) Sports hypotheticals must not be mislabeled as non-sports.
8) Betting-advice prompts must still be refused.
9) Output must include traceable source type and confidence drivers.
10) Fixes must be implemented end-to-end in code, with tests and proof.

You must implement all of the following fixes in this run:

A) Version and deployment integrity
- Add server/client version handshake.
- Add endpoint and UI indicator for active backend version.
- Hard-fail if UI expects newer API than running server.
- Add command to verify that localhost app is running latest build.

B) Canonical intent layer (before probability)
- Build canonical schema with fields:
  - entity_type (player/team/league/any-player/any-qb)
  - entity_id or normalized name
  - action (wins_super_bowl, passing_tds, receiving_tds, retires, comeback, etc.)
  - threshold
  - comparator (>=, ==, etc.)
  - horizon (this_season, next_season, career, ever)
  - league
- Add synonym normalization so these map identically:
  - “catches” / “records receiving” / “gets”
  - “WS” / “World Series”
  - “AFC” / “AFC Championship” / “AFC winner”
  - “returns to play” / “comeback” / “comes out of retirement”

C) Deterministic model coverage expansion
- Add deterministic generic-threshold models for:
  - any QB passing TDs
  - any QB interceptions
  - passing yards
  - receiving yards
  - rushing yards
  - sacks
- Add deterministic named-player threshold model routing by position.
- Ensure position realism constraints apply regardless of phrasing.
  - Example class: offensive lineman receiving TD thresholds.

D) Sports intent + entity resolution hardening
- Remove false non-sports rejection for valid sports phrasing.
- Add stronger entity resolution with:
  - local NFL index first
  - fuzzy matching
  - active-player preference for duplicate names
  - team disambiguation when available
- Add confidence score for entity match and use it in response confidence.

E) Sportsbook anchor reliability
- Improve market mapping and phrase normalization to maximize anchor hit-rate.
- If direct market not found:
  - try adjacent equivalent markets (defined mapping table)
  - apply documented transform
- Always label source clearly:
  - sportsbook (with book + market)
  - deterministic model
  - fallback model (only if unavoidable)

F) Consistency validator (hard gate)
Implement pre-response validator rules:
- P(2+) <= P(1+)
- horizon monotonicity: ever >= career >= season for compatible event families
- impossible world constraints => NO CHANCE
- semantically equivalent prompt outputs within tolerance
- clamp improbable spikes from low-confidence fallbacks
If rule fails, auto-repair or refuse with explicit reason.

G) Observability + metrics
- Add metrics endpoint fields for:
  - anchor hit-rate
  - fallback rate
  - refusal rate
  - non-sports false-positive count
  - consistency repair count
- Add per-response trace object (can be hidden in UI, available in API) showing:
  - canonical intent
  - entity resolution result
  - model path taken
  - constraints applied
  - final validator actions

H) Test suite (must be added and passing)
- Unit tests for parser normalization and consistency rules.
- Integration tests for API outcomes.
- Golden regression prompts (min 100) including:
  - equivalent-phrasing pairs
  - impossible scenarios
  - retirement/comeback logic
  - generic stat thresholds
  - sportsbook-style mainstream markets
- Include performance test proving p95 <= 2s under 100 mixed concurrent requests locally.

I) Deliverables required in your response
1) Summary of exactly what you changed.
2) List of files added/modified.
3) Exact terminal commands I should run.
4) Test results with pass/fail counts.
5) Before/after examples proving fixes on previously broken prompts.
6) Remaining known gaps and next recommended priorities.

Execution rules:
- Be fully methodical.
- Do not stop at partial fixes.
- If uncertain, state assumptions and continue with best-practice defaults.
- Prioritize correctness and consistency over visual changes.
- Keep language plain English and directly actionable.
