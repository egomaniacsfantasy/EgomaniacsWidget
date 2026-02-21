import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildPlayerOutcomes, buildPerformanceThresholdOutcome } from "./engine/outcomes.js";
import { parseIntent } from "./engine/intent.js";
import { buildBaselineEstimate, buildPlayerSeasonStatEstimate } from "./engine/baselines.js";
import { applyConsistencyRules } from "./engine/consistency.js";

const app = express();
const port = process.env.PORT || 3000;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 35000);
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "high";
const OPENAI_REASONING = { effort: OPENAI_REASONING_EFFORT };
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);
const HEADSHOT_TIMEOUT_MS = Number(process.env.HEADSHOT_TIMEOUT_MS || 1800);
const LIVE_CONTEXT_TIMEOUT_MS = Number(process.env.LIVE_CONTEXT_TIMEOUT_MS || 7000);
const LIVE_CONTEXT_ENABLED = String(process.env.LIVE_CONTEXT_ENABLED || "true") === "true";
const SPORTSDB_API_KEY = process.env.SPORTSDB_API_KEY || "3";
const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ODDS_API_BASE = process.env.ODDS_API_BASE || "https://api.the-odds-api.com";
const ODDS_API_REGIONS = process.env.ODDS_API_REGIONS || "us";
const ODDS_API_BOOKMAKERS = process.env.ODDS_API_BOOKMAKERS || "draftkings,fanduel";
const CACHE_VERSION = "v38";
const API_PUBLIC_VERSION = "2026.02.21.4";
const DEFAULT_NFL_SEASON = process.env.DEFAULT_NFL_SEASON || "2025-26";
const oddsCache = new Map();
const PLAYER_STATUS_TIMEOUT_MS = Number(process.env.PLAYER_STATUS_TIMEOUT_MS || 7000);
const NFL_INDEX_TIMEOUT_MS = Number(process.env.NFL_INDEX_TIMEOUT_MS || 12000);
const NFL_INDEX_REFRESH_MS = Number(process.env.NFL_INDEX_REFRESH_MS || 12 * 60 * 60 * 1000);
const LIVE_STATE_REFRESH_MS = Number(process.env.LIVE_STATE_REFRESH_MS || 30 * 60 * 1000);
const LIVE_STATE_TIMEOUT_MS = Number(process.env.LIVE_STATE_TIMEOUT_MS || 9000);
const MONOTONIC_TIMEOUT_MS = Number(process.env.MONOTONIC_TIMEOUT_MS || 5000);
const SPORTSBOOK_REF_CACHE_TTL_MS = Number(process.env.SPORTSBOOK_REF_CACHE_TTL_MS || 10 * 60 * 1000);
const SEMANTIC_CACHE_TTL_MS = Number(process.env.SEMANTIC_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const SLEEPER_NFL_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const PHASE2_CALIBRATION_FILE = process.env.PHASE2_CALIBRATION_FILE || "data/phase2_calibration.json";
const FEATURE_ENABLE_TRACE = String(process.env.FEATURE_ENABLE_TRACE || "true") === "true";
const STRICT_BOOT_SELFTEST = String(process.env.STRICT_BOOT_SELFTEST || "false") === "true";
const execFileAsync = promisify(execFile);
let nflPlayerIndex = new Map();
let nflIndexLoadedAt = 0;
let nflIndexLoadPromise = null;
let liveSportsState = null;
let liveSportsStateLoadedAt = 0;
let liveSportsStatePromise = null;
let oddsApiSports = null;
let oddsApiSportsLoadedAt = 0;
let oddsApiSportsPromise = null;
const sportsbookRefCache = new Map();
const dynamicSportsbookFeedCache = new Map();
const semanticOddsCache = new Map();
let phase2Calibration = null;
let phase2CalibrationLoadedAt = 0;
const metrics = {
  oddsRequests: 0,
  baselineServed: 0,
  sportsbookServed: 0,
  hypotheticalServed: 0,
  quickServed: 0,
  fallbackServed: 0,
  consistencyRepairs: 0,
  anchorMisses: 0,
  parseNormalized: 0,
  refusals: 0,
  snarks: 0,
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REFUSAL_PATTERNS = [
  /\bbest bet\b/i,
  /\bshould i bet\b/i,
  /\bparlay\b/i,
  /\bunits?\b/i,
  /\bwager\b/i,
  /\bplace a bet\b/i,
  /\bover\/?under\b/i,
  /\bspread\b/i,
  /\bmoneyline\b/i,
  /\bbet\s+(on|this|that)\b/i,
  /\b[a-z]{2,}\s*[-+]\d+(\.\d+)?\b/i,
  /\b\d+(\.\d+)?\s*(points?|pt|pts)\b/i,
];
const SPORTS_PATTERNS = [
  /\bnfl\b/i,
  /\bnba\b/i,
  /\bmlb\b/i,
  /\bnhl\b/i,
  /\bwnba\b/i,
  /\bncaa\b/i,
  /\bafc\b/i,
  /\bnfc\b/i,
  /\bsuper bowls?\b/i,
  /\bplayoffs?\b/i,
  /\bfinals?\b/i,
  /\bchampionship\b/i,
  /\bmvp\b/i,
  /\bseason\b/i,
  /\bretire(?:d|ment|s)?\b/i,
  /\bretiring\b/i,
  /\bunretire(?:d|ment|s)?\b/i,
  /\bcomeback\b/i,
  /\bcomes? out of retirement\b/i,
  /\breturns?\s+to\s+play\b/i,
  /\breturns? to (the )?(nfl|nba|mlb|nhl)\b/i,
  /\bweek\s*\d+\b/i,
  /\bquarterback\b/i,
  /\bqb\b/i,
  /\btouchdown\b/i,
  /\btds?\b/i,
  /\brecord\b/i,
  /\bdraft\b/i,
  /\bcoach\b/i,
  /\bteam\b/i,
  /\bplayer\b/i,
  /\bpatriots\b/i,
  /\bchiefs\b/i,
  /\bceltics\b/i,
  /\blakers\b/i,
  /\byankees\b/i,
  /\bred sox\b/i,
  /\bwarriors\b/i,
  /\btom brady\b/i,
  /\bbrady\b/i,
  /\bdrake maye\b/i,
];
const PLAYER_ALIASES = {
  "drake may": "Drake Maye",
  "caleb": "Caleb Williams",
  "amon ra": "Amon-Ra St. Brown",
  "amon ra st brown": "Amon-Ra St. Brown",
  "amon-ra st brown": "Amon-Ra St. Brown",
};
const TEAM_TEXT_ALIASES = {
  niners: "49ers",
  phins: "Dolphins",
  pats: "Patriots",
  jags: "Jaguars",
  hawks: "Seahawks",
  chip: "championship",
};
const INVALID_PERSON_PHRASES = new Set([
  "super bowl",
  "super bowls",
  "world series",
  "nba finals",
  "afc championship",
  "nfc championship",
]);
const COMMON_NON_NAME_PHRASES = new Set([
  "what are",
  "the odds",
  "odds that",
  "this season",
  "next season",
  "next year",
  "this year",
  "hall of",
  "of fame",
  "a team",
  "team goes",
]);
const NON_NAME_TOKENS = new Set([
  "what",
  "are",
  "the",
  "odds",
  "that",
  "win",
  "wins",
  "won",
  "make",
  "makes",
  "made",
  "throws",
  "throw",
  "catches",
  "catch",
  "is",
  "best",
  "greatest",
  "goat",
  "season",
  "year",
  "next",
  "this",
  "hall",
  "fame",
  "nfl",
  "and",
  "for",
  "pass",
  "passing",
  "td",
  "touchdown",
  "combine",
  "combined",
]);
const NUMBER_WORD_MAP = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};
const KNOWN_TEAMS = [
  "Patriots",
  "Chiefs",
  "Bills",
  "Jets",
  "Dolphins",
  "Cowboys",
  "Eagles",
  "49ers",
  "Packers",
  "Lions",
  "Ravens",
  "Bengals",
  "Steelers",
  "Texans",
  "Celtics",
  "Lakers",
  "Warriors",
  "Yankees",
  "Red Sox",
  "Panthers",
  "49ers",
];
const NFL_TEAM_ALIASES = {
  "arizona cardinals": "ARI",
  cardinals: "ARI",
  "atlanta falcons": "ATL",
  falcons: "ATL",
  "baltimore ravens": "BAL",
  ravens: "BAL",
  "buffalo bills": "BUF",
  bills: "BUF",
  "carolina panthers": "CAR",
  panthers: "CAR",
  "chicago bears": "CHI",
  bears: "CHI",
  "cincinnati bengals": "CIN",
  bengals: "CIN",
  "cleveland browns": "CLE",
  browns: "CLE",
  "dallas cowboys": "DAL",
  cowboys: "DAL",
  "denver broncos": "DEN",
  broncos: "DEN",
  "detroit lions": "DET",
  lions: "DET",
  "green bay packers": "GB",
  packers: "GB",
  "houston texans": "HOU",
  texans: "HOU",
  "indianapolis colts": "IND",
  colts: "IND",
  "jacksonville jaguars": "JAX",
  jaguars: "JAX",
  "kansas city chiefs": "KC",
  chiefs: "KC",
  "las vegas raiders": "LV",
  raiders: "LV",
  "los angeles chargers": "LAC",
  chargers: "LAC",
  "los angeles rams": "LAR",
  rams: "LAR",
  "miami dolphins": "MIA",
  dolphins: "MIA",
  "minnesota vikings": "MIN",
  vikings: "MIN",
  "new england patriots": "NE",
  patriots: "NE",
  "new orleans saints": "NO",
  saints: "NO",
  "new york giants": "NYG",
  giants: "NYG",
  "new york jets": "NYJ",
  jets: "NYJ",
  "philadelphia eagles": "PHI",
  eagles: "PHI",
  "pittsburgh steelers": "PIT",
  steelers: "PIT",
  "san francisco 49ers": "SF",
  "49ers": "SF",
  "seattle seahawks": "SEA",
  seahawks: "SEA",
  "tampa bay buccaneers": "TB",
  buccaneers: "TB",
  "tennessee titans": "TEN",
  titans: "TEN",
  "washington commanders": "WAS",
  commanders: "WAS",
};
const NFL_TEAM_DISPLAY = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LV: "Las Vegas Raiders",
  LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SF: "San Francisco 49ers",
  SEA: "Seattle Seahawks",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
};
const KNOWN_DECEASED_ATHLETES = [
  "babe ruth",
  "kobe bryant",
  "walter payton",
  "joe dimaggio",
  "lou gehrig",
  "thurman munson",
];
const KNOWN_LONG_RETIRED_ATHLETES = [
  "brett favre",
  "tom brady",
  "joe montana",
  "dan marino",
  "peyton manning",
  "terry bradshaw",
  "john elway",
];
const KNOWN_ACTIVE_PLAYERS = [
  "drake maye",
  "josh allen",
  "patrick mahomes",
  "lamar jackson",
  "joe burrow",
  "jalen hurts",
  "justin herbert",
  "cj stroud",
  "brock purdy",
  "jordan love",
];
const KNOWN_NON_PLAYER_FIGURES = [
  "bill belichick",
  "roger goodell",
  "jerry jones",
];

const COMEBACK_PATTERNS = [
  /\breturns?\b/i,
  /\breturn(s|ing)? to play\b/i,
  /\bcomeback\b/i,
  /\bcomes? out of retirement\b/i,
  /\bunretire(?:d|ment|s|)\b/i,
  /\bplay again\b/i,
];

const RETIREMENT_PATTERNS = [
  /\bretire(?:d|ment|s|)\b/i,
  /\bretiring\b/i,
];

app.use(express.json({ limit: "200kb" }));
app.use(express.static("."));

function shouldRefuse(prompt) {
  if (REFUSAL_PATTERNS.some((pattern) => pattern.test(prompt))) return true;
  if (/\b(parlay|bet|wager|stake|units)\b/i.test(prompt)) return true;
  return false;
}

function isSportsPrompt(prompt) {
  return SPORTS_PATTERNS.some((pattern) => pattern.test(prompt));
}

