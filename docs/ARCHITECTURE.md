# Egomaniacs Probability Engine Architecture (v1)

## A) Blueprint
### 1) Input Processing Pipeline
- Normalize prompt text (typos/aliases/number words).
- Parse intent: sport, entity type, metric, horizon (`season`, `next_season`, `career`, `ever`).
- Run safety filter for betting-advice requests.

### 2) Intent / Time Horizon Classifier
- Deterministic regex + canonicalization first.
- LLM only as fallback parser for ambiguous phrasing.

### 3) Entity Resolver
- Local NFL index (Sleeper) first.
- Fuzzy name matching second.
- Team alias resolver for abbreviations/slang.

### 4) Market Mapping + Sportsbook Anchor
- Query direct market when available (FanDuel/DraftKings via The Odds API).
- If no direct market: query adjacent market(s) and anchor priors.
- Cache sportsbook references by market/team.

### 5) Historical Base-Rate Module
- Deterministic baselines for rare events (example: NFL 17-0, 0-17).
- Time-horizon conversion (`season -> career/ever`) using repeated-trial model.

### 6) Simulation Engine
- Per-season probability vectors by player/team context.
- Convert vectors to count distributions (`P(0), P(1), ...`) via Poisson-binomial DP.
- Used for awards/team/performance/longevity outputs.

### 7) Calibration Module
- JSON calibration artifact loaded at runtime (`data/phase2_calibration.json`).
- Rebuildable via script (`npm run phase2:rebuild`).
- Includes base rates, decay rates, longevity/earnings multipliers.

### 8) Consistency Validator
- Enforces monotonic/hard rules before response.
- Repairs contradictory outputs (for example `ever >= season`).

### 9) Response Renderer
- Always return:
  - odds
  - implied probability
  - source type/label
  - assumptions
  - optional trace (feature-flagged)

## B) Data Plan
### Free data
- Sleeper NFL players index: roster identity, position, years experience, age.
- The Odds API: real market anchors.
- Local calibration artifact: engine constants.

### Paid/enterprise next
- Sportradar / Stats Perform for deeper play-by-play, injuries, depth charts, contract detail.

### Cadence
- Player index: every 12h.
- Sportsbook anchors: near-real-time at request + short cache.
- Calibration artifact: rebuild daily/weekly or after model updates.

### Logical schema
- players: ids, name aliases, position, team, age, years_exp, status.
- markets: sport, market_type, team/player, odds, implied probability, timestamp, bookmaker.
- outcomes: event_key, horizon, probability, odds, source, assumptions, trace.
- calibration: versioned constants by module.

## C) Modeling Plan
- Awards: season-base-rate x player factors x horizon simulation.
- Team outcomes: team market prior x role/position multiplier x horizon simulation.
- Performance thresholds: metric base-rates + position filters + simulation counts.
- Longevity: hazard-style age curve with position modifiers.
- Earnings: role bands + years-remaining + retention factor.
- LLM used only for language parsing/explanations, never final probability math.

## D) Hard Rules (must pass)
- `P(2+) <= P(1+)`
- `P(ever) >= P(this season)` for same event.
- Impossible events -> `NO CHANCE`.
- Non-sports person prompts rejected unless strong sports evidence.
- Semantically equivalent prompts map to stable outputs via canonical keying/caches.

## E) Implementation Phases
### Phase 1 (stabilization)
- Intent parsing, canonicalization, safety guards, baseline-event module.
- Acceptance: no random swings for equivalent phrasing; major false snarks removed.

### Phase 2 (data + simulation)
- Outcomes engine module, calibration loader, player outcome endpoints.
- Acceptance: structured distributions returned for awards/team/performance/career.

### Phase 3 (calibration/backtest/observability)
- Regression suite, drift checks, metrics endpoint, deployment controls.
- Acceptance: measurable error targets and reproducible rebuild flow.

## F) Testing Plan
- Unit: intent parsing, baseline event mapping, consistency rules, distribution math.
- Integration: `/api/odds`, `/api/player/outcomes`, `/api/player/performance-threshold`.
- Regression/golden prompts: run `npm run test:regression`.
- Latency budgets:
  - `/api/odds` p95 under 10s (fallback/quick-model path enabled).
  - Structured endpoints p95 under 2s (no LLM required).

## G) Deployment Plan
- Local -> staging -> production with environment-specific keys.
- Feature flags:
  - `FEATURE_ENABLE_TRACE`
  - future: `FEATURE_BASELINE_EVENTS`, `FEATURE_STRICT_VALIDATOR`
- Monitoring:
  - `/api/metrics` for request mix, refusals, fallback behavior.
- Rollback:
  - switch to previous server file/version and restart service.
