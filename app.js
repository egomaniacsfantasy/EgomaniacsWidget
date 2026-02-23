const form = document.getElementById("odds-form");
const scenarioInput = document.getElementById("scenario-input");
const submitBtn = document.getElementById("submit-btn");
const resultCard = document.getElementById("result-card");
const refusalCard = document.getElementById("refusal-card");
const refusalTitle = document.getElementById("refusal-title");
const refusalCopy = document.getElementById("refusal-copy");
const refusalHint = document.getElementById("refusal-hint");
const resultTypeLabel = document.getElementById("result-type-label");
const oddsOutput = document.getElementById("odds-output");
const probabilityOutput = document.getElementById("probability-output");
const sourceLine = document.getElementById("source-line");
const freshnessLine = document.getElementById("freshness-line");
const playerHeadshot = document.getElementById("player-headshot");
const playerHeadshotSecondary = document.getElementById("player-headshot-secondary");
const playerHeadshotCluster = document.getElementById("player-headshot-cluster");
const playerHeadshotWrap = document.getElementById("player-headshot-wrap");
const entityStrip = document.getElementById("entity-strip");
const headshotProfilePop = document.getElementById("headshot-profile-pop");
const headshotProfileLogo = document.getElementById("headshot-profile-logo");
const headshotProfileName = document.getElementById("headshot-profile-name");
const headshotProfileMeta = document.getElementById("headshot-profile-meta");
const promptSummary = document.getElementById("prompt-summary");
const shareBtn = document.getElementById("share-btn");
const copyBtn = document.getElementById("copy-btn");
const statusLine = document.getElementById("status-line");
const examplesWrap = document.querySelector(".examples");
const shareCard = document.getElementById("share-card");
const shareOddsOutput = document.getElementById("share-odds-output");
const shareSummaryOutput = document.getElementById("share-summary-output");
const shareProbabilityOutput = document.getElementById("share-probability-output");
const shareSourceOutput = document.getElementById("share-source-output");
const hofWarning = document.getElementById("hof-warning");
const rationalePanel = document.getElementById("rationale-panel");
const rationaleList = document.getElementById("rationale-list");
const feedbackPop = document.getElementById("feedback-pop");
const feedbackQuestion = document.getElementById("feedback-question");
const feedbackUpBtn = document.getElementById("feedback-up");
const feedbackDownBtn = document.getElementById("feedback-down");
const feedbackThanks = document.getElementById("feedback-thanks");
const PLACEHOLDER_ROTATE_MS = 3200;
const EXAMPLE_REFRESH_MS = 12000;
const CLIENT_API_VERSION = "2026.02.23.12";
const FEEDBACK_RATED_MAP_KEY = "ewa_feedback_rated_map";
const FEEDBACK_SESSION_ID_KEY = "ewa_feedback_session_id";

const DEFAULT_EXAMPLE_POOL = [
  "Josh Allen throws 30 touchdowns this season",
  "Drake Maye wins MVP this season",
  "Bijan Robinson scores 12 rushing TDs this season",
  "Ja'Marr Chase gets 1400 receiving yards this season",
  "Justin Jefferson scores 10 receiving TDs this season",
  "CeeDee Lamb catches 105 passes this season",
  "Breece Hall gets 1500 scrimmage yards this season",
  "Amon-Ra St. Brown gets 1200 receiving yards this season",
  "Lamar Jackson throws 35 touchdowns this season",
  "Joe Burrow throws 4200 passing yards this season",
  "Brock Bowers scores 8 receiving TDs this season",
  "Jahmyr Gibbs scores 14 total TDs this season",
  "Chiefs win the AFC next season",
  "Patriots win the AFC East next season",
  "A team goes 17-0 in the NFL regular season",
  "A team goes 0-17 in the NFL regular season",
  "Drake Maye wins 2 Super Bowls",
];
let examplePool = [...DEFAULT_EXAMPLE_POOL];
let lastExamples = [];
let placeholderPool = [...DEFAULT_EXAMPLE_POOL];
let placeholderIdx = 0;
let placeholderTimer = null;
let exampleTimer = null;
let feedbackContext = null;
let primaryPlayerInfo = null;
let secondaryPlayerInfo = null;
let allowFeedbackForCurrentResult = false;
let profileHideTimer = null;

const NFL_TEAM_ABBR = {
  "arizona cardinals": "ARI",
  "atlanta falcons": "ATL",
  "baltimore ravens": "BAL",
  "buffalo bills": "BUF",
  "carolina panthers": "CAR",
  "chicago bears": "CHI",
  "cincinnati bengals": "CIN",
  "cleveland browns": "CLE",
  "dallas cowboys": "DAL",
  "denver broncos": "DEN",
  "detroit lions": "DET",
  "green bay packers": "GB",
  "houston texans": "HOU",
  "indianapolis colts": "IND",
  "jacksonville jaguars": "JAX",
  "kansas city chiefs": "KC",
  "las vegas raiders": "LV",
  "los angeles chargers": "LAC",
  "los angeles rams": "LAR",
  "miami dolphins": "MIA",
  "minnesota vikings": "MIN",
  "new england patriots": "NE",
  "new orleans saints": "NO",
  "new york giants": "NYG",
  "new york jets": "NYJ",
  "philadelphia eagles": "PHI",
  "pittsburgh steelers": "PIT",
  "san francisco 49ers": "SF",
  "seattle seahawks": "SEA",
  "tampa bay buccaneers": "TB",
  "tennessee titans": "TEN",
  "washington commanders": "WAS",
};

function isNflPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!text.trim()) return false;
  const nonNfl = /\b(nba|mlb|nhl|wnba|soccer|premier league|epl|world series|stanley cup|nba finals|ufc|mma|f1|formula 1|tennis|golf)\b/.test(text);
  if (nonNfl) return false;
  return /\b(nfl|afc|nfc|super bowl|playoffs?|mvp|qb|quarterback|rb|wr|te|touchdowns?|tds?|passing|receiving|interceptions?|ints?|yards?|patriots|chiefs|bills|jets|dolphins|ravens|49ers|packers|cowboys|eagles|burrow|allen|lamar|maye|jefferson|chase|gibbs|bijan|breece)\b/.test(
    text
  );
}

function normalizePrompt(prompt) {
  return prompt
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function setBusy(isBusy) {
  submitBtn.disabled = isBusy;
  submitBtn.textContent = isBusy ? "Estimating..." : "Estimate";
  submitBtn.classList.toggle("is-loading", isBusy);
}

function isTouchLikeDevice() {
  return (
    (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: none)").matches) ||
    (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0)
  );
}

function clearHeadshot() {
  if (entityStrip) {
    entityStrip.innerHTML = "";
    entityStrip.classList.add("hidden");
  }
  playerHeadshot.removeAttribute("src");
  playerHeadshot.alt = "";
  playerHeadshot.classList.add("hidden");
  playerHeadshotSecondary.removeAttribute("src");
  playerHeadshotSecondary.alt = "";
  playerHeadshotSecondary.classList.add("hidden");
  playerHeadshotCluster.classList.add("hidden");
  playerHeadshotCluster.style.display = "";
  hideHeadshotProfile();
  primaryPlayerInfo = null;
  secondaryPlayerInfo = null;
}

function clearRationale() {
  if (!rationalePanel || !rationaleList) return;
  rationaleList.innerHTML = "";
  rationalePanel.open = false;
  rationalePanel.classList.add("hidden");
}

function clearFreshness() {
  freshnessLine.textContent = "";
  freshnessLine.classList.add("hidden");
}

function clearSourceLine() {
  sourceLine.textContent = "";
  sourceLine.classList.add("hidden");
}

function getStoredNumber(key, fallback = 0) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) ? n : fallback;
  } catch (_error) {
    return fallback;
  }
}

function setStoredValue(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (_error) {
    // no-op
  }
}

