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
  const seasonLike = /\b(this year|this season|next year|next season|in \d{4}|season)\b/.test(p);
  if (!seasonLike) return null;
  if (!/\b(a|any)\s+(quarterback|qb)\b/.test(p)) return null;
  const m = p.match(/\bthrows?\s+(?:for\s+)?(\d{1,2})\s+(tds?|touchdowns?|ints?|interceptions?|picks?)\b/);
  if (!m) return null;
  const threshold = Number(m[1]);
  if (!Number.isFinite(threshold) || threshold < 1) return null;
  const metricWord = m[2] || "";
  const metric = /\bint|interception|pick\b/.test(metricWord) ? "passing_interceptions" : "passing_tds";
  return { threshold, metric };
}

function genericQbAnyHitsTdThresholdSeasonPct(threshold) {
  // Probability at least one NFL QB reaches threshold in a season (coarse baseline).
  if (threshold <= 15) return 99.8;
  if (threshold <= 20) return 99.2;
  if (threshold <= 25) return 96.5;
  if (threshold <= 30) return 86.0;
  if (threshold <= 35) return 62.0;
  if (threshold <= 40) return 34.0;
  if (threshold <= 45) return 13.0;
  if (threshold <= 50) return 3.5;
  if (threshold <= 55) return 0.8;
  return 0.2;
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

export function detectBaselineEvent(prompt) {
  const p = String(prompt || "").toLowerCase();

  const genericQbTd = parseGenericQbSeasonThreshold(p);
  if (genericQbTd) {
    const metric = genericQbTd.metric || "passing_tds";
    const seasonProbabilityPct = metric === "passing_interceptions"
      ? genericQbAnyHitsIntThresholdSeasonPct(genericQbTd.threshold)
      : genericQbAnyHitsTdThresholdSeasonPct(genericQbTd.threshold);
    return {
      key: metric === "passing_interceptions"
        ? "nfl_any_qb_passing_int_threshold"
        : "nfl_any_qb_passing_td_threshold",
      seasonProbabilityPct,
      assumptions: [
        `Historical NFL passing environment baseline for any-QB season ${metric === "passing_interceptions" ? "INT" : "TD"} threshold.`,
        "Deterministic threshold model used for generic QB prompts.",
      ],
    };
  }

  // Rare-event library can be expanded over time.
  const hasNflSeasonContext = /\bnfl\b/.test(p) || /\b(0-17|17-0)\b/.test(p);
  const hasSeasonContext = /\b(regular season|this nfl season|nfl season|this season|season)\b/.test(p);

  if (/\b17-0\b/.test(p) && hasNflSeasonContext && hasSeasonContext) {
    return {
      key: "nfl_team_17_0_regular",
      seasonProbabilityPct: 0.35,
      assumptions: [
        "NFL parity and schedule strength distribution make 17-0 extremely rare.",
        "Baseline event model used with time-horizon adjustment.",
      ],
    };
  }

  if (/\b0-17\b/.test(p) && hasNflSeasonContext && hasSeasonContext) {
    return {
      key: "nfl_team_0_17_regular",
      seasonProbabilityPct: 1.2,
      assumptions: [
        "Bottom-tail season outcomes are uncommon but more frequent than perfect seasons.",
        "Baseline event model used with time-horizon adjustment.",
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
    summaryLabel: String(prompt || "").slice(0, 42),
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

function parseSeasonStatIntent(prompt) {
  const p = String(prompt || "").toLowerCase();
  const seasonLike = /\b(this year|this season|next year|next season|in \d{4}|season)\b/.test(p);
  if (!seasonLike) return null;
  const normalized = p
    .replace(/\brushers?\s+for\b/g, "rushes for")
    .replace(/\brushesr?\s+for\b/g, "rushes for")
    .replace(/\brec(?:eiv|iev)ing\b/g, "receiving")
    .replace(/\brec\b(?=\s*(?:yards?|yds?)\b)/g, "receiving")
    .replace(/\brec\s+yds?\b/g, "receiving yards")
    .replace(/\breception\b/g, "receptions");

  const passing = normalized.match(/\bthrows?\s+(?:for\s+)?(\d{1,4})\s+(passing\s+yards?|yards?|yds?|interceptions?|ints?|picks?|tds?|touchdowns?)\b/);
  if (passing) {
    const threshold = Number(passing[1]);
    const metricWord = passing[2] || "";
    if (!Number.isFinite(threshold) || threshold < 1) return null;
    if (/\byards?|yds?\b/.test(metricWord)) return { metric: "passing_yards", threshold };
    return { metric: /\bint|interception|pick\b/.test(metricWord) ? "passing_interceptions" : "passing_tds", threshold };
  }

  const receivingTds = normalized.match(/\b(?:catches?|receives?|gets?|has|scores?|scored)\s+(?:for\s+)?(\d{1,2})\s+(receiving\s+)?(tds?|touchdowns?)\b/);
  if (receivingTds) {
    const threshold = Number(receivingTds[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "receiving_tds", threshold };
  }

  const rushingTds = normalized.match(/\b(?:rush(?:es|ing|ed)?|runs?)\s+(?:for\s+)?(\d{1,2})\s+(rushing\s+)?(tds?|touchdowns?)\b/);
  if (rushingTds) {
    const threshold = Number(rushingTds[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "rushing_tds", threshold };
  }
  const rushingTdsGets = normalized.match(/\b(?:gets?|has|records?|scores?|scored)\s+(\d{1,2})\s+rushing\s+(tds?|touchdowns?)\b/);
  if (rushingTdsGets) {
    const threshold = Number(rushingTdsGets[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "rushing_tds", threshold };
  }
  const rushingTdsCompact = normalized.match(/\b(\d{1,2})\s+rushing\s+(tds?|touchdowns?)\b/);
  if (rushingTdsCompact) {
    const threshold = Number(rushingTdsCompact[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "rushing_tds", threshold };
  }

  const receivingTdsCompact = normalized.match(/\b(\d{1,2})\s+receiving\s+(tds?|touchdowns?)\b/);
  if (receivingTdsCompact) {
    const threshold = Number(receivingTdsCompact[1]);
    if (Number.isFinite(threshold) && threshold >= 1) return { metric: "receiving_tds", threshold };
  }

  const receivingYards =
    normalized.match(/\b(?:for|gets?|has|records?)\s+(\d{2,4})\s+(receiving\s+)?(yards?|yds?)\b/) ||
    normalized.match(/\b(\d{2,4})\s+(receiving\s+)?(yards?|yds?)\b/);
  if (receivingYards && /\b(receiv\w*|catch\w*|rec)\b/.test(normalized)) {
    const threshold = Number(receivingYards[1]);
    if (Number.isFinite(threshold) && threshold >= 10) return { metric: "receiving_yards", threshold };
  }

  const rushingYards = normalized.match(/\b(?:rush(?:es|ing|ed)?|runs?)\s+(?:for\s+)?(\d{2,4})\s+(yards?|yds?)\b/);
  if (rushingYards) {
    const threshold = Number(rushingYards[1]);
    if (Number.isFinite(threshold) && threshold >= 10) return { metric: "rushing_yards", threshold };
  }
  const rushingYardsGets = normalized.match(/\b(?:gets?|has|records?|posts?|puts up)\s+(\d{2,4})\s+rushing\s+(yards?|yds?)\b/);
  if (rushingYardsGets) {
    const threshold = Number(rushingYardsGets[1]);
    if (Number.isFinite(threshold) && threshold >= 10) return { metric: "rushing_yards", threshold };
  }

  const scrimmageYards = normalized.match(/\b(?:gets?|has|records?|posts?|puts up)\s+(\d{2,4})\s+(scrimmage|from scrimmage)\s+(yards?|yds?)\b/);
  if (scrimmageYards) {
    const threshold = Number(scrimmageYards[1]);
    if (Number.isFinite(threshold) && threshold >= 50) return { metric: "scrimmage_yards", threshold };
  }

  const receptions = normalized.match(/\b(?:catches?|gets?|has|records?)\s+(\d{2,3})\s+(receptions?|catches?)\b/);
  if (receptions) {
    const threshold = Number(receptions[1]);
    if (Number.isFinite(threshold) && threshold >= 5) return { metric: "receptions", threshold };
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
  const p = String(position || "").toUpperCase();
  if (p === "QB") return "qb";
  if (p === "RB" || p === "FB") return "rb";
  if (p === "WR") return "wr";
  if (p === "TE") return "te";
  return "other";
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
    ["receiving_yards", "receptions", "receiving_tds", "rushing_yards", "scrimmage_yards", "rushing_tds"].includes(metric) &&
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
  const pos = String(profile.position || "").toUpperCase();

  const qbOnlyMetric = ["passing_tds", "passing_interceptions", "passing_yards"].includes(parsed.metric);
  if (qbOnlyMetric && pos !== "QB") {
    return {
      status: "ok",
      odds: "NO CHANCE",
      impliedProbability: "0.0%",
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
  const lambda = modelInput.lambda;

  let dispersion = 6.2;
  if (modelInput.sampleSeasons <= 1) dispersion = 3.8;
  else if (modelInput.sampleSeasons === 2) dispersion = 4.8;
  if (modelInput.staleYears >= 1) dispersion -= 0.8;
  if (parsed.metric === "passing_interceptions") dispersion += 1.6;
  if (["rushing_tds", "receiving_tds"].includes(parsed.metric)) dispersion += 0.5;
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
  if (["receiving_yards", "rushing_yards", "receptions", "scrimmage_yards", "rushing_tds", "receiving_tds"].includes(parsed.metric)) {
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

  return {
    status: "ok",
    odds: toAmericanOdds(probabilityPct),
    impliedProbability: `${probabilityPct.toFixed(1)}%`,
    confidence: "High",
    assumptions: [
      "Deterministic season stat model (negative-binomial tail) used.",
      modelInput.modelType === "player_history_blended"
        ? "Player recent NFL season production was blended with league priors for stability."
        : modelInput.modelType === "skill_history_blended"
          ? "Player recent rushing/receiving seasons were blended with position priors."
        : "Tier-based fallback prior used because player season sample was unavailable.",
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