function isLikelySportsHypothetical(prompt) {
  const text = String(prompt || "");
  const lower = normalizePrompt(text);
  const hasSportsAction = /\b(wins?|make(s)? the playoffs?|hall of fame|hof|mvp|touchdowns?|tds?|interceptions?|ints?|throws?|catches?|rushing|passing|retire(?:d|ment|s)?|retiring|comes? out of retirement|returns? to play)\b/.test(
    lower
  );
  const hasTeam = KNOWN_TEAMS.some((team) => new RegExp(`\\b${team.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
  const hasNameShape = /\b[a-z][a-z'.-]+\s+[a-z][a-z'.-]+\b/i.test(text);
  return hasSportsAction && (hasTeam || hasNameShape);
}

function isLikelyGibberishPrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/(asdf|qwerty|zxcv|poiuy|lkjhg|mnbvc|qazwsx|wsxedc)/.test(lower)) return true;
  if (/^(.)\1{5,}$/.test(lower.replace(/\s+/g, ""))) return true;

  const compact = lower.replace(/\s+/g, "");
  if (compact.length >= 10 && /^[a-z]+$/.test(compact) && !/[aeiou]/.test(compact)) return true;

  const letters = (text.match(/[a-z]/gi) || []).length;
  const digits = (text.match(/[0-9]/g) || []).length;
  const symbols = Math.max(0, text.length - letters - digits - (text.match(/\s/g) || []).length);
  const symbolRatio = text.length ? symbols / text.length : 0;
  if (text.length >= 8 && symbolRatio > 0.45) return true;
  return false;
}

function hasMeasurableOutcomeIntent(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(win|wins|won|make|makes|made|reach|reaches|throws?|catch(?:es)?|rush(?:es|ing)?|retire(?:d|ment|s|ing)?|returns?|comeback|playoffs?|mvp|yards?|touchdowns?|tds?|interceptions?|ints?|sacks?|record|awards?|super bowl|championship|finals?|0-17|17-0|hall of fame)\b/.test(
    lower
  );
}

function buildGibberishSnarkResponse() {
  return {
    status: "snark",
    title: "I Need Real Words.",
    message: "That looks like keyboard smash. Give me a real sports hypothetical and I’ll price it.",
    hint: "Example: 'Drake Maye throws 30 TDs this season.'",
  };
}

function buildNonsenseSportsSnarkResponse(playerOrTeam, prompt = "") {
  if (prompt) {
    const offTopic = buildOffTopicSnarkResponse(prompt);
    if (offTopic?.title !== "Nice Try." || /\b(cocaine|snort|drug|rehab|dating|married|jail|arrest|crime)\b/.test(normalizePrompt(prompt))) {
      return offTopic;
    }
  }
  const label = playerOrTeam || "that";
  return {
    status: "snark",
    title: "Need A Scenario.",
    message: `You gave me ${label}, but not an actual outcome to price.`,
    hint: "Try something measurable: wins MVP, throws 30 TDs, makes playoffs, wins Super Bowl, etc.",
  };
}

function buildOffTopicSnarkResponse(prompt) {
  const lower = normalizePrompt(prompt);
  const topic = [
    {
      re: /\b(cocaine|snort|drug|drugs|rehab|overdose|meth|heroin|substance)\b/,
      title: "Wrong Playbook.",
      message: "I price sports outcomes, not personal-life interventions.",
      hint: "Try a game, season, or career sports scenario.",
    },
    {
      re: /\b(dating|girlfriend|boyfriend|marry|married|divorce|relationship|hook up)\b/,
      title: "Not That Kind Of Odds.",
      message: "I’m built for sports hypotheticals, not relationship forecasts.",
      hint: "Try a player/team outcome instead.",
    },
    {
      re: /\b(jail|arrest|crime|lawsuit|court|prison)\b/,
      title: "Out Of Scope.",
      message: "I’m not a legal drama predictor. I only price sports hypotheticals.",
      hint: "Try awards, playoffs, or stat milestones.",
    },
  ].find((x) => x.re.test(lower));

  if (topic) {
    return {
      status: "snark",
      title: topic.title,
      message: topic.message,
      hint: topic.hint,
    };
  }

  return {
    status: "snark",
    title: "Nice Try.",
    message: "I’m an odds widget for sports scenarios, not random life hypotheticals.",
    hint: "Try a player, team, or league outcome.",
  };
}

function buildDeterministicDataSnarkResponse() {
  return {
    status: "snark",
    title: "Need Better Data.",
    message: "I don’t have enough deterministic data to price that reliably yet, so I’m not guessing.",
    hint: "Try a concrete NFL scenario: player stat threshold, playoff outcome, awards, or team futures.",
  };
}

function shouldAllowLlmLastResort(prompt, context = {}) {
  const lower = normalizePrompt(prompt);
  if (!hasMeasurableOutcomeIntent(prompt)) return false;
  if (parseUnpriceableSubjectiveReason(prompt)) return false;
  if (hardImpossibleReason(prompt)) return false;
  if (context.conditionalIntent || context.jointEventIntent) return false;

  const strongSportsDomain = /\b(nfl|super bowl|afc|nfc|playoffs?|mvp|hall of fame|touchdowns?|tds?|interceptions?|ints?|passing|receiving|rushing|wins?)\b/.test(
    lower
  );
  if (!strongSportsDomain) return false;

  const hasResolvedEntity = Boolean(
    context.localPlayerStatus ||
      context.teamHint ||
      context.referenceAnchors?.length ||
      context.playerStatus?.isSportsFigure === "yes"
  );
  if (!hasResolvedEntity) return false;

  if (context.playerHint && !context.localPlayerStatus && context.playerStatus?.isSportsFigure !== "yes") {
    return false;
  }

  return true;
}

function hasDepthChartDisplacementIntent(prompt) {
  const lower = normalizePrompt(prompt);
  return (
    (/\b(start|starts|starting)\b/.test(lower) && /\bover\b/.test(lower)) ||
    /\b(replace|replaces|replacing)\b/.test(lower) ||
    /\b(beats? out|beat out)\b/.test(lower) ||
    /\b(take|takes|taking)\s+snaps?\s+over\b/.test(lower)
  );
}

const POSITION_TOKEN_TO_GROUP = {
  qb: "qb",
  quarterback: "qb",
  rb: "rb",
  "running back": "rb",
  wr: "receiver",
  receiver: "receiver",
  "wide receiver": "receiver",
  te: "receiver",
  "tight end": "receiver",
  ol: "ol",
  "offensive line": "ol",
  "offensive tackle": "ol",
  tackle: "ol",
  guard: "ol",
  center: "ol",
  dt: "defense",
  "defensive tackle": "defense",
  de: "defense",
  "defensive end": "defense",
  lb: "defense",
  linebacker: "defense",
  cb: "defense",
  "cornerback": "defense",
  safety: "defense",
  s: "defense",
  k: "specialist",
  kicker: "specialist",
  p: "specialist",
  punter: "specialist",
};

function groupsInPrompt(prompt) {
  const lower = normalizePrompt(prompt);
  const found = [];
  for (const [token, group] of Object.entries(POSITION_TOKEN_TO_GROUP)) {
    const re = new RegExp(`\\b${token.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(lower)) found.push({ token, group });
  }
  return found;
}

function parseRoleWordsFromDepthChartPrompt(prompt) {
  const text = normalizePrompt(prompt);
  let leftText = "";
  let rightText = "";

  let m = text.match(/(.+?)\b(start|starts|starting)\b(.+?)\bover\b(.+)/);
  if (m) {
    leftText = `${m[1]} ${m[3]}`.trim();
    rightText = String(m[4] || "").trim();
  } else {
    m = text.match(/(.+?)\b(replace|replaces|replacing|beats? out|beat out|takes?\s+snaps?\s+over)\b(.+)/);
    if (!m) return null;
    leftText = String(m[1] || "").trim();
    rightText = String(m[3] || "").trim();
  }

  const pickGroup = (chunk) => {
    for (const [token, group] of Object.entries(POSITION_TOKEN_TO_GROUP)) {
      const re = new RegExp(`\\b${token.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(chunk)) return { token, group };
    }
    return null;
  };

  const left = pickGroup(leftText);
  const right = pickGroup(rightText);
  if (!left || !right) return null;
  return { left: left.token, right: right.token, leftGroup: left.group, rightGroup: right.group };
}

async function extractKnownNflNamesFromPrompt(prompt, maxNames = 3) {
  if (nflPlayerIndex.size === 0) {
    try {
      await loadNflPlayerIndex(false);
    } catch (_error) {
      return [];
    }
  }
  const tokens = normalizeEntityName(prompt).split(" ").filter(Boolean);
  const hits = [];
  const seen = new Set();
  for (let n = Math.min(5, tokens.length); n >= 2; n -= 1) {
    for (let i = 0; i <= tokens.length - n; i += 1) {
      const phrase = tokens.slice(i, i + n).join(" ");
      const key = normalizePersonName(phrase);
      const candidates = nflPlayerIndex.get(key);
      if (!candidates || candidates.length === 0) continue;
      const active = candidates.find((c) => c.status === "active");
      const chosen = active || candidates[0];
      const canonicalName = chosen.fullName || phrase;
      const dedupeKey = normalizePersonName(canonicalName);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      hits.push({
        name: canonicalName,
        position: chosen.position || "",
        group: positionGroup(chosen.position || ""),
      });
      if (hits.length >= maxNames) return hits;
    }
  }
  return hits;
}

function buildRoleMismatchSnarkResponse(a, b) {
  const left = a?.name || "That player";
  const right = b?.name || "that other player";
  const roleLabel = (x) => {
    const g = x?.group || "";
    if (g === "qb") return "a quarterback";
    if (g === "receiver" || g === "rb" || g === "ol" || g === "defense" || g === "specialist") return "a non-quarterback";
    return "that role";
  };
  const leftRole = roleLabel(a);
  const rightRole = roleLabel(b);
  const unknownRole = leftRole === "that role" || rightRole === "that role";
  return {
    status: "snark",
    title: "What Are You Talking About?",
    message: unknownRole
      ? `${left} starting over ${right} doesn’t make sense at the same depth-chart spot.`
      : `${left} is ${leftRole}, and ${right} is ${rightRole}. That matchup doesn’t make sense at the same depth-chart spot.`,
    hint: "Try a measurable scenario that fits football roles.",
  };
}

function buildRoleWordMismatchSnarkResponse(words) {
  const left = words?.left || "that role";
  const right = words?.right || "that role";
  return {
    status: "snark",
    title: "What Are You Talking About?",
    message: `How is ${left} going to start over ${right}? That’s a role mismatch.`,
    hint: "Try a realistic depth-chart scenario.",
  };
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function normalizePrompt(prompt) {
  return String(prompt || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bmvps\b/gi, "mvp")
    .toLowerCase();
}

function hasExplicitSeasonYear(prompt) {
  return /\b(20\d{2})(?:\s*-\s*(?:20)?\d{2})?\b/.test(String(prompt || ""));
}

function hasNflContext(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(nfl|super bowl|afc|nfc|playoffs?|mvp|qb|quarterback|touchdowns?|tds?|interceptions?|ints?|0-17|17-0|patriots|chiefs|bills|jets|dolphins|ravens|49ers|packers|cowboys|eagles|seahawks|bengals|steelers|texans)\b/.test(
    lower
  );
}

function applyDefaultNflSeasonInterpretation(prompt) {
  let text = String(prompt || "").trim();
  if (!text) return text;
  if (!hasNflContext(text)) return text;
  if (/\b(hall of fame|hof)\b/i.test(text)) return text;
  if (/\b(ever|career|all[- ]time)\b/i.test(text)) return text;
  if (hasExplicitSeasonYear(text)) return text;

  // Product rule: between seasons, "this year" and "next year" both reference upcoming NFL season.
  text = text.replace(/\bthis year\b/gi, "this season");
  text = text.replace(/\bnext year\b/gi, "this season");
  text = text.replace(/\bnext season\b/gi, "this season");
  text = text.replace(/\bupcoming season\b/gi, "this season");

  if (!/\bthis season\b/i.test(text) && !/\bseason\b/i.test(text)) {
    text = `${text} this season`;
  }
  if (!/\b2025-26\b/i.test(text)) {
    text = `${text} (${DEFAULT_NFL_SEASON} NFL season)`;
  }
  return text.replace(/\s+/g, " ").trim();
}

function applyPlayerAliases(text) {
  let out = String(text || "");
  for (const [alias, canonical] of Object.entries(PLAYER_ALIASES)) {
    const re = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "ig");
    out = out.replace(re, canonical);
  }
  return out;
}

function applyTeamAndSlangAliases(text) {
  let out = String(text || "");
  for (const [alias, canonical] of Object.entries(TEAM_TEXT_ALIASES)) {
    const re = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "ig");
    out = out.replace(re, canonical);
  }
  return out;
}

function normalizeNumberWords(text) {
  return String(text || "").replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
    (m) => NUMBER_WORD_MAP[m.toLowerCase()] || m
  );
}

function canonicalizePromptForKey(prompt) {
  let t = applyPlayerAliases(prompt);
  t = applyTeamAndSlangAliases(t);
  t = normalizeNumberWords(t);
  t = t.toLowerCase();
  t = t.replace(/\breturns?\s+to\s+play\b/g, "comes out of retirement");
  t = t.replace(/\brecords?\s+(\d{1,2})\s+receiving\s+touchdowns?\b/g, "catches $1 touchdowns");
  t = t.replace(/\bgets?\s+(\d{1,2})\s+receiving\s+touchdowns?\b/g, "catches $1 touchdowns");
  t = t.replace(/\bcatches?\s+(\d{1,2})\s+receiving\s+touchdowns?\b/g, "catches $1 touchdowns");
  t = t.replace(/\bafc championship winner\b/g, "afc winner");
  t = t.replace(/\bnfc championship winner\b/g, "nfc winner");
  t = t.replace(/\bworld series\b/g, "ws");
  t = t.replace(/\bmakes?\s+playoffs?\b/g, "make the playoffs");
  t = t.replace(/\bpicks\b/g, "interceptions");
  t = t.replace(/\bto\s+wins?\b/g, "to win");
  t = t.replace(/\bwins?\b/g, "win");
  t = t.replace(/\bto win\b/g, "win");
  t = t.replace(/\bsuper bowls\b/g, "super bowl");
  t = t.replace(/\bafc championship\b/g, "afc");
  t = t.replace(/\bnfc championship\b/g, "nfc");
  t = t.replace(/\bmvps\b/g, "mvp");
  t = t.replace(/[^\w\s]/g, " ");
  t = t.replace(/\b(what are the odds that|what are the odds|what are odds that|odds that)\b/g, " ");
  t = t.replace(/\b(in his career|in her career|in their career)\b/g, " ");
  t = t.replace(/\b(nfl|nba|mlb|nhl)\b/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function normalizePromptForModel(prompt) {
  let t = applyPlayerAliases(prompt);
  t = applyTeamAndSlangAliases(t);
  t = normalizeNumberWords(t);
  t = t.replace(/\bmakes?\s+playoffs?\b/gi, "make the playoffs");
  t = t.replace(/\bpicks\b/gi, "interceptions");
  t = t.replace(/\bto\s+wins?\b/gi, "to win");
  t = t.replace(/\bwins?\b/gi, "win");
  t = t.replace(/\breturns?\s+to\s+play\b/gi, "comes out of retirement");
  t = t.replace(/\brecords?\s+(\d{1,2})\s+receiving\s+touchdowns?\b/gi, "catches $1 touchdowns");
  t = t.replace(/\bgets?\s+(\d{1,2})\s+receiving\s+touchdowns?\b/gi, "catches $1 touchdowns");
  t = t.replace(/\bthis nfl season\b/gi, "this nfl regular season");
  t = t.replace(/\bafc championship winner\b/gi, "afc winner");
  t = t.replace(/\bnfc championship winner\b/gi, "nfc winner");
  t = t.replace(/\bmvps\b/gi, "mvp");
  return t.trim();
}

function normalizePersonName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[.,'\-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEntityName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeamToken(name) {
  return normalizeEntityName(name)
    .replace(/\b(the|fc|cf|club)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeNormalized(text) {
  return normalizeEntityName(text).split(" ").filter(Boolean);
}

function extractSportsbookEntityToken(prompt) {
  const parsed = parseSportsbookFuturesIntent(prompt);
  if (parsed?.team) return parsed.team;
  const m = String(prompt || "").match(/^(.*?)\b(win|wins|to win|make|makes|miss|misses|take|takes)\b/i);
  let phrase = m ? m[1] : "";
  phrase = phrase.replace(/\b(the|a|an|odds|what|are|that|for|to)\b/gi, " ").trim();
  return normalizeTeamToken(phrase);
}

function marketKeywordsFromPrompt(prompt) {
  const p = normalizePrompt(prompt);
  const out = new Set();
  if (/\bafc\b/.test(p)) out.add("afc");
  if (/\bnfc\b/.test(p)) out.add("nfc");
  if (/\beast\b/.test(p)) out.add("east");
  if (/\bwest\b/.test(p)) out.add("west");
  if (/\bnorth\b/.test(p)) out.add("north");
  if (/\bsouth\b/.test(p)) out.add("south");
  if (/\bdivision\b/.test(p)) out.add("division");
  if (/\bsuper bowl\b|\bsb\b/.test(p)) out.add("super bowl");
  if (/\bnba finals\b|\bnba championship\b/.test(p)) out.add("nba finals");
  if (/\bworld series\b|\bws\b/.test(p)) out.add("world series");
  if (/\bstanley cup\b/.test(p)) out.add("stanley cup");
  if (/\bmvp|most valuable player\b/.test(p)) out.add("mvp");
  if (/\bplayoffs?\b/.test(p)) out.add("playoffs");
  return out;
}

function marketNeedsStrictKeywordMatch(market) {
  return /^nfl_(afc|nfc)_(east|west|north|south)_winner$/.test(String(market || ""));
}

function scoreMarketKeywordMatch(blob, keywords) {
  if (!keywords || keywords.size === 0) return 0;
  let score = 0;
  for (const kw of keywords) {
    const k = normalizeEntityName(kw);
    if (k && blob.includes(k)) score += 1;
  }
  return score;
}

function isLikelyKnownTeamToken(token) {
  const t = normalizeTeamToken(token);
  if (!t) return false;
  const aliasMatches = Object.keys(NFL_TEAM_ALIASES).some((alias) => normalizeTeamToken(alias) === t);
  if (aliasMatches) return true;
  const knownMatches = KNOWN_TEAMS.some((team) => normalizeTeamToken(team) === t);
  if (knownMatches) return true;
  return false;
}

function isSportsbookCandidatePrompt(prompt) {
  const lower = normalizePrompt(numberWordsToDigits(prompt));
  if (/\b(next|over|within)\s+\d{1,2}\s+(years|seasons)\b/.test(lower)) return false;
  if (/\b(career|ever|all[- ]time|whole career|entire career)\b/.test(lower)) return false;
  if (/\b(before|after|than|ahead of|first)\b/.test(lower)) return false;
  return (
    /\b(win|wins|to win|take|takes)\b/.test(lower) &&
    /\b(afc|nfc|super bowl|sb|nba finals|world series|ws|stanley cup|cup final|championship|division|east|west|north|south|mvp|most valuable player)\b/.test(lower)
  );
}

function parseNflDivisionMarket(lowerPrompt) {
  const p = normalizePrompt(lowerPrompt);
  if (/\bafc\b/.test(p) && /\beast\b/.test(p)) return "nfl_afc_east_winner";
  if (/\bafc\b/.test(p) && /\bwest\b/.test(p)) return "nfl_afc_west_winner";
  if (/\bafc\b/.test(p) && /\bnorth\b/.test(p)) return "nfl_afc_north_winner";
  if (/\bafc\b/.test(p) && /\bsouth\b/.test(p)) return "nfl_afc_south_winner";
  if (/\bnfc\b/.test(p) && /\beast\b/.test(p)) return "nfl_nfc_east_winner";
  if (/\bnfc\b/.test(p) && /\bwest\b/.test(p)) return "nfl_nfc_west_winner";
  if (/\bnfc\b/.test(p) && /\bnorth\b/.test(p)) return "nfl_nfc_north_winner";
  if (/\bnfc\b/.test(p) && /\bsouth\b/.test(p)) return "nfl_nfc_south_winner";
  return "";
}

function parseMultiYearWindow(prompt) {
  const lower = normalizePrompt(numberWordsToDigits(prompt));
  const m = lower.match(/\b(next|over|within)\s+(\d{1,2})\s+(years|seasons)\b/);
  if (m) {
    const years = Number(m[2]);
    if (!Number.isFinite(years) || years <= 1 || years > 20) return null;
    return years;
  }
  const byYear = lower.match(/\b(before|by|through|thru|until|up to)\s+(20\d{2})\b/);
  if (byYear) {
    const targetYear = Number(byYear[2]);
    const currentYear = new Date().getUTCFullYear();
    const years = targetYear - currentYear;
    if (!Number.isFinite(years) || years <= 0 || years > 25) return null;
    return years;
  }
  return null;
}

function titleCaseWords(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w.charAt(0).toUpperCase()}${w.slice(1)}`)
    .join(" ");
}

function extractKnownTeamTokens(prompt, maxTeams = 3) {
  const text = String(prompt || "");
  const seen = new Set();
  const matches = [];
  const catalog = [
    ...Object.keys(NFL_TEAM_ALIASES),
    ...KNOWN_TEAMS.map((x) => String(x || "").toLowerCase()),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const alias of catalog) {
    const re = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "i");
    const m = text.match(re);
    if (!m) continue;
    const abbr = NFL_TEAM_ALIASES[alias] || extractNflTeamAbbr(alias);
    const canonical = abbr ? (NFL_TEAM_DISPLAY[abbr] || alias) : alias;
    const token = normalizeTeamToken(canonical);
    if (!token) continue;
    matches.push({
      token,
      idx: typeof m.index === "number" ? m.index : text.toLowerCase().indexOf(String(m[0] || "").toLowerCase()),
      len: alias.length,
    });
  }
  matches.sort((a, b) => (a.idx - b.idx) || (b.len - a.len));
  const hits = [];
  for (const row of matches) {
    if (seen.has(row.token)) continue;
    seen.add(row.token);
    hits.push(row.token);
    if (hits.length >= maxTeams) break;
  }
  return hits;
}

function parseBeforeOtherTeamIntent(prompt) {
  const lower = normalizePrompt(numberWordsToDigits(prompt));
  if (!/\bbefore\b/.test(lower)) return null;
  if (/\bbefore\s+20\d{2}\b/.test(lower)) return null;
  let market = "";
  if (/\bsuper bowl\b|\bsb\b/.test(lower)) market = "super_bowl_winner";
  else if (/\bafc\b/.test(lower)) market = "afc_winner";
  else if (/\bnfc\b/.test(lower)) market = "nfc_winner";
  else if (/\bnba finals\b|\bnba championship\b/.test(lower)) market = "nba_finals_winner";
  else if (/\bworld series\b|\bws\b/.test(lower)) market = "world_series_winner";
  else if (/\bstanley cup\b/.test(lower)) market = "stanley_cup_winner";
  if (!market) return null;

  const teams = extractKnownTeamTokens(prompt, 4);
  if (teams.length < 2) return null;
  const [teamA, teamB] = teams;
  if (!teamA || !teamB || teamA === teamB) return null;

  const years = parseMultiYearWindow(prompt) || 10;
  return { market, teamA, teamB, years };
}

function raceBeforeProbability(perSeasonA, perSeasonB) {
  const n = Math.min(perSeasonA.length, perSeasonB.length);
  let survive = 1;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const a = clamp(perSeasonA[i], 0, 0.999);
    const b = clamp(perSeasonB[i], 0, 0.999);
    sum += survive * (a * (1 - b));
    survive *= (1 - a) * (1 - b);
  }
  return clamp(sum, 0, 1);
}

async function buildBeforeOtherTeamEstimate(prompt, asOfDate) {
  const parsed = parseBeforeOtherTeamIntent(prompt);
  if (!parsed) return null;
  const { market, teamA, teamB, years } = parsed;

  const [refA, refB] = await Promise.all([
    getSportsbookReferenceByTeamAndMarket(teamA, market),
    getSportsbookReferenceByTeamAndMarket(teamB, market),
  ]);
  const defaults = {
    super_bowl_winner: 4.5,
    afc_winner: 9.5,
    nfc_winner: 9.5,
    nba_finals_winner: 6.5,
    world_series_winner: 6.0,
    stanley_cup_winner: 6.0,
  };
  let seasonPctA = refA ? Number(String(refA.impliedProbability || "").replace("%", "")) : null;
  let seasonPctB = refB ? Number(String(refB.impliedProbability || "").replace("%", "")) : null;
  if (!Number.isFinite(seasonPctA) || seasonPctA <= 0) seasonPctA = defaults[market] || 5.0;
  if (!Number.isFinite(seasonPctB) || seasonPctB <= 0) seasonPctB = defaults[market] || 5.0;
  seasonPctA = clamp(seasonPctA, 0.2, 70);
  seasonPctB = clamp(seasonPctB, 0.2, 70);

  const perA = [];
  const perB = [];
  for (let i = 0; i < years; i += 1) {
    const decay = Math.pow(0.96, i);
    perA.push(clamp((seasonPctA / 100) * decay, 0.001, 0.8));
    perB.push(clamp((seasonPctB / 100) * decay, 0.001, 0.8));
  }
  const pBefore = raceBeforeProbability(perA, perB) * 100;
  const probPct = clamp(pBefore, 0.1, 99.0);

  const labelA = titleCaseWords(teamA);
  const labelB = titleCaseWords(teamB);
  const hasAnchors = Boolean(refA || refB);
  return {
    status: "ok",
    odds: toAmericanOdds(probPct),
    impliedProbability: `${probPct.toFixed(1)}%`,
    confidence: hasAnchors ? "High" : "Medium",
    assumptions: [
      "Comparative race model used: probability Team A wins market before Team B.",
      "Season-level title probabilities are compounded over time with year-over-year decay.",
    ],
    playerName: null,
    headshotUrl: null,
    summaryLabel: `${labelA} before ${labelB}`,
    liveChecked: hasAnchors,
    asOfDate: refA?.asOfDate || refB?.asOfDate || asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: hasAnchors ? "hybrid_anchored" : "historical_model",
    sourceLabel: hasAnchors
      ? "Comparative model anchored to live market"
      : "Comparative race baseline model",
    sourceMarket: market,
    trace: {
      baselineEventKey: "team_before_team_race",
      teamA,
      teamB,
      market,
      years,
      seasonPctA,
      seasonPctB,
    },
  };
}

function parseSportsbookFuturesIntent(prompt) {
  const lower = normalizePrompt(prompt);
  let market = "";
  const divisionMarket = parseNflDivisionMarket(lower);
  if (divisionMarket && /\b(division|winner|to win|win|wins|title)\b/.test(lower)) market = divisionMarket;
  else if (/\bafc\b/.test(lower) && /\b(champ|championship|winner|to win|win|wins)\b/.test(lower)) market = "afc_winner";
  else if (/\bnfc\b/.test(lower) && /\b(champ|championship|winner|to win|win|wins)\b/.test(lower)) market = "nfc_winner";
  else if (/\bsuper bowl\b|\bsb\b/.test(lower)) market = "super_bowl_winner";
  else if (/\b(mvp|most valuable player)\b/.test(lower) && /\b(nfl|football|qb|quarterback)\b/.test(lower)) market = "nfl_mvp";
  else if (/\bnba finals\b|\bnba championship\b/.test(lower)) market = "nba_finals_winner";
  else if (/\bworld series\b|\bws\b/.test(lower)) market = "world_series_winner";
  else if (/\bstanley cup\b/.test(lower)) market = "stanley_cup_winner";
  if (!market) return null;

  // Grab text before win/take verbs as likely team phrase.
  const m = prompt.match(/^(.*?)\b(win|wins|to win|take|takes)\b/i);
  let teamPhrase = m ? m[1] : "";
  teamPhrase = teamPhrase.replace(/\b(the|to)\b/gi, " ").trim();
  const team = normalizeTeamToken(teamPhrase);
  if (!team) return null;
  if (!isLikelyKnownTeamToken(team)) return null;
  return {
    market,
    team,
  };
}

function normalizeMarketPhrasingForLookup(prompt) {
  let text = String(prompt || "");
  text = text.replace(/\bAFC Championship\b/i, "AFC");
  text = text.replace(/\bNFC Championship\b/i, "NFC");
  text = text.replace(/\bAFC title\b/i, "AFC");
  text = text.replace(/\bNFC title\b/i, "NFC");
  text = text.replace(/\bWorld Series title\b/i, "World Series");
  text = text.replace(/\bNBA title\b/i, "NBA Finals");
  return text;
}

async function normalizeSportsbookIntentWithAI(prompt) {
  if (!ODDS_API_KEY) return null;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "Return JSON only. Normalize user sportsbook-style futures phrasing to canonical market + team/player token. Markets: afc_winner, nfc_winner, super_bowl_winner, nfl_afc_east_winner, nfl_afc_west_winner, nfl_afc_north_winner, nfl_afc_south_winner, nfl_nfc_east_winner, nfl_nfc_west_winner, nfl_nfc_north_winner, nfl_nfc_south_winner, nfl_mvp, nba_finals_winner, world_series_winner, stanley_cup_winner. If not one of these, use unknown.",
        },
        {
          role: "user",
          content: `As of ${today}, normalize this prompt: ${prompt}`,
        },
      ],
      reasoning: OPENAI_REASONING,
      max_output_tokens: 120,
      text: {
        format: {
          type: "json_schema",
          name: "sportsbook_intent",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              market: {
                type: "string",
                enum: [
                  "afc_winner",
                  "nfc_winner",
                  "super_bowl_winner",
                  "nfl_afc_east_winner",
                  "nfl_afc_west_winner",
                  "nfl_afc_north_winner",
                  "nfl_afc_south_winner",
                  "nfl_nfc_east_winner",
                  "nfl_nfc_west_winner",
                  "nfl_nfc_north_winner",
                  "nfl_nfc_south_winner",
                  "nfl_mvp",
                  "nba_finals_winner",
                  "world_series_winner",
                  "stanley_cup_winner",
                  "unknown",
                ],
              },
              team: { type: "string" },
            },
            required: ["market", "team"],
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text);
    if (!parsed || parsed.market === "unknown") return null;
    return {
      market: parsed.market,
      team: normalizeTeamToken(parsed.team || ""),
    };
  } catch (_error) {
    return null;
  }
}

function detectSportKeyForMarket(market, sports) {
  const list = Array.isArray(sports) ? sports : [];
  const findByKey = (needle) => list.find((s) => String(s.key || "").includes(needle));
  const findByTitle = (needle) =>
    list.find((s) => normalizeEntityName(`${s.title || ""} ${s.description || ""}`).includes(needle));

  if (market === "afc_winner") {
    return findByKey("americanfootball_nfl_afc")?.key || findByTitle("afc championship winner")?.key || null;
  }
  if (market === "nfc_winner") {
    return findByKey("americanfootball_nfl_nfc")?.key || findByTitle("nfc championship winner")?.key || null;
  }
  if (market === "super_bowl_winner") {
    return findByKey("americanfootball_nfl_super_bowl")?.key || findByTitle("super bowl winner")?.key || null;
  }
  if (market === "nfl_mvp") {
    return findByKey("americanfootball_nfl")?.key || findByTitle("nfl mvp")?.key || findByTitle("most valuable player")?.key || null;
  }
  if (market === "nfl_afc_east_winner") {
    return findByKey("americanfootball_nfl_afc_east")?.key || findByTitle("afc east winner")?.key || null;
  }
  if (market === "nfl_afc_west_winner") {
    return findByKey("americanfootball_nfl_afc_west")?.key || findByTitle("afc west winner")?.key || null;
  }
  if (market === "nfl_afc_north_winner") {
    return findByKey("americanfootball_nfl_afc_north")?.key || findByTitle("afc north winner")?.key || null;
  }
  if (market === "nfl_afc_south_winner") {
    return findByKey("americanfootball_nfl_afc_south")?.key || findByTitle("afc south winner")?.key || null;
  }
  if (market === "nfl_nfc_east_winner") {
    return findByKey("americanfootball_nfl_nfc_east")?.key || findByTitle("nfc east winner")?.key || null;
  }
  if (market === "nfl_nfc_west_winner") {
    return findByKey("americanfootball_nfl_nfc_west")?.key || findByTitle("nfc west winner")?.key || null;
  }
  if (market === "nfl_nfc_north_winner") {
    return findByKey("americanfootball_nfl_nfc_north")?.key || findByTitle("nfc north winner")?.key || null;
  }
  if (market === "nfl_nfc_south_winner") {
    return findByKey("americanfootball_nfl_nfc_south")?.key || findByTitle("nfc south winner")?.key || null;
  }
  if (market === "nfl_afc_east_winner") {
    return findByKey("americanfootball_nfl_afc_east")?.key || findByTitle("afc east winner")?.key || null;
  }
  if (market === "nfl_afc_west_winner") {
    return findByKey("americanfootball_nfl_afc_west")?.key || findByTitle("afc west winner")?.key || null;
  }
  if (market === "nfl_afc_north_winner") {
    return findByKey("americanfootball_nfl_afc_north")?.key || findByTitle("afc north winner")?.key || null;
  }
  if (market === "nfl_afc_south_winner") {
    return findByKey("americanfootball_nfl_afc_south")?.key || findByTitle("afc south winner")?.key || null;
  }
  if (market === "nfl_nfc_east_winner") {
    return findByKey("americanfootball_nfl_nfc_east")?.key || findByTitle("nfc east winner")?.key || null;
  }
  if (market === "nfl_nfc_west_winner") {
    return findByKey("americanfootball_nfl_nfc_west")?.key || findByTitle("nfc west winner")?.key || null;
  }
  if (market === "nfl_nfc_north_winner") {
    return findByKey("americanfootball_nfl_nfc_north")?.key || findByTitle("nfc north winner")?.key || null;
  }
  if (market === "nfl_nfc_south_winner") {
    return findByKey("americanfootball_nfl_nfc_south")?.key || findByTitle("nfc south winner")?.key || null;
  }
  if (market === "nba_finals_winner") {
    return findByKey("basketball_nba_championship")?.key || findByTitle("nba championship winner")?.key || null;
  }
  if (market === "world_series_winner") {
    return findByKey("baseball_mlb_world_series")?.key || findByTitle("world series winner")?.key || null;
  }
  if (market === "stanley_cup_winner") {
    return findByKey("icehockey_nhl_stanley_cup")?.key || findByTitle("stanley cup winner")?.key || null;
  }
  return null;
}