function getFeedbackRatedMap() {
  try {
    const raw = localStorage.getItem(FEEDBACK_RATED_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function setFeedbackRatedMap(map) {
  try {
    localStorage.setItem(FEEDBACK_RATED_MAP_KEY, JSON.stringify(map || {}));
  } catch (_error) {
    // no-op
  }
}

function buildFeedbackKey(prompt, result) {
  return `${String(prompt || "").toLowerCase().trim()}|${String(result?.summaryLabel || "").toLowerCase().trim()}|${String(result?.odds || "").trim()}`;
}

function getOrCreateSessionId() {
  try {
    const existing = localStorage.getItem(FEEDBACK_SESSION_ID_KEY);
    if (existing) return existing;
    const generated = `sess_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    localStorage.setItem(FEEDBACK_SESSION_ID_KEY, generated);
    return generated;
  } catch (_error) {
    return `sess_${Date.now().toString(36)}`;
  }
}

function hideFeedbackPop() {
  if (!feedbackPop) return;
  feedbackPop.classList.remove("feedback-closing", "feedback-thanked");
  feedbackPop.classList.add("hidden");
  feedbackThanks?.classList.add("hidden");
  feedbackUpBtn?.removeAttribute("disabled");
  feedbackDownBtn?.removeAttribute("disabled");
}

function closeFeedbackPopAnimated() {
  if (!feedbackPop || feedbackPop.classList.contains("hidden")) return;
  feedbackPop.classList.add("feedback-closing");
  setTimeout(() => {
    hideFeedbackPop();
  }, 340);
}

function maybeShowFeedback(prompt, result) {
  if (!feedbackPop || !result) return;
  const key = buildFeedbackKey(prompt, result);
  const rated = getFeedbackRatedMap();
  if (rated[key]) return;

  feedbackContext = {
    prompt,
    result:
      result.status === "ok"
        ? {
            status: result.status,
            odds: result.odds,
            impliedProbability: result.impliedProbability,
            summaryLabel: result.summaryLabel,
            sourceType: result.sourceType,
            sourceLabel: result.sourceLabel,
            asOfDate: result.asOfDate,
            requestId: result.requestId || "",
          }
        : {
            status: result.status || "refused",
            title: result.title || "",
            message: result.message || "",
            hint: result.hint || "",
            requestId: result.requestId || "",
          },
    key,
  };
  feedbackQuestion.textContent = "Was this estimate helpful?";
  feedbackThanks.classList.add("hidden");
  feedbackPop.classList.remove("feedback-closing", "feedback-thanked");
  feedbackPop.classList.remove("hidden");
}

async function submitFeedback(vote) {
  if (!feedbackContext || !["up", "down"].includes(vote)) return;
  feedbackUpBtn?.setAttribute("disabled", "true");
  feedbackDownBtn?.setAttribute("disabled", "true");
  feedbackPop.classList.add("feedback-thanked");
  feedbackThanks.classList.add("hidden");
  feedbackQuestion.textContent = "Thanks for your feedback!";
  setTimeout(() => {
    closeFeedbackPopAnimated();
  }, 1800);

  const body = {
    vote,
    prompt: feedbackContext.prompt,
    result: feedbackContext.result,
    requestId: String(feedbackContext.result?.requestId || ""),
    clientVersion: CLIENT_API_VERSION,
    sessionId: getOrCreateSessionId(),
  };
  fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // Ignore send errors after UX confirmation.
  });

  const rated = getFeedbackRatedMap();
  rated[feedbackContext.key] = vote;
  setFeedbackRatedMap(rated);
  feedbackContext = null;
}

function parseAmericanOdds(oddsText) {
  const text = String(oddsText || "").trim();
  if (!text || text.toUpperCase() === "NO CHANCE") return null;
  const n = Number(text.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

function renderOddsDisplay(oddsText) {
  const n = parseAmericanOdds(oddsText);
  oddsOutput.classList.remove("live-shimmer", "heartbeat-glow");
  oddsOutput.style.animation = "none";
  void oddsOutput.offsetWidth;
  oddsOutput.style.animation = "";
  if (n !== null && n <= -10000) {
    oddsOutput.classList.add("lock-mode");
    oddsOutput.classList.add("live-shimmer", "heartbeat-glow");
    oddsOutput.innerHTML = `IT'S A LOCK!<span class="odds-subline">(WELL, BASICALLY, AS LONG AS HE'S HEALTHY.)</span>`;
    return "lock";
  }
  if (n !== null && n >= 10000) {
    oddsOutput.classList.add("lock-mode");
    oddsOutput.classList.add("live-shimmer", "heartbeat-glow");
    oddsOutput.innerHTML = `NO SHOT.<span class="odds-subline">(LIKE, REALLY NO SHOT.)</span>`;
    return "no-shot";
  }
  oddsOutput.classList.remove("lock-mode");
  oddsOutput.classList.add("live-shimmer", "heartbeat-glow");
  oddsOutput.textContent = oddsText;
  return "normal";
}

function applyResultCardState(mode) {
  resultCard.classList.remove("state-lock", "state-no-shot");
  if (mode === "lock") resultCard.classList.add("state-lock");
  if (mode === "no-shot") resultCard.classList.add("state-no-shot");
}

function formatPlayerMeta(info) {
  if (!info || typeof info !== "object") return "";
  return String(info.team || "").trim();
}

function hideHeadshotProfile() {
  if (!headshotProfilePop) return;
  if (profileHideTimer) window.clearTimeout(profileHideTimer);
  headshotProfilePop.classList.remove("profile-enter");
  headshotProfilePop.classList.add("profile-leave");
  profileHideTimer = window.setTimeout(() => {
    headshotProfilePop.classList.add("hidden");
    headshotProfilePop.classList.remove("profile-leave");
  }, 150);
}

function showHeadshotProfile(info, anchor = "primary", anchorEl = null) {
  if (!headshotProfilePop || !headshotProfileName || !headshotProfileMeta) return;
  if (!info || !info.name) return;
  if (profileHideTimer) window.clearTimeout(profileHideTimer);
  const isTeam = String(info.position || "").toLowerCase() === "team" || String(info.kind || "").toLowerCase() === "team";

  if (headshotProfileLogo) {
    const logoUrl = info.teamLogoUrl || "";
    if (logoUrl) {
      headshotProfileLogo.src = logoUrl;
      headshotProfileLogo.alt = `${info.team || info.name || "Team"} logo`;
      headshotProfileLogo.classList.remove("hidden");
      headshotProfilePop.classList.remove("no-logo");
    } else {
      headshotProfileLogo.removeAttribute("src");
      headshotProfileLogo.alt = "";
      headshotProfileLogo.classList.add("hidden");
      headshotProfilePop.classList.add("no-logo");
    }
  }

  if (isTeam) {
    headshotProfileName.textContent = String(info.name || "").trim();
    headshotProfileMeta.textContent = info.superBowlOdds
      ? `2026-27 Super Bowl odds: ${info.superBowlOdds}`
      : "2026-27 Super Bowl odds: unavailable";
  } else {
    const pos = String(info.position || "").trim();
    const nm = String(info.name || "").trim();
    headshotProfileName.textContent = pos ? `${nm} • ${pos}` : nm;
    headshotProfileMeta.textContent = formatPlayerMeta(info);
  }
  if (anchorEl instanceof Element && playerHeadshotWrap instanceof Element) {
    const wrapRect = playerHeadshotWrap.getBoundingClientRect();
    const targetRect = anchorEl.getBoundingClientRect();
    const leftPx = Math.max(0, targetRect.left - wrapRect.left - 14);
    headshotProfilePop.style.left = `${leftPx}px`;
    headshotProfilePop.style.right = "auto";
  } else if (anchor === "secondary") {
    headshotProfilePop.style.left = "auto";
    headshotProfilePop.style.right = "0";
  } else {
    headshotProfilePop.style.right = "auto";
    headshotProfilePop.style.left = "0";
  }
  headshotProfilePop.classList.remove("profile-leave", "hidden");
  headshotProfilePop.classList.add("profile-enter");
}

function renderEntityStrip(result) {
  if (!entityStrip) return false;
  const assets = Array.isArray(result?.entityAssets) ? result.entityAssets : [];
  if (!assets.length) {
    entityStrip.innerHTML = "";
    entityStrip.classList.add("hidden");
    return false;
  }

  entityStrip.innerHTML = "";
  const validAssets = assets
    .filter((asset) => {
      const url = String(asset?.imageUrl || "").trim();
      if (!url) return false;
      if (/^(about:blank|data:,?)$/i.test(url)) return false;
      if (/\/500\/\.png$/i.test(url)) return false;
      return true;
    })
    .slice(0, 10);
  const overflowCount = Math.max(
    0,
    assets.filter((asset) => {
      const url = String(asset?.imageUrl || "").trim();
      return Boolean(url) && !/^(about:blank|data:,?)$/i.test(url);
    }).length - validAssets.length
  );

  validAssets.forEach((asset, idx, arr) => {
    if (!asset?.imageUrl) return;
    const img = document.createElement("img");
    img.className = "entity-avatar";
    img.classList.add(asset?.kind === "team" ? "entity-avatar--team" : "entity-avatar--player");
    img.src = asset.imageUrl;
    img.alt = asset.name || asset.kind || "Entity";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.remove();
      if (!entityStrip.children.length) {
        entityStrip.classList.add("hidden");
      }
    });
    img.addEventListener("load", () => {
      const w = Number(img.naturalWidth || 0);
      const h = Number(img.naturalHeight || 0);
      if (w < 8 || h < 8) {
        img.remove();
        if (!entityStrip.children.length) {
          entityStrip.classList.add("hidden");
        }
      }
    });
    const info = asset.info && typeof asset.info === "object" ? asset.info : { name: asset.name || "Entity" };
    const infoLabel = info?.name
      ? `${String(info.name || "").trim()}${info?.position ? ` • ${String(info.position || "").trim()}` : ""}`
      : String(asset.name || asset.kind || "Entity");
    img.title = infoLabel;
    img.setAttribute("aria-label", infoLabel);
    img.addEventListener("click", () => {
      const anchor = idx >= Math.floor(arr.length / 2) ? "secondary" : "primary";
      showHeadshotProfile(info, anchor, img);
    });
    img.addEventListener("touchstart", () => {
      const anchor = idx >= Math.floor(arr.length / 2) ? "secondary" : "primary";
      showHeadshotProfile(info, anchor, img);
    }, { passive: true });
    img.addEventListener("mouseenter", () => {
      const anchor = idx >= Math.floor(arr.length / 2) ? "secondary" : "primary";
      showHeadshotProfile(info, anchor, img);
    });
    img.addEventListener("mouseleave", () => {
      if (!headshotProfilePop?.matches(":hover")) hideHeadshotProfile();
    });
    entityStrip.appendChild(img);
  });

  if (overflowCount > 0) {
    const badge = document.createElement("span");
    badge.className = "entity-overflow-badge";
    badge.textContent = `+${overflowCount}`;
    entityStrip.appendChild(badge);
  }

  if (!entityStrip.children.length) {
    entityStrip.classList.add("hidden");
    return false;
  }
  const avatarCount = validAssets.length;
  entityStrip.classList.toggle("entity-strip--single", avatarCount === 1);
  entityStrip.classList.toggle("entity-strip--pair", avatarCount === 2);
  entityStrip.classList.toggle("entity-strip--trio", avatarCount === 3);
  entityStrip.classList.toggle("entity-strip--quad", avatarCount === 4);
  entityStrip.classList.toggle("entity-strip--dense", avatarCount >= 5 && avatarCount <= 7);
  entityStrip.classList.toggle("entity-strip--ultra", avatarCount >= 8);
  entityStrip.classList.remove("hidden");
  return true;
}

function bindHeadshotPopovers() {
  const primaryCanShow = Boolean(primaryPlayerInfo && primaryPlayerInfo.name);
  const secondaryCanShow = Boolean(secondaryPlayerInfo && secondaryPlayerInfo.name);
  playerHeadshot.style.cursor = primaryCanShow ? "pointer" : "default";
  playerHeadshotSecondary.style.cursor = secondaryCanShow ? "pointer" : "default";
}

function isHallOfFamePrompt(text) {
  const t = String(text || "").toLowerCase();
  return /\b(hall of fame|hof)\b/.test(t);
}

function toggleHallOfFameWarning(show) {
  if (!hofWarning) return;
  hofWarning.classList.toggle("hidden", !show);
}

function formatOddsForShare(oddsText) {
  const n = parseAmericanOdds(oddsText);
  if (n !== null && n <= -10000) return "IT'S A LOCK!";
  if (n !== null && n >= 10000) return "NO SHOT.";
  return String(oddsText || "");
}

function syncShareCard(result, prompt) {
  shareOddsOutput.textContent = formatOddsForShare(result.odds);
  shareSummaryOutput.textContent = getDisplaySummaryLabel(result.summaryLabel, prompt, result);
  shareProbabilityOutput.textContent = result.impliedProbability || "";

  if (result.sourceType === "sportsbook" && result.sourceBook) {
    shareSourceOutput.textContent = `${result.sourceBook} reference`;
  } else if (result.liveChecked) {
    shareSourceOutput.textContent = "Live context checked";
  } else {
    shareSourceOutput.textContent = "Hypothetical model";
  }
}

function normalizeSummaryText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAwkwardSummaryEnding(text) {
  return /\b(and|or|to|of|in|on|for|with|before|after|the|a|an)$/i.test(normalizeSummaryText(text));
}

function getLastName(fullName) {
  const clean = String(fullName || "")
    .replace(/\b(Jr\.?|Sr\.?|II|III|IV|V)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const parts = clean.split(" ");
  return parts[parts.length - 1] || clean;
}

function teamAbbrFromName(teamName) {
  const key = String(teamName || "").toLowerCase().trim();
  if (!key) return "";
  return NFL_TEAM_ABBR[key] || "";
}

function applySummaryStyleRules(label, result) {
  let out = String(label || "");
  const assets = Array.isArray(result?.entityAssets) ? result.entityAssets : [];
  for (const asset of assets) {
    const nm = String(asset?.name || "").trim();
    if (!nm) continue;
    if (String(asset?.kind || "").toLowerCase() === "player") {
      const ln = getLastName(nm);
      if (ln) {
        const re = new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
        out = out.replace(re, ln);
      }
    } else if (String(asset?.kind || "").toLowerCase() === "team") {
      const abbr = teamAbbrFromName(nm);
      if (abbr) {
        const re = new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
        out = out.replace(re, abbr);
      }
    }
  }
  return normalizeSummaryText(out);
}

function getDisplaySummaryLabel(summaryLabel, prompt, result) {
  const label = normalizeSummaryText(summaryLabel);
  const fallback = normalizeSummaryText(prompt);
  const chosen = !label || isAwkwardSummaryEnding(label) ? fallback : label;
  return applySummaryStyleRules(chosen, result);
}

function applyPromptSummarySizing(text) {
  const len = String(text || "").length;
  promptSummary.classList.remove("prompt-summary--compact", "prompt-summary--tiny");
  if (len > 110) {
    promptSummary.classList.add("prompt-summary--tiny");
  } else if (len > 74) {
    promptSummary.classList.add("prompt-summary--compact");
  }
}

function showResult(result, prompt) {
  refusalCard.classList.add("hidden");
  resultCard.classList.remove("hidden");
  hideHeadshotProfile();
  resultCard.classList.remove("result-pop");
  void resultCard.offsetWidth;
  resultCard.classList.add("result-pop");

  const oddsMode = renderOddsDisplay(result.odds);
  applyResultCardState(oddsMode);
  probabilityOutput.textContent = result.impliedProbability;
  const displaySummary = getDisplaySummaryLabel(result.summaryLabel, prompt, result);
  promptSummary.textContent = displaySummary;
  applyPromptSummarySizing(displaySummary);
  resultTypeLabel.textContent = result.sourceType === "sportsbook" ? "Market Reference" : "Estimated Odds";
  toggleHallOfFameWarning(isHallOfFamePrompt(prompt) || isHallOfFamePrompt(result.summaryLabel));
  if (result.sourceType === "sportsbook" && result.sourceBook) {
    sourceLine.textContent = `Source: ${result.sourceBook}`;
    sourceLine.classList.remove("hidden");
    freshnessLine.textContent = `${result.sourceBook} reference as of ${result.asOfDate || "today"}`;
    freshnessLine.classList.remove("hidden");
  } else if (result.liveChecked && result.asOfDate) {
    clearSourceLine();
    freshnessLine.textContent = `Live context checked as of ${result.asOfDate}`;
    freshnessLine.classList.remove("hidden");
  } else {
    clearSourceLine();
    clearFreshness();
  }

  clearRationale();
  if (Array.isArray(result.assumptions) && result.assumptions.length > 0 && rationalePanel && rationaleList) {
    result.assumptions.slice(0, 3).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = String(item || "");
      rationaleList.appendChild(li);
    });
    rationalePanel.open = false;
    rationalePanel.classList.remove("hidden");
  }

  const renderedStrip = renderEntityStrip(result);
  if (renderedStrip) {
    playerHeadshot.removeAttribute("src");
    playerHeadshotSecondary.removeAttribute("src");
    playerHeadshot.classList.add("hidden");
    playerHeadshotSecondary.classList.add("hidden");
    playerHeadshotCluster.classList.add("hidden");
    playerHeadshotCluster.style.display = "none";
    primaryPlayerInfo = null;
    secondaryPlayerInfo = null;
  } else if (result.headshotUrl) {
    playerHeadshotCluster.style.display = "";
    playerHeadshot.src = result.headshotUrl;
    playerHeadshot.alt = result.playerName || result.summaryLabel || "Sports entity";
    playerHeadshot.classList.remove("hidden");
    playerHeadshotCluster.classList.remove("hidden");
    primaryPlayerInfo =
      result.playerInfo && typeof result.playerInfo === "object"
        ? result.playerInfo
        : result.playerName
          ? { name: result.playerName }
          : null;
    const hasSecondary = Boolean(
      result.secondaryHeadshotUrl &&
      result.secondaryHeadshotUrl !== result.headshotUrl
    );
    if (hasSecondary) {
      playerHeadshotSecondary.src = result.secondaryHeadshotUrl;
      playerHeadshotSecondary.alt = result.secondaryPlayerName || "Second sports figure";
      playerHeadshotSecondary.classList.remove("hidden");
      secondaryPlayerInfo =
        result.secondaryPlayerInfo && typeof result.secondaryPlayerInfo === "object"
          ? result.secondaryPlayerInfo
          : result.secondaryPlayerName
            ? { name: result.secondaryPlayerName }
            : null;
    } else {
      playerHeadshotSecondary.removeAttribute("src");
      playerHeadshotSecondary.alt = "";
      playerHeadshotSecondary.classList.add("hidden");
      secondaryPlayerInfo = null;
    }
    bindHeadshotPopovers();
  } else {
    clearHeadshot();
  }

  syncShareCard(result, prompt);
  if (allowFeedbackForCurrentResult) {
    maybeShowFeedback(prompt, result);
  } else {
    hideFeedbackPop();
  }
}

function showRefusal(message, options = {}) {
  resultCard.classList.add("hidden");
  refusalCard.classList.remove("hidden");
  resultTypeLabel.textContent = "Estimated Odds";
  clearHeadshot();
  clearSourceLine();
  clearFreshness();
  clearRationale();
  toggleHallOfFameWarning(false);
  hideFeedbackPop();
  applyResultCardState("normal");
  refusalTitle.textContent = options.title || "This tool can’t help with betting picks.";
  refusalCopy.textContent =
    message ||
    "What Are the Odds? provides hypothetical entertainment estimates only. It does not provide sportsbook lines or betting advice.";
  refusalHint.textContent = options.hint || "Try a sports hypothetical instead.";
  statusLine.textContent = message || "Hypothetical entertainment odds only.";
}

function showSystemError(message) {
  resultCard.classList.add("hidden");
  refusalCard.classList.add("hidden");
  clearHeadshot();
  clearSourceLine();
  clearFreshness();
  clearRationale();
  toggleHallOfFameWarning(false);
  hideFeedbackPop();
  applyResultCardState("normal");
  statusLine.textContent = message;
}

function encodePromptInUrl(prompt) {
  const url = new URL(window.location.href);
  url.searchParams.set("q", prompt);
  window.history.replaceState({}, "", url);
}

async function fetchOdds(prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 22000);
  let response;
  try {
    response = await fetch("/api/odds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ewa-client-version": CLIENT_API_VERSION,
        "x-ewa-session-id": getOrCreateSessionId(),
      },
      body: JSON.stringify({ prompt, sessionId: getOrCreateSessionId() }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    throw new Error("Invalid API response.");
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Request failed.");
  }

  return payload;
}

async function checkVersionHandshake() {
  try {
    const response = await fetch("/api/health", { method: "GET" });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload || !payload.apiVersion) return;
    if (payload.apiVersion !== CLIENT_API_VERSION) {
      statusLine.textContent = `App updated on server. Running in compatibility mode (${payload.apiVersion}).`;
    }
  } catch (_error) {
    // Non-fatal: normal request flow will surface availability errors.
  }
}

async function fetchSuggestions() {
  const response = await fetch("/api/suggestions", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.prompts)) return null;
  return payload.prompts.filter((p) => typeof p === "string" && p.trim().length > 0 && isNflPrompt(p));
}

async function onSubmit(event) {
  event.preventDefault();
  statusLine.textContent = "";
  allowFeedbackForCurrentResult = Boolean(event?.isTrusted);

  const prompt = normalizePrompt(scenarioInput.value);
  if (!prompt) {
    statusLine.textContent = "Enter a sports hypothetical to generate an estimate.";
    return;
  }

  setBusy(true);

  try {
    const payload = await fetchOdds(prompt);

    if (payload.status === "refused" || payload.status === "snark") {
      showRefusal(payload.message, {
        title: payload.title,
        hint: payload.hint,
      });
      if (allowFeedbackForCurrentResult) {
        maybeShowFeedback(prompt, payload);
      }
      encodePromptInUrl(prompt);
      refreshExampleChips();
      return;
    }

    showResult(payload, prompt);
    encodePromptInUrl(prompt);
    statusLine.textContent = "Estimate generated. Try another scenario.";
    refreshExampleChips();
  } catch (error) {
    if (error?.name === "AbortError") {
      showSystemError("Request timed out. Try a shorter prompt.");
    } else {
      showSystemError("Estimator is unavailable right now. Try again in a moment.");
    }
    console.error(error);
  } finally {
    allowFeedbackForCurrentResult = false;
    setBusy(false);
  }
}

async function copyCurrentResult() {
  if (resultCard.classList.contains("hidden")) return;
  const source = freshnessLine.classList.contains("hidden") ? "Hypothetical estimate" : freshnessLine.textContent;
  const payload = `${promptSummary.textContent} | ${oddsOutput.textContent} | ${probabilityOutput.textContent} implied | ${source} | Egomaniacs Fantasy Football - What Are the Odds?`;

  try {
    await navigator.clipboard.writeText(payload);
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1300);
  } catch (_error) {
    statusLine.textContent = "Copy failed. You can still screenshot this result.";
  }
}

async function createShareBlob() {
  if (!window.html2canvas) {
    throw new Error("Share renderer unavailable.");
  }
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  const canvas = await window.html2canvas(shareCard, {
    backgroundColor: "#1e1810",
    scale: isiOS ? 1.25 : 1.6,
    useCORS: true,
    logging: false,
  });

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not build image."));
    }, "image/jpeg", 0.9);
  });
}

async function shareCurrentResult() {
  if (resultCard.classList.contains("hidden")) return;

  const oldText = shareBtn.textContent;
  shareBtn.disabled = true;
  shareBtn.textContent = "Preparing...";
  try {
    const blob = await createShareBlob();
    const file = new File([blob], "egomaniacs-odds.jpg", { type: "image/jpeg" });
    const shareText = `${promptSummary.textContent} — ${oddsOutput.textContent}`;

    const canShareFiles =
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] });
    if (canShareFiles) {
      await navigator.share({
        files: [file],
        title: "What Are the Odds?",
        text: shareText,
      });
      statusLine.textContent = "Share card ready. Sent.";
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "egomaniacs-odds.jpg";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    statusLine.textContent = "Share image downloaded. Send it anywhere.";
  } catch (_error) {
    statusLine.textContent = "Could not generate share image right now.";
  } finally {
    shareBtn.disabled = false;
    shareBtn.textContent = oldText;
  }
}

function hydrateFromUrl() {
  const url = new URL(window.location.href);
  const q = url.searchParams.get("q");
  if (!q) return false;

  scenarioInput.value = q;
  return true;
}

function setupExampleChips() {
  const chips = document.querySelectorAll(".example-chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      scenarioInput.value = chip.textContent.trim();
      scenarioInput.focus();
      form.requestSubmit();
    });
  });
}

function uniqByNormalized(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function chooseFreshExamples() {
  const pool = examplePool.filter((item) => !lastExamples.includes(item));
  const source = pool.length >= 3 ? pool : examplePool;
  const local = [...source];
  const chosen = [];

  while (chosen.length < 3 && local.length > 0) {
    const idx = Math.floor(Math.random() * local.length);
    chosen.push(local.splice(idx, 1)[0]);
  }
  return chosen;
}

function refreshExampleChips() {
  const chips = [...document.querySelectorAll(".example-chip")];
  if (chips.length === 0) return;

  const next = chooseFreshExamples();
  lastExamples = next;

  examplesWrap.classList.remove("examples-refresh");
  void examplesWrap.offsetWidth;
  examplesWrap.classList.add("examples-refresh");

  chips.forEach((chip, index) => {
    chip.textContent = next[index] || chip.textContent;
  });
}

function pickNextPlaceholder() {
  if (!placeholderPool.length) return "";
  if (placeholderPool.length === 1) return placeholderPool[0];
  let idx = Math.floor(Math.random() * placeholderPool.length);
  if (idx === placeholderIdx) idx = (idx + 1) % placeholderPool.length;
  placeholderIdx = idx;
  return placeholderPool[placeholderIdx];
}

function applyPlaceholderSwap(text) {
  if (!text || scenarioInput.value.trim()) return;
  scenarioInput.classList.remove("placeholder-swap");
  void scenarioInput.offsetWidth;
  scenarioInput.placeholder = text;
  scenarioInput.classList.add("placeholder-swap");
}

function startPlaceholderRotation() {
  if (placeholderTimer) clearInterval(placeholderTimer);
  if (!scenarioInput.placeholder) scenarioInput.placeholder = pickNextPlaceholder() || "Josh Allen throws 30 touchdowns this season";
  placeholderTimer = setInterval(() => {
    if (document.activeElement === scenarioInput && scenarioInput.value.trim()) return;
    applyPlaceholderSwap(pickNextPlaceholder());
  }, PLACEHOLDER_ROTATE_MS);
}

function startExampleRotation() {
  if (exampleTimer) clearInterval(exampleTimer);
  exampleTimer = setInterval(() => {
    if (document.activeElement === scenarioInput && scenarioInput.value.trim()) return;
    refreshExampleChips();
  }, EXAMPLE_REFRESH_MS);
}

async function hydrateLiveSuggestions() {
  try {
    const prompts = await fetchSuggestions();
    const merged = uniqByNormalized([...(prompts || []).filter(isNflPrompt), ...DEFAULT_EXAMPLE_POOL]).filter(
      (p) => isNflPrompt(p) && !/\bpro\s*bowl\b/i.test(String(p || ""))
    );
    examplePool = merged.length >= 3 ? merged : [...DEFAULT_EXAMPLE_POOL];
    placeholderPool = [...examplePool];
    placeholderIdx = Math.floor(Math.random() * Math.max(1, placeholderPool.length));
  } catch (_error) {
    examplePool = [...DEFAULT_EXAMPLE_POOL];
    placeholderPool = [...DEFAULT_EXAMPLE_POOL];
    placeholderIdx = Math.floor(Math.random() * Math.max(1, placeholderPool.length));
  } finally {
    refreshExampleChips();
    startPlaceholderRotation();
    startExampleRotation();
  }
}

form.addEventListener("submit", onSubmit);
copyBtn.addEventListener("click", copyCurrentResult);
if (shareBtn) {
  shareBtn.addEventListener("click", shareCurrentResult);
}
playerHeadshot.addEventListener("click", () => {
  if (!primaryPlayerInfo?.name) return;
  const isHidden = headshotProfilePop?.classList.contains("hidden");
  if (!isHidden && headshotProfileName?.textContent === primaryPlayerInfo.name) {
    hideHeadshotProfile();
    return;
  }
  showHeadshotProfile(primaryPlayerInfo, "primary");
});
if (!isTouchLikeDevice()) {
  playerHeadshot.addEventListener("mouseenter", () => {
    if (primaryPlayerInfo?.name) showHeadshotProfile(primaryPlayerInfo, "primary");
  });
  playerHeadshot.addEventListener("mouseleave", () => {
    if (!headshotProfilePop?.matches(":hover")) hideHeadshotProfile();
  });
}
playerHeadshotSecondary.addEventListener("click", () => {
  if (!secondaryPlayerInfo?.name) return;
  const isHidden = headshotProfilePop?.classList.contains("hidden");
  if (!isHidden && headshotProfileName?.textContent === secondaryPlayerInfo.name) {
    hideHeadshotProfile();
    return;
  }
  showHeadshotProfile(secondaryPlayerInfo, "secondary");
});
if (!isTouchLikeDevice()) {
  playerHeadshotSecondary.addEventListener("mouseenter", () => {
    if (secondaryPlayerInfo?.name) showHeadshotProfile(secondaryPlayerInfo, "secondary");
  });
  playerHeadshotSecondary.addEventListener("mouseleave", () => {
    if (!headshotProfilePop?.matches(":hover")) hideHeadshotProfile();
  });
}
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (
    headshotProfilePop?.contains(target) ||
    entityStrip?.contains(target) ||
    playerHeadshotCluster?.contains(target) ||
    playerHeadshot.contains(target) ||
    playerHeadshotSecondary.contains(target)
  ) {
    return;
  }
  hideHeadshotProfile();
});
if (feedbackUpBtn) {
  feedbackUpBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    submitFeedback("up");
  });
  feedbackUpBtn.addEventListener("touchend", (event) => {
    event.preventDefault();
    event.stopPropagation();
    submitFeedback("up");
  }, { passive: false });
}
if (feedbackDownBtn) {
  feedbackDownBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    submitFeedback("down");
  });
  feedbackDownBtn.addEventListener("touchend", (event) => {
    event.preventDefault();
    event.stopPropagation();
    submitFeedback("down");
  }, { passive: false });
}
scenarioInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
const hasSharedPrompt = hydrateFromUrl();
setupExampleChips();
checkVersionHandshake();
hydrateLiveSuggestions();

if (hasSharedPrompt) {
  form.requestSubmit();
}
