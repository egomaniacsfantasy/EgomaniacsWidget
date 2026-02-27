import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function toAmericanOdds(probabilityPct) {
  const p = clamp(probabilityPct / 100, 0.001, 0.999);
  if (p >= 0.5) return `${-Math.round((p / (1 - p)) * 100)}`;
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

function horizonAdjustedProbability(seasonPct, horizon) {
  if (horizon === "season" || horizon === "next_season") return seasonPct;
  if (horizon === "career") {
    const years = 10;
    const p = seasonPct / 100;
    return clamp((1 - Math.pow(1 - p, years)) * 100, 0.01, 99.9);
  }
  if (horizon === "ever") {
    const years = 30;
    const p = seasonPct / 100;
    return clamp((1 - Math.pow(1 - p, years)) * 100, 0.01, 99.9);
  }
  return seasonPct;
}

function parseGenericQbSeasonThreshold(prompt) {
  const p = String(prompt || "").toLowerCase();
  if (!/\b(a|any)\s+(quarterback|qb)\b/.test(p)) return null;
  const tdMatch = p.match(/\bthrows?\s+(?:for\s+)?(\d{1,2})\+?\s+(tds?|touchdowns?|ints?|interceptions?|picks?)\b/);
  if (tdMatch) {
    const threshold = Number(tdMatch[1]);
    if (!Number.isFinite(threshold) || threshold < 1) return null;
    const metricWord = tdMatch[2] || "";
    const metric = /\bint|interception|pick\b/.test(metricWord) ? "passing_interceptions" : "passing_tds";
    return { threshold, metric };
  }
  const yardMatch = p.match(/\b(\d{4})\+?\s+(passing\s+)?yards?\b/);
  if (yardMatch) {
    const threshold = Number(yardMatch[1]);
    if (!Number.isFinite(threshold) || threshold < 500) return null;
    return { threshold, metric: "passing_yards" };
  }
  return null;
}

function parseGenericQbGameThreshold(prompt) {
  const p = String(prompt || "").toLowerCase();
  if (!/\b(a|any)\s+(quarterback|qb)\b/.test(p)) return null;
  if (!/\b(single\s+game|in\s+a\s+game|in\s+one\s+game|in\s+a\s+single\s+game|single-game)\b/.test(p)) return null;
  const tdMatch = p.match(/\bthrows?\s+(?:for\s+)?(\d{1,2})\+?\s+(tds?|touchdowns?|ints?|interceptions?|picks?)\b/);
  if (tdMatch) {
    const threshold = Number(tdMatch[1]);
    if (!Number.isFinite(threshold) || threshold < 1) return null;
    const metricWord = tdMatch[2] || "";
    const metric = /\bint|interception|pick\b/.test(metricWord) ? "passing_interceptions" : "passing_tds";
    return { threshold, metric };
  }
  const yardMatch = p.match(/\b(\d{3,4})\+?\s+(passing\s+)?yards?\b/);
  if (yardMatch) {
    const threshold = Number(yardMatch[1]);
    if (!Number.isFinite(threshold) || threshold < 200) return null;
    return { threshold, metric: "passing_yards" };
  }
  return null;
}

function genericQbAnyHitsTdThresholdSeasonPct(threshold) {
  // Probability at least one NFL QB reaches threshold in a season (coarse baseline).
  if (threshold <= 15) return 99.5;
  if (threshold <= 20) return 98.5;
  if (threshold <= 25) return 93.0;
  if (threshold <= 30) return 80.0;
  if (threshold <= 35) return 55.0;
  if (threshold <= 40) return 30.0;
  if (threshold <= 45) return 10.0;
  if (threshold <= 50) return 2.0;
  if (threshold <= 55) return 1.5;
  return 0.4;
}

function genericQbAnyHitsIntThresholdSeasonPct(threshold) {
  // Probability at least one NFL QB reaches threshold interceptions in a season.
  if (threshold <= 10) return 99.7;
  if (threshold <= 12) return 97.0;
  if (threshold <= 15) return 89.0;
  if (threshold <= 18) return 60.0;
  if (threshold <= 20) return 33.0;
  if (threshold <= 22) return 16.0;
  if (threshold <= 25) return 4.0;
  return 0.8;
}

function genericQbAnyHitsYardsThresholdSeasonPct(threshold) {
  if (threshold <= 4000) return 90.0;
  if (threshold <= 4500) return 70.0;
  if (threshold <= 5000) return 25.0;
  if (threshold <= 5200) return 15.0;
  if (threshold <= 5500) return 6.0;
  return 2.5;
}

function genericQbAnyHitsYardsThresholdGamePct(threshold) {
  if (threshold <= 400) return 28.0;
  if (threshold <= 450) return 12.0;
  if (threshold <= 500) return 3.0;
  if (threshold <= 550) return 0.8;
  if (threshold <= 600) return 0.3;
  if (threshold <= 650) return 0.15;
  if (threshold <= 700) return 0.08;
  return 0.03;
}

function genericQbAnyHitsTdThresholdGamePct(threshold) {
  if (threshold <= 4) return 22.0;
  if (threshold <= 5) return 6.5;
  if (threshold <= 6) return 1.8;
  if (threshold <= 7) return 0.6;
  return 0.2;
}

function parseTeamRecordEvent(prompt) {
  const p = String(prompt || "").toLowerCase();
  const m = p.match(/\b([0-9]|1[0-7])\s*-\s*([0-9]|1[0-7])\b/);
  if (!m) return null;
  const wins = Number(m[1]);
  const losses = Number(m[2]);
  if (!Number.isFinite(wins) || !Number.isFinite(losses)) return null;
  if (wins + losses !== 17) return null;

  const hasRecordIntent = /\b(finish|finishes|ending|end|record|goes|go)\b/.test(p);
  const hasNflSeasonContext = /\b(nfl|regular season|this season|next season|season)\b/.test(p);
  if (!hasRecordIntent && !hasNflSeasonContext) return null;

  const anyTeamLanguage = /\b(a team|any team|some team)\b/.test(p);
  return { wins, losses, anyTeamLanguage };
}

function logGamma(z) {
  const g = 7;
  const coeff = [
    0.9999999999998099,
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    0.000009984369578019571,
    0.00000015056327351493116,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  const z1 = z - 1;
  let x = coeff[0];
  for (let i = 1; i < g + 2; i += 1) x += coeff[i] / (z1 + i);
  const t = z1 + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z1 + 0.5) * Math.log(t) - t + Math.log(x);
}

function logChoose(n, k) {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

function betaBinomialPmf(k, n, alpha, beta) {
  const logP =
    logChoose(n, k) +
    logGamma(k + alpha) +
    logGamma(n - k + beta) -
    logGamma(n + alpha + beta) +
    logGamma(alpha + beta) -
    logGamma(alpha) -
    logGamma(beta);
  return Math.exp(logP);
}

function teamRecordSeasonPct(wins, anyTeam) {
  const nGames = 17;
  // Symmetric beta-binomial to account for parity + team-strength spread.
  const alpha = 30;
  const beta = 30;
  const oneTeam = clamp(betaBinomialPmf(wins, nGames, alpha, beta), 0.00001, 0.95);
  if (!anyTeam) return clamp(oneTeam * 100, 0.01, 99.9);
  const nTeams = 32;
  const anyTeamProb = 1 - Math.pow(1 - oneTeam, nTeams);
  return clamp(anyTeamProb * 100, 0.01, 99.9);
}

export function detectBaselineEvent(prompt) {
  const p = String(prompt || "").toLowerCase();
  const hasSuperBowl = /\b(super bowl|superbowl|sb)\b/.test(p);
  const singleGame = /\b(single\s+game|in\s+a\s+game|in\s+one\s+game|in\s+a\s+single\s+game|single-game)\b/.test(p);

  // Super Bowl event props.
  if (hasSuperBowl && /\b(overtime|ot)\b/.test(p)) {
    return {
      key: "super_bowl_overtime",
      seasonProbabilityPct: 2.5,
      assumptions: [
        "Super Bowl overtime is rare but measurable.",
        "Historical frequency baseline used for next-season projection.",
      ],
    };
  }

  const marginMatch = p.match(/\b(super bowl|superbowl|sb)\b.*\b(\d{1,2})\s+points?\s+(?:or\s+fewer|or\s+less)\b/);
  if (marginMatch) {
    const margin = Number(marginMatch[2]);
    if (Number.isFinite(margin) && margin > 0) {
      const pct = margin <= 3 ? 33.0 : margin <= 7 ? 51.0 : 66.0;
      return {
        key: `super_bowl_margin_leq_${margin}`,
        seasonProbabilityPct: pct,
        assumptions: [
          "Modeled using historical Super Bowl margin distribution with smoothing.",
          "Deterministic historical-frequency baseline for close-game outcomes.",
        ],
      };
    }
  }
  if (hasSuperBowl && /\bone[-\s]?score\b/.test(p)) {
    return {
      key: "super_bowl_margin_leq_8",
      seasonProbabilityPct: 62.0,
      assumptions: [
        "Modeled using historical Super Bowl margin distribution with smoothing.",
        "One-score games approximate a margin of 8 points or fewer.",
      ],
    };
  }

  const genericQbGame = parseGenericQbGameThreshold(p);
  if (genericQbGame) {
    const metric = genericQbGame.metric || "passing_yards";
    const seasonProbabilityPct = metric === "passing_tds"
      ? genericQbAnyHitsTdThresholdGamePct(genericQbGame.threshold)
      : metric === "passing_interceptions"
        ? 0.15
        : genericQbAnyHitsYardsThresholdGamePct(genericQbGame.threshold);
    return {
      key: metric === "passing_tds"
        ? "nfl_any_qb_passing_td_single_game_threshold"
        : metric === "passing_interceptions"
          ? "nfl_any_qb_passing_int_single_game_threshold"
          : "nfl_any_qb_passing_yards_single_game_threshold",
      seasonProbabilityPct,
      assumptions: [
        "Single-game outlier baseline using historical tail frequency.",
        "Probability represents any QB reaching the threshold in a season.",
      ],
    };
  }

  const genericQbTd = parseGenericQbSeasonThreshold(p);
  if (genericQbTd) {
    const metric = genericQbTd.metric || "passing_tds";
    const seasonProbabilityPct = metric === "passing_interceptions"
      ? genericQbAnyHitsIntThresholdSeasonPct(genericQbTd.threshold)
      : metric === "passing_yards"
        ? genericQbAnyHitsYardsThresholdSeasonPct(genericQbTd.threshold)
        : genericQbAnyHitsTdThresholdSeasonPct(genericQbTd.threshold);
    return {
      key: metric === "passing_interceptions"
        ? "nfl_any_qb_passing_int_threshold"
        : metric === "passing_yards"
          ? "nfl_any_qb_passing_yards_threshold"
          : "nfl_any_qb_passing_td_threshold",
      seasonProbabilityPct,
      assumptions: [
        `Historical NFL passing environment baseline for any-QB season ${
          metric === "passing_interceptions" ? "INT" : metric === "passing_yards" ? "yardage" : "TD"
        } threshold.`,
        "Deterministic threshold model used for generic QB prompts.",
      ],
    };
  }

  if (/\b(18\s*game|18\s*games|18-game)\b/.test(p) && /\b(nfl|regular season|season)\b/.test(p)) {
    return {
      key: "nfl_18_game_season",
      seasonProbabilityPct: 40.0,
      assumptions: [
        "League-structure change modeled as a forward-looking policy probability.",
        "Historical expansion cadence and CBA trajectory used as baseline.",
      ],
    };
  }

  if (hasSuperBowl && /\b(outside the (us|united states)|outside the u\.s\.|international)\b/.test(p)) {
    return {
      key: "super_bowl_outside_us",
      seasonProbabilityPct: 22.0,
      assumptions: [
        "International expansion trend used as a baseline.",
        "Pricing reflects policy feasibility within the next decade.",
      ],
    };
  }

  if (/\b(expand|expands|expansion)\b/.test(p) && /\b(nfl)\b/.test(p) && /\b(35|36)\s+teams?\b/.test(p)) {
    return {
      key: "nfl_expands_35_teams",
      seasonProbabilityPct: 20.0,
      assumptions: [
        "Expansion probability modeled over a medium-term window.",
        "Baseline uses historical franchise growth cadence.",
      ],
    };
  }

  if (/\b(relocate|relocates|relocation)\b/.test(p) && /\bnext season|next year|this season\b/.test(p)) {
    return {
      key: "nfl_team_relocation_next",
      seasonProbabilityPct: 6.7,
      assumptions: [
        "Relocation baseline uses recent NFL relocation frequency.",
        "Near-term window assumed for next-season framing.",
      ],
    };
  }

  if (/\b(no)\b.*\bafc\b.*\bsuper bowl\b.*\b(5|five)\s+straight\b/.test(p)) {
    return {
      key: "afc_no_sb_five_years",
      seasonProbabilityPct: 3.0,
      assumptions: [
        "Modeled as a five-season run without an AFC champion.",
        "Baseline uses conference parity and recent dominance cycles.",
      ],
    };
  }

  if (hasSuperBowl && /\b(5|five)\s+touchdowns?\b/.test(p)) {
    return {
      key: "super_bowl_five_tds",
      seasonProbabilityPct: 2.0,
      assumptions: [
        "Super Bowl single-player touchdown outlier baseline.",
        "Historical record tail used with smoothing.",
      ],
    };
  }

  if (hasSuperBowl && /\bthree-?peat|three\s+peat\b/.test(p) && !/\bteam\b/.test(p)) {
    return {
      key: "super_bowl_threepeat_any_team",
      seasonProbabilityPct: 5.0,
      assumptions: [
        "Back-to-back-to-back title baseline modeled from dynasty-era frequency.",
        "No team specified; any-team event probability used.",
      ],
    };
  }

  // Rare-event library can be expanded over time.
  const hasTiePhrase =
    /\b(tie|ties|tied|ending in a tie|end in a tie)\b/.test(p) &&
    /\b(game|season|regular season|matchup)\b/.test(p);
  if (hasTiePhrase) {
    const anyTeamLanguage = /\b(a team|any team|some team)\b/.test(p);
    return {
      key: anyTeamLanguage ? "nfl_any_team_tie_game_regular" : "nfl_team_tie_game_regular",
      seasonProbabilityPct: anyTeamLanguage ? 38.0 : 2.8,
      assumptions: [
        anyTeamLanguage
          ? "Historical NFL tie rates mapped to a league-wide chance that at least one game ends tied in a regular season."
          : "Historical NFL tie rates mapped to a single-team chance of logging at least one tie in a regular season.",
        "Deterministic historical-frequency baseline with horizon adjustment.",
      ],
    };
  }

  const hasNflSeasonContext = /\bnfl\b/.test(p) || /\b(0-17|17-0)\b/.test(p);
  const hasSeasonContext = /\b(regular season|this nfl season|nfl season|this season|season)\b/.test(p);
  const anyTeamLanguage = /\b(a team|any team|some team)\b/.test(p);

  const anyTeamWinTotal =
    p.match(/\b(a team|any team|some team)\b.*\b(at least|no fewer than|not less than)\s+(\d{1,2})\s+(regular[-\s]?season\s+)?games?\b/) ||
    p.match(/\b(a team|any team|some team)\b.*\b(\d{1,2})\s*\+\s*(regular[-\s]?season\s+)?wins?\b/) ||
    p.match(/\b(a team|any team|some team)\b.*\b(\d{1,2})\s*\+\s*(regular[-\s]?season\s+)?games?\b/);
  if (anyTeamWinTotal) {
    const wins = Number(anyTeamWinTotal[3] || anyTeamWinTotal[2]);
    if (Number.isFinite(wins) && wins >= 0 && wins <= 17) {
      const meanWins = 8.5;
      const sd = 2.3;
      const perTeamProb = normalTailAtLeast(meanWins, sd, wins);
      const anyTeamProb = 1 - Math.pow(1 - perTeamProb, 32);
      return {
        key: `nfl_any_team_win_total_at_least_${wins}`,
        seasonProbabilityPct: clamp(anyTeamProb * 100, 0.05, 95),
        assumptions: [
          `Estimated chance at least one NFL team reaches ${wins}+ wins in a 17-game season.`,
          "Regular-season win totals modeled with a normal win distribution.",
        ],
      };
    }
  }

  if (/\b17-0\b/.test(p) && (hasNflSeasonContext || hasSeasonContext || anyTeamLanguage)) {
    const oneTeamPct = 0.03;
    const seasonProbabilityPct = anyTeamLanguage
      ? clamp((1 - Math.pow(1 - oneTeamPct / 100, 32)) * 100, 0.02, 1.0)
      : oneTeamPct;
    return {
      key: anyTeamLanguage ? "nfl_any_team_17_0_regular" : "nfl_team_17_0_regular",
      seasonProbabilityPct,
      assumptions: [
        "17-0 regular seasons are historically extremely rare in a 17-game slate.",
        "Baseline event model used with time-horizon adjustment.",
      ],
    };
  }

  if (/\b(rookie\s+qb|rookie\s+quarterback)\b/.test(p) && /\bstart(s|ing)?\b/.test(p)) {
    const match = p.match(/\bstart(?:s|ing)?\s+(\d{1,2})\s+games?\b/);
    const starts = match ? Number(match[1]) : 10;
    const base = starts >= 12 ? 48 : starts >= 10 ? 60 : starts >= 8 ? 68 : 75;
    return {
      key: `nfl_any_rookie_qb_starts_${Number.isFinite(starts) ? starts : 10}`,
      seasonProbabilityPct: clamp(base, 5, 90),
      assumptions: [
        "Rookie QB starts modeled from recent league starter turnover and injury volatility.",
        "Deterministic cohort baseline used for rookie starter counts.",
      ],
    };
  }

  if (
    (/\b1500\b/.test(p) && /\byard\b/.test(p) && /\b(rusher|rushing|rb|running back)\b/.test(p)) ||
    (/\b1500\b/.test(p) && /\b(rushing\s+)?yards?\b/.test(p) && /\b(rusher|rush|rushing|rb|running back)\b/.test(p))
  ) {
    return {
      key: "nfl_any_rusher_1500",
      seasonProbabilityPct: 55.0,
      assumptions: [
        "Historical tail rate for 1,500+ rushing yards modeled across lead backs.",
        "Deterministic cohort baseline used for any-rusher threshold.",
      ],
    };
  }

  if (/\bunderdog\b/.test(p) && /\bplayoff\b/.test(p) && /\bwin\b/.test(p)) {
    return {
      key: "nfl_playoff_underdog_win",
      seasonProbabilityPct: 85.0,
      assumptions: [
        "Historical playoff upset rate baseline for underdogs.",
        "Deterministic frequency model with postseason variance.",
      ],
    };
  }

  if (/\b0-17\b/.test(p) && (hasNflSeasonContext || hasSeasonContext || anyTeamLanguage)) {
    const oneTeamPct = 1.1;
    const seasonProbabilityPct = anyTeamLanguage
      ? clamp((1 - Math.pow(1 - oneTeamPct / 100, 32)) * 100, 0.1, 15)
      : oneTeamPct;
    return {
      key: anyTeamLanguage ? "nfl_any_team_0_17_regular" : "nfl_team_0_17_regular",
      seasonProbabilityPct,
      assumptions: [
        "Bottom-tail season outcomes are uncommon but more frequent than perfect seasons.",
        "Baseline event model used with time-horizon adjustment.",
      ],
    };
  }

  const recordEvent = parseTeamRecordEvent(p);
  if (recordEvent) {
    const pct = teamRecordSeasonPct(recordEvent.wins, recordEvent.anyTeamLanguage);
    return {
      key: recordEvent.anyTeamLanguage
        ? `nfl_any_team_${recordEvent.wins}_${recordEvent.losses}_regular`
        : `nfl_team_${recordEvent.wins}_${recordEvent.losses}_regular`,
      seasonProbabilityPct: pct,
      assumptions: [
        recordEvent.anyTeamLanguage
          ? `Estimated chance at least one NFL team finishes exactly ${recordEvent.wins}-${recordEvent.losses}.`
          : `Estimated chance a specific NFL team finishes exactly ${recordEvent.wins}-${recordEvent.losses}.`,
        "Deterministic parity-distribution model for 17-game records.",
      ],
    };
  }

  return null;
}

export function buildBaselineEstimate(prompt, intent, asOfDate) {
  const event = detectBaselineEvent(prompt);
  if (!event) return null;

  const probabilityPct = horizonAdjustedProbability(event.seasonProbabilityPct, intent?.horizon || "unspecified");
  return {
    status: "ok",
    odds: toAmericanOdds(probabilityPct),
    impliedProbability: `${probabilityPct.toFixed(1)}%`,
    confidence: "High",
    assumptions: event.assumptions,
    playerName: null,
    headshotUrl: null,
    summaryLabel: String(prompt || "").trim(),
    liveChecked: false,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "historical_model",
    sourceLabel: `Baseline event model (${event.key})`,
    trace: {
      baselineEventKey: event.key,
      seasonProbabilityPct: event.seasonProbabilityPct,
      horizon: intent?.horizon || "unspecified",
    },
  };
}

function poissonTailAtLeast(lambda, threshold) {
  const k = Math.max(0, Math.floor(threshold));
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  // Sum P(X = 0..k-1), then tail = 1 - CDF(k-1)
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i += 1) {
    term = (term * lambda) / i;
    cdf += term;
  }
  return clamp(1 - cdf, 0, 1);
}

function negativeBinomialTailAtLeast(mean, dispersionK, threshold) {
  const k = clamp(Number(dispersionK) || 5, 0.8, 40);
  const mu = clamp(Number(mean) || 0, 0.01, 200);
  const t = Math.max(0, Math.floor(threshold));
  const p = k / (k + mu);
  const q = 1 - p;
  let pmf = Math.pow(p, k); // x = 0
  let cdf = pmf;
  for (let x = 1; x < t; x += 1) {
    pmf = pmf * ((x + k - 1) / x) * q;
    cdf += pmf;
    if (pmf < 1e-14) break;
  }
  return clamp(1 - cdf, 0, 1);
}

function normalCdf(x) {
  const z = Number(x);
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const poly = (((((1.330274429 * t - 1.821255978) * t) + 1.781477937) * t - 0.356563782) * t + 0.31938153) * t;
  const cdfPos = 1 - d * poly;
  return z >= 0 ? cdfPos : 1 - cdfPos;
}

function normalTailAtLeast(mean, sigma, threshold) {
  const mu = Number(mean) || 0;
  const sd = Math.max(0.8, Number(sigma) || 1);
  return clamp(1 - normalCdf((threshold - 0.5 - mu) / sd), 0, 1);
}

export function parseSeasonStatIntent(prompt) {
  const p = String(prompt || "").toLowerCase();
  const seasonLike = /\b(this year|this season|next year|next season|in \d{4}|season|nfl)\b/.test(p);
  const gameLike = /\b(single\s+game|in\s+a\s+game|in\s+one\s+game|in\s+a\s+single\s+game|single-game)\b/.test(p);
  const careerLike = /\b(career|ever|all[- ]time|by end of|before (?:he|she|they) retire|before (?:he|she|they) retires|lifetime)\b/.test(
    p
  );
  if (careerLike && !seasonLike && !gameLike) return null;
  if (!seasonLike && !gameLike) return null;
  const scope = gameLike ? "game" : "season";
  const normalized = p
    .replace(/,/g, "")
    .replace(/\brushers?\s+for\b/g, "rushes for")
    .replace(/\brushesr?\s+for\b/g, "rushes for")
    .replace(/\brec(?:eiv|iev)ing\b/g, "receiving")
    .replace(/\brec\b(?=\s*(?:yards?|yds?)\b)/g, "receiving")
    .replace(/\brec\s+yds?\b/g, "receiving yards")
    .replace(/\breception\b/g, "receptions")
    .replace(/\btotal\s+td\b/g, "total touchdowns")
    .replace(/\btotal\s+tds\b/g, "total touchdowns");

  const passing = normalized.match(
    /\bthrows?\s+(?:for\s+)?(\d{1,4})\+?\s+(passing\s+yards?|passing\s+tds?|passing\s+touchdowns?|yards?|yds?|interceptions?|ints?|picks?|tds?|touchdowns?)\b/
  );
  if (passing) {
    const threshold = Number(passing[1]);
    const metricWord = passing[2] || "";
    if (!Number.isFinite(threshold) || threshold < 1) return null;
    if (/\byards?|yds?\b/.test(metricWord)) return { metric: "passing_yards", threshold, scope };
    return { metric: /\bint|interception|pick\b/.test(metricWord) ? "passing_interceptions" : "passing_tds", threshold, scope };
  }
  const qbYards = normalized.match(/\b(\d{3,4})\+?\s+yards?\b/);
  if (qbYards && /\b(qb|quarterback|passing)\b/.test(normalized)) {
    const threshold = Number(qbYards[1]);
    if (Number.isFinite(threshold) && threshold >= 200) return { metric: "passing_yards", threshold, scope };
  }
  const qbTds = normalized.match(/\b(\d{1,2})\+?\s+tds?\b/);
  if (qbTds && /\b(qb|quarterback|passing)\b/.test(normalized)) {
    const threshold = Number(qbTds[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "passing_tds", threshold, scope };
  }

  const receivingTds = normalized.match(
    /\b(?:catches?|receives?|gets?|has|scores?|scored)\s+(?:for\s+)?(\d{1,2})\+?\s+(receiving\s+)?(tds?|touchdowns?)\b/
  );
  if (receivingTds) {
    const threshold = Number(receivingTds[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "receiving_tds", threshold, scope };
  }

  const rushingTds = normalized.match(
    /\b(?:rush(?:es|ing|ed)?|runs?)\s+(?:for\s+)?(\d{1,2})\+?\s+(rushing\s+)?(tds?|touchdowns?)\b/
  );
  if (rushingTds) {
    const threshold = Number(rushingTds[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "rushing_tds", threshold, scope };
  }
  const rushingTdsGets = normalized.match(
    /\b(?:gets?|has|records?|scores?|scored)\s+(\d{1,2})\+?\s+rushing\s+(tds?|touchdowns?)\b/
  );
  if (rushingTdsGets) {
    const threshold = Number(rushingTdsGets[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "rushing_tds", threshold, scope };
  }
  const rushingTdsCompact = normalized.match(/\b(\d{1,2})\+?\s+rushing\s+(tds?|touchdowns?)\b/);
  if (rushingTdsCompact) {
    const threshold = Number(rushingTdsCompact[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "rushing_tds", threshold, scope };
  }

  const receivingTdsCompact = normalized.match(/\b(\d{1,2})\+?\s+receiving\s+(tds?|touchdowns?)\b/);
  if (receivingTdsCompact) {
    const threshold = Number(receivingTdsCompact[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "receiving_tds", threshold, scope };
  }

  const totalTds =
    normalized.match(
      /\b(?:gets?|has|records?|scores?|scored|posts?|puts up)\s+(\d{1,2})\+?\s+(?:total\s+)?(tds?|touchdowns?)\b/
    ) ||
    normalized.match(/\b(\d{1,2})\+?\s+(?:total\s+)?(tds?|touchdowns?)\b/);
  if (totalTds) {
    const threshold = Number(totalTds[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "total_tds", threshold, scope };
  }
  const bareTds = normalized.match(/\b(\d{1,2})\+?\s+tds?\b/);
  if (bareTds && !/\bpassing\b/.test(normalized) && !/\brushing\b/.test(normalized) && !/\breceiving\b/.test(normalized)) {
    const threshold = Number(bareTds[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "total_tds", threshold, scope };
  }

  const receivingYards =
    normalized.match(/\b(?:for|gets?|has|records?)\s+(\d{2,4})\+?\s+(receiving\s+)?(yards?|yds?)\b/) ||
    normalized.match(/\b(\d{2,4})\+?\s+(receiving\s+)?(yards?|yds?)\b/);
  if (receivingYards && /\b(receiv\w*|catch\w*|rec)\b/.test(normalized)) {
    const threshold = Number(receivingYards[1]);
    if (Number.isFinite(threshold) && threshold >= 10) return { metric: "receiving_yards", threshold, scope };
  }

  const rushingYards = normalized.match(
    /\b(?:rush(?:es|ing|ed)?|runs?)\s+(?:for\s+)?(\d{2,4})\+?\s+(yards?|yds?)\b/
  );
  if (rushingYards) {
    const threshold = Number(rushingYards[1]);
    if (Number.isFinite(threshold) && threshold >= 10) return { metric: "rushing_yards", threshold, scope };
  }
  const rushingYardsCompact = normalized.match(/\b(\d{2,4})\+?\s+rush(?:ing)?\b/);
  if (rushingYardsCompact) {
    const threshold = Number(rushingYardsCompact[1]);
    if (Number.isFinite(threshold) && threshold >= 10) return { metric: "rushing_yards", threshold, scope };
  }
  const rushingYardsGets = normalized.match(
    /\b(?:gets?|has|records?|posts?|puts up)\s+(\d{2,4})\+?\s+rushing\s+(yards?|yds?)\b/
  );
  if (rushingYardsGets) {
    const threshold = Number(rushingYardsGets[1]);
    if (Number.isFinite(threshold) && threshold >= 10) return { metric: "rushing_yards", threshold, scope };
  }

  const scrimmageYards = normalized.match(
    /\b(?:gets?|has|records?|posts?|puts up)\s+(\d{2,4})\+?\s+(scrimmage|from scrimmage)\s+(yards?|yds?)\b/
  );
  if (scrimmageYards) {
    const threshold = Number(scrimmageYards[1]);
    if (Number.isFinite(threshold) && threshold >= 50) return { metric: "scrimmage_yards", threshold, scope };
  }

  const receptions = normalized.match(
    /\b(?:catches?|gets?|has|records?)\s+(\d{2,3})\+?\s+(receptions?|catches?)\b/
  );
  if (receptions) {
    const threshold = Number(receptions[1]);
    if (Number.isFinite(threshold) && threshold >= 5) return { metric: "receptions", threshold, scope };
  }

  return null;
}

function tierFromName(name) {
  const n = String(name || "").toLowerCase();
  if (["patrick mahomes", "josh allen", "joe burrow", "lamar jackson"].includes(n)) return "elite";
  if (["jalen hurts", "justin herbert", "cj stroud"].includes(n)) return "high";
  if (["drake maye", "caleb williams", "jayden daniels"].includes(n)) return "young";
  return "default";
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let qbSeasonData = null;
let skillSeasonData = null;

function loadQbSeasonData() {
  if (qbSeasonData) return qbSeasonData;
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const jsonPath = path.resolve(__dirname, "..", "data", "qb_season_stats.json");
    const raw = fs.readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(raw);
    qbSeasonData = parsed && parsed.players ? parsed : null;
  } catch {
    qbSeasonData = null;
  }
  return qbSeasonData;
}

function loadSkillSeasonData() {
  if (skillSeasonData) return skillSeasonData;
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const jsonPath = path.resolve(__dirname, "..", "data", "skill_position_season_stats.json");
    const raw = fs.readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(raw);
    skillSeasonData = parsed && parsed.players ? parsed : null;
  } catch {
    skillSeasonData = null;
  }
  return skillSeasonData;
}

function getSkillPlayerSeasons(profile) {
  const dataset = loadSkillSeasonData();
  if (!dataset?.players) return [];
  const key = normalizeName(profile?.name || "");
  const row = dataset.players[key];
  if (!row?.seasons?.length) return [];
  return row.seasons
    .map((s) => ({
      ...s,
      scrimmage_yards: Number(s?.rushing_yards || 0) + Number(s?.receiving_yards || 0),
    }))
    .filter((s) => Number(s.games || 0) >= 6);
}

function positionGroup(position) {
  const p = String(position || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (p === "QB") return "qb";
  if (p === "RB" || p === "FB") return "rb";
  if (p === "WR") return "wr";
  if (p === "TE") return "te";
  return "other";
}

function isKnownQbName(name) {
  const dataset = loadQbSeasonData();
  if (!dataset?.players) return false;
  const key = normalizeName(name || "");
  return Boolean(dataset.players[key]);
}

function weightedRecentMean(seasons, metricKey) {
  if (!Array.isArray(seasons) || !seasons.length) return null;
  const weights = [0.52, 0.30, 0.18];
  let num = 0;
  let den = 0;
  for (let i = 0; i < Math.min(3, seasons.length); i += 1) {
    const w = weights[i] || 0.1;
    const v = Number(seasons[i]?.[metricKey] || 0);
    num += w * v;
    den += w;
  }
  if (!den) return null;
  return num / den;
}

function buildPlayerSeasonLambda(profile, metric, calibration, asOfDate) {
  const model = calibration?.performance?.seasonStatModel || {};
  const tier = tierFromName(profile?.name || "");
  const intMeans = model.passingInterceptionsMean || { elite: 9, high: 10.5, young: 12.5, default: 11 };
  // Retuned to 2025-26-friendly scoring environment with starter-centric priors.
  const tdMeans = model.passingTdsMean || { elite: 33, high: 28, young: 22, default: 24 };
  const yardsMeans = model.passingYardsMean || { elite: 4650, high: 4250, young: 3650, default: 3900 };
  const fallback = metric === "passing_interceptions"
    ? Number(intMeans[tier] ?? intMeans.default ?? 11)
    : metric === "passing_yards"
      ? Number(yardsMeans[tier] ?? yardsMeans.default ?? 3900)
      : Number(tdMeans[tier] ?? tdMeans.default ?? 27);

  const dataset = loadQbSeasonData();
  const yearsExp = Number(profile?.yearsExp || 0);
  const experienceStarterFactor = (() => {
    if (!Number.isFinite(yearsExp)) return 0.9;
    if (yearsExp <= 0) return 0.72;
    if (yearsExp === 1) return 0.82;
    if (yearsExp === 2) return 0.92;
    return 1;
  })();

  if (!dataset?.players) {
    return {
      lambda: clamp(fallback * experienceStarterFactor, 0.8, 75),
      modelType: "tier_fallback",
      sampleSeasons: 0,
      staleYears: 0,
      yearsExp,
    };
  }

  const key = normalizeName(profile?.name || "");
  const row = dataset.players[key];
  if (!row?.seasons?.length) {
    return {
      lambda: clamp(fallback * experienceStarterFactor, 0.8, 75),
      modelType: "tier_fallback",
      sampleSeasons: 0,
      staleYears: 0,
      yearsExp,
    };
  }

  const metricKey = metric === "passing_interceptions" ? "passingInts" : "passingTds";
  const valid = row.seasons.filter(
    (s) =>
      Number.isFinite(Number(s?.[metricKey])) &&
      Number.isFinite(Number(s?.passingAttempts)) &&
      Number(s.passingAttempts) >= 120
  );
  if (!valid.length) {
    return {
      lambda: clamp(fallback * experienceStarterFactor, 0.8, 75),
      modelType: "tier_fallback",
      sampleSeasons: 0,
      staleYears: 0,
      yearsExp,
    };
  }

  const recent = weightedRecentMean(valid, metricKey);
  const longRunMean = valid.reduce((acc, s) => acc + Number(s[metricKey] || 0), 0) / valid.length;
  const recentAttempts = Number(valid[0]?.passingAttempts || 0);
  const recentGames = Number(valid[0]?.games || 0);
  const starterFactor = clamp(0.68 + recentAttempts / 760 + recentGames / 45, 0.80, 1.10);
  const reliabilityBase = clamp(0.16 + valid.length * 0.10 + recentAttempts / 2600, 0.22, 0.76);
  const asOfYear = Number(String(asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 4));
  const latestSeason = Number(dataset.latestSeason || valid[0]?.season || asOfYear - 1);
  const staleYears = Math.max(0, asOfYear - latestSeason - 1);
  const reliability = clamp(reliabilityBase * (staleYears >= 1 ? 0.82 : 1), 0.18, 0.76);
  const playerSignal = clamp(((recent ?? longRunMean) * 0.72 + longRunMean * 0.28) * starterFactor, 1, 70);
  let lambda = clamp(playerSignal * reliability + fallback * (1 - reliability), 0.8, 75);
  if (metric === "passing_yards") {
    const recentAttempts = Number(valid[0]?.passingAttempts || 0);
    const recentGames = Number(valid[0]?.games || 0);
    const attPerGame = recentGames > 0 ? recentAttempts / recentGames : 31.5;
    const projectedAttempts = clamp(attPerGame * 16.5, 380, 690);
    const ypaByTier = { elite: 7.5, high: 7.2, young: 6.9, default: 7.0 };
    const ypa = ypaByTier[tier] ?? ypaByTier.default;
    const yardsFromAttempts = projectedAttempts * ypa;
    lambda = clamp(yardsFromAttempts * reliability + fallback * (1 - reliability), 2100, 5600);
    return {
      lambda,
      modelType: "player_history_blended",
      sampleSeasons: valid.length,
      recentAttempts,
      recentGames,
      reliability,
      staleYears,
      yearsExp,
    };
  }
  if (metric === "passing_tds" && yearsExp <= 2) lambda *= 1.07;
  if (metric === "passing_interceptions" && yearsExp <= 2) lambda *= 1.08;
  lambda = clamp(lambda, 0.8, 75);

  return {
    lambda,
    modelType: "player_history_blended",
    sampleSeasons: valid.length,
    recentAttempts,
    recentGames,
    reliability,
    staleYears,
    yearsExp,
  };
}

function skillFallbackMean(metric, posGroup) {
  const table = {
    rushing_yards: { rb: 760, wr: 95, te: 15, qb: 240, other: 40 },
    rushing_tds: { rb: 5.8, wr: 0.7, te: 0.3, qb: 2.2, other: 0.4 },
    receiving_yards: { rb: 370, wr: 840, te: 620, qb: 5, other: 120 },
    receiving_tds: { rb: 2.4, wr: 5.5, te: 4.8, qb: 0.03, other: 0.8 },
    receptions: { rb: 38, wr: 62, te: 54, qb: 0.1, other: 12 },
    scrimmage_yards: { rb: 1120, wr: 920, te: 640, qb: 250, other: 180 },
    total_tds: { rb: 8.4, wr: 6.3, te: 4.9, qb: 2.3, other: 1.8 },
  };
  const byPos = table[metric] || {};
  return Number(byPos[posGroup] ?? byPos.other ?? 25);
}

function buildSkillSeasonLambda(profile, metric, asOfDate) {
  const posGroup = positionGroup(profile?.position);
  const fallback = skillFallbackMean(metric, posGroup);
  const dataset = loadSkillSeasonData();
  if (!dataset?.players) {
    return { lambda: fallback, modelType: "skill_fallback", sampleSeasons: 0, staleYears: 0, posGroup };
  }
  const key = normalizeName(profile?.name || "");
  const row = dataset.players[key];
  if (!row?.seasons?.length) {
    return { lambda: fallback, modelType: "skill_fallback", sampleSeasons: 0, staleYears: 0, posGroup };
  }

  const withScrimmage = row.seasons.map((s) => ({
    ...s,
    scrimmage_yards: Number(s?.rushing_yards || 0) + Number(s?.receiving_yards || 0),
    total_tds: Number(s?.rushing_tds || 0) + Number(s?.receiving_tds || 0),
  }));
  const valid = withScrimmage.filter((s) => Number.isFinite(Number(s?.[metric])) && Number(s.games || 0) >= 6);
  if (!valid.length) {
    return { lambda: fallback, modelType: "skill_fallback", sampleSeasons: 0, staleYears: 0, posGroup };
  }

  const recent = weightedRecentMean(valid, metric);
  const longRunMean = valid.reduce((acc, s) => acc + Number(s[metric] || 0), 0) / valid.length;
  const recentGames = Number(valid[0]?.games || 0);
  const durabilityFactor = clamp(0.84 + recentGames / 60, 0.84, 1.10);
  const reliabilityBase = clamp(0.20 + valid.length * 0.10 + recentGames / 220, 0.24, 0.78);
  const asOfYear = Number(String(asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 4));
  const latestSeason = Number(dataset.latestSeason || valid[0]?.season || asOfYear - 1);
  const staleYears = Math.max(0, asOfYear - latestSeason - 1);
  const reliability = clamp(reliabilityBase * (staleYears >= 1 ? 0.92 : 1), 0.2, 0.84);

  let lambda = clamp((((recent ?? longRunMean) * 0.7 + longRunMean * 0.3) * durabilityFactor), 0.02, 3000);
  lambda = clamp(lambda * reliability + fallback * (1 - reliability), 0.02, 3000);

  // Generic breakout trend carry-forward: reward recent upward trajectory for skill players.
  if (
    ["receiving_yards", "receptions", "receiving_tds", "rushing_yards", "scrimmage_yards", "rushing_tds", "total_tds"].includes(metric) &&
    valid.length >= 2 &&
    ["wr", "rb", "te"].includes(posGroup)
  ) {
    const latest = Number(valid[0]?.[metric]);
    const prior = Number(valid[1]?.[metric]);
    const latestGames = Number(valid[0]?.games || 0);
    if (Number.isFinite(latest) && Number.isFinite(prior) && prior > 0 && latest > prior && latestGames >= 12) {
      const growth = (latest - prior) / prior;
      const trendBoost = 1 + clamp(growth * 0.24, 0, 0.14);
      lambda = clamp(lambda * trendBoost, 0.02, 3000);
    }
  }

  return {
    lambda,
    modelType: "skill_history_blended",
    sampleSeasons: valid.length,
    recentGames,
    reliability,
    staleYears,
    posGroup,
  };
}

export function buildPlayerSeasonStatEstimate(prompt, intent, profile, asOfDate, calibration = {}) {
  const parsed = parseSeasonStatIntent(prompt);
  if (!parsed || !profile) return null;
  const pos = String(profile.position || "").toUpperCase().replace(/[^A-Z]/g, "");
  const isQb = pos === "QB" || isKnownQbName(profile?.name);
  const scope = parsed.scope || "season";

  const qbOnlyMetric = ["passing_tds", "passing_interceptions", "passing_yards"].includes(parsed.metric);
  if (qbOnlyMetric && !isQb) {
    return {
      status: "ok",
      odds: "+100000",
      impliedProbability: "0.1%",
      confidence: "High",
      assumptions: ["Passing-season thresholds apply only to quarterbacks."],
      playerName: profile.name || null,
      headshotUrl: null,
      summaryLabel: `${profile.name} season stat threshold`,
      liveChecked: false,
      asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
      sourceType: "historical_model",
      sourceLabel: "Position constraint model",
      trace: { statMetric: parsed.metric, threshold: parsed.threshold },
    };
  }

  const modelInput = qbOnlyMetric
    ? buildPlayerSeasonLambda(profile, parsed.metric, calibration, asOfDate)
    : buildSkillSeasonLambda(profile, parsed.metric, asOfDate);
  let lambda = modelInput.lambda;
  if (parsed.metric === "rushing_yards" && isQb && modelInput.modelType === "skill_fallback" && lambda < 100) {
    lambda = 240;
  }

  if (scope === "game") {
    const games = 17;
    const perGameMean = clamp(lambda / games, 0.05, 900);
    let tailProb = 0;
    if (["passing_tds", "passing_interceptions", "rushing_tds", "receiving_tds", "total_tds"].includes(parsed.metric)) {
      tailProb = poissonTailAtLeast(perGameMean, parsed.threshold);
    } else {
      const sigma =
        parsed.metric === "passing_yards"
          ? clamp(perGameMean * 0.38 + 18, 22, 140)
          : parsed.metric === "rushing_yards"
            ? clamp(perGameMean * 0.55 + 12, 15, 90)
            : parsed.metric === "receiving_yards"
              ? clamp(perGameMean * 0.6 + 12, 15, 95)
              : clamp(perGameMean * 0.5 + 15, 18, 110);
      tailProb = normalTailAtLeast(perGameMean, sigma, parsed.threshold);
    }
    const probabilityPct = clamp(tailProb * 100, 0.01, 99.9);
    return {
      status: "ok",
      odds: toAmericanOdds(probabilityPct),
      impliedProbability: `${probabilityPct.toFixed(1)}%`,
      confidence: modelInput.sampleSeasons === 0 ? "Low" : "Medium",
      assumptions: [
        "Single-game threshold modeled from per-game rate distribution.",
        "Season-long usage rate scaled to per-game mean for the tail estimate.",
      ],
      playerName: profile.name || null,
      headshotUrl: null,
      summaryLabel: `${profile.name} ${parsed.metric.replace(/_/g, " ")} ${parsed.threshold} (single game)`,
      liveChecked: false,
      asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
      sourceType: "historical_model",
      sourceLabel: "Single-game stat model",
      trace: { statMetric: parsed.metric, threshold: parsed.threshold, scope: "game" },
    };
  }

  let dispersion = 6.2;
  if (modelInput.sampleSeasons <= 1) dispersion = 3.8;
  else if (modelInput.sampleSeasons === 2) dispersion = 4.8;
  if (modelInput.staleYears >= 1) dispersion -= 0.8;
  if (parsed.metric === "passing_interceptions") dispersion += 1.6;
  if (["rushing_tds", "receiving_tds", "total_tds"].includes(parsed.metric)) dispersion += 0.5;
  if (["rushing_yards", "receiving_yards", "receptions"].includes(parsed.metric)) dispersion += 1.4;
  if (parsed.metric === "passing_yards") dispersion += 9.5;
  const variance = lambda + (lambda * lambda) / Math.max(0.8, dispersion);
  const sigma = Math.sqrt(Math.max(1, variance));
  let tailProb = parsed.threshold >= 120 || lambda >= 120
    ? normalTailAtLeast(lambda, sigma, parsed.threshold)
    : negativeBinomialTailAtLeast(lambda, dispersion, parsed.threshold);

  if (parsed.metric === "passing_tds") {
    // QB passing TDs need tighter tails than generic NB; this keeps 45-50 TD seasons rare.
    const qbSigma = clamp(4.6 + lambda * 0.14, 6.0, 10.2);
    tailProb = normalTailAtLeast(lambda, qbSigma, parsed.threshold);
    const tier = tierFromName(profile?.name || "");
    const capByThreshold = (threshold) => {
      if (threshold >= 50) return { elite: 1.9, high: 1.4, young: 1.2, default: 0.9 }[tier] || 0.9;
      if (threshold >= 45) return { elite: 8.0, high: 6.2, young: 5.1, default: 4.2 }[tier] || 4.2;
      if (threshold >= 40) return { elite: 25.0, high: 20.0, young: 17.0, default: 14.0 }[tier] || 14.0;
      return 100;
    };
    tailProb = Math.min(tailProb, capByThreshold(parsed.threshold) / 100);
    const floorByThreshold = (threshold) => {
      if (threshold >= 50) return { elite: 1.8, high: 1.5, young: 1.5, default: 0.9 }[tier] || 0.9;
      return 0;
    };
    tailProb = Math.max(tailProb, floorByThreshold(parsed.threshold) / 100);

    const starterSignal = clamp(
      (Number(modelInput.recentAttempts || 0) / 520) + (Number(modelInput.recentGames || 0) / 19),
      0,
      1.2
    );
    const hasRealStarterSample = Number(modelInput.sampleSeasons || 0) >= 1 && Number(modelInput.recentAttempts || 0) >= 320;
    const exp = Number(modelInput.yearsExp || 0);
    if (parsed.threshold <= 20 && hasRealStarterSample && starterSignal >= 0.75 && exp >= 2) {
      const boost = clamp(1.03 + (starterSignal - 0.75) * 0.09, 1.01, 1.12);
      tailProb = clamp(tailProb * boost, 0, 0.985);
    }
    if (parsed.threshold <= 15 && hasRealStarterSample && starterSignal >= 0.75 && exp >= 2) {
      tailProb = clamp(tailProb * 1.05, 0, 0.992);
    }
  }
  let probabilityPct = clamp(tailProb * 100, 0.01, 99.9);
  if (parsed.metric === "passing_tds" && parsed.threshold <= 10) {
    probabilityPct = Math.max(probabilityPct, 99.9);
  }
  if (parsed.metric === "passing_tds" && parsed.threshold <= 5) {
    probabilityPct = Math.max(probabilityPct, 99.95);
  }
  if (parsed.metric === "passing_yards") {
    const yardsSigma = clamp(360 + lambda * 0.08, 340, 900);
    tailProb = normalTailAtLeast(lambda, yardsSigma, parsed.threshold);
    probabilityPct = clamp(tailProb * 100, 0.01, 99.9);
  }
  if (parsed.metric === "rushing_yards" && isQb && parsed.threshold >= 600) {
    const floor =
      parsed.threshold >= 1000 ? 0.2 :
      parsed.threshold >= 900 ? 0.25 :
      parsed.threshold >= 800 ? 0.3 :
      0.35;
    probabilityPct = Math.max(probabilityPct, floor);
  }
  if (["receiving_yards", "rushing_yards", "receptions", "scrimmage_yards", "rushing_tds", "receiving_tds", "total_tds"].includes(parsed.metric)) {
    const seasons = getSkillPlayerSeasons(profile);
    if (seasons.length >= 2) {
      const vals = seasons
        .map((s) => Number(s?.[parsed.metric]))
        .filter((v) => Number.isFinite(v));
      if (vals.length >= 2) {
        const hits = vals.filter((v) => v >= parsed.threshold).length;
        const near = vals.filter((v) => v >= parsed.threshold * 0.9).length;
        const empiricalHitPct = (hits / vals.length) * 100;
        const empiricalNearPct = (near / vals.length) * 100;
        const sampleWeight = clamp(vals.length / 8, 0.2, 0.65);
        const nearFloorPct = clamp(empiricalNearPct * 0.62, 0, 95);
        const blended = probabilityPct * (1 - sampleWeight) + empiricalHitPct * sampleWeight;
        probabilityPct = clamp(Math.max(blended, nearFloorPct), 0.01, 99.9);
      }
    }
    const recent = seasons[0] || null;
    if (recent && Number(recent.games || 0) >= 12) {
      const recentValue = Number(recent?.[parsed.metric] || 0);
      if (Number.isFinite(recentValue) && recentValue > 0 && parsed.threshold > 0) {
        // Generic breakout carry-forward floor: if a player recently cleared a threshold by a lot,
        // keep that threshold meaningfully favored unless explicit negative context exists.
        const ratio = recentValue / parsed.threshold;
        if (ratio >= 1) {
          const durabilityBoost = Number(recent.games || 0) >= 15 ? 8 : 4;
          const floor = clamp(45 + (ratio - 1) * 120 + durabilityBoost, 45, 92);
          probabilityPct = Math.max(probabilityPct, floor);
        }
      }
    }
  }

  const confidence = Number(modelInput.sampleSeasons || 0) === 0 ? "Low" : "High";
  return {
    status: "ok",
    odds: toAmericanOdds(probabilityPct),
    impliedProbability: `${probabilityPct.toFixed(1)}%`,
    confidence,
    assumptions: [
      "Used a deterministic season-volume model with a calibrated negative-binomial tail (not LLM guessing).",
      modelInput.modelType === "player_history_blended"
        ? "Blended player trendline with league-era priors, then adjusted for expected snaps/dropbacks and game availability."
        : modelInput.modelType === "skill_history_blended"
          ? "Weighted recent rushing/receiving efficiency, role share, and position-level distribution to price the threshold."
        : "Limited sample fallback: tier prior + role-based usage baseline + era scoring environment adjustment.",
    ],
    playerName: profile.name || null,
    headshotUrl: null,
    summaryLabel: `${profile.name} ${parsed.metric.replace(/_/g, " ")} ${parsed.threshold}`,
    liveChecked: false,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "historical_model",
    sourceLabel: "Season stat baseline model",
    trace: {
      statMetric: parsed.metric,
      threshold: parsed.threshold,
      lambda,
      modelType: modelInput.modelType,
      sampleSeasons: modelInput.sampleSeasons,
      recentAttempts: modelInput.recentAttempts,
      recentGames: modelInput.recentGames,
      reliability: modelInput.reliability,
      staleYears: modelInput.staleYears,
      dispersion,
    },
  };
}