function getSportKeyCandidatesForMarket(market) {
  if (market === "afc_winner") {
    return [
      "americanfootball_nfl",
      "americanfootball_nfl_afc_championship_winner",
      "americanfootball_nfl_afc_winner",
      "americanfootball_nfl_afc",
    ];
  }
  if (market === "nfc_winner") {
    return [
      "americanfootball_nfl",
      "americanfootball_nfl_nfc_championship_winner",
      "americanfootball_nfl_nfc_winner",
      "americanfootball_nfl_nfc",
    ];
  }
  if (market === "super_bowl_winner") {
    return [
      "americanfootball_nfl",
      "americanfootball_nfl_super_bowl_winner",
      "americanfootball_nfl_championship_winner",
    ];
  }
  if (market === "nfl_mvp") {
    return [
      "americanfootball_nfl",
      "americanfootball_nfl_mvp",
      "americanfootball_nfl_regular_season_mvp",
      "americanfootball_nfl_player_awards",
    ];
  }
  if (market === "nfl_afc_east_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_afc_east_winner", "americanfootball_nfl_afc_east"];
  }
  if (market === "nfl_afc_west_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_afc_west_winner", "americanfootball_nfl_afc_west"];
  }
  if (market === "nfl_afc_north_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_afc_north_winner", "americanfootball_nfl_afc_north"];
  }
  if (market === "nfl_afc_south_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_afc_south_winner", "americanfootball_nfl_afc_south"];
  }
  if (market === "nfl_nfc_east_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_nfc_east_winner", "americanfootball_nfl_nfc_east"];
  }
  if (market === "nfl_nfc_west_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_nfc_west_winner", "americanfootball_nfl_nfc_west"];
  }
  if (market === "nfl_nfc_north_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_nfc_north_winner", "americanfootball_nfl_nfc_north"];
  }
  if (market === "nfl_nfc_south_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_nfc_south_winner", "americanfootball_nfl_nfc_south"];
  }
  if (market === "nfl_afc_east_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_afc_east_winner", "americanfootball_nfl_afc_east"];
  }
  if (market === "nfl_afc_west_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_afc_west_winner", "americanfootball_nfl_afc_west"];
  }
  if (market === "nfl_afc_north_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_afc_north_winner", "americanfootball_nfl_afc_north"];
  }
  if (market === "nfl_afc_south_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_afc_south_winner", "americanfootball_nfl_afc_south"];
  }
  if (market === "nfl_nfc_east_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_nfc_east_winner", "americanfootball_nfl_nfc_east"];
  }
  if (market === "nfl_nfc_west_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_nfc_west_winner", "americanfootball_nfl_nfc_west"];
  }
  if (market === "nfl_nfc_north_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_nfc_north_winner", "americanfootball_nfl_nfc_north"];
  }
  if (market === "nfl_nfc_south_winner") {
    return ["americanfootball_nfl", "americanfootball_nfl_nfc_south_winner", "americanfootball_nfl_nfc_south"];
  }
  if (market === "nba_finals_winner") {
    return [
      "basketball_nba",
      "basketball_nba_championship_winner",
      "basketball_nba_nba_championship_winner",
    ];
  }
  if (market === "world_series_winner") {
    return [
      "baseball_mlb",
      "baseball_mlb_world_series_winner",
      "baseball_mlb_championship_winner",
    ];
  }
  if (market === "stanley_cup_winner") {
    return [
      "icehockey_nhl",
      "icehockey_nhl_stanley_cup_winner",
      "icehockey_nhl_championship_winner",
    ];
  }
  return [];
}

function parseLocalIndexNote(note) {
  const raw = String(note || "");
  const parts = raw.split(":");
  return {
    teamAbbr: parts[1] || "",
    position: parts[2] || "",
    yearsExp: Number(parts[3] || "") || null,
    age: Number(parts[4] || "") || null,
  };
}

async function loadPhase2Calibration() {
  try {
    const filePath = path.resolve(process.cwd(), PHASE2_CALIBRATION_FILE);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    phase2Calibration = parsed;
    phase2CalibrationLoadedAt = Date.now();
    return phase2Calibration;
  } catch (_error) {
    phase2Calibration = null;
    phase2CalibrationLoadedAt = 0;
    return null;
  }
}

async function runBootSelfTest() {
  const scriptPath = path.resolve(process.cwd(), "scripts/regression-check.mjs");
  try {
    await execFileAsync("node", [scriptPath], {
      env: { ...process.env, BASE_URL: `http://localhost:${port}` },
      timeout: 20000,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error?.stderr || error?.stdout || error?.message || "self-test failed",
    };
  }
}

function numberWordsToDigits(text) {
  return String(text || "").replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
    (m) => NUMBER_WORD_MAP[m.toLowerCase()] || m
  );
}

function parseCareerSuperBowlIntent(prompt) {
  const normalized = numberWordsToDigits(prompt).toLowerCase().replace(/\bto win\b/g, "wins");
  const withCount = normalized.match(/\b([a-z]+(?:\s+[a-z]+){1,2})\s+wins?\s+(?:exactly\s+)?(\d+)\s+super\s*bowls?\b/i);
  const singular = normalized.match(/\b([a-z]+(?:\s+[a-z]+){1,2})\s+wins?\s+(?:(?:a|an|one)\s+)?super\s*bowl\b/i);
  if (!withCount && !singular) return null;
  const wins = withCount ? Number(withCount[2]) : 1;
  if (!Number.isFinite(wins) || wins < 1 || wins > 7) return null;
  const exactBefore = new RegExp(`\\bwins?\\s+exactly\\s+${wins}\\s+super\\s*bowls?\\b`, "i").test(normalized)
    || new RegExp(`\\bexactly\\s+${wins}\\s+super\\s*bowls?\\b`, "i").test(normalized);
  const exactAfter = new RegExp(`\\bwins?\\s+${wins}\\s+super\\s*bowls?\\s+exactly\\b`, "i").test(normalized);
  const exact = Boolean(exactBefore || exactAfter);
  return {
    playerPhrase: withCount?.[1] || singular?.[1] || "",
    wins,
    exact,
  };
}

function americanOddsToProbabilityPct(oddsText) {
  const n = Number(String(oddsText || "").replace(/[+]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  const p = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return clamp(p * 100, 0.1, 99.9);
}

function getTopQbBoost(playerName) {
  const key = normalizePersonName(playerName);
  if (["patrick mahomes"].includes(key)) return 1.55;
  if (["josh allen", "joe burrow", "lamar jackson"].includes(key)) return 1.35;
  if (["jalen hurts", "justin herbert", "cj stroud"].includes(key)) return 1.15;
  if (["drake maye", "caleb williams", "jayden daniels"].includes(key)) return 1.0;
  return 1;
}

function estimateCareerYearsRemaining(localHints) {
  const age = Number(localHints?.age || 0);
  if (Number.isFinite(age) && age > 0) return clamp(41 - age, 3, 14);
  const exp = Number(localHints?.yearsExp || 0);
  if (Number.isFinite(exp) && exp >= 0) return clamp(12 - exp, 3, 14);
  return 9;
}

function poibinAtLeastK(probabilities, k) {
  const n = probabilities.length;
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (const p of probabilities) {
    for (let j = n; j >= 1; j -= 1) {
      dp[j] = dp[j] * (1 - p) + dp[j - 1] * p;
    }
    dp[0] *= 1 - p;
  }
  let sum = 0;
  for (let j = k; j <= n; j += 1) sum += dp[j];
  return clamp(sum, 0, 1);
}

function poibinExactlyK(probabilities, k) {
  const n = probabilities.length;
  if (k < 0 || k > n) return 0;
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (const p of probabilities) {
    for (let j = n; j >= 1; j -= 1) {
      dp[j] = dp[j] * (1 - p) + dp[j - 1] * p;
    }
    dp[0] *= 1 - p;
  }
  return clamp(dp[k] || 0, 0, 1);
}

function historicalCapForSuperBowls(positionGroupName, winsTarget, yearsExp) {
  const exp = Number(yearsExp || 0);
  const young = Number.isFinite(exp) && exp <= 2;
  if (positionGroupName === "qb") {
    if (winsTarget === 1) return young ? 34 : 46;
    if (winsTarget === 2) return young ? 18 : 24;
    if (winsTarget === 3) return 10;
    if (winsTarget >= 4) return 3;
  }
  if (winsTarget === 1) return 20;
  if (winsTarget === 2) return 6;
  if (winsTarget === 3) return 2.4;
  return 1;
}

function buildCareerSeasonCurve(baseSeasonWinPct, yearsRemaining, yearsExp, posGroup) {
  const exp = Number(yearsExp || 0);
  const curve = [];
  for (let i = 0; i < yearsRemaining; i += 1) {
    const careerYear = exp + i + 1;
    let roleFactor = 1;
    if (careerYear <= 2) roleFactor *= 0.78;
    else if (careerYear <= 4) roleFactor *= 0.92;
    else if (careerYear <= 9) roleFactor *= 1.05;
    else if (careerYear <= 12) roleFactor *= 0.92;
    else roleFactor *= 0.8;

    if (posGroup !== "qb") roleFactor *= 0.74;
    const parityDecay = Math.pow(0.97, i);
    curve.push(clamp((baseSeasonWinPct * roleFactor * parityDecay) / 100, 0.001, 0.38));
  }
  return curve;
}

async function estimateCareerSuperBowlOdds(prompt, playerName, localPlayerStatus) {
  const intent = parseCareerSuperBowlIntent(prompt);
  if (!intent || !playerName || !localPlayerStatus?.teamAbbr) return null;

  const localHints = parseLocalIndexNote(localPlayerStatus.note);
  const posGroup = positionGroup(localHints.position);
  const yearsRemaining = estimateCareerYearsRemaining(localHints);
  const teamName = NFL_TEAM_DISPLAY[localPlayerStatus.teamAbbr] || localPlayerStatus.teamAbbr;
  const sbRef = await getSportsbookReferenceByTeamAndMarket(teamName, "super_bowl_winner");
  const teamSeasonPct = sbRef
    ? Number(sbRef.impliedProbability.replace("%", ""))
    : 4.5;

  let playerShare = posGroup === "qb" ? 0.95 : 0.28;
  playerShare *= getTopQbBoost(playerName);
  if (posGroup === "qb" && Number(localHints.yearsExp || 0) <= 2) playerShare *= 0.72;
  if (posGroup === "qb" && Number(localHints.yearsExp || 0) >= 4) playerShare *= 1.12;
  const baseSeasonWinPct = clamp(teamSeasonPct * playerShare, 0.2, 35);

  const perSeason = buildCareerSeasonCurve(
    baseSeasonWinPct,
    yearsRemaining,
    localHints.yearsExp,
    posGroup
  );

  const rawProb = (intent.exact ? poibinExactlyK(perSeason, intent.wins) : poibinAtLeastK(perSeason, intent.wins)) * 100;
  const capped = Math.min(rawProb, historicalCapForSuperBowls(posGroup, intent.wins, localHints.yearsExp));
  const probabilityPct = clamp(capped, 0.2, 95);
  const countLabel = intent.exact ? `${intent.wins}` : `${intent.wins}+`;
  return {
    status: "ok",
    odds: toAmericanOdds(probabilityPct),
    impliedProbability: `${probabilityPct.toFixed(1)}%`,
    confidence: "High",
    assumptions: [
      `${teamName} current Super Bowl reference used as base (${sbRef?.odds || "market unavailable"}).`,
      `Career window modeled over ~${yearsRemaining} seasons with NFL parity decay.`,
      `Historical cap applied for ${countLabel} Super Bowl wins by ${posGroup.toUpperCase()} careers.`,
    ],
    playerName: null,
    headshotUrl: null,
    summaryLabel: intent.exact ? `${playerName} wins exactly ${intent.wins} Super Bowls` : `${playerName} wins ${intent.wins}+ Super Bowls`,
    liveChecked: Boolean(sbRef),
    asOfDate: sbRef?.asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: sbRef ? "hybrid_anchored" : "hypothetical",
    sourceLabel: sbRef ? "Career model anchored to live SB market" : "Career historical model",
  };
}

function parseMvpIntent(prompt) {
  const lower = normalizePrompt(numberWordsToDigits(prompt));
  if (!/\b(mvp|most valuable player)\b/.test(lower)) return null;
  const m = lower.match(/\b(win|wins|won|to win)\s+(?:exactly\s+)?(\d+)\s+(mvp|most valuable player)s?\b/);
  const count = m ? Number(m[2]) : 1;
  if (!Number.isFinite(count) || count < 1 || count > 8) return null;
  const exactBefore = new RegExp(`\\b(win|wins|won|to win)\\s+exactly\\s+${count}\\s+(mvp|most valuable player)s?\\b`, "i").test(lower)
    || new RegExp(`\\bexactly\\s+${count}\\s+(mvp|most valuable player)s?\\b`, "i").test(lower);
  const exactAfter = new RegExp(`\\b(win|wins|won)\\s+${count}\\s+(mvp|most valuable player)s?\\s+exactly\\b`, "i").test(lower);
  const exact = Boolean(exactBefore || exactAfter);
  return { count, exact };
}

function probabilityAtLeastFromCountDistribution(distribution, threshold) {
  if (!Array.isArray(distribution) || !distribution.length) return null;
  let sum = 0;
  for (const row of distribution) {
    const c = row?.count;
    const p = Number(row?.probabilityPct || 0);
    if (!Number.isFinite(p)) continue;
    if (typeof c === "number") {
      if (c >= threshold) sum += p;
      continue;
    }
    if (typeof c === "string" && /\+$/.test(c)) {
      const floor = Number(c.replace("+", ""));
      if (Number.isFinite(floor) && floor >= threshold) sum += p;
    }
  }
  return clamp(sum, 0.01, 99.9);
}

async function estimatePlayerMvpOdds(prompt, intent, playerName, localPlayerStatus, asOfDate) {
  const mvpIntent = parseMvpIntent(prompt);
  if (!mvpIntent || !playerName || !localPlayerStatus) return null;

  const liveMvpRef = await getLiveNflMvpReferenceByWeb(`${prompt} nfl`, playerName);
  if (liveMvpRef) {
    const label = mvpIntent.count > 1
      ? (mvpIntent.exact ? `${playerName} wins exactly ${mvpIntent.count} MVPs` : `${playerName} wins ${mvpIntent.count}+ MVPs`)
      : `${playerName} wins MVP`;
    return {
      ...liveMvpRef,
      playerName,
      summaryLabel: label,
    };
  }

  const hints = parseLocalIndexNote(localPlayerStatus.note);
  const profile = {
    name: playerName,
    position: hints.position || "",
    teamAbbr: localPlayerStatus.teamAbbr || hints.teamAbbr || "",
    yearsExp: hints.yearsExp,
    age: hints.age,
    status: localPlayerStatus.status || "unknown",
  };

  const teamName = NFL_TEAM_DISPLAY[profile.teamAbbr] || profile.teamAbbr || "";
  const sbRef = teamName ? await getSportsbookReferenceByTeamAndMarket(teamName, "super_bowl_winner") : null;
  const teamSuperBowlPct = sbRef ? Number(String(sbRef.impliedProbability || "").replace("%", "")) : 0;
  const outcomes = buildPlayerOutcomes(profile, {
    teamSuperBowlPct,
    asOfDate,
    calibration: phase2Calibration || {},
  });
  const mvp = outcomes?.awards?.mvp;
  if (!mvp) return null;

  let probabilityPct = null;
  if (intent?.horizon === "season" || intent?.horizon === "next_season") {
    if (mvpIntent.count >= 2) {
      return noChanceEstimate(prompt, asOfDate);
    }
    const posGroup = positionGroup(profile.position);
    const exp = Number(profile.yearsExp || 0);
    const teamSignal = clamp((teamSuperBowlPct || 4.5) * 0.9, 0.8, 14);
    let tierBoost = 1.0;
    const key = normalizePersonName(playerName);
    if (["patrick mahomes"].includes(key)) tierBoost = 1.65;
    else if (["josh allen", "joe burrow", "lamar jackson"].includes(key)) tierBoost = 1.45;
    else if (["jalen hurts", "justin herbert", "cj stroud"].includes(key)) tierBoost = 1.25;
    else if (["drake maye", "caleb williams", "jayden daniels"].includes(key)) tierBoost = 1.12;
    const expMul = exp <= 0 ? 0.65 : exp === 1 ? 0.82 : exp === 2 ? 1.0 : exp <= 7 ? 1.1 : 0.95;
    const posMul = posGroup === "qb" ? 1 : posGroup === "rb" || posGroup === "receiver" ? 0.12 : 0.05;
    const baseline = posGroup === "qb" ? 1.2 : 0.15;
    probabilityPct = clamp(teamSignal * tierBoost * expMul * posMul + baseline, 0.1, 40);
  } else {
    if (mvpIntent.exact) {
      const exactRow = Array.isArray(mvp.distribution)
        ? mvp.distribution.find((row) => typeof row?.count === "number" && row.count === mvpIntent.count)
        : null;
      probabilityPct = Number(exactRow?.probabilityPct || 0);
      if (!Number.isFinite(probabilityPct) || probabilityPct <= 0) probabilityPct = 0.01;
    } else {
      probabilityPct = probabilityAtLeastFromCountDistribution(mvp.distribution, mvpIntent.count);
    }
  }
  if (!Number.isFinite(probabilityPct)) return null;
  const mvpLabel = mvpIntent.count > 1
    ? (mvpIntent.exact ? `${playerName} wins exactly ${mvpIntent.count} MVPs` : `${playerName} wins ${mvpIntent.count}+ MVPs`)
    : `${playerName} wins MVP`;

  return {
    status: "ok",
    odds: toAmericanOdds(probabilityPct),
    impliedProbability: `${probabilityPct.toFixed(1)}%`,
    confidence: "High",
    assumptions: [
      "Deterministic player-award model used with position, age/experience, and team strength context.",
      sbRef ? `Team strength anchored by live Super Bowl reference (${sbRef.odds}).` : "No live team anchor available; historical priors used.",
    ],
    playerName,
    headshotUrl: null,
    summaryLabel: mvpLabel,
    liveChecked: Boolean(sbRef),
    asOfDate,
    sourceType: sbRef ? "hybrid_anchored" : "historical_model",
    sourceLabel: sbRef ? "Award model with team-market anchor" : "Award baseline model",
    trace: {
      award: "mvp",
      countTarget: mvpIntent.count,
      countMode: mvpIntent.exact ? "exact" : "at_least",
      horizon: intent?.horizon || "unspecified",
      expectedCountCareer: mvp.expectedCount,
    },
  };
}

function extractTdIntent(prompt) {
  const lower = normalizePrompt(prompt);
  const match = lower.match(/\b(\d{1,2})\s+(?:(receiving|rushing|passing)\s+)?(td|tds|touchdown|touchdowns)\b/);
  const tdCount = match ? Number(match[1]) : null;
  if (!tdCount) return null;

  const explicitFlavor = match?.[2] || "";
  if (explicitFlavor === "receiving") return { type: "receiving_td", count: tdCount };
  if (explicitFlavor === "passing") return { type: "passing_td", count: tdCount };
  if (explicitFlavor === "rushing") return { type: "rushing_td", count: tdCount };

  if (/\b(catch|catches|receiv|receiving)\b/.test(lower)) return { type: "receiving_td", count: tdCount };
  if (/\b(throw|throws|passing|passes)\b/.test(lower)) return { type: "passing_td", count: tdCount };
  if (/\b(rush|rushing|runs|run)\b/.test(lower)) return { type: "rushing_td", count: tdCount };
  return { type: "generic_td", count: tdCount };
}

function positionGroup(position) {
  const p = String(position || "").toUpperCase();
  if (!p) return "unknown";
  if (["LT", "LG", "C", "RG", "RT", "OL", "OT", "OG"].includes(p)) return "ol";
  if (["QB"].includes(p)) return "qb";
  if (["WR", "TE"].includes(p)) return "receiver";
  if (["RB", "FB"].includes(p)) return "rb";
  if (["K", "P", "LS"].includes(p)) return "specialist";
  return "other";
}

function evaluatePositionReality(prompt, playerStatus) {
  if (!playerStatus) return { noChance: false, capPct: null, reason: "" };
  const intent = extractTdIntent(prompt);
  if (!intent) return { noChance: false, capPct: null, reason: "" };

  const local = parseLocalIndexNote(playerStatus.note);
  const group = positionGroup(local.position);
  const c = intent.count;

  if (intent.type === "receiving_td" && group === "ol" && c >= 1) {
    return { noChance: true, capPct: null, reason: "offensive_line_receiving_td" };
  }

  if (intent.type === "passing_td" && group !== "qb") {
    if (group === "unknown") return { noChance: false, capPct: null, reason: "unknown_position_skip" };
    if (c >= 10) return { noChance: true, capPct: null, reason: "non_qb_high_passing_td" };
    return { noChance: false, capPct: 0.8, reason: "non_qb_passing_td_cap" };
  }

  if (intent.type === "receiving_td" && group === "qb" && c >= 3) {
    return { noChance: false, capPct: 0.7, reason: "qb_receiving_td_cap" };
  }

  if (intent.type === "rushing_td" && (group === "ol" || group === "specialist") && c >= 3) {
    return { noChance: true, capPct: null, reason: "line_or_specialist_rushing_td" };
  }

  return { noChance: false, capPct: null, reason: "" };
}

function hasHallOfFameIntent(prompt) {
  return /\b(hall of fame|hof)\b/i.test(String(prompt || ""));
}

function hasExplicitSeasonReference(prompt) {
  return /\b(this year|this season|next year|next season|upcoming season|in \d{4})\b/i.test(String(prompt || ""));
}

function buildHallOfFameEstimate(prompt, intent, localPlayerStatus, playerStatus, playerName, asOfDate) {
  if (!hasHallOfFameIntent(prompt)) return null;

  const status = localPlayerStatus?.status || playerStatus?.status || "unknown";
  const explicitSeason = hasExplicitSeasonReference(prompt);
  const localHints = parseLocalIndexNote(localPlayerStatus?.note);
  const posGroup = positionGroup(localHints.position);
  const yearsExp = Number(localHints.yearsExp || 0);
  const key = normalizePersonName(playerName || "");

  if (explicitSeason && status === "active") {
    return {
      status: "ok",
      odds: "NO CHANCE",
      impliedProbability: "0.0%",
      confidence: "High",
      assumptions: ["Active players are not Hall of Fame inductees in the current season."],
      playerName: playerName || null,
      headshotUrl: null,
      summaryLabel: buildFallbackLabel(prompt),
      liveChecked: Boolean(localPlayerStatus || playerStatus),
      asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
      sourceType: "constraint_model",
      sourceLabel: "Hall of Fame eligibility constraint",
    };
  }

  let careerPctByPos = 7;
  if (posGroup === "qb") careerPctByPos = 18;
  else if (posGroup === "receiver") careerPctByPos = 11;
  else if (posGroup === "rb") careerPctByPos = 9;
  else if (posGroup === "specialist") careerPctByPos = 3;

  const eliteOverrides = {
    "patrick mahomes": 78,
    "josh allen": 42,
    "joe burrow": 38,
    "lamar jackson": 46,
    "jalen hurts": 24,
    "justin herbert": 24,
    "cj stroud": 23,
    "drake maye": 15,
  };
  let careerPct = eliteOverrides[key] ?? careerPctByPos;

  if (status === "retired" && explicitSeason) careerPct = Math.min(Math.max(careerPct / 3, 4), 35);
  if (status === "active" && yearsExp <= 3) careerPct = Math.min(careerPct, posGroup === "qb" ? 28 : 18);
  if (status === "active" && yearsExp >= 8) careerPct = Math.min(careerPct * 1.08, 92);
  if (status === "unknown") careerPct = Math.max(4, careerPct * 0.8);

  const horizon = intent?.horizon || "career";
  let probPct = careerPct;
  if (horizon === "season" && status !== "active") probPct = Math.min(Math.max(careerPct / 3, 2), 45);
  if (horizon === "ever") probPct = Math.min(careerPct * 1.02, 95);
  probPct = clamp(probPct, 0.2, 95);

  return {
    status: "ok",
    odds: toAmericanOdds(probPct),
    impliedProbability: `${probPct.toFixed(1)}%`,
    confidence: localPlayerStatus ? "High" : "Medium",
    assumptions: [
      "Hall of Fame estimate uses position baseline + player-tier adjustment.",
      `Default interpretation for this prompt is long-horizon (${DEFAULT_NFL_SEASON} context when season unspecified).`,
    ],
    playerName: playerName || null,
    headshotUrl: null,
    summaryLabel: buildFallbackLabel(prompt),
    liveChecked: Boolean(localPlayerStatus || playerStatus),
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "historical_model",
    sourceLabel: "Hall of Fame baseline model",
  };
}

function buildRetirementEstimate(prompt, intent, localPlayerStatus, playerStatus, playerName, asOfDate) {
  const normalized = normalizePrompt(prompt);
  if (!hasRetirementIntent(prompt)) return null;

  const status = localPlayerStatus?.status || playerStatus?.status || "unknown";
  if (status === "retired" || status === "deceased") {
    return {
      status: "ok",
      odds: "NO CHANCE",
      impliedProbability: "0.0%",
      confidence: "High",
      assumptions: ["Player is already retired, so this specific retirement event cannot occur again."],
      playerName: playerName || null,
      headshotUrl: null,
      summaryLabel: buildFallbackLabel(prompt),
      liveChecked: false,
      asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
      sourceType: "constraint_model",
      sourceLabel: "Retirement status constraint",
    };
  }

  const localHints = parseLocalIndexNote(localPlayerStatus?.note);
  const ageRaw = Number(localHints.age);
  const expRaw = Number(localHints.yearsExp);
  const age = Number.isFinite(ageRaw) && ageRaw > 0
    ? ageRaw
    : Number.isFinite(expRaw) && expRaw >= 0
      ? 22 + expRaw
      : 28;
  const pos = String(localHints.position || "").toUpperCase();

  let seasonPct = 1.2;
  if (age <= 24) seasonPct = 0.6;
  else if (age <= 27) seasonPct = 0.9;
  else if (age <= 30) seasonPct = 1.4;
  else if (age <= 33) seasonPct = 2.8;
  else if (age <= 36) seasonPct = 7.5;
  else if (age <= 39) seasonPct = 18;
  else seasonPct = 36;

  if (pos === "QB") seasonPct *= 0.75;
  if (pos === "RB") seasonPct *= 1.25;
  if (Number.isFinite(expRaw) && expRaw <= 2) seasonPct = Math.min(seasonPct, 1.2);
  if (/\b(injury|injured|concussion|medical)\b/.test(normalized)) seasonPct *= 1.7;

  seasonPct = clamp(seasonPct, 0.1, 70);
  let probPct = seasonPct;
  if (intent?.horizon === "career") probPct = (1 - Math.pow(1 - seasonPct / 100, 8)) * 100;
  if (intent?.horizon === "ever") probPct = (1 - Math.pow(1 - seasonPct / 100, 15)) * 100;
  probPct = clamp(probPct, 0.1, 95);

  return {
    status: "ok",
    odds: toAmericanOdds(probPct),
    impliedProbability: `${probPct.toFixed(1)}%`,
    confidence: localPlayerStatus ? "High" : "Medium",
    assumptions: [
      "Age + career-stage retirement baseline model applied.",
      "Position-adjusted retirement tendency used where available.",
    ],
    playerName: playerName || null,
    headshotUrl: null,
    summaryLabel: buildFallbackLabel(prompt),
    liveChecked: Boolean(localPlayerStatus),
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "historical_model",
    sourceLabel: "Retirement baseline model",
  };
}

function parseTeamPlayoffIntent(prompt) {
  const p = normalizePrompt(prompt);
  const wantsMake = /\b(make|makes)\s+(the\s+)?playoffs?\b/.test(p);
  const wantsMiss = /\b(miss|misses)\s+(the\s+)?playoffs?\b/.test(p);
  if (!wantsMake && !wantsMiss) return null;
  const abbr = extractNflTeamAbbr(prompt);
  if (!abbr) return null;
  return { teamAbbr: abbr, outcome: wantsMiss ? "miss" : "make" };
}

function nflTeamPlayoffMakePct(teamAbbr) {
  const map = {
    KC: 82,
    BUF: 79,
    BAL: 77,
    CIN: 66,
    HOU: 64,
    SF: 74,
    PHI: 72,
    DET: 71,
    DAL: 63,
    GB: 62,
    MIA: 55,
    NYJ: 36,
    NE: 39,
    PIT: 50,
    LAR: 58,
  };
  return Number(map[teamAbbr] ?? 50);
}

function buildTeamPlayoffEstimate(prompt, asOfDate) {
  const parsed = parseTeamPlayoffIntent(prompt);
  if (!parsed) return null;
  const makePct = clamp(nflTeamPlayoffMakePct(parsed.teamAbbr), 2, 98);
  const probPct = parsed.outcome === "miss" ? 100 - makePct : makePct;
  const teamName = NFL_TEAM_DISPLAY[parsed.teamAbbr] || parsed.teamAbbr;
  return {
    status: "ok",
    odds: toAmericanOdds(probPct),
    impliedProbability: `${probPct.toFixed(1)}%`,
    confidence: "Medium",
    assumptions: [
      "Deterministic team-strength playoff baseline model used.",
      "Estimate reflects roster-era priors, schedule uncertainty, and league parity.",
    ],
    playerName: null,
    headshotUrl: null,
    summaryLabel: `${teamName} ${parsed.outcome === "miss" ? "miss playoffs" : "make playoffs"}`,
    liveChecked: false,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "historical_model",
    sourceLabel: "Team playoff baseline model",
    trace: {
      baselineEventKey: "nfl_team_playoff_make_miss",
      teamAbbr: parsed.teamAbbr,
      outcome: parsed.outcome,
    },
  };
}

function extractNflTeamAbbr(prompt) {
  const lower = normalizePrompt(prompt);
  const entries = Object.entries(NFL_TEAM_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, abbr] of entries) {
    const re = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(lower)) return abbr;
  }
  return null;
}

function hasWholeCareerTeamIntent(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(whole career|entire career|career on|career with|one-team career|plays his whole career|plays her whole career)\b/.test(
    lower
  );
}

function hasStrongSportsContext(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(nfl|nba|mlb|nhl|super bowls?|playoffs?|mvp|touchdowns?|tds?|interceptions?|ints?|passing|yards?|qb|quarterback|wide receiver|running back|tight end|afc|nfc|championships?|finals?|world series|stanley cup|retire(?:d|ment|s)?|retiring|hall of fame|all[- ]pro)\b/.test(
    lower
  );
}

function hasExplicitNonNflLeagueContext(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(nba|mlb|nhl|wnba|ncaa|soccer|premier league|ufc|mma|f1|formula 1|tennis|golf)\b/.test(
    lower
  );
}

function hasNflSpecificContext(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(nfl|super bowls?|afc|nfc|mvp|touchdowns?|tds?|interceptions?|ints?|passing yards?|qb|patriots|chiefs|bills|jets|dolphins|ravens|49ers|packers|cowboys|eagles)\b/.test(
    lower
  );
}

function isNonNflSportsPrompt(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(nba|mlb|nhl|wnba|ncaa|soccer|premier league|epl|champions league|ufc|mma|f1|formula 1|tennis|golf|world series|stanley cup|nba finals|mlb)\b/.test(
    lower
  );
}

function buildNflOnlySnarkResponse() {
  return {
    status: "snark",
    title: "NFL Only Right Now.",
    message: "This version is focused on NFL scenarios only.",
    hint: "Try an NFL prompt: QB/RB/WR/TE stat line, MVP, playoffs, or Super Bowl.",
  };
}

function mapSleeperStatus(rawStatus) {
  const s = String(rawStatus || "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("deceased")) return "deceased";
  if (s.includes("retired")) return "retired";
  if (["active", "ir", "pup", "reserve", "practice squad"].some((x) => s.includes(x))) return "active";
  return "unknown";
}

function ageFromBirthDate(birthDate) {
  const str = String(birthDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const dob = new Date(`${str}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  const dayDiff = now.getUTCDate() - dob.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return Number.isFinite(age) ? age : null;
}

async function loadNflPlayerIndex(force = false) {
  const isFresh = Date.now() - nflIndexLoadedAt < NFL_INDEX_REFRESH_MS && nflPlayerIndex.size > 0;
  if (!force && isFresh) return nflPlayerIndex;
  if (nflIndexLoadPromise) return nflIndexLoadPromise;

  nflIndexLoadPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NFL_INDEX_TIMEOUT_MS);
    try {
      const response = await fetch(SLEEPER_NFL_PLAYERS_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`NFL index fetch failed: ${response.status}`);
      const payload = await response.json();
      const map = new Map();
      for (const p of Object.values(payload || {})) {
        if (!p || typeof p !== "object") continue;
        const fullName = p.full_name || p.search_full_name || "";
        if (!fullName) continue;
        const key = normalizePersonName(fullName);
        if (!key) continue;
        const entry = {
          fullName,
          status: mapSleeperStatus(p.status),
          team: p.team || "",
          position: p.position || "",
          yearsExp: Number.isFinite(Number(p.years_exp)) ? Number(p.years_exp) : null,
          age: ageFromBirthDate(p.birth_date),
        };
        const existing = map.get(key);
        if (existing) {
          existing.push(entry);
        } else {
          map.set(key, [entry]);
        }
      }
      nflPlayerIndex = map;
      nflIndexLoadedAt = Date.now();
      return nflPlayerIndex;
    } finally {
      clearTimeout(timeoutId);
      nflIndexLoadPromise = null;
    }
  })();

  return nflIndexLoadPromise;
}

async function inferLocalNflPlayerFromPrompt(prompt, preferredTeamAbbr = "") {
  const text = normalizeEntityName(prompt);
  if (!text) return null;
  if (nflPlayerIndex.size === 0) {
    try {
      await loadNflPlayerIndex(false);
    } catch (_error) {
      return null;
    }
  }
  const tokens = text.split(" ").filter(Boolean);
  if (tokens.length < 2) return null;

  for (let n = 3; n >= 2; n -= 1) {
    for (let i = 0; i <= tokens.length - n; i += 1) {
      const phrase = tokens.slice(i, i + n).join(" ");
      const candidates = nflPlayerIndex.get(normalizePersonName(phrase));
      if (!candidates || candidates.length === 0) continue;
      const byTeam =
        preferredTeamAbbr &&
        candidates.find((c) => c.team && c.team.toUpperCase() === preferredTeamAbbr.toUpperCase());
      const active = candidates.find((c) => c.status === "active");
      const found = byTeam || active || candidates[0];
      return found?.fullName || null;
    }
  }
  return null;
}

async function getLocalNflPlayerStatus(player, preferredTeamAbbr = "") {
  if (!player) return null;
  if (nflPlayerIndex.size === 0) {
    try {
      await loadNflPlayerIndex(false);
    } catch (_error) {
      // Ignore: caller will fall back to web verification.
    }
  }
  const key = normalizePersonName(player);
  const candidates = nflPlayerIndex.get(key);
  if (!candidates || candidates.length === 0) return null;
  const exactTeam =
    preferredTeamAbbr &&
    candidates.find((c) => c.team && c.team.toUpperCase() === preferredTeamAbbr.toUpperCase());
  const activeCandidate = candidates.find((c) => c.status === "active");
  const found = exactTeam || activeCandidate || candidates[0];
  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    status: found.status || "unknown",
    isSportsFigure: "yes",
    teamAbbr: found.team || "",
    note: `local_nfl_index:${found.team || "FA"}:${found.position || "NA"}:${found.yearsExp ?? "NA"}:${found.age ?? "NA"}`,
  };
}

function inferPreferredPositionFromPrompt(prompt) {
  const lower = normalizePrompt(prompt);
  if (/\b(qb|quarterback|throw|throws|passing|passes|passing yards?|passing tds?)\b/.test(lower)) return "QB";
  if (/\b(catch|catches|receiv|receiving)\b/.test(lower)) return "WR";
  if (/\b(rush|rushing|runs?|carries)\b/.test(lower)) return "RB";
  return "";
}

async function alignPlayerStatusToPromptPosition(playerName, status, prompt, preferredTeamAbbr = "") {
  if (!playerName || !status) return status;
  if (nflPlayerIndex.size === 0) return status;
  const preferredPos = inferPreferredPositionFromPrompt(prompt);
  if (!preferredPos) return status;

  const key = normalizePersonName(playerName);
  const candidates = nflPlayerIndex.get(key);
  if (!candidates || candidates.length === 0) return status;
  const matching = candidates.filter((c) => String(c.position || "").toUpperCase() === preferredPos);
  if (!matching.length) return status;

  const teamMatch =
    preferredTeamAbbr &&
    matching.find((c) => c.team && c.team.toUpperCase() === preferredTeamAbbr.toUpperCase());
  const active = matching.find((c) => c.status === "active");
  const chosen = teamMatch || active || matching[0];
  return {
    ...status,
    teamAbbr: chosen.team || status.teamAbbr || "",
    note: `local_nfl_index:${chosen.team || "FA"}:${chosen.position || "NA"}:${chosen.yearsExp ?? "NA"}:${chosen.age ?? "NA"}`,
  };
}

function levenshteinDistance(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  if (!s) return t.length;
  if (!t) return s.length;
  const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= t.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[s.length][t.length];
}

async function getFuzzyLocalNflPlayerStatus(player, preferredTeamAbbr = "") {
  if (!player) return null;
  if (nflPlayerIndex.size === 0) {
    try {
      await loadNflPlayerIndex(false);
    } catch (_error) {
      return null;
    }
  }

  const inputKey = normalizePersonName(player);
  const inputParts = inputKey.split(" ").filter(Boolean);
  if (inputParts.length < 2) return null;

  let best = null;
  for (const [key, candidates] of nflPlayerIndex.entries()) {
    const parts = key.split(" ").filter(Boolean);
    if (parts.length < 2) continue;

    const fullDist = levenshteinDistance(inputKey, key);
    const firstDist = levenshteinDistance(inputParts[0], parts[0]);
    const lastDist = levenshteinDistance(inputParts[inputParts.length - 1], parts[parts.length - 1]);
    const score = fullDist * 2 + firstDist + lastDist;

    const plausible =
      fullDist <= 2 ||
      (firstDist <= 1 && lastDist <= 1 && Math.abs(inputParts.length - parts.length) <= 1);
    if (!plausible) continue;

    if (!best || score < best.score) {
      best = { key, candidates, score };
    }
  }

  if (!best || best.score > 6) return null;
  const exactTeam =
    preferredTeamAbbr &&
    best.candidates.find((c) => c.team && c.team.toUpperCase() === preferredTeamAbbr.toUpperCase());
  const activeCandidate = best.candidates.find((c) => c.status === "active");
  const found = exactTeam || activeCandidate || best.candidates[0];
  return {
    matchedName: found.fullName || player,
    status: {
      asOfDate: new Date().toISOString().slice(0, 10),
      status: found.status || "unknown",
      isSportsFigure: "yes",
      teamAbbr: found.team || "",
      note: `local_nfl_index_fuzzy:${found.team || "FA"}:${found.position || "NA"}:${found.yearsExp ?? "NA"}:${found.age ?? "NA"}`,
    },
  };
}

async function resolveNflPlayerProfile(playerName, preferredTeamAbbr = "") {
  if (!playerName) return null;
  let resolvedName = playerName;
  let local = await getLocalNflPlayerStatus(playerName, preferredTeamAbbr);
  if (!local) {
    const fuzzy = await getFuzzyLocalNflPlayerStatus(playerName, preferredTeamAbbr);
    if (fuzzy?.status) {
      local = fuzzy.status;
      resolvedName = fuzzy.matchedName || playerName;
    }
  }
  if (!local) return null;
  const hints = parseLocalIndexNote(local.note);
  return {
    name: resolvedName,
    teamAbbr: local.teamAbbr || hints.teamAbbr || "",
    position: hints.position || "",
    yearsExp: hints.yearsExp,
    age: hints.age,
    status: local.status || "unknown",
  };
}

async function fetchOddsApiJson(path, params = {}) {
  if (!ODDS_API_KEY) return null;
  const url = new URL(`${ODDS_API_BASE}${path}`);
  url.searchParams.set("apiKey", ODDS_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  const response = await fetch(url);
  if (!response.ok) return null;
  return await response.json();
}

async function getOddsApiSports(force = false) {
  const isFresh = Date.now() - oddsApiSportsLoadedAt < 6 * 60 * 60 * 1000 && Array.isArray(oddsApiSports);
  if (!force && isFresh) return oddsApiSports;
  if (oddsApiSportsPromise) return oddsApiSportsPromise;

  oddsApiSportsPromise = (async () => {
    try {
      const data = await fetchOddsApiJson("/v4/sports", { all: "true" });
      oddsApiSports = Array.isArray(data) ? data : [];
      oddsApiSportsLoadedAt = Date.now();
      return oddsApiSports;
    } finally {
      oddsApiSportsPromise = null;
    }
  })();

  return oddsApiSportsPromise;
}

function scoreOutcomeName(outcomeName, teamToken) {
  const o = normalizeTeamToken(outcomeName);
  const t = normalizeTeamToken(teamToken);
  if (!o || !t) return 0;
  if (o === t) return 10;
  if (o.includes(t) || t.includes(o)) return 7;
  const tWords = new Set(t.split(" "));
  let shared = 0;
  for (const w of o.split(" ")) if (tWords.has(w)) shared += 1;
  return shared;
}

function marketKeyHints(market) {
  if (market === "afc_winner") return ["afc", "championship", "conference"];
  if (market === "nfc_winner") return ["nfc", "championship", "conference"];
  if (market === "super_bowl_winner") return ["super", "bowl", "championship"];
  if (market === "nfl_mvp") return ["nfl", "mvp", "most valuable player", "award"];
  if (market === "nfl_afc_east_winner") return ["afc", "east", "division", "winner"];
  if (market === "nfl_afc_west_winner") return ["afc", "west", "division", "winner"];
  if (market === "nfl_afc_north_winner") return ["afc", "north", "division", "winner"];
  if (market === "nfl_afc_south_winner") return ["afc", "south", "division", "winner"];
  if (market === "nfl_nfc_east_winner") return ["nfc", "east", "division", "winner"];
  if (market === "nfl_nfc_west_winner") return ["nfc", "west", "division", "winner"];
  if (market === "nfl_nfc_north_winner") return ["nfc", "north", "division", "winner"];
  if (market === "nfl_nfc_south_winner") return ["nfc", "south", "division", "winner"];
  if (market === "nba_finals_winner") return ["nba", "final", "championship"];
  if (market === "world_series_winner") return ["world", "series", "mlb"];
  if (market === "stanley_cup_winner") return ["stanley", "cup", "nhl"];
  return [];
}

async function getSportsbookReferenceOdds(prompt) {
  if (!ODDS_API_KEY) return null;
  if (!isSportsbookCandidatePrompt(prompt)) return null;

  const intent = parseSportsbookFuturesIntent(prompt) || (await normalizeSportsbookIntentWithAI(prompt));
  if (!intent || !intent.team) return null;
  const cacheKey = `${intent.market}:${normalizeTeamToken(intent.team)}`;
  const cachedRef = sportsbookRefCache.get(cacheKey);
  if (cachedRef && Date.now() - cachedRef.ts < SPORTSBOOK_REF_CACHE_TTL_MS) {
    return cachedRef.value;
  }

  const sports = await getOddsApiSports(false);
  const detected = detectSportKeyForMarket(intent.market, sports);
  const candidateKeys = [
    ...(detected ? [detected] : []),
    ...getSportKeyCandidatesForMarket(intent.market),
  ];
  const hints = marketKeyHints(intent.market);
  const inferredKeys = (Array.isArray(sports) ? sports : [])
    .filter((s) => {
      const keyText = normalizeEntityName(`${s.key || ""} ${s.title || ""} ${s.description || ""}`);
      if (!keyText.includes("americanfootball") && !keyText.includes("basketball") && !keyText.includes("baseball") && !keyText.includes("icehockey")) {
        return false;
      }
      return hints.some((h) => keyText.includes(h));
    })
    .map((s) => s.key)
    .slice(0, 10);
  const tried = [...new Set([...candidateKeys, ...inferredKeys])];
  const strictKeywordMatch = marketNeedsStrictKeywordMatch(intent.market);

  let best = null;
  for (const sportKey of tried) {
    const data = await fetchOddsApiJson(`/v4/sports/${sportKey}/odds`, {
      regions: ODDS_API_REGIONS,
      markets: "outrights",
      oddsFormat: "american",
      bookmakers: ODDS_API_BOOKMAKERS,
    });
    if (!Array.isArray(data)) continue;

    for (const event of data) {
      for (const bookmaker of event.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const marketBlob = normalizeEntityName(
            `${market.key || ""} ${event.sport_title || ""} ${event.home_team || ""} ${event.away_team || ""}`
          );
          const keywordScore = scoreMarketKeywordMatch(marketBlob, hints);
          if (strictKeywordMatch && hints.length > 0 && keywordScore <= 0) continue;
          for (const outcome of market.outcomes || []) {
            const score = scoreOutcomeName(outcome.name, intent.team);
            if (score <= 0) continue;
            const price = Number(outcome.price);
            if (!Number.isFinite(price)) continue;
            const odds = price > 0 ? `+${price}` : `${price}`;
            const candidate = {
              score: score * 10 + keywordScore * 5,
              odds,
              impliedProbability: `${(price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100)) * 100
                }%`,
              bookmaker: bookmaker.title || bookmaker.key || "Sportsbook",
              asOfDate: new Date().toISOString().slice(0, 10),
              outcomeName: outcome.name || "",
              sportKey,
            };
            if (!best || candidate.score > best.score) best = candidate;
          }
        }
      }
    }
  }

  if (!best) {
    const ref = await getSportsbookReferenceByTeamAndMarket(intent.team, intent.market);
    if (!ref) return null;
    const value = {
      status: "ok",
      odds: ref.odds,
      impliedProbability: ref.impliedProbability,
      confidence: "High",
      assumptions: [],
      playerName: null,
      headshotUrl: null,
      summaryLabel: buildFallbackLabel(prompt),
      liveChecked: true,
      asOfDate: ref.asOfDate,
      sourceType: "sportsbook",
      sourceBook: ref.bookmaker,
      sourceLabel: `Reference odds via ${ref.bookmaker}`,
      sourceMarket: intent.market,
    };
    sportsbookRefCache.set(cacheKey, { ts: Date.now(), value });
    return value;
  }
  const value = {
    status: "ok",
    odds: best.odds,
    impliedProbability: `${Number.parseFloat(best.impliedProbability).toFixed(1)}%`,
    confidence: "High",
    assumptions: [],
    playerName: null,
    headshotUrl: null,
    summaryLabel: buildFallbackLabel(prompt),
    liveChecked: true,
    asOfDate: best.asOfDate,
    sourceType: "sportsbook",
    sourceBook: best.bookmaker,
    sourceLabel: `Reference odds via ${best.bookmaker}`,
    sourceMarket: intent.market,
  };
  sportsbookRefCache.set(cacheKey, { ts: Date.now(), value });
  return value;
}

async function getDynamicSportsbookReference(prompt) {
  if (!ODDS_API_KEY) return null;
  if (parseBeforeOtherTeamIntent(prompt)) return null;
  if (parseMultiYearWindow(prompt)) return null;
  if (!isSportsbookCandidatePrompt(prompt)) return null;
  const parsedIntent = parseSportsbookFuturesIntent(prompt);
  if (parsedIntent?.market) return null;

  const entityToken = extractSportsbookEntityToken(prompt);
  if (!entityToken) return null;
  const marketKeywords = marketKeywordsFromPrompt(prompt);
  const feedCacheKey = "major_us_outrights";
  const feedCached = dynamicSportsbookFeedCache.get(feedCacheKey);
  let entries = [];
  if (feedCached && Date.now() - feedCached.ts < 120000) {
    entries = feedCached.entries;
  } else {
    const sports = await getOddsApiSports(false);
    const candidateSportKeys = [...new Set(
      (Array.isArray(sports) ? sports : [])
        .map((s) => String(s.key || ""))
        .filter((k) =>
          /^(americanfootball_nfl|basketball_nba|baseball_mlb|icehockey_nhl)/.test(k)
        )
    )];
    const collected = [];
    for (const sportKey of candidateSportKeys) {
      const data = await fetchOddsApiJson(`/v4/sports/${sportKey}/odds`, {
        regions: ODDS_API_REGIONS,
        markets: "outrights",
        oddsFormat: "american",
        bookmakers: ODDS_API_BOOKMAKERS,
      });
      if (!Array.isArray(data)) continue;
      for (const event of data) {
        for (const bookmaker of event.bookmakers || []) {
          for (const market of bookmaker.markets || []) {
            for (const outcome of market.outcomes || []) {
              const price = Number(outcome.price);
              if (!Number.isFinite(price)) continue;
              const odds = price > 0 ? `+${price}` : `${price}`;
              collected.push({
                sportKey,
                bookmaker: bookmaker.title || bookmaker.key || "Sportsbook",
                marketKey: market.key || "",
                eventName: `${event.sport_title || ""} ${event.home_team || ""} ${event.away_team || ""}`.trim(),
                outcomeName: String(outcome.name || ""),
                odds,
                impliedProbability: `${(
                  (price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100)) * 100
                ).toFixed(1)}%`,
              });
            }
          }
        }
      }
    }
    entries = collected;
    dynamicSportsbookFeedCache.set(feedCacheKey, { ts: Date.now(), entries });
  }

  let best = null;
  for (const row of entries) {
    const blob = normalizeEntityName(
      `${row.sportKey} ${row.marketKey} ${row.eventName} ${row.outcomeName}`
    );
    const entityScore = scoreOutcomeName(row.outcomeName, entityToken);
    if (entityScore <= 0) continue;
    const keywordScore = scoreMarketKeywordMatch(blob, marketKeywords);
    if (marketKeywords.size > 0 && keywordScore <= 0) continue;
    const bookmakerBoost = /draftkings|fanduel/i.test(row.bookmaker) ? 1 : 0;
    const score = entityScore * 10 + keywordScore * 3 + bookmakerBoost;
    if (!best || score > best.score) {
      best = { ...row, score };
    }
  }

  if (!best || best.score < 10) return null;
  return {
    status: "ok",
    odds: best.odds,
    impliedProbability: best.impliedProbability,
    confidence: "High",
    assumptions: [],
    playerName: null,
    headshotUrl: null,
    summaryLabel: buildFallbackLabel(prompt),
    liveChecked: true,
    asOfDate: new Date().toISOString().slice(0, 10),
    sourceType: "sportsbook",
    sourceBook: best.bookmaker,
    sourceLabel: `Reference odds via ${best.bookmaker}`,
    sourceMarket: best.marketKey || "outrights",
  };
}

async function getSportsbookReferenceByTeamAndMarket(teamToken, market) {
  if (!ODDS_API_KEY || !teamToken || !market) return null;

  const sports = await getOddsApiSports(false);
  const detected = detectSportKeyForMarket(market, sports);
  const candidateKeys = [...(detected ? [detected] : []), ...getSportKeyCandidatesForMarket(market)];
  const tried = [...new Set(candidateKeys)];
  const hints = marketKeyHints(market);
  const strictKeywordMatch = marketNeedsStrictKeywordMatch(market);

  let best = null;
  for (const sportKey of tried) {
    const data = await fetchOddsApiJson(`/v4/sports/${sportKey}/odds`, {
      regions: ODDS_API_REGIONS,
      markets: "outrights",
      oddsFormat: "american",
      bookmakers: ODDS_API_BOOKMAKERS,
    });
    if (!Array.isArray(data)) continue;

    for (const event of data) {
      for (const bookmaker of event.bookmakers || []) {
        for (const m of bookmaker.markets || []) {
          const marketBlob = normalizeEntityName(
            `${m.key || ""} ${event.sport_title || ""} ${event.home_team || ""} ${event.away_team || ""}`
          );
          const keywordScore = scoreMarketKeywordMatch(marketBlob, new Set(hints));
          if (strictKeywordMatch && hints.length > 0 && keywordScore <= 0) continue;
          for (const outcome of m.outcomes || []) {
            const score = scoreOutcomeName(outcome.name, teamToken);
            if (score <= 0) continue;
            const price = Number(outcome.price);
            if (!Number.isFinite(price)) continue;
            const odds = price > 0 ? `+${price}` : `${price}`;
            const impliedPct = (price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100)) * 100;
            const candidate = {
              score: score * 10 + keywordScore * 5,
              odds,
              impliedProbability: `${impliedPct.toFixed(1)}%`,
              bookmaker: bookmaker.title || bookmaker.key || "Sportsbook",
              asOfDate: new Date().toISOString().slice(0, 10),
              sportKey,
              market,
            };
            if (!best || candidate.score > best.score) best = candidate;
          }
        }
      }
    }
  }

  return best;
}

async function buildMultiYearTeamTitleEstimate(prompt, asOfDate) {
  const years = parseMultiYearWindow(prompt);
  if (!years) return null;
  const intent = parseSportsbookFuturesIntent(prompt);
  if (!intent || !intent.market || !intent.team) return null;
  const supported = new Set([
    "super_bowl_winner",
    "afc_winner",
    "nfc_winner",
    "nfl_afc_east_winner",
    "nfl_afc_west_winner",
    "nfl_afc_north_winner",
    "nfl_afc_south_winner",
    "nfl_nfc_east_winner",
    "nfl_nfc_west_winner",
    "nfl_nfc_north_winner",
    "nfl_nfc_south_winner",
    "nba_finals_winner",
    "world_series_winner",
    "stanley_cup_winner",
  ]);
  if (!supported.has(intent.market)) return null;

  const ref = await getSportsbookReferenceByTeamAndMarket(intent.team, intent.market);
  let seasonPct = ref ? Number(String(ref.impliedProbability || "").replace("%", "")) : null;
  if (!Number.isFinite(seasonPct) || seasonPct <= 0) {
    const defaults = {
      super_bowl_winner: 4.5,
      afc_winner: 9.5,
      nfc_winner: 9.5,
      nfl_afc_east_winner: 22.0,
      nfl_afc_west_winner: 22.0,
      nfl_afc_north_winner: 22.0,
      nfl_afc_south_winner: 22.0,
      nfl_nfc_east_winner: 22.0,
      nfl_nfc_west_winner: 22.0,
      nfl_nfc_north_winner: 22.0,
      nfl_nfc_south_winner: 22.0,
      nba_finals_winner: 6.5,
      world_series_winner: 6.0,
      stanley_cup_winner: 6.0,
    };
    seasonPct = defaults[intent.market] || 5.0;
  }
  seasonPct = clamp(seasonPct, 0.2, 90);

  const perYear = [];
  for (let i = 0; i < years; i += 1) {
    const decay = Math.pow(0.96, i);
    perYear.push(clamp((seasonPct / 100) * decay, 0.001, 0.95));
  }
  const atLeastOne = (1 - perYear.reduce((acc, p) => acc * (1 - p), 1)) * 100;
  const probPct = clamp(atLeastOne, 0.1, 99.9);
  const teamLabel = titleCaseWords(intent.team);

  return {
    status: "ok",
    odds: toAmericanOdds(probPct),
    impliedProbability: `${probPct.toFixed(1)}%`,
    confidence: ref ? "High" : "Medium",
    assumptions: [
      "Multi-year estimate compounds season-level title probability across the requested window.",
      "Year-over-year decay is applied to reflect roster/coaching/league volatility.",
    ],
    playerName: null,
    headshotUrl: null,
    summaryLabel: `${teamLabel} win title in ${years} years`,
    liveChecked: Boolean(ref),
    asOfDate: ref?.asOfDate || asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: ref ? "hybrid_anchored" : "historical_model",
    sourceBook: ref?.bookmaker || undefined,
    sourceLabel: ref
      ? `Multi-year model anchored to ${ref.bookmaker}`
      : "Multi-year title baseline model",
    sourceMarket: intent.market,
    trace: {
      baselineEventKey: "multi_year_team_title_window",
      years,
      seasonPct,
      market: intent.market,
      anchored: Boolean(ref),
    },
  };
}

async function buildSeasonTeamTitleFallback(prompt, asOfDate) {
  const years = parseMultiYearWindow(prompt);
  if (years) return null;
  const intent = parseSportsbookFuturesIntent(prompt);
  if (!intent || !intent.market || !intent.team) return null;
  const supported = new Set([
    "super_bowl_winner",
    "afc_winner",
    "nfc_winner",
    "nfl_afc_east_winner",
    "nfl_afc_west_winner",
    "nfl_afc_north_winner",
    "nfl_afc_south_winner",
    "nfl_nfc_east_winner",
    "nfl_nfc_west_winner",
    "nfl_nfc_north_winner",
    "nfl_nfc_south_winner",
    "nba_finals_winner",
    "world_series_winner",
    "stanley_cup_winner",
  ]);
  if (!supported.has(intent.market)) return null;

  const ref = await getSportsbookReferenceByTeamAndMarket(intent.team, intent.market);
  if (ref) {
    return {
      status: "ok",
      odds: ref.odds,
      impliedProbability: ref.impliedProbability,
      confidence: "High",
      assumptions: [],
      playerName: null,
      headshotUrl: null,
      summaryLabel: buildFallbackLabel(prompt),
      liveChecked: true,
      asOfDate: ref.asOfDate || asOfDate || new Date().toISOString().slice(0, 10),
      sourceType: "sportsbook",
      sourceBook: ref.bookmaker,
      sourceLabel: `Reference odds via ${ref.bookmaker}`,
      sourceMarket: intent.market,
    };
  }

  const defaults = {
    super_bowl_winner: 4.5,
    afc_winner: 9.5,
    nfc_winner: 9.5,
    nfl_afc_east_winner: 22.0,
    nfl_afc_west_winner: 22.0,
    nfl_afc_north_winner: 22.0,
    nfl_afc_south_winner: 22.0,
    nfl_nfc_east_winner: 22.0,
    nfl_nfc_west_winner: 22.0,
    nfl_nfc_north_winner: 22.0,
    nfl_nfc_south_winner: 22.0,
    nba_finals_winner: 6.5,
    world_series_winner: 6.0,
    stanley_cup_winner: 6.0,
  };
  const seasonPct = clamp(Number(defaults[intent.market] || 5.0), 0.2, 90);
  return {
    status: "ok",
    odds: toAmericanOdds(seasonPct),
    impliedProbability: `${seasonPct.toFixed(1)}%`,
    confidence: "Medium",
    assumptions: [
      "Live sportsbook line unavailable at request time.",
      "Deterministic season baseline used for this futures market.",
    ],
    playerName: null,
    headshotUrl: null,
    summaryLabel: buildFallbackLabel(prompt),
    liveChecked: false,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "historical_model",
    sourceLabel: "Season futures baseline model",
    sourceMarket: intent.market,
  };
}

function hasNflMvpPrompt(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(mvp|most valuable player)\b/.test(lower);
}

async function getLiveNflMvpReferenceByWeb(prompt, playerHint = "") {
  if (!hasNflMvpPrompt(prompt)) return null;
  const playerToken =
    playerHint ||
    parseSportsbookFuturesIntent(prompt)?.team ||
    normalizeTeamToken(extractPlayerName(prompt) || "");
  if (!playerToken) return null;

  const today = new Date().toISOString().slice(0, 10);
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      tools: [{ type: "web_search_preview" }],
      input: [
        {
          role: "system",
          content:
            "Return JSON only. Find a current US sportsbook NFL MVP line for the requested player. Prefer DraftKings or FanDuel. Return american odds like +850 or -120.",
        },
        {
          role: "user",
          content: `As of ${today}, find a current DraftKings or FanDuel NFL MVP odds line for player token: ${playerToken}.`,
        },
      ],
      max_output_tokens: 140,
      text: {
        format: {
          type: "json_schema",
          name: "nfl_mvp_reference",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              found: { type: "boolean" },
              player_name: { type: "string" },
              sportsbook: { type: "string" },
              odds: { type: "string" },
              as_of_date: { type: "string" },
            },
            required: ["found", "player_name", "sportsbook", "odds", "as_of_date"],
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text || "{}");
    if (!parsed?.found) return null;
    const odds = String(parsed.odds || "").trim();
    if (!/^[+-]\d{2,6}$/.test(odds)) return null;
    const n = Number(odds.replace("+", ""));
    if (!Number.isFinite(n) || n === 0) return null;
    const p = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
    const impliedProbability = `${(p * 100).toFixed(1)}%`;
    const book = String(parsed.sportsbook || "Sportsbook").trim();
    return {
      status: "ok",
      odds,
      impliedProbability,
      confidence: "High",
      assumptions: [],
      playerName: null,
      headshotUrl: null,
      summaryLabel: buildFallbackLabel(prompt),
      liveChecked: true,
      asOfDate: parsed.as_of_date || today,
      sourceType: "sportsbook",
      sourceBook: book,
      sourceLabel: `Reference odds via ${book}`,
      sourceMarket: "nfl_mvp",
    };
  } catch (_error) {
    return null;
  }
}

async function buildReferenceAnchors(prompt, localPlayerStatus, teamHint) {
  if (!ODDS_API_KEY) return [];
  const anchors = [];
  const lower = normalizePrompt(prompt);

  const teamFromPlayer = localPlayerStatus?.teamAbbr ? NFL_TEAM_DISPLAY[localPlayerStatus.teamAbbr] : "";
  const teamToken = teamHint || teamFromPlayer;

  if (!teamToken) return anchors;

  if (/\bsuper bowl\b/.test(lower)) {
    const ref = await getSportsbookReferenceByTeamAndMarket(teamToken, "super_bowl_winner");
    if (ref) {
      anchors.push(
        `${teamToken} Super Bowl winner reference: ${ref.odds} (${ref.impliedProbability}) via ${ref.bookmaker} as of ${ref.asOfDate}`
      );
    }
  }

  if (/\bafc\b/.test(lower)) {
    const ref = await getSportsbookReferenceByTeamAndMarket(teamToken, "afc_winner");
    if (ref) {
      anchors.push(
        `${teamToken} AFC winner reference: ${ref.odds} (${ref.impliedProbability}) via ${ref.bookmaker} as of ${ref.asOfDate}`
      );
    }
  }

  if (/\bnfc\b/.test(lower)) {
    const ref = await getSportsbookReferenceByTeamAndMarket(teamToken, "nfc_winner");
    if (ref) {
      anchors.push(
        `${teamToken} NFC winner reference: ${ref.odds} (${ref.impliedProbability}) via ${ref.bookmaker} as of ${ref.asOfDate}`
      );
    }
  }

  return anchors;
}

function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function toAmericanOdds(probPct) {
  const p = clamp(probPct / 100, 0.001, 0.999);
  const raw = p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
  const step = Math.abs(raw) > 1000 ? 10 : 5;
  const rounded = Math.round(raw / step) * step;
  if (rounded > 0) return `+${rounded}`;
  return `${rounded}`;
}

function parseCombinedPassingTdIntent(prompt) {
  const p = normalizePrompt(prompt);
  if (!/\b(and|combine|combined|together)\b/.test(p)) return null;
  const m =
    p.match(/\bcombine(?:d)?\s+for\s+(\d{1,2})\s+(?:total\s+)?(?:pass(?:ing)?\s+)?(?:td|tds|touchdown|touchdowns)\b/) ||
    p.match(/\btogether\s+for\s+(\d{1,2})\s+(?:pass(?:ing)?\s+)?(?:td|tds|touchdown|touchdowns)\b/);
  if (!m) return null;
  const threshold = Number(m[1]);
  if (!Number.isFinite(threshold) || threshold < 1) return null;
  return { threshold };
}

function parseCombinedPassingYardsIntent(prompt) {
  const p = normalizePrompt(prompt);
  if (!/\b(and|combine|combined|together)\b/.test(p)) return null;
  const m =
    p.match(/\bcombine(?:d)?\s+for\s+(\d{3,5})\s+(?:total\s+)?(?:(pass(?:ing)?\s+)?)?(?:yds?|yards?)\b/) ||
    p.match(/\btogether\s+for\s+(\d{3,5})\s+(?:(pass(?:ing)?\s+)?)?(?:yds?|yards?)\b/);
  if (!m) return null;
  const threshold = Number(m[1]);
  if (!Number.isFinite(threshold) || threshold < 100) return null;
  const explicitPassing = /\bpass/.test(m[0] || "");
  return { threshold, explicitPassing };
}

function poissonTailAtLeast(lambda, threshold) {
  const k = Math.max(0, Math.floor(Number(threshold || 0)));
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i += 1) {
    term = (term * lambda) / i;
    cdf += term;
  }
  return clamp(1 - cdf, 0, 1);
}

function erfApprox(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function normalTailAtLeast(mean, sigma, threshold) {
  const sd = Math.max(1, Number(sigma) || 1);
  const z = (Number(threshold || 0) - 0.5 - Number(mean || 0)) / (sd * Math.sqrt(2));
  const cdf = 0.5 * (1 + erfApprox(z));
  return clamp(1 - cdf, 0, 1);
}

function qbTierFromName(name) {
  const n = normalizePersonName(name);
  if (["patrick mahomes", "josh allen", "joe burrow", "lamar jackson"].includes(n)) return "elite";
  if (["jalen hurts", "justin herbert", "cj stroud"].includes(n)) return "high";
  if (["drake maye", "caleb williams", "jayden daniels"].includes(n)) return "young";
  return "default";
}

function inferIsQbProfile(profile) {
  const pos = String(profile?.position || "").toUpperCase();
  if (pos === "QB") return true;
  const tier = qbTierFromName(profile?.name || "");
  return tier !== "default";
}

function passingTdMeanForProfile(profile) {
  if (!inferIsQbProfile(profile)) return 0.35;
  const tier = qbTierFromName(profile?.name || "");
  const tierMeans = {
    elite: 34,
    high: 30,
    young: 24,
    default: 27,
  };
  let lambda = Number(tierMeans[tier] ?? tierMeans.default);
  const yearsExp = Number(profile?.yearsExp || 0);
  if (Number.isFinite(yearsExp) && yearsExp <= 1) lambda *= 0.9;
  if (Number.isFinite(yearsExp) && yearsExp >= 8) lambda *= 0.95;
  return clamp(lambda, 0.2, 45);
}

function passingYardsMeanForProfile(profile) {
  if (!inferIsQbProfile(profile)) return 35;
  const tier = qbTierFromName(profile?.name || "");
  const tierMeans = {
    elite: 4300,
    high: 3900,
    young: 3400,
    default: 3600,
  };
  let mu = Number(tierMeans[tier] ?? tierMeans.default);
  const yearsExp = Number(profile?.yearsExp || 0);
  if (Number.isFinite(yearsExp) && yearsExp <= 1) mu *= 0.88;
  if (Number.isFinite(yearsExp) && yearsExp >= 9) mu *= 0.94;
  return clamp(mu, 80, 5600);
}

function passingYardsSigmaForProfile(profile, mean) {
  if (!inferIsQbProfile(profile)) return 65;
  const mu = Number(mean || passingYardsMeanForProfile(profile));
  return clamp(Math.sqrt((0.23 * mu) ** 2 + 320 ** 2), 420, 1600);
}

function shortNameLabel(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  return parts[0] || "Player";
}

function buildCombinedPassingTdEstimate(prompt, combinedIntent, profiles, asOfDate) {
  if (!combinedIntent || !Array.isArray(profiles) || profiles.length < 2) return null;
  const [a, b] = profiles;
  const threshold = combinedIntent.threshold;
  const lambda = passingTdMeanForProfile(a) + passingTdMeanForProfile(b);
  let probabilityPct = poissonTailAtLeast(lambda, threshold) * 100;

  const aIsQb = String(a?.position || "").toUpperCase() === "QB";
  const bIsQb = String(b?.position || "").toUpperCase() === "QB";
  if ((aIsQb || bIsQb) && threshold <= 10) probabilityPct = Math.max(probabilityPct, 99.7);
  if (aIsQb && bIsQb && threshold <= 15) probabilityPct = Math.max(probabilityPct, 99.9);
  if ((aIsQb || bIsQb) && threshold <= 5) probabilityPct = Math.max(probabilityPct, 99.95);
  probabilityPct = clamp(probabilityPct, 0.1, 99.95);

  return {
    status: "ok",
    odds: toAmericanOdds(probabilityPct),
    impliedProbability: `${probabilityPct.toFixed(1)}%`,
    confidence: "High",
    assumptions: [
      "Deterministic two-player season passing TD model used.",
      "Quarterback role and player-tier season means drive combined distribution.",
    ],
    playerName: a?.name || null,
    headshotUrl: null,
    summaryLabel: `${shortNameLabel(a?.name)} + ${shortNameLabel(b?.name)} combine for ${threshold} pass TDs`,
    liveChecked: false,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "historical_model",
    sourceLabel: "Two-player passing TD baseline model",
    trace: {
      baselineEventKey: "nfl_two_player_combined_passing_tds_threshold",
      threshold,
      lambda,
      players: [a?.name || "", b?.name || ""],
    },
  };
}

function buildCombinedPassingYardsEstimate(prompt, combinedIntent, profiles, asOfDate) {
  if (!combinedIntent || !Array.isArray(profiles) || profiles.length < 2) return null;
  const [a, b] = profiles;
  const threshold = combinedIntent.threshold;

  const aMean = passingYardsMeanForProfile(a);
  const bMean = passingYardsMeanForProfile(b);
  const aSigma = passingYardsSigmaForProfile(a, aMean);
  const bSigma = passingYardsSigmaForProfile(b, bMean);
  const mean = aMean + bMean;
  const sigma = Math.sqrt(aSigma * aSigma + bSigma * bSigma);

  const aIsQb = inferIsQbProfile(a);
  const bIsQb = inferIsQbProfile(b);
  if (!combinedIntent.explicitPassing && !(aIsQb && bIsQb)) return null;

  let probabilityPct = normalTailAtLeast(mean, sigma, threshold) * 100;
  if (aIsQb && bIsQb && threshold <= 6000) probabilityPct = Math.max(probabilityPct, 92);
  if (aIsQb && bIsQb && threshold <= 7000) probabilityPct = Math.max(probabilityPct, 78);
  probabilityPct = clamp(probabilityPct, 0.1, 99.9);

  return {
    status: "ok",
    odds: toAmericanOdds(probabilityPct),
    impliedProbability: `${probabilityPct.toFixed(1)}%`,
    confidence: "High",
    assumptions: [
      "Deterministic two-player season passing yards model used.",
      "Player-specific passing-yard means and variance drive combined distribution.",
    ],
    playerName: a?.name || null,
    headshotUrl: null,
    summaryLabel: `${shortNameLabel(a?.name)} + ${shortNameLabel(b?.name)} combine for ${threshold} pass yds`,
    liveChecked: false,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "historical_model",
    sourceLabel: "Two-player passing yards baseline model",
    trace: {
      baselineEventKey: "nfl_two_player_combined_passing_yards_threshold",
      threshold,
      mean,
      sigma,
      players: [a?.name || "", b?.name || ""],
    },
  };
}

function hasComebackIntent(prompt) {
  return COMEBACK_PATTERNS.some((pattern) => pattern.test(String(prompt || "")));
}

function hasRetirementIntent(prompt) {
  const text = String(prompt || "");
  return RETIREMENT_PATTERNS.some((pattern) => pattern.test(text)) && !hasComebackIntent(text);
}

function isKnownDeceasedMention(prompt) {
  const lower = String(prompt || "").toLowerCase();
  return KNOWN_DECEASED_ATHLETES.some((name) => lower.includes(name));
}

function isKnownLongRetiredMention(prompt) {
  const lower = String(prompt || "").toLowerCase();
  return KNOWN_LONG_RETIRED_ATHLETES.some((name) => lower.includes(name));
}

function isKnownActiveMention(prompt) {
  const lower = String(prompt || "").toLowerCase();
  return KNOWN_ACTIVE_PLAYERS.some((name) => lower.includes(name));
}

function inferRetirementGapYears(contextText) {
  const yearMatch = contextText.match(/\bretired\s+in\s+(19\d{2}|20\d{2})\b/);
  if (!yearMatch) return null;
  const retiredYear = Number(yearMatch[1]);
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isFinite(retiredYear)) return null;
  return currentYear - retiredYear;
}

function inferAge(contextText) {
  const ageMatch = contextText.match(/\bage\s+(\d{2})\b/);
  if (!ageMatch) return null;
  const age = Number(ageMatch[1]);
  return Number.isFinite(age) ? age : null;
}

function isImpossibleScenario(prompt, liveContext) {
  const comebackIntent = hasComebackIntent(prompt);
  if (!comebackIntent) return false;
  if (isKnownDeceasedMention(prompt)) return true;
  if (isKnownLongRetiredMention(prompt)) return true;

  const contextText = `${(liveContext?.facts || []).join(" ")} ${(liveContext?.constraints || []).join(" ")}`.toLowerCase();
  if (/\b(dead|deceased|died|passed away)\b/.test(contextText)) return true;
  const age = inferAge(contextText);
  if (age !== null && age >= 55) return true;
  const gapYears = inferRetirementGapYears(contextText);
  if (gapYears !== null && gapYears >= 12) return true;
  if (/\bretired\b/.test(contextText) && /\bdecade|years?\b/.test(contextText)) return true;
  return false;
}

function isContradictoryComebackScenario(prompt, liveContext) {
  if (!hasComebackIntent(prompt)) return false;
  if (isImpossibleScenario(prompt, liveContext)) return false;

  if (isKnownActiveMention(prompt)) return true;

  const contextText = `${(liveContext?.facts || []).join(" ")} ${(liveContext?.constraints || []).join(" ")}`.toLowerCase();
  const indicatesActive = /\b(active|currently playing|starter|under contract|on roster)\b/.test(contextText);
  const indicatesRetired = /\b(retired|retirement)\b/.test(contextText);
  return indicatesActive && !indicatesRetired;
}

function buildSnarkResponse(prompt) {
  const player = extractPlayerName(prompt) || "That player";
  const lines = [
    `${player} coming out of retirement? Nice try.`,
    `${player} isn’t retired, so this hypothetical is doing too much.`,
    `${player} “returns” from retirement only after retiring first. Try another one.`,
  ];
  const idx = hashString(normalizePrompt(prompt)) % lines.length;
  return {
    status: "snark",
    title: "Nice Try.",
    message: lines[idx],
    hint: "Try a real sports hypothetical and I’ll price it.",
  };
}

function buildComebackSnarkResponse(player) {
  const label = player || "That player";
  return {
    status: "snark",
    title: "Nice Try.",
    message: `${label} is currently active, so there’s no retirement comeback to price.`,
    hint: "Try a real sports hypothetical and I’ll price it.",
  };
}

function buildNonSportsPersonSnarkResponse(player, prompt = "") {
  if (prompt) {
    const offTopic = buildOffTopicSnarkResponse(prompt);
    if (offTopic?.title !== "Nice Try." || /\b(cocaine|snort|drug|rehab|dating|jail|arrest|crime)\b/.test(normalizePrompt(prompt))) {
      return offTopic;
    }
  }
  const label = player || "That person";
  return {
    status: "snark",
    title: "Nice Try.",
    message: `${label} isn’t showing up as a sports figure, so I’m not pricing that one.`,
    hint: "Try a player, team, or league scenario.",
  };
}

function buildTeamCareerContradictionSnark(player, currentTeamAbbr, targetTeamAbbr) {
  const label = player || "That player";
  const current = currentTeamAbbr || "their current team";
  const target = targetTeamAbbr || "that team";
  return {
    status: "snark",
    title: "Nice Try.",
    message: `${label} is currently on ${current}, so “whole career on ${target}” is already busted.`,
    hint: "Try a scenario that matches current roster reality.",
  };
}

function parseUnpriceableSubjectiveReason(prompt) {
  const lower = normalizePrompt(prompt);
  if (/\b(best|greatest|goat)\s+(qb|quarterback)\s+(ever|of all time)\b/.test(lower)) {
    return "best_qb_ever";
  }
  if (/\b(best|greatest|goat)\s+(tight end|te)\s+(ever|of all time)\b/.test(lower)) {
    return "best_te_ever";
  }
  if (/\b(best|greatest|goat)\s+(head coach|coach)\s+(ever|of all time)\b/.test(lower)) {
    return "best_coach_ever";
  }
  if (/\b(best|greatest|goat)\s+(qb|quarterback|player)\s+(ever|of all time)\b/.test(lower)) {
    return "all_time_best_debate";
  }
  if (/\b(greatest|best)\s+ever\b/.test(lower)) {
    return "all_time_best_debate";
  }
  if (/\bwho('?s| is)?\s+better\b/.test(lower)) {
    return "head_to_head_subjective";
  }
  if (/\b(top\s*\d+|mount\s*rushmore)\b/.test(lower)) {
    return "ranking_subjective";
  }
  if (/\b(legacy|clutch gene|more talented|better leader|better intangibles)\b/.test(lower)) {
    return "subjective_trait";
  }
  return "";
}

function buildUnpriceableSnarkResponse(reason) {
  const map = {
    best_qb_ever: {
      title: "Come On.",
      message: "How do you expect me to put a number on 'best ever'? (And it's obviously Tom Brady, ask me something else.)",
      hint: "Try something measurable, like MVPs, playoff wins, or passing TDs in a season.",
    },
    best_te_ever: {
      title: "Come On.",
      message: "How do you expect me to put a number on 'best ever'? (And it's obviously Rob Gronkowski, ask me something else.)",
      hint: "Try something measurable, like career TDs, All-Pros, or playoff production.",
    },
    best_coach_ever: {
      title: "Come On.",
      message: "How do you expect me to put a number on 'best ever'? (And it's obviously Bill Belichick, ask me something else.)",
      hint: "Try something measurable, like playoff wins, championships, or win percentage.",
    },
    all_time_best_debate: {
      title: "Come On.",
      message: "How do you expect me to put a number on 'best ever'?",
      hint: "Try something measurable, like MVPs, playoff wins, or passing TDs in a season.",
    },
    head_to_head_subjective: {
      title: "Hot Take Zone.",
      message: "I can’t price pure opinion battles like 'who is better' as one clean probability.",
      hint: "Try a specific outcome for one player or team.",
    },
    ranking_subjective: {
      title: "Debate Club.",
      message: "Rankings and Mount Rushmore arguments are subjective, not clean probability events.",
      hint: "Try a measurable milestone instead.",
    },
    subjective_trait: {
      title: "Too Vague.",
      message: "That’s a trait debate, not a clearly measurable event I can price reliably.",
      hint: "Try a concrete stat, award, or season outcome.",
    },
  };
  const picked = map[reason] || map.subjective_trait;
  return {
    status: "snark",
    title: picked.title,
    message: picked.message,
    hint: picked.hint,
  };
}

function noChanceEstimate(prompt, asOfDate) {
  return {
    status: "ok",
    odds: "NO CHANCE",
    impliedProbability: "0.0%",
    confidence: "High",
    assumptions: ["Scenario is not feasible under real-world constraints."],
    playerName: null,
    headshotUrl: null,
    summaryLabel: buildFallbackLabel(prompt),
    liveChecked: Boolean(asOfDate),
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    sourceType: "hypothetical",
    sourceLabel: "Constraint-based no-chance outcome",
  };
}

function hardImpossibleReason(prompt) {
  const lower = normalizePrompt(prompt);
  if (/\b(live|lives|living)\s+forever\b/.test(lower)) return "Biological impossibility.";
  if (/\b(immortal|immortality|eternal life|never dies?|cannot die)\b/.test(lower)) {
    return "Biological impossibility.";
  }
  if (/\b(time travel|time travels?|teleport|teleports?|wormhole)\b/.test(lower)) return "Physics-breaking scenario.";
  if (/\b(resurrect|comes back from the dead|undead)\b/.test(lower)) return "Biological impossibility.";
  if (/\b(two places at once|same time on two teams|plays for both teams at the same time)\b/.test(lower)) {
    return "Single-person simultaneity impossibility.";
  }
  return "";
}

function hasConditionalScenario(prompt) {
  return /\bif\b/.test(normalizePrompt(prompt));
}

function hasJointEventScenario(prompt) {
  const lower = normalizePrompt(prompt);
  return /\b(and|both)\b/.test(lower) && /\b(win|wins|make|makes|reach|reaches|mvp|playoffs?|championship)\b/.test(lower);
}

function awardRoleNoChance(prompt, localPlayerStatus) {
  const lower = normalizePrompt(prompt);
  const asksAward = /\b(mvp|offensive player of the year|defensive player of the year|opoy|dpoy)\b/.test(lower);
  if (!asksAward) return null;
  if (/\b(coach|owner|gm|general manager)\b/.test(lower)) return "Award is player-only for this scenario.";
  if (KNOWN_NON_PLAYER_FIGURES.some((name) => lower.includes(name))) {
    return "Award is player-only for this scenario.";
  }
  const local = parseLocalIndexNote(localPlayerStatus?.note);
  const pos = String(local.position || "").toUpperCase();
  if (/\bpassing td|passing touchdowns?|throws?\b/.test(lower) && pos && pos !== "QB") {
    return "Passing-award style scenario conflicts with player position constraints.";
  }
  return null;
}

function parseTouchdownMilestone(prompt) {
  const match = prompt.match(/\bthrows?\s+(\d{2})\s*(tds?|touchdowns?)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function singularizeAchievement(noun) {
  const lower = String(noun || "").toLowerCase().trim();
  if (lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("s")) return lower.slice(0, -1);
  return lower;
}

function parseMultiAchievementIntent(prompt) {
  const match = String(prompt || "").match(
    /\b(win|wins|won)\s+(\d+)\s+(super bowls?|mvps?|championships?|titles?|rings?)\b/i
  );
  if (!match) return null;
  const count = Number(match[2]);
  if (!Number.isFinite(count) || count < 2) return null;
  return {
    count,
    phrase: match[0],
    verb: match[1],
    noun: match[3],
  };
}

function buildSingleAchievementPrompt(prompt, parsed) {
  if (!parsed) return null;
  const onePhrase = `${parsed.verb} 1 ${singularizeAchievement(parsed.noun)}`;
  return String(prompt || "").replace(parsed.phrase, onePhrase);
}

function fallbackBaseProbability(prompt) {
  const lower = normalizePrompt(prompt);
  const seed = hashString(lower);
  let probabilityPct = 19 + (seed % 1000) / 1000 * 9; // 19-28 baseline

  if (/\b(win|make|reach|beat)\b/.test(lower)) probabilityPct += 4;
  if (/\b(miss|lose|doesn't|won't)\b/.test(lower)) probabilityPct -= 3;
  if (/\bnext year|next season|career\b/.test(lower)) probabilityPct -= 3;
  if (/\bretire|retirement|comeback|comes out\b/.test(lower)) probabilityPct -= 8;

  const tdMilestone = parseTouchdownMilestone(prompt);
  if (tdMilestone !== null) {
    if (tdMilestone >= 50) probabilityPct = Math.min(probabilityPct, 0.8);
    else if (tdMilestone >= 45) probabilityPct = Math.min(probabilityPct, 3.0);
    else if (tdMilestone >= 40) probabilityPct = Math.min(probabilityPct, 7.0);
    else if (tdMilestone >= 35) probabilityPct = Math.min(probabilityPct, 17.0);
  }

  if (/\b0-17\b|\b17-0\b|\bpunter\b.*\bmvp\b/.test(lower)) {
    probabilityPct = Math.min(probabilityPct, 1.6);
  }

  return clamp(probabilityPct, 0.5, 95);
}

function fallbackEstimate(prompt) {
  let probabilityPct = fallbackBaseProbability(prompt);
  probabilityPct = applyPromptSanityCaps(prompt, probabilityPct);
  const multi = parseMultiAchievementIntent(prompt);
  if (multi) {
    const singlePrompt = buildSingleAchievementPrompt(prompt, multi);
    let singlePct = fallbackBaseProbability(singlePrompt);
    singlePct = applyPromptSanityCaps(singlePrompt, singlePct);
    probabilityPct = Math.min(probabilityPct, singlePct * 0.92);
  }
  return {
    status: "ok",
    odds: toAmericanOdds(probabilityPct),
    impliedProbability: `${probabilityPct.toFixed(1)}%`,
    confidence: "Low",
    assumptions: [
      "Fast fallback estimate used due to API latency.",
      "Hypothetical entertainment model with conservative priors.",
    ],
    playerName: null,
    headshotUrl: null,
    summaryLabel: buildFallbackLabel(prompt),
    liveChecked: false,
    asOfDate: new Date().toISOString().slice(0, 10),
    sourceType: "hypothetical",
    sourceLabel: "Fallback hypothetical estimate",
  };
}

async function estimateSingleAchievementProbability(prompt, liveFactsText, globalStateText, today) {
  const parsed = parseMultiAchievementIntent(prompt);
  if (!parsed) return null;
  const singlePrompt = buildSingleAchievementPrompt(prompt, parsed);
  if (!singlePrompt) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MONOTONIC_TIMEOUT_MS);
  try {
    const response = await client.responses.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        input: [
          {
            role: "system",
            content:
              `Today is ${today}. Return JSON only with probability_pct from 0.5 to 95 for a sports hypothetical. Use current context and realistic constraints.`,
          },
          {
            role: "user",
            content: `${globalStateText}\n${liveFactsText}\nScenario: ${singlePrompt}`,
          },
        ],
        reasoning: OPENAI_REASONING,
        max_output_tokens: 70,
        text: {
          format: {
            type: "json_schema",
            name: "single_event_prob",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                probability_pct: { type: "number", minimum: 0.5, maximum: 95 },
              },
              required: ["probability_pct"],
            },
          },
        },
      },
      { signal: controller.signal }
    );
    const parsedOut = JSON.parse(response.output_text);
    const p = Number(parsedOut.probability_pct);
    if (!Number.isFinite(p)) return null;
    return clamp(p, 0.5, 95);
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function quickModelEstimate(prompt, today) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await client.responses.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        input: [
          {
            role: "system",
            content:
              `Today is ${today}. Return JSON only for a sports hypothetical estimate. This is for entertainment, not betting advice.`,
          },
          {
            role: "user",
            content: `Scenario: ${prompt}`,
          },
        ],
        reasoning: OPENAI_REASONING,
        max_output_tokens: 120,
        text: {
          format: {
            type: "json_schema",
            name: "quick_odds_estimate",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                probability_pct: { type: "number", minimum: 0.5, maximum: 95 },
                confidence: { type: "string", enum: ["Low", "Medium", "High"] },
                summary_label: { type: "string" },
              },
              required: ["probability_pct", "confidence", "summary_label"],
            },
          },
        },
      },
      { signal: controller.signal }
    );
    const parsed = JSON.parse(response.output_text);
    const p = clamp(Number(parsed.probability_pct), 0.5, 95);
    if (!Number.isFinite(p)) return null;
    return {
      status: "ok",
      odds: toAmericanOdds(p),
      impliedProbability: `${p.toFixed(1)}%`,
      confidence: parsed.confidence || "Low",
      assumptions: ["Quick estimate generated after timeout on deep context pass."],
      playerName: null,
      headshotUrl: null,
      summaryLabel: parsed.summary_label?.trim() || buildFallbackLabel(prompt),
      liveChecked: false,
      asOfDate: today,
      sourceType: "hypothetical",
      sourceLabel: "Quick hypothetical estimate",
    };
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractPlayerName(prompt) {
  const raw = String(prompt || "");
  const tokens = normalizeEntityName(raw).split(" ").filter(Boolean);
  const titleCase = (s) => s.split(" ").map((w) => (w ? `${w[0].toUpperCase()}${w.slice(1)}` : w)).join(" ");

  // First pass: try to resolve known players using longer n-grams first.
  for (let n = Math.min(5, tokens.length); n >= 2; n -= 1) {
    for (let i = 0; i <= tokens.length - n; i += 1) {
      const phrase = tokens.slice(i, i + n).join(" ");
      if (!phrase) continue;
      if (INVALID_PERSON_PHRASES.has(phrase)) continue;
      if (COMMON_NON_NAME_PHRASES.has(phrase)) continue;
      if (KNOWN_TEAMS.some((t) => normalizeEntityName(t) === phrase)) continue;
      const words = phrase.split(" ");
      if (words.some((w) => NON_NAME_TOKENS.has(w))) continue;

      const key = normalizePersonName(phrase);
      const known = nflPlayerIndex.get(key);
      if (known?.length) {
        return known[0].fullName || titleCase(phrase);
      }
    }
  }

  // Second pass fallback: return first plausible two-word person-like phrase.
  for (let i = 0; i <= tokens.length - 2; i += 1) {
    const phrase = tokens.slice(i, i + 2).join(" ");
    if (!phrase) continue;
    if (INVALID_PERSON_PHRASES.has(phrase)) continue;
    if (COMMON_NON_NAME_PHRASES.has(phrase)) continue;
    if (KNOWN_TEAMS.some((t) => normalizeEntityName(t) === phrase)) continue;
    const words = phrase.split(" ");
    if (words.some((w) => NON_NAME_TOKENS.has(w))) continue;
    return titleCase(phrase);
  }
  return null;
}

function extractPlayerNamesFromPrompt(prompt, maxNames = 3) {
  const raw = String(prompt || "");
  const tokens = normalizeEntityName(raw).split(" ").filter(Boolean);
  const titleCase = (s) => s.split(" ").map((w) => (w ? `${w[0].toUpperCase()}${w.slice(1)}` : w)).join(" ");
  const out = [];
  const seen = new Set();

  for (let n = Math.min(5, tokens.length); n >= 2; n -= 1) {
    for (let i = 0; i <= tokens.length - n; i += 1) {
      const phrase = tokens.slice(i, i + n).join(" ");
      if (!phrase) continue;
      if (INVALID_PERSON_PHRASES.has(phrase)) continue;
      if (COMMON_NON_NAME_PHRASES.has(phrase)) continue;
      if (KNOWN_TEAMS.some((t) => normalizeEntityName(t) === phrase)) continue;
      const words = phrase.split(" ");
      if (words.some((w) => NON_NAME_TOKENS.has(w))) continue;
      const key = normalizePersonName(phrase);
      if (seen.has(key)) continue;
      const known = nflPlayerIndex.get(key);
      if (known?.length) {
        const canonical = known.find((p) => p.status === "active")?.fullName || known[0].fullName || titleCase(phrase);
        const canonicalKey = normalizePersonName(canonical);
        if (seen.has(canonicalKey)) continue;
        seen.add(canonicalKey);
        out.push(canonical);
      }
      if (out.length >= maxNames) return out;
    }
  }

  // Fallback pass for unknown names when we have no known matches.
  if (out.length === 0) {
    for (let i = 0; i <= tokens.length - 2; i += 1) {
      const phrase = tokens.slice(i, i + 2).join(" ");
      if (!phrase) continue;
      if (INVALID_PERSON_PHRASES.has(phrase)) continue;
      if (COMMON_NON_NAME_PHRASES.has(phrase)) continue;
      if (KNOWN_TEAMS.some((t) => normalizeEntityName(t) === phrase)) continue;
      const words = phrase.split(" ");
      if (words.some((w) => NON_NAME_TOKENS.has(w))) continue;
      const key = normalizePersonName(phrase);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(titleCase(phrase));
      if (out.length >= maxNames) return out;
    }
  }
  return out;
}

function extractTeamName(prompt) {
  const text = String(prompt || "");
  const nflAliasMatches = Object.entries(NFL_TEAM_ALIASES)
    .map(([alias, abbr]) => ({ alias, abbr }))
    .filter(({ alias }) => new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "i").test(text))
    .sort((a, b) => b.alias.length - a.alias.length);
  if (nflAliasMatches.length) {
    const abbr = nflAliasMatches[0].abbr;
    return NFL_TEAM_DISPLAY[abbr] || nflAliasMatches[0].alias;
  }

  const found = KNOWN_TEAMS.find((team) => new RegExp(`\\b${team.replace(" ", "\\s+")}\\b`, "i").test(text));
  return found || null;
}

function buildFallbackLabel(prompt) {
  const clean = String(prompt || "").replace(/[?]/g, "").trim();
  const words = clean.split(/\s+/).slice(0, 6).join(" ");
  return words.length > 40 ? `${words.slice(0, 37)}...` : words;
}

async function getPlayerStatusLive(player) {
  if (!player) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PLAYER_STATUS_TIMEOUT_MS);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const response = await client.responses.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        tools: [{ type: "web_search_preview" }],
        input: [
          {
            role: "system",
            content:
              "Return JSON only. Determine if the named person is a real sports figure and current status from up-to-date sources. Status: active, retired, deceased, or unknown.",
          },
          {
            role: "user",
            content: `As of ${today}, is ${player} a real sports figure (athlete/coach/team sports public figure), and what is their current playing status?`,
          },
        ],
        max_output_tokens: 140,
        text: {
          format: {
            type: "json_schema",
            name: "player_status",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                as_of_date: { type: "string" },
                status: {
                  type: "string",
                  enum: ["active", "retired", "deceased", "unknown"],
                },
                is_sports_figure: {
                  type: "string",
                  enum: ["yes", "no", "unclear"],
                },
                note: { type: "string" },
              },
              required: ["as_of_date", "status", "is_sports_figure", "note"],
            },
          },
        },
      },
      { signal: controller.signal }
    );

    const parsed = JSON.parse(response.output_text);
    return {
      asOfDate: parsed.as_of_date || today,
      status: parsed.status || "unknown",
      isSportsFigure: parsed.is_sports_figure || "unclear",
      note: parsed.note || "",
    };
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getLiveSportsContext(prompt) {
  if (!LIVE_CONTEXT_ENABLED) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LIVE_CONTEXT_TIMEOUT_MS);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const response = await client.responses.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        tools: [{ type: "web_search_preview" }],
        input: [
          {
            role: "system",
            content:
              "Return JSON only. Gather current, relevant sports context for the scenario with short factual constraints and time markers. Do not provide betting advice.",
          },
          {
            role: "user",
            content: `As of today (${today}), gather up-to-date sports facts for this scenario: ${prompt}`,
          },
        ],
        max_output_tokens: 220,
        text: {
          format: {
            type: "json_schema",
            name: "live_context",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                as_of_date: { type: "string" },
                key_facts: {
                  type: "array",
                  minItems: 0,
                  maxItems: 4,
                  items: { type: "string" },
                },
                constraints: {
                  type: "array",
                  minItems: 0,
                  maxItems: 4,
                  items: { type: "string" },
                },
              },
              required: ["as_of_date", "key_facts", "constraints"],
            },
          },
        },
      },
      { signal: controller.signal }
    );

    const parsed = JSON.parse(response.output_text);
    return {
      asOfDate: parsed.as_of_date || today,
      facts: Array.isArray(parsed.key_facts) ? parsed.key_facts : [],
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
    };
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function refreshLiveSportsState(force = false) {
  const isFresh = Date.now() - liveSportsStateLoadedAt < LIVE_STATE_REFRESH_MS && liveSportsState;
  if (!force && isFresh) return liveSportsState;
  if (liveSportsStatePromise) return liveSportsStatePromise;

  liveSportsStatePromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LIVE_STATE_TIMEOUT_MS);
    const today = new Date().toISOString().slice(0, 10);
    try {
      const response = await client.responses.create(
        {
          model: process.env.OPENAI_MODEL || "gpt-5-mini",
          tools: [{ type: "web_search_preview" }],
          input: [
            {
              role: "system",
              content:
                "Return JSON only. Build a concise, current sports snapshot for fan-facing odds products. Include champions and fresh prompt ideas. Do not include betting advice.",
            },
            {
              role: "user",
              content:
                `As of ${today}, return latest sports state for NFL/NBA/MLB/NHL including current/recent champions and 6 high-quality hypothetical prompts grounded in present-day context.`,
            },
          ],
          max_output_tokens: 420,
          text: {
            format: {
              type: "json_schema",
              name: "live_sports_state",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  as_of_date: { type: "string" },
                  champions: {
                    type: "array",
                    minItems: 0,
                    maxItems: 8,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        league: { type: "string" },
                        champion: { type: "string" },
                      },
                      required: ["league", "champion"],
                    },
                  },
                  suggested_prompts: {
                    type: "array",
                    minItems: 3,
                    maxItems: 10,
                    items: { type: "string" },
                  },
                },
                required: ["as_of_date", "champions", "suggested_prompts"],
              },
            },
          },
        },
        { signal: controller.signal }
      );

      const parsed = JSON.parse(response.output_text);
      liveSportsState = {
        asOfDate: parsed.as_of_date || today,
        champions: Array.isArray(parsed.champions) ? parsed.champions : [],
        suggestedPrompts: Array.isArray(parsed.suggested_prompts) ? parsed.suggested_prompts : [],
      };
      liveSportsStateLoadedAt = Date.now();
      return liveSportsState;
    } catch (_error) {
      if (!liveSportsState) {
        liveSportsState = {
          asOfDate: today,
          champions: [],
          suggestedPrompts: [
            "Chiefs win the AFC next season",
            "A rookie QB makes the Pro Bowl",
            "Lakers win the NBA Finals",
            "Yankees win the World Series",
            "A team goes 17-0 in the NFL regular season",
            "Packers make the playoffs",
          ],
        };
      }
      return liveSportsState;
    } finally {
      clearTimeout(timeoutId);
      liveSportsStatePromise = null;
    }
  })();

  return liveSportsStatePromise;
}

function scoreSportsDbPlayerCandidate(candidate, targetName, preferredTeamAbbr = "", preferActive = false) {
  let score = 0;
  const name = normalizePersonName(candidate?.strPlayer || "");
  const target = normalizePersonName(targetName || "");
  if (name && target && name === target) score += 8;

  const team = String(candidate?.strTeam || "").toLowerCase();
  if (preferredTeamAbbr) {
    const teamNameEntries = Object.entries(NFL_TEAM_ALIASES).filter(([, abbr]) => abbr === preferredTeamAbbr);
    const teamAliasNames = teamNameEntries.map(([alias]) => alias.toLowerCase());
    if (teamAliasNames.some((alias) => team.includes(alias))) score += 4;
  }

  const status = String(candidate?.strStatus || "").toLowerCase();
  if (preferActive && status.includes("active")) score += 3;

  if (candidate?.strCutout || candidate?.strRender || candidate?.strThumb) score += 1;
  return score;
}

async function lookupPlayerHeadshot(player, options = {}) {
  if (!player) return null;
  const preferredTeamAbbr = options.preferredTeamAbbr || "";
  const preferActive = Boolean(options.preferActive);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEADSHOT_TIMEOUT_MS);

  try {
    const url = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_API_KEY}/searchplayers.php?p=${encodeURIComponent(player)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const payload = await response.json();
    const players = Array.isArray(payload?.player) ? payload.player : [];
    if (players.length === 0) return await lookupWikipediaHeadshot(player);

    const target = normalizePersonName(player);
    const exact = players.find((p) => normalizePersonName(p?.strPlayer || "") === target);
    const exactHeadshot = exact?.strCutout || exact?.strRender || exact?.strThumb || null;
    if (exactHeadshot) {
      return {
        playerName: exact?.strPlayer || player,
        headshotUrl: exactHeadshot,
      };
    }

    const ranked = [...players].sort(
      (a, b) =>
        scoreSportsDbPlayerCandidate(b, player, preferredTeamAbbr, preferActive) -
        scoreSportsDbPlayerCandidate(a, player, preferredTeamAbbr, preferActive)
    );
    const match = ranked[0];
    if (!exact) return await lookupWikipediaHeadshot(player);
    const headshotUrl = match?.strCutout || match?.strRender || match?.strThumb || null;
    if (!headshotUrl) return await lookupWikipediaHeadshot(player);

    return {
      playerName: match?.strPlayer || player,
      headshotUrl,
    };
  } catch (_error) {
    return await lookupWikipediaHeadshot(player);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function lookupWikipediaHeadshot(player) {
  if (!player) return null;
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(player)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json();
    const headshotUrl = payload?.thumbnail?.source || null;
    if (!headshotUrl) return null;
    return {
      playerName: payload?.title || player,
      headshotUrl,
    };
  } catch (_error) {
    return null;
  }
}

async function lookupTeamLogo(team) {
  if (!team) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEADSHOT_TIMEOUT_MS);

  try {
    const url = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_API_KEY}/searchteams.php?t=${encodeURIComponent(team)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const payload = await response.json();
    let teams = Array.isArray(payload?.teams) ? payload.teams : [];
    if (teams.length === 0) return null;

    const teamAbbr = extractNflTeamAbbr(team);
    if (teamAbbr) {
      const nflOnly = teams.filter((t) => {
        const sport = String(t?.strSport || "").toLowerCase();
        const league = String(t?.strLeague || "").toLowerCase();
        return sport.includes("football") || league.includes("nfl") || league.includes("national football");
      });
      if (nflOnly.length) teams = nflOnly;
    }

    const exact = teams.find(
      (t) =>
        typeof t?.strTeam === "string" &&
        t.strTeam.toLowerCase() === team.toLowerCase()
    );
    const match = exact || teams[0];
    const logoUrl = match?.strBadge || match?.strLogo || null;
    if (!logoUrl) return null;

    return {
      entityName: match?.strTeam || team,
      imageUrl: logoUrl,
    };
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function enrichEntityMedia(
  prompt,
  baseValue,
  playerNameHint = "",
  teamNameHint = "",
  options = {}
) {
  const team = teamNameHint || extractTeamName(prompt);
  const player = playerNameHint || extractPlayerName(prompt);
  const teamAsset = await lookupTeamLogo(team);
  const preferredTeamAbbr = options.preferredTeamAbbr || "";
  const preferActive = Boolean(options.preferActive);
  const playerAsset = teamAsset
    ? null
    : await lookupPlayerHeadshot(player, { preferredTeamAbbr, preferActive });

  let secondaryPlayerName = null;
  let secondaryHeadshotUrl = null;
  if (!teamAsset) {
    const candidates = extractPlayerNamesFromPrompt(prompt, 4);
    const primaryKey = normalizePersonName(playerAsset?.playerName || player || "");
    const secondary = candidates.find((name) => normalizePersonName(name) && normalizePersonName(name) !== primaryKey);
    if (secondary) {
      const secondaryAsset = await lookupPlayerHeadshot(secondary, { preferredTeamAbbr: "", preferActive: true });
      if (secondaryAsset?.headshotUrl) {
        secondaryPlayerName = secondaryAsset.playerName || secondary;
        secondaryHeadshotUrl = secondaryAsset.headshotUrl;
      }
    }
  }

  return {
    ...baseValue,
    playerName: playerAsset?.playerName || null,
    headshotUrl: playerAsset?.headshotUrl || teamAsset?.imageUrl || null,
    secondaryPlayerName,
    secondaryHeadshotUrl,
  };
}

// Optional sanity cap to prevent impossible "more likely with more titles" behavior.
function applyPromptSanityCaps(prompt, probPct) {
  let adjusted = probPct;
  const lower = prompt.toLowerCase();

  const sbMatch = prompt.match(/wins?\s+(\d+)\s+super\s*bowls?/i);
  if (sbMatch) {
    const n = Number(sbMatch[1]);
    if (Number.isFinite(n) && n >= 2) {
      const cap = 38 * Math.pow(0.55, n - 1);
      adjusted = Math.min(adjusted, cap);
    }
  }

  // Ownership stake makes return-to-play hypotheticals much less likely unless stake is sold.
  if (
    /\btom brady\b/.test(lower) &&
    /\b(retire|retirement|return|comeback|come(s)? out)\b/.test(lower)
  ) {
    adjusted = Math.min(adjusted, 0.7);
  }

  // General owner/ownership constraints for active player comeback prompts.
  if (
    /\b(owner|ownership|stake)\b/.test(lower) &&
    /\b(return|comeback|come(s)? out|play again)\b/.test(lower)
  ) {
    adjusted = Math.min(adjusted, 1.2);
  }

  // Long-retired comeback scenarios should be long odds by default.
  if (
    /\b(retire|retirement|return|comeback|come(s)? out)\b/.test(lower) &&
    /\b(tom brady|brett favre|joe montana|dan marino|peyton manning)\b/.test(lower)
  ) {
    adjusted = Math.min(adjusted, 0.9);
  }

  const tdMilestone = parseTouchdownMilestone(prompt);
  if (tdMilestone !== null) {
    if (tdMilestone >= 50) adjusted = Math.min(adjusted, 0.8);
    else if (tdMilestone >= 45) adjusted = Math.min(adjusted, 3.0);
    else if (tdMilestone >= 40) adjusted = Math.min(adjusted, 7.0);
  }

  return clamp(adjusted, 0.5, 95);
}

function applyLiveContextCaps(probPct, liveContext) {
  if (!liveContext) return probPct;

  let adjusted = probPct;
  const text = `${(liveContext.facts || []).join(" ")} ${(liveContext.constraints || []).join(" ")}`.toLowerCase();

  if (/\bowner|ownership|stake\b/.test(text)) adjusted = Math.min(adjusted, 1.2);
  if (/\bretired\b/.test(text) && /\breturn|comeback|come out\b/.test(text)) adjusted = Math.min(adjusted, 2.0);
  if (/\bage\s*(4[4-9]|[5-9]\d)\b/.test(text)) adjusted = Math.min(adjusted, 1.8);
  if (/\bineligible|not eligible|cannot\b/.test(text)) adjusted = Math.min(adjusted, 1.0);

  return clamp(adjusted, 0.5, 95);
}

function applyConsistencyAndTrack(args) {
  const before = JSON.stringify({
    odds: args?.result?.odds,
    impliedProbability: args?.result?.impliedProbability,
    sourceType: args?.result?.sourceType,
    assumptions: args?.result?.assumptions || [],
  });
  const out = applyConsistencyRules(args);
  const after = JSON.stringify({
    odds: out?.odds,
    impliedProbability: out?.impliedProbability,
    sourceType: out?.sourceType,
    assumptions: out?.assumptions || [],
  });
  if (before !== after) metrics.consistencyRepairs += 1;
  return out;
}

function decorateForScenarioComplexity(value, conditionalIntent, jointEventIntent) {
  if (!value || value.status !== "ok") return value;
  if (!conditionalIntent && !jointEventIntent) return value;
  const assumptions = Array.isArray(value.assumptions) ? [...value.assumptions] : [];
  assumptions.unshift(
    conditionalIntent
      ? `Conditional scenario simplified to a single-path estimate for ${DEFAULT_NFL_SEASON}.`
      : `Joint-event scenario estimated with conservative dependence assumptions for ${DEFAULT_NFL_SEASON}.`
  );
  return {
    ...value,
    confidence: "Low",
    assumptions,
    sourceLabel: conditionalIntent
      ? "Scenario model (conditional approximation)"
      : "Scenario model (joint-event approximation)",
  };
}

app.post("/api/odds", async (req, res) => {
  try {
    metrics.oddsRequests += 1;
    const prompt = String(req.body?.prompt || "").trim();
    const clientVersion = String(req.get("x-ewa-client-version") || "").trim();
    if (clientVersion && clientVersion !== API_PUBLIC_VERSION) {
      metrics.parseNormalized += 1;
    }
    const promptSeasonScoped = applyDefaultNflSeasonInterpretation(prompt);
    const promptForParsing = normalizePromptForModel(promptSeasonScoped);
    if (promptForParsing !== prompt) metrics.parseNormalized += 1;
    const intent = parseIntent(promptForParsing);
    const semanticKey = canonicalizePromptForKey(promptForParsing);
    const normalizedPrompt = `${CACHE_VERSION}:${semanticKey}`;
    let playerHint = extractPlayerName(promptForParsing);
    const teamHint = extractTeamName(promptForParsing);
    const wholeCareerIntent = hasWholeCareerTeamIntent(promptForParsing);
    const targetNflTeamAbbr = extractNflTeamAbbr(promptForParsing);
    const comebackIntent = hasComebackIntent(promptForParsing);
    const retirementIntent = hasRetirementIntent(promptForParsing);
    const hallOfFameIntent = hasHallOfFameIntent(promptForParsing);
    const conditionalIntent = hasConditionalScenario(promptForParsing);
    const jointEventIntent = hasJointEventScenario(promptForParsing);

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    if (isLikelyGibberishPrompt(promptForParsing)) {
      metrics.snarks += 1;
      return res.json(buildGibberishSnarkResponse());
    }

    if (shouldRefuse(promptForParsing)) {
      metrics.refusals += 1;
      return res.json({
        status: "refused",
        message:
          "This tool provides hypothetical entertainment estimates only. It does not provide betting advice or sportsbook lines.",
      });
    }

    if (isNonNflSportsPrompt(promptForParsing)) {
      metrics.snarks += 1;
      return res.json(buildNflOnlySnarkResponse());
    }

    if (/\b(my friend|my buddy|my cousin|my brother|my sister|my dad|my mom|my uncle|my aunt)\b/i.test(promptForParsing)) {
      metrics.snarks += 1;
      return res.json(buildOffTopicSnarkResponse(promptForParsing));
    }

    const impossibleReason = hardImpossibleReason(promptForParsing);
    if (impossibleReason) {
      metrics.baselineServed += 1;
      const value = {
        ...noChanceEstimate(promptForParsing, new Date().toISOString().slice(0, 10)),
        assumptions: [impossibleReason],
        sourceType: "constraint_model",
        sourceLabel: "Hard impossibility constraint",
      };
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
      return res.json(value);
    }

    const unpriceableReason = parseUnpriceableSubjectiveReason(promptForParsing);
    if (unpriceableReason) {
      metrics.snarks += 1;
      return res.json(buildUnpriceableSnarkResponse(unpriceableReason));
    }

    if (hasDepthChartDisplacementIntent(promptForParsing)) {
      const named = await extractKnownNflNamesFromPrompt(promptForParsing, 3);
      if (named.length >= 2) {
        const a = named[0];
        const b = named[1];
        if (a.group && b.group && a.group !== b.group) {
          metrics.snarks += 1;
          return res.json(buildRoleMismatchSnarkResponse(a, b));
        }
        if ((a.group === "qb" && b.group !== "qb") || (a.group !== "qb" && b.group === "qb")) {
          metrics.snarks += 1;
          return res.json(buildRoleMismatchSnarkResponse(a, b));
        }
      } else {
        const words = parseRoleWordsFromDepthChartPrompt(promptForParsing);
        if (words) {
          if (words.leftGroup !== words.rightGroup) {
            metrics.snarks += 1;
            return res.json(buildRoleWordMismatchSnarkResponse(words));
          }
        }
      }
    }

    if ((playerHint || teamHint || isSportsPrompt(promptForParsing)) && !hasMeasurableOutcomeIntent(promptForParsing)) {
      metrics.snarks += 1;
      const label = playerHint || teamHint || "that";
      return res.json(buildNonsenseSportsSnarkResponse(label, promptForParsing));
    }

    if (!isSportsPrompt(promptForParsing) && !isLikelySportsHypothetical(promptForParsing)) {
      metrics.snarks += 1;
      return res.json(buildOffTopicSnarkResponse(promptForParsing));
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY in .env" });
    }

    if (!playerHint && hasStrongSportsContext(promptForParsing)) {
      playerHint = await inferLocalNflPlayerFromPrompt(promptForParsing, targetNflTeamAbbr || "");
    }

    const combinedPassingIntent = parseCombinedPassingTdIntent(promptForParsing);
    if (combinedPassingIntent) {
      const named = await extractKnownNflNamesFromPrompt(promptForParsing, 3);
      if (named.length >= 2) {
        const profiles = (
          await Promise.all(
            named.slice(0, 2).map((n) => resolveNflPlayerProfile(n.name, targetNflTeamAbbr || ""))
          )
        ).filter(Boolean);
        if (profiles.length >= 2) {
          const base = buildCombinedPassingTdEstimate(
            promptForParsing,
            combinedPassingIntent,
            profiles.slice(0, 2),
            new Date().toISOString().slice(0, 10)
          );
          if (base) {
            let value = await enrichEntityMedia(
              promptForParsing,
              base,
              profiles[0].name,
              "",
              {
                preferredTeamAbbr: profiles[0].teamAbbr || "",
                preferActive: true,
              }
            );
            value = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: value });
            value = decorateForScenarioComplexity(value, conditionalIntent, jointEventIntent);
            if (FEATURE_ENABLE_TRACE) {
              value.trace = { ...(value.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
            }
            metrics.baselineServed += 1;
            oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
            semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
            return res.json(value);
          }
        }
      }
    }

    const combinedPassingYardsIntent = parseCombinedPassingYardsIntent(promptForParsing);
    if (combinedPassingYardsIntent) {
      const named = await extractKnownNflNamesFromPrompt(promptForParsing, 3);
      if (named.length >= 2) {
        const profiles = (
          await Promise.all(
            named.slice(0, 2).map((n) => resolveNflPlayerProfile(n.name, targetNflTeamAbbr || ""))
          )
        ).filter(Boolean);
        if (profiles.length >= 2) {
          const base = buildCombinedPassingYardsEstimate(
            promptForParsing,
            combinedPassingYardsIntent,
            profiles.slice(0, 2),
            new Date().toISOString().slice(0, 10)
          );
          if (base) {
            let value = await enrichEntityMedia(
              promptForParsing,
              base,
              profiles[0].name,
              "",
              {
                preferredTeamAbbr: profiles[0].teamAbbr || "",
                preferActive: true,
              }
            );
            value = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: value });
            value = decorateForScenarioComplexity(value, conditionalIntent, jointEventIntent);
            if (FEATURE_ENABLE_TRACE) {
              value.trace = { ...(value.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
            }
            metrics.baselineServed += 1;
            oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
            semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
            return res.json(value);
          }
        }
      }
    }

    const baseline = buildBaselineEstimate(promptForParsing, intent, new Date().toISOString().slice(0, 10));
    if (baseline) {
      metrics.baselineServed += 1;
      let stable = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: baseline });
      stable = decorateForScenarioComplexity(stable, conditionalIntent, jointEventIntent);
      if (FEATURE_ENABLE_TRACE) {
        stable.trace = { ...(stable.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
      }
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value: stable });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value: stable });
      return res.json(stable);
    }

    const playoffBaseline = buildTeamPlayoffEstimate(promptForParsing, new Date().toISOString().slice(0, 10));
    if (playoffBaseline) {
      metrics.baselineServed += 1;
      let stable = await enrichEntityMedia(promptForParsing, playoffBaseline, "", extractTeamName(promptForParsing) || "");
      stable = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: stable });
      stable = decorateForScenarioComplexity(stable, conditionalIntent, jointEventIntent);
      if (FEATURE_ENABLE_TRACE) {
        stable.trace = { ...(stable.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
      }
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value: stable });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value: stable });
      return res.json(stable);
    }

    const multiYearTitle = await buildMultiYearTeamTitleEstimate(
      promptForParsing,
      new Date().toISOString().slice(0, 10)
    );
    if (multiYearTitle) {
      metrics.baselineServed += 1;
      let stable = await enrichEntityMedia(promptForParsing, multiYearTitle, "", extractTeamName(promptForParsing) || "");
      stable = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: stable });
      stable = decorateForScenarioComplexity(stable, conditionalIntent, jointEventIntent);
      if (FEATURE_ENABLE_TRACE) {
        stable.trace = { ...(stable.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
      }
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value: stable });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value: stable });
      return res.json(stable);
    }

    const beforeOtherTeam = await buildBeforeOtherTeamEstimate(
      promptForParsing,
      new Date().toISOString().slice(0, 10)
    );
    if (beforeOtherTeam) {
      metrics.baselineServed += 1;
      let stable = await enrichEntityMedia(promptForParsing, beforeOtherTeam, "", extractTeamName(promptForParsing) || "");
      stable = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: stable });
      stable = decorateForScenarioComplexity(stable, conditionalIntent, jointEventIntent);
      if (FEATURE_ENABLE_TRACE) {
        stable.trace = { ...(stable.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
      }
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value: stable });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value: stable });
      return res.json(stable);
    }

    const cached = oddsCache.get(normalizedPrompt);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return res.json(cached.value);
    }
    const semanticCached = semanticOddsCache.get(normalizedPrompt);
    if (semanticCached && Date.now() - semanticCached.ts < SEMANTIC_CACHE_TTL_MS) {
      return res.json(semanticCached.value);
    }

    let sportsbookReference = await getSportsbookReferenceOdds(promptForParsing);
    if (!sportsbookReference) {
      const lookupPrompt = normalizeMarketPhrasingForLookup(promptForParsing);
      if (lookupPrompt && lookupPrompt !== promptForParsing) {
        sportsbookReference = await getSportsbookReferenceOdds(lookupPrompt);
      }
    }
    if (!sportsbookReference) {
      sportsbookReference = await getDynamicSportsbookReference(promptForParsing);
    }
    if (sportsbookReference) {
      metrics.sportsbookServed += 1;
      let value = await enrichEntityMedia(promptForParsing, sportsbookReference, "", extractTeamName(promptForParsing) || "");
      value = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: value });
      value = decorateForScenarioComplexity(value, conditionalIntent, jointEventIntent);
      if (FEATURE_ENABLE_TRACE) {
        value.trace = { ...(value.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
      }
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
      return res.json(value);
    }
    // MVP prompts should use live sportsbook odds when available, but must
    // gracefully fall back to deterministic/hypothetical models if a live
    // market is not currently present in the feed.

    const seasonTeamFallback = await buildSeasonTeamTitleFallback(
      promptForParsing,
      new Date().toISOString().slice(0, 10)
    );
    if (seasonTeamFallback) {
      metrics.baselineServed += 1;
      let value = await enrichEntityMedia(promptForParsing, seasonTeamFallback, "", extractTeamName(promptForParsing) || "");
      value = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: value });
      value = decorateForScenarioComplexity(value, conditionalIntent, jointEventIntent);
      if (FEATURE_ENABLE_TRACE) {
        value.trace = { ...(value.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
      }
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
      return res.json(value);
    }
    if (isSportsbookCandidatePrompt(promptForParsing)) metrics.anchorMisses += 1;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let allowLlmBackstop = false;

    try {
      const today = new Date().toISOString().slice(0, 10);
      const [liveState, liveContext, initialLocalPlayerStatus] = await Promise.all([
        refreshLiveSportsState(false),
        getLiveSportsContext(promptForParsing),
        playerHint ? getLocalNflPlayerStatus(playerHint, targetNflTeamAbbr || "") : Promise.resolve(null),
      ]);
      let localPlayerStatus = initialLocalPlayerStatus;
      let resolvedPlayerHint = playerHint;
      if (!localPlayerStatus && playerHint && !teamHint && hasStrongSportsContext(promptForParsing)) {
        const fuzzyMatch = await getFuzzyLocalNflPlayerStatus(playerHint, targetNflTeamAbbr || "");
        if (fuzzyMatch?.status) {
          localPlayerStatus = fuzzyMatch.status;
          resolvedPlayerHint = fuzzyMatch.matchedName || playerHint;
        }
      }
      if (!localPlayerStatus && hasStrongSportsContext(promptForParsing)) {
        const inferredFromPrompt = await inferLocalNflPlayerFromPrompt(promptForParsing, targetNflTeamAbbr || "");
        if (inferredFromPrompt) {
          resolvedPlayerHint = inferredFromPrompt;
          localPlayerStatus = await getLocalNflPlayerStatus(inferredFromPrompt, targetNflTeamAbbr || "");
        }
      }
      if (localPlayerStatus && (resolvedPlayerHint || playerHint)) {
        localPlayerStatus = await alignPlayerStatusToPromptPosition(
          resolvedPlayerHint || playerHint,
          localPlayerStatus,
          promptForParsing,
          targetNflTeamAbbr || ""
        );
      }
      const playerStatus = playerHint
        ? localPlayerStatus || (await getPlayerStatusLive(resolvedPlayerHint || playerHint))
        : null;
      const referenceAnchors = await buildReferenceAnchors(promptForParsing, localPlayerStatus, teamHint || "");
      const positionReality = evaluatePositionReality(promptForParsing, localPlayerStatus);
      if (positionReality.noChance) {
        const value = await enrichEntityMedia(
          promptForParsing,
          noChanceEstimate(promptForParsing, liveContext?.asOfDate || today),
          resolvedPlayerHint || playerHint || "",
          "",
          {
            preferredTeamAbbr: localPlayerStatus?.teamAbbr || "",
            preferActive: localPlayerStatus?.status === "active",
          }
        );
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }

      const awardNoChanceReason = awardRoleNoChance(promptForParsing, localPlayerStatus);
      if (awardNoChanceReason) {
        const value = await enrichEntityMedia(
          promptForParsing,
          {
            ...noChanceEstimate(promptForParsing, liveContext?.asOfDate || today),
            assumptions: [awardNoChanceReason],
          },
          resolvedPlayerHint || playerHint || "",
          teamHint || "",
          {
            preferredTeamAbbr: localPlayerStatus?.teamAbbr || "",
            preferActive: localPlayerStatus?.status === "active",
          }
        );
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }

      if (retirementIntent && playerHint) {
        const retirementEstimate = buildRetirementEstimate(
          promptForParsing,
          intent,
          localPlayerStatus,
          playerStatus,
          resolvedPlayerHint || playerHint,
          liveContext?.asOfDate || today
        );
        if (retirementEstimate) {
          const value = await enrichEntityMedia(
            promptForParsing,
            retirementEstimate,
            resolvedPlayerHint || playerHint,
            "",
            {
              preferredTeamAbbr: localPlayerStatus?.teamAbbr || "",
              preferActive: localPlayerStatus?.status === "active",
            }
          );
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          metrics.baselineServed += 1;
          return res.json(value);
        }
      }

      if (hallOfFameIntent && playerHint) {
        const hofEstimate = buildHallOfFameEstimate(
          promptForParsing,
          intent,
          localPlayerStatus,
          playerStatus,
          resolvedPlayerHint || playerHint,
          liveContext?.asOfDate || today
        );
        if (hofEstimate) {
          const value = await enrichEntityMedia(
            promptForParsing,
            hofEstimate,
            resolvedPlayerHint || playerHint,
            "",
            {
              preferredTeamAbbr: localPlayerStatus?.teamAbbr || "",
              preferActive: localPlayerStatus?.status === "active",
            }
          );
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          metrics.baselineServed += 1;
          return res.json(value);
        }
      }

      if (playerHint && /\b(mvp|most valuable player)\b/i.test(promptForParsing)) {
        const mvpEstimate = await estimatePlayerMvpOdds(
          promptForParsing,
          intent,
          resolvedPlayerHint || playerHint,
          localPlayerStatus,
          liveContext?.asOfDate || today
        );
        if (mvpEstimate) {
          const value = await enrichEntityMedia(
            promptForParsing,
            mvpEstimate,
            resolvedPlayerHint || playerHint,
            "",
            {
              preferredTeamAbbr: localPlayerStatus?.teamAbbr || "",
              preferActive: localPlayerStatus?.status === "active",
            }
          );
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          metrics.baselineServed += 1;
          return res.json(value);
        }
      }

      const localIndexHints = parseLocalIndexNote(localPlayerStatus?.note);
      const mediaOptions = {
        preferredTeamAbbr: localPlayerStatus?.teamAbbr || localIndexHints.teamAbbr || "",
        preferActive: localPlayerStatus?.status === "active",
      };

      if (playerHint) {
        const profile = {
          name: resolvedPlayerHint || playerHint,
          position: localIndexHints.position || "",
          teamAbbr: localPlayerStatus?.teamAbbr || localIndexHints.teamAbbr || "",
          yearsExp: localIndexHints.yearsExp,
          age: localIndexHints.age,
        };
        const seasonStatDeterministic = buildPlayerSeasonStatEstimate(
          promptForParsing,
          intent,
          profile,
          today,
          phase2Calibration || {}
        );
        if (seasonStatDeterministic) {
          let value = await enrichEntityMedia(
            promptForParsing,
            seasonStatDeterministic,
            resolvedPlayerHint || playerHint,
            "",
            mediaOptions
          );
          value = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: value });
          value = decorateForScenarioComplexity(value, conditionalIntent, jointEventIntent);
          if (FEATURE_ENABLE_TRACE) {
            value.trace = { ...(value.trace || {}), intent, canonicalPromptKey: semanticKey, apiVersion: API_PUBLIC_VERSION };
          }
          metrics.baselineServed += 1;
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }
      }

      // Deterministic career-Super-Bowl model to avoid unstable outputs.
      if (playerHint) {
        const careerSbEstimate = await estimateCareerSuperBowlOdds(
          promptForParsing,
          resolvedPlayerHint || playerHint,
          localPlayerStatus
        );
        if (careerSbEstimate) {
          const value = await enrichEntityMedia(
            promptForParsing,
            careerSbEstimate,
            resolvedPlayerHint || playerHint,
            "",
            mediaOptions
          );
          const finalValue = decorateForScenarioComplexity(value, conditionalIntent, jointEventIntent);
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value: finalValue });
          semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value: finalValue });
          return res.json(finalValue);
        }
      }

      if (
        wholeCareerIntent &&
        playerHint &&
        localPlayerStatus?.teamAbbr &&
        targetNflTeamAbbr &&
        localPlayerStatus.teamAbbr !== targetNflTeamAbbr
      ) {
        const value = buildTeamCareerContradictionSnark(
          resolvedPlayerHint || playerHint,
          localPlayerStatus.teamAbbr,
          targetNflTeamAbbr
        );
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }

      if (playerHint && !teamHint) {
        const explicitNonNfl = hasExplicitNonNflLeagueContext(promptForParsing);
        const strongSports = hasStrongSportsContext(promptForParsing);
        const nflSpecific = hasNflSpecificContext(promptForParsing);
        const fullNameShape = /\b[a-z][a-z'.-]+\s+[a-z][a-z'.-]+\b/i.test(promptForParsing);
        const allowNflPlayerHeuristic = nflSpecific && strongSports && fullNameShape;

        const clearlyNonSports = playerStatus?.isSportsFigure === "no";
        const unclear = !playerStatus || playerStatus.isSportsFigure === "unclear";

        // Skip non-sports snark here for comeback prompts; comeback classifier handles those.
        if (
          !comebackIntent &&
          ((clearlyNonSports && !allowNflPlayerHeuristic) ||
          (!localPlayerStatus &&
            !isKnownActiveMention(promptForParsing) &&
            !explicitNonNfl &&
            unclear &&
            !strongSports))
        ) {
          const value = buildNonSportsPersonSnarkResponse(resolvedPlayerHint || playerHint, promptForParsing);
          metrics.snarks += 1;
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }
      }

      if (comebackIntent && playerHint) {
        if (playerStatus?.status === "deceased" || isKnownDeceasedMention(promptForParsing)) {
          const value = await enrichEntityMedia(
            promptForParsing,
            noChanceEstimate(promptForParsing, playerStatus?.asOfDate || liveContext?.asOfDate || today),
            resolvedPlayerHint || playerHint,
            "",
            mediaOptions
          );
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }

        if (isKnownLongRetiredMention(promptForParsing)) {
          const value = await enrichEntityMedia(
            promptForParsing,
            noChanceEstimate(promptForParsing, playerStatus?.asOfDate || liveContext?.asOfDate || today),
            resolvedPlayerHint || playerHint,
            "",
            mediaOptions
          );
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }

        if (
          localPlayerStatus?.status === "active" ||
          playerStatus?.status === "active" ||
          isKnownActiveMention(promptForParsing)
        ) {
          const value = buildComebackSnarkResponse(resolvedPlayerHint || playerHint);
          metrics.snarks += 1;
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }
      }

      if (isContradictoryComebackScenario(promptForParsing, liveContext)) {
        const value = buildSnarkResponse(promptForParsing);
        metrics.snarks += 1;
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }

      allowLlmBackstop = shouldAllowLlmLastResort(promptForParsing, {
        conditionalIntent,
        jointEventIntent,
        playerHint: resolvedPlayerHint || playerHint || "",
        teamHint,
        localPlayerStatus,
        playerStatus,
        referenceAnchors,
      });
      if (!allowLlmBackstop) {
        const value = buildDeterministicDataSnarkResponse();
        metrics.snarks += 1;
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }

      const liveFactsText = liveContext
        ? `Live context as of ${liveContext.asOfDate}:\nFacts: ${liveContext.facts.join(" | ") || "none"}\nConstraints: ${
            liveContext.constraints.join(" | ") || "none"
          }`
        : "Live context unavailable within timeout; use conservative assumptions.";
      const localRosterText =
        resolvedPlayerHint && localPlayerStatus?.teamAbbr
          ? `Local NFL roster context: ${resolvedPlayerHint} currently on ${localPlayerStatus.teamAbbr}.`
          : "";
      const globalStateText = liveState
        ? `Global state as of ${liveState.asOfDate}: champions => ${liveState.champions
            .map((x) => `${x.league}:${x.champion}`)
            .join(" | ") || "none"}`
        : "";
      const anchorText = referenceAnchors.length
        ? `Live market reference anchors (use these as priors when relevant): ${referenceAnchors.join(" || ")}`
        : "No direct live market anchors found; estimate from current context and conservative priors.";
      const response = await client.responses.create(
        {
          model: process.env.OPENAI_MODEL || "gpt-5-mini",
          input: [
            {
              role: "system",
              content:
                `You are the Egomaniacs Fantasy Football hypothetical probability engine. Today is ${today}. Return JSON only. This product is for hypothetical entertainment, never betting advice. For sports hypotheticals, estimate probability in a coherent way using up-to-date context as of today. Account for real-world constraints (eligibility rules, ownership conflicts, retirement status, league rules) when relevant. Ensure internally that more extreme versions of the same event are not more likely than less extreme versions. If a specific athlete is clearly named in the scenario, set player_name to that exact name; otherwise set player_name to an empty string. If a specific team is clearly named, set team_name to that name; otherwise set team_name to an empty string. Also provide summary_label as a concise, slick label under 40 chars, no odds included (example: 'Maye to win MVP').`,
            },
            {
              role: "user",
              content:
                "These are merely hypothetical estimates for fun and fan discussion, not real betting picks, not sportsbook lines, and not betting advice.\n" +
                `${globalStateText}\n${localRosterText}\n${liveFactsText}\n${anchorText}\nScenario: ${promptForParsing}`,
            },
          ],
          reasoning: OPENAI_REASONING,
          max_output_tokens: 180,
          text: {
            format: {
              type: "json_schema",
              name: "odds_estimate",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  probability_pct: {
                    type: "number",
                    minimum: 1,
                    maximum: 95,
                  },
                  confidence: {
                    type: "string",
                    enum: ["Low", "Medium", "High"],
                  },
                  assumptions: {
                    type: "array",
                    minItems: 1,
                    maxItems: 3,
                    items: { type: "string" },
                  },
                  player_name: {
                    type: "string",
                  },
                  team_name: {
                    type: "string",
                  },
                  summary_label: {
                    type: "string",
                  },
                },
                required: [
                  "probability_pct",
                  "confidence",
                  "assumptions",
                  "player_name",
                  "team_name",
                  "summary_label",
                ],
              },
            },
          },
        },
        { signal: controller.signal }
      );

      const parsed = JSON.parse(response.output_text);
      if (isImpossibleScenario(promptForParsing, liveContext)) {
        const value = await enrichEntityMedia(
          promptForParsing,
          noChanceEstimate(promptForParsing, liveContext?.asOfDate || today),
          parsed.player_name,
          parsed.team_name,
          mediaOptions
        );
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }

      const modelProbability = Number(parsed.probability_pct);
      const withPromptCaps = applyPromptSanityCaps(promptForParsing, modelProbability);
      const withLiveCaps = applyLiveContextCaps(withPromptCaps, liveContext);
      let probabilityPct =
        positionReality.capPct !== null
          ? Math.min(withLiveCaps, positionReality.capPct)
          : withLiveCaps;

      // Monotonicity guard: "N achievements" cannot be more likely than "1 achievement".
      const singleAchievementPct = await estimateSingleAchievementProbability(
        promptForParsing,
        liveFactsText,
        globalStateText,
        today
      );
      if (singleAchievementPct !== null) {
        probabilityPct = Math.min(probabilityPct, singleAchievementPct * 0.92);
      }
      const player = parsed.player_name || resolvedPlayerHint || extractPlayerName(promptForParsing);
      const team = parsed.team_name || extractTeamName(promptForParsing);
      const summaryLabel = parsed.summary_label?.trim() || buildFallbackLabel(promptForParsing);
      const rawValue = {
        status: "ok",
        odds: toAmericanOdds(probabilityPct),
        impliedProbability: `${probabilityPct.toFixed(1)}%`,
        confidence: parsed.confidence,
        assumptions: parsed.assumptions,
        playerName: null,
        headshotUrl: null,
        summaryLabel,
        liveChecked: Boolean(liveContext),
        asOfDate: liveContext?.asOfDate || today,
        sourceType: referenceAnchors.length ? "hybrid_anchored" : "hypothetical",
        sourceLabel: referenceAnchors.length
          ? "Estimated with live market anchors"
          : "Hypothetical estimate",
      };
      if (conditionalIntent || jointEventIntent) {
        rawValue.confidence = "Low";
        rawValue.assumptions = Array.isArray(rawValue.assumptions) ? rawValue.assumptions : [];
        rawValue.assumptions.unshift(
          conditionalIntent
            ? `Conditional scenario simplified to a single-path estimate for ${DEFAULT_NFL_SEASON}.`
            : `Joint-event scenario estimated with conservative dependence assumptions for ${DEFAULT_NFL_SEASON}.`
        );
        rawValue.sourceLabel = "Scenario model (conditional/joint approximation)";
      }
      const value = await enrichEntityMedia(promptForParsing, rawValue, player, team, mediaOptions);
      const stableValue = applyConsistencyAndTrack({ prompt: promptForParsing, intent, result: value });
      let finalValue = decorateForScenarioComplexity(stableValue, conditionalIntent, jointEventIntent);
      if (FEATURE_ENABLE_TRACE) {
        finalValue.trace = {
          ...(finalValue.trace || {}),
          intent,
          canonicalPromptKey: semanticKey,
          apiVersion: API_PUBLIC_VERSION,
          entity: {
            playerHint: resolvedPlayerHint || playerHint || "",
            teamHint: teamHint || "",
          },
        };
      }
      metrics.hypotheticalServed += 1;
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value: finalValue });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value: finalValue });
      return res.json(finalValue);
    } catch (error) {
      if (error?.name === "AbortError") {
        const today = new Date().toISOString().slice(0, 10);
        const explicitNonNfl = hasExplicitNonNflLeagueContext(promptForParsing);
        if (comebackIntent && (isKnownDeceasedMention(prompt) || isKnownLongRetiredMention(prompt))) {
          const base = noChanceEstimate(promptForParsing, today);
          const value = await enrichEntityMedia(promptForParsing, base, playerHint || "", "", {
            preferredTeamAbbr: "",
            preferActive: false,
          });
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }
        if (playerHint && !teamHint && !hasStrongSportsContext(promptForParsing) && !explicitNonNfl) {
          const value = buildNonSportsPersonSnarkResponse(playerHint, promptForParsing);
          metrics.snarks += 1;
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }
        if (comebackIntent && playerHint) {
          const value = buildComebackSnarkResponse(playerHint);
          metrics.snarks += 1;
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }
        if (isContradictoryComebackScenario(promptForParsing, null)) {
          const value = buildSnarkResponse(promptForParsing);
          metrics.snarks += 1;
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }
        if (allowLlmBackstop) {
          const quick = await quickModelEstimate(promptForParsing, today);
          if (quick) {
            const value = await enrichEntityMedia(promptForParsing, quick, playerHint || "", "", {
              preferredTeamAbbr: "",
              preferActive: true,
            });
            metrics.quickServed += 1;
            metrics.hypotheticalServed += 1;
            oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
            semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
            return res.json(value);
          }
        }
        const deterministicOnly = buildDeterministicDataSnarkResponse();
        metrics.snarks += 1;
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value: deterministicOnly });
        semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value: deterministicOnly });
        return res.json(deterministicOnly);
      }
      const today = new Date().toISOString().slice(0, 10);
      const explicitNonNfl = hasExplicitNonNflLeagueContext(promptForParsing);
      if (comebackIntent && (isKnownDeceasedMention(promptForParsing) || isKnownLongRetiredMention(promptForParsing))) {
        const base = noChanceEstimate(promptForParsing, today);
        const value = await enrichEntityMedia(promptForParsing, base, playerHint || "", "", {
          preferredTeamAbbr: "",
          preferActive: false,
        });
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }
      if (playerHint && !teamHint && !hasStrongSportsContext(promptForParsing) && !explicitNonNfl) {
        const value = buildNonSportsPersonSnarkResponse(playerHint, promptForParsing);
        metrics.snarks += 1;
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }
      if (comebackIntent && playerHint) {
        const value = buildComebackSnarkResponse(playerHint);
        metrics.snarks += 1;
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }
      if (isContradictoryComebackScenario(promptForParsing, null)) {
        const value = buildSnarkResponse(promptForParsing);
        metrics.snarks += 1;
        oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
        return res.json(value);
      }
      if (allowLlmBackstop) {
        const quick = await quickModelEstimate(promptForParsing, today);
        if (quick) {
          const value = await enrichEntityMedia(promptForParsing, quick, playerHint || "", "", {
            preferredTeamAbbr: "",
            preferActive: true,
          });
          metrics.quickServed += 1;
          metrics.hypotheticalServed += 1;
          oddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value });
          return res.json(value);
        }
      }
      const deterministicOnly = buildDeterministicDataSnarkResponse();
      metrics.snarks += 1;
      oddsCache.set(normalizedPrompt, { ts: Date.now(), value: deterministicOnly });
      semanticOddsCache.set(normalizedPrompt, { ts: Date.now(), value: deterministicOnly });
      return res.json(deterministicOnly);
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const message = error?.message || "Unexpected server error.";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/player/outcomes", async (req, res) => {
  try {
    const playerRaw = String(req.body?.player || "").trim();
    if (!playerRaw) {
      return res.status(400).json({ error: "player is required" });
    }

    const profile = await resolveNflPlayerProfile(playerRaw);
    if (!profile) {
      return res.json({
        status: "refused",
        message: "Player not found in current NFL player index. Try full first + last name.",
      });
    }

    const teamName = NFL_TEAM_DISPLAY[profile.teamAbbr] || profile.teamAbbr || "";
    const sbRef = teamName ? await getSportsbookReferenceByTeamAndMarket(teamName, "super_bowl_winner") : null;
    const teamSuperBowlPct = sbRef ? Number(String(sbRef.impliedProbability || "").replace("%", "")) : 0;
    const asOfDate = sbRef?.asOfDate || new Date().toISOString().slice(0, 10);
    const outcomes = buildPlayerOutcomes(profile, {
      teamSuperBowlPct,
      asOfDate,
      calibration: phase2Calibration || {},
    });

    return res.json({
      status: "ok",
      sourceType: sbRef ? "hybrid_anchored" : "historical_model",
      sourceLabel: sbRef
        ? `Anchored to live Super Bowl market (${sbRef.bookmaker})`
        : "Historical model without live team anchor",
      reference: sbRef
        ? {
            market: "super_bowl_winner",
            odds: sbRef.odds,
            impliedProbability: sbRef.impliedProbability,
            book: sbRef.bookmaker,
            asOfDate: sbRef.asOfDate,
          }
        : null,
      outcomes,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unexpected server error." });
  }
});

app.post("/api/player/performance-threshold", async (req, res) => {
  try {
    const playerRaw = String(req.body?.player || "").trim();
    const metric = String(req.body?.metric || "").trim().toLowerCase();
    const threshold = Number(req.body?.threshold);

    if (!playerRaw) return res.status(400).json({ error: "player is required" });
    if (!metric) return res.status(400).json({ error: "metric is required" });
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return res.status(400).json({ error: "threshold must be a positive number" });
    }

    const supported = new Set([
      "passing_yards",
      "passing_tds",
      "receiving_yards",
      "sacks",
      "interceptions",
    ]);
    if (!supported.has(metric)) {
      return res.status(400).json({
        error:
          "Unsupported metric. Use one of: passing_yards, passing_tds, receiving_yards, sacks, interceptions",
      });
    }

    const profile = await resolveNflPlayerProfile(playerRaw);
    if (!profile) {
      return res.json({
        status: "refused",
        message: "Player not found in current NFL player index. Try full first + last name.",
      });
    }

    const result = buildPerformanceThresholdOutcome(profile, metric, threshold, {
      calibration: phase2Calibration || {},
    });
    return res.json({
      status: "ok",
      asOfDate: new Date().toISOString().slice(0, 10),
      player: profile,
      result,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unexpected server error." });
  }
});

app.get("/api/suggestions", async (_req, res) => {
  try {
    const state = await refreshLiveSportsState(false);
    const prompts = Array.isArray(state?.suggestedPrompts)
      ? state.suggestedPrompts
          .filter((p) => typeof p === "string" && p.trim().length > 0)
          .filter((p) => !isNonNflSportsPrompt(p) && hasNflSpecificContext(p))
          .slice(0, 8)
      : [];
    return res.json({
      status: "ok",
      asOfDate: state?.asOfDate || new Date().toISOString().slice(0, 10),
      prompts,
    });
  } catch (_error) {
    return res.json({
      status: "ok",
      asOfDate: new Date().toISOString().slice(0, 10),
      prompts: [
        "Chiefs win the AFC next season",
        "Josh Allen throws 30 touchdowns this season",
        "Justin Jefferson scores 10 receiving TDs this season",
        "A team goes 17-0 in the NFL regular season",
      ],
    });
  }
});

app.get("/api/phase2/status", (_req, res) => {
  res.json({
    status: "ok",
    calibrationLoaded: Boolean(phase2Calibration),
    calibrationVersion: phase2Calibration?.version || null,
    calibrationBuiltAt: phase2Calibration?.builtAt || null,
    calibrationLoadedAt: phase2CalibrationLoadedAt ? new Date(phase2CalibrationLoadedAt).toISOString() : null,
    calibrationFile: PHASE2_CALIBRATION_FILE,
  });
});

app.get("/api/metrics", (_req, res) => {
  const totalServed = metrics.baselineServed + metrics.sportsbookServed + metrics.hypotheticalServed;
  const anchorChecks = metrics.sportsbookServed + metrics.anchorMisses;
  res.json({
    status: "ok",
    ...metrics,
    totalServed,
    anchorHitRate: anchorChecks > 0 ? Number((metrics.sportsbookServed / anchorChecks).toFixed(3)) : null,
    fallbackRate: totalServed > 0 ? Number((metrics.fallbackServed / totalServed).toFixed(3)) : null,
    cacheEntries: oddsCache.size,
    semanticCacheEntries: semanticOddsCache.size,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/version", (_req, res) => {
  res.json({
    status: "ok",
    apiVersion: API_PUBLIC_VERSION,
    expectedClientVersion: API_PUBLIC_VERSION,
    cacheVersion: CACHE_VERSION,
    defaultNflSeasonInterpretation: DEFAULT_NFL_SEASON,
  });
});

app.post("/api/phase2/reload", async (_req, res) => {
  try {
    const loaded = await loadPhase2Calibration();
    return res.json({
      status: "ok",
      calibrationLoaded: Boolean(loaded),
      calibrationVersion: loaded?.version || null,
      calibrationBuiltAt: loaded?.builtAt || null,
      calibrationLoadedAt: phase2CalibrationLoadedAt ? new Date(phase2CalibrationLoadedAt).toISOString() : null,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Failed to reload calibration" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    apiVersion: API_PUBLIC_VERSION,
    expectedClientVersion: API_PUBLIC_VERSION,
    cacheVersion: CACHE_VERSION,
    defaultNflSeasonInterpretation: DEFAULT_NFL_SEASON,
    cwd: process.cwd(),
    pid: process.pid,
    nflIndexPlayers: nflPlayerIndex.size,
    nflIndexLoadedAt: nflIndexLoadedAt ? new Date(nflIndexLoadedAt).toISOString() : null,
    phase2CalibrationLoaded: Boolean(phase2Calibration),
    phase2CalibrationVersion: phase2Calibration?.version || null,
    oddsApiConfigured: Boolean(ODDS_API_KEY),
    now: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`What Are the Odds server running at http://localhost:${port}`);
  loadNflPlayerIndex(false).catch(() => {
    // Non-fatal: web verification remains as fallback.
  });
  refreshLiveSportsState(false).catch(() => {
    // Non-fatal: fallback prompts are available.
  });
  if (ODDS_API_KEY) {
    getOddsApiSports(false).catch(() => {
      // Non-fatal: hypothetical mode remains available.
    });
  }
  loadPhase2Calibration().catch(() => {
    // Non-fatal: engine falls back to internal defaults.
  });
  if (STRICT_BOOT_SELFTEST) {
    setTimeout(async () => {
      const result = await runBootSelfTest();
      if (!result.ok) {
        console.error("Boot self-test failed:", result.message);
        process.exit(1);
      }
      console.log("Boot self-test passed.");
    }, 900);
  }
});
