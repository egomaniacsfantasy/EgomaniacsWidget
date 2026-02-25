const form = document.getElementById("odds-form");
const scenarioInput = document.getElementById("scenario-input");
const promptContainer = document.getElementById("prompt-container");
const watoContent = document.getElementById("wato-content");
const flipBtn = document.getElementById("flip-btn");
const flipTip = document.getElementById("flip-tip");
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
const queryEcho = document.getElementById("query-echo");
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
const PLACEHOLDER_ROTATE_MS = 3000;
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
let flipTipSeen = false;

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
  promptContainer?.classList.toggle("loading", isBusy);
  if (flipBtn) {
    flipBtn.disabled = isBusy;
  }
}

function splitBeforePrompt(prompt) {
  const text = normalizePrompt(prompt || "");
  if (!text) return null;
  const parts = text.split(/\bbefore\b/i);
  if (parts.length < 2) return null;
  const left = String(parts[0] || "").trim();
  const right = String(parts.slice(1).join(" before ") || "").trim();
  if (!left || !right) return null;
  return { left, right };
}

function isTwoSidedBeforePrompt(prompt) {
  const parts = splitBeforePrompt(prompt);
  if (!parts) return false;
  if (/^(20\d{2})(\s*-\s*(?:20)?\d{2})?$/i.test(parts.right)) return false;
  if (/\bbefore\s+20\d{2}\b/i.test(String(prompt || ""))) return false;
  return true;
}

function updateFlipVisibility() {
  if (!flipBtn) return;
  const show = isTwoSidedBeforePrompt(scenarioInput.value);
  flipBtn.classList.toggle("hidden", !show);
  if (show && !flipTipSeen && flipTip) {
    flipTip.classList.remove("hidden");
    setTimeout(() => {
      flipTip.classList.add("hidden");
    }, 2300);
    flipTipSeen = true;
  }
  if (!show && flipTip) flipTip.classList.add("hidden");
}

function flipPrompt() {
  const parts = splitBeforePrompt(scenarioInput.value);
  if (!parts) return;
  scenarioInput.value = `${parts.right} before ${parts.left}`;
  updateFlipVisibility();
  form.requestSubmit();
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
  feedbackUpBtn?.classList.remove("selected-up", "selected-down");
  feedbackDownBtn?.classList.remove("selected-up", "selected-down");
  feedbackPop.classList.remove("feedback-closing", "feedback-thanked");
  feedbackPop.classList.remove("hidden");
}

async function submitFeedback(vote) {
  if (!feedbackContext || !["up", "down"].includes(vote)) return;
  feedbackUpBtn?.setAttribute("disabled", "true");
  feedbackDownBtn?.setAttribute("disabled", "true");
  feedbackUpBtn?.classList.toggle("selected-up", vote === "up");
  feedbackDownBtn?.classList.toggle("selected-down", vote === "down");
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
  oddsOutput.classList.remove("positive", "negative", "even");
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
  if (n !== null) {
    if (n > 0) oddsOutput.classList.add("positive");
    else if (n < 0) oddsOutput.classList.add("negative");
    else oddsOutput.classList.add("even");
  }
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
  if (queryEcho) queryEcho.textContent = normalizePrompt(prompt);
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
  watoContent?.classList.add("has-result");
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
  watoContent?.classList.add("has-result");
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
  watoContent?.classList.add("has-result");
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
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("copied");
    }, 1300);
  } catch (_error) {
    statusLine.textContent = "Copy failed. You can still screenshot this result.";
  }
}

async function createShareBlob() {
  const shareData = getCurrentShareData();
  const canvas = await generateShareCard(shareData);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not build image."));
      },
      "image/jpeg",
      0.95
    );
  });
}

async function shareCurrentResult() {
  if (resultCard.classList.contains("hidden")) return;

  const oldText = shareBtn.textContent;
  shareBtn.disabled = true;
  shareBtn.textContent = "Preparing...";
  try {
    const blob = await createShareBlob();
    const oddsSlug = String(oddsOutput.textContent || "")
      .trim()
      .toLowerCase()
      .replace(/\+/g, "plus")
      .replace(/-/g, "minus")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const filename = `odds-gods-${oddsSlug || "estimate"}.jpg`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const query = normalizeSummaryText(queryEcho?.textContent || scenarioInput.value || "");
    const tweetText =
      `Odds Gods says ${String(oddsOutput.textContent || "").trim()} — ${query}.\n\n` +
      `Somebody tell me I'm wrong.\n\noddsgods.com/odds`;
    setTimeout(() => {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`,
        "_blank",
        "noopener,noreferrer"
      );
    }, 400);
    statusLine.textContent = "Share image downloaded.";
  } catch (_error) {
    statusLine.textContent = "Could not generate share image right now.";
  } finally {
    shareBtn.disabled = false;
    shareBtn.textContent = oldText;
  }
}

function hashQuery(text) {
  let hash = 0;
  const input = String(text || "");
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash + input.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return hash || 1;
}

function seededRng(seed) {
  let s = Math.max(1, Number(seed) || 1);
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function addCanvasGrain(ctx, w, h, opacity = 0.03) {
  const gc = document.createElement("canvas");
  gc.width = w;
  gc.height = h;
  const gx = gc.getContext("2d");
  const img = gx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * opacity * 255;
  }
  gx.putImageData(img, 0, 0);
  ctx.drawImage(gc, 0, 0);
}

function getCurrentShareData() {
  const query = normalizeSummaryText(queryEcho?.textContent || scenarioInput.value || "");
  const oddsStr = String(oddsOutput.textContent || "").trim();
  const impliedStr = String(probabilityOutput.textContent || "").trim();
  const entityLabel = normalizeSummaryText(promptSummary.textContent || query || "");
  const primaryCluster = document.querySelector("#entity-strip img.entity-avatar");
  const primaryHeadshot =
    (primaryCluster && primaryCluster.getAttribute("src")) ||
    playerHeadshot?.getAttribute("src") ||
    null;
  return { query, oddsStr, impliedStr, entityLabel, playerHeadshotUrl: primaryHeadshot };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawBolt(ctx, pts, color, lineWidth) {
  if (!pts || pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
}

function genBolt(bRng, x1, y1, x2, y2, disp, depth) {
  if (depth === 0) return [[x1, y1], [x2, y2]];
  const mx = (x1 + x2) / 2 + (bRng() - 0.5) * disp;
  const my = (y1 + y2) / 2 + (bRng() - 0.5) * disp;
  const left = genBolt(bRng, x1, y1, mx, my, disp * 0.55, depth - 1);
  const right = genBolt(bRng, mx, my, x2, y2, disp * 0.55, depth - 1);
  return [...left, ...right.slice(1)];
}

async function generateShareCard({ query, oddsStr, impliedStr, entityLabel, playerHeadshotUrl }) {
  const SIZE = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const normalizedQuery = normalizeSummaryText(query || "What Are the Odds?");
  const queryHash = hashQuery(normalizedQuery);
  const rng = seededRng(queryHash * 31337);
  const boltRng = seededRng(queryHash * 99991);

  let logoImg = null;
  let playerImg = null;
  try {
    logoImg = await loadImage("/logo-icon.png");
  } catch (_error) {
    logoImg = null;
  }
  if (playerHeadshotUrl) {
    try {
      playerImg = await loadImage(playerHeadshotUrl);
    } catch (_error) {
      playerImg = null;
    }
  }

  // Rounded-corner clip region.
  ctx.fillStyle = "#090805";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.save();
  roundRectPath(ctx, 8, 8, SIZE - 16, SIZE - 16, 38);
  ctx.clip();

  // Layer 1.
  ctx.fillStyle = "#0e0c09";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Layer 2.
  const g1 = ctx.createRadialGradient(600, 1340, 0, 600, 1340, 820);
  g1.addColorStop(0, "rgba(139,90,18,0.58)");
  g1.addColorStop(0.5, "rgba(139,90,18,0.20)");
  g1.addColorStop(1, "rgba(139,90,18,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const g2 = ctx.createRadialGradient(1120, 60, 0, 1120, 60, 440);
  g2.addColorStop(0, "rgba(110,70,12,0.34)");
  g2.addColorStop(1, "rgba(110,70,12,0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Layer 3.
  const FRAGS = [
    "-110", "+3300", "-450", "+220", "EVEN", "-175", "+550", "-3040", "+1400", "-800", "+290", "+6500",
    "+105", "-190", "+380", "+4500", "XIV", "XLVIII", "IX", "MMXXV", "XCIX", "IV", "LXIII", "LVII", "VII",
    "XVI", "XLII", "XXXII", "Σ", "Δ", "μ", "σ", "π", "Ω", "β", "λ", "φ", "ALEA IACTA EST", "SORS",
    "PROBABILITAS", "FATA", "RATIO", "EVENTUS", "CALCULUS", "VINCULUM", "45.3 WIN%", "61.2%", "28.6% IMP",
    "73.4%", "19.2% IMP", "88.1%", "33.3%", "4,832 YDS", "38 TD", "QBR 84.2", "DVOA +24.8", "EPA/P 0.24",
    "CPOE +4.1", "ELO 1842", "KC -450", "PHI -3.5", "BAL -6.5", "SF ML -175",
  ];
  const SERIF_FRAGS = new Set([
    "ALEA IACTA EST", "SORS", "PROBABILITAS", "FATA", "RATIO", "EVENTUS", "CALCULUS", "VINCULUM",
    "XIV", "VII", "IX", "MMXXV", "XLVIII", "XCIX", "LVII", "LXIII", "XVI", "IV", "XLII", "XXXII",
  ]);
  const placed = [];
  let count = 0;
  while (count < 108) {
    const txt = FRAGS[Math.floor(rng() * FRAGS.length)];
    const serif = SERIF_FRAGS.has(txt) || /[ΣΔμσπΩβλφ]/.test(txt);
    const size = serif ? 18 + Math.floor(rng() * 14) : 14 + Math.floor(rng() * 12);
    ctx.font = serif ? `400 ${size}px "Instrument Serif",serif` : `400 ${size}px "Space Grotesk",monospace`;
    const tw = ctx.measureText(txt).width;
    const th = size * 1.3;
    const x = rng() * (SIZE - tw - 20) + 10;
    const y = rng() * (SIZE - th - 20) + 10;
    const r0 = [x - 6, y - 4, x + tw + 6, y + th + 4];
    if (!placed.some((o) => r0[0] < o[2] && r0[2] > o[0] && r0[1] < o[3] && r0[3] > o[1])) {
      ctx.globalAlpha = 0.018 + rng() * 0.02;
      ctx.fillStyle = "#f0e6d0";
      ctx.textAlign = "left";
      ctx.fillText(txt, x, y + th * 0.8);
      placed.push(r0);
      count += 1;
    }
  }
  ctx.globalAlpha = 1;

  // Layer 4.
  const bolt = genBolt(boltRng, 984, 24, 660, 648, 65, 5);
  const mid = bolt[Math.floor(bolt.length * 0.35)];
  const branch = genBolt(boltRng, mid[0], mid[1], mid[0] + 90 + boltRng() * 60, mid[1] + 70 + boltRng() * 50, 30, 3);
  drawBolt(ctx, bolt, "rgba(184,125,24,0.020)", 20);
  drawBolt(ctx, bolt, "rgba(184,125,24,0.036)", 12);
  drawBolt(ctx, bolt, "rgba(184,125,24,0.055)", 6);
  drawBolt(ctx, bolt, "rgba(184,125,24,0.044)", 3);
  drawBolt(ctx, bolt, "rgba(240,230,208,0.070)", 1);
  drawBolt(ctx, branch, "rgba(184,125,24,0.026)", 5);
  drawBolt(ctx, branch, "rgba(184,125,24,0.040)", 2);

  // Layer 5.
  ctx.strokeStyle = "rgba(184,125,24,0.20)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);
  [[56, 56, 1, 1], [1144, 56, -1, 1], [56, 1144, 1, -1], [1144, 1144, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.strokeStyle = "rgba(184,125,24,0.68)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * 60, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + dy * 60);
    ctx.stroke();
    ctx.fillStyle = "rgba(184,125,24,0.52)";
    ctx.beginPath();
    ctx.arc(x + dx * 6, y + dy * 6, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Layer 6.
  if (logoImg) ctx.drawImage(logoImg, 56, 50, 48, 48);
  ctx.font = '700 24px "Space Grotesk",monospace';
  ctx.fillStyle = "rgba(240,230,208,0.80)";
  ctx.textAlign = "left";
  ctx.fillText("ODDS GODS", 116, 83);

  // Layer 7.
  ctx.font = '400 19px "Space Grotesk",monospace';
  ctx.fillStyle = "rgba(240,230,208,0.36)";
  ctx.textAlign = "center";
  ctx.fillText("WHAT ARE THE ODDS THAT...", 600, 226);

  // Layer 8.
  const qSize = normalizedQuery.length < 48 ? 46 : normalizedQuery.length < 70 ? 38 : 32;
  ctx.font = `italic 400 ${qSize}px "Instrument Serif",serif`;
  ctx.fillStyle = "rgba(240,230,208,0.90)";
  ctx.textAlign = "center";
  const qLines = wrapText(ctx, normalizedQuery, 980);
  const qLineH = qSize * 1.38;
  let qY = 274;
  qLines.forEach((line) => {
    ctx.fillText(line, 600, qY);
    qY += qLineH;
  });
  const qBottom = qY;

  // Layer 9.
  const ruleY = qBottom + 22;
  ctx.strokeStyle = "rgba(184,125,24,0.40)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(300, ruleY);
  ctx.lineTo(900, ruleY);
  ctx.stroke();

  // Layer 10.
  const HS_R = 84;
  const HS_CX = 600;
  const HS_CY = ruleY + 36 + HS_R;
  if (playerImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(HS_CX, HS_CY, HS_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(playerImg, HS_CX - HS_R, HS_CY - HS_R, HS_R * 2, HS_R * 2);
    ctx.restore();
    ctx.strokeStyle = "rgba(184,125,24,0.50)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(HS_CX, HS_CY, HS_R + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(184,125,24,0.14)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(HS_CX, HS_CY, HS_R + 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  const headshotBottom = playerImg ? HS_CY + HS_R + 8 : ruleY + 20;

  // Layer 11.
  const ODDS_SIZE = 200;
  ctx.font = `400 ${ODDS_SIZE}px "Space Grotesk",monospace`;
  ctx.textAlign = "center";
  const value = String(oddsStr || "").trim().toUpperCase();
  const isPos = value.startsWith("+");
  const isEven = value === "EVEN";
  ctx.fillStyle = isPos
    ? "rgba(74,222,128,0.96)"
    : isEven
      ? "rgba(184,125,24,0.96)"
      : "rgba(248,113,113,0.96)";
  ctx.shadowColor = "rgba(0,0,0,0.60)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  const oddsY = headshotBottom + 24;
  ctx.fillText(value || "N/A", 600, oddsY + ODDS_SIZE * 0.8);
  ctx.shadowColor = "transparent";
  const oddsBottom = oddsY + ODDS_SIZE * 0.92;

  // Layer 12.
  const chipText = String(entityLabel || "").trim() || "Hypothetical NFL estimate";
  const chipY = oddsBottom + 16;
  ctx.font = '600 26px "Space Grotesk",monospace';
  const chipTW = ctx.measureText(chipText).width;
  const chipW = Math.min(1020, chipTW + 48);
  const chipH = 56;
  const chipX = 600 - chipW / 2;
  ctx.fillStyle = "rgba(26,21,13,0.92)";
  roundRectPath(ctx, chipX, chipY, chipW, chipH, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(184,125,24,0.30)";
  ctx.lineWidth = 1;
  roundRectPath(ctx, chipX, chipY, chipW, chipH, 5);
  ctx.stroke();
  ctx.fillStyle = "rgba(240,230,208,0.78)";
  const chipLines = wrapText(ctx, chipText, chipW - 36).slice(0, 2);
  const chipCenterY = chipY + chipH / 2 + (chipLines.length === 2 ? -7 : 0);
  chipLines.forEach((line, idx) => {
    ctx.fillText(line, 600, chipCenterY + idx * 26);
  });
  const chipBottom = chipY + chipH;

  // Layer 13.
  const implLabelY = chipBottom + 30;
  ctx.font = '400 19px "Space Grotesk",monospace';
  ctx.fillStyle = "rgba(240,230,208,0.36)";
  ctx.fillText("IMPLIED PROBABILITY", 600, implLabelY);
  ctx.font = '700 54px "Space Grotesk",monospace';
  ctx.fillStyle = "rgba(240,230,208,0.84)";
  ctx.fillText(String(impliedStr || "").trim() || "N/A", 600, implLabelY + 62);

  // Layer 14.
  const barY = 1108;
  ctx.strokeStyle = "rgba(184,125,24,0.26)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(56, barY);
  ctx.lineTo(1144, barY);
  ctx.stroke();
  if (logoImg) ctx.drawImage(logoImg, 56, barY + 12, 30, 30);
  ctx.font = '700 26px "Space Grotesk",monospace';
  ctx.fillStyle = "rgba(184,125,24,0.82)";
  ctx.textAlign = "left";
  ctx.fillText("oddsgods.com", 98, barY + 33);
  ctx.font = '400 17px "Space Grotesk",monospace';
  ctx.fillStyle = "rgba(240,230,208,0.22)";
  ctx.textAlign = "right";
  ctx.fillText("Hypothetical estimate · Not betting advice", 1144, barY + 33);

  // Layer 15.
  addCanvasGrain(ctx, SIZE, SIZE, 0.03);
  ctx.restore();
  return canvas;
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

function startBackgroundLayers() {
  const canvases = [
    document.getElementById("bg-stats"),
    document.getElementById("bg-lightning"),
    document.getElementById("bg-text"),
  ].filter(Boolean);
  if (!canvases.length) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const contexts = canvases.map((canvas) => canvas.getContext("2d"));
  let frame = 0;

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvases.forEach((canvas) => {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    });
    contexts.forEach((ctx) => ctx?.setTransform(dpr, 0, 0, dpr, 0, 0));
  };

  const draw = () => {
    frame += 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = frame * 0.01;
    const [statsCtx, boltCtx, textCtx] = contexts;

    if (statsCtx) {
      statsCtx.clearRect(0, 0, w, h);
      statsCtx.strokeStyle = "rgba(220,170,90,0.05)";
      statsCtx.lineWidth = 1;
      for (let i = 0; i < 14; i += 1) {
        const y = (i + 1) * (h / 15);
        statsCtx.beginPath();
        statsCtx.moveTo(0, y + Math.sin(t + i) * 6);
        statsCtx.lineTo(w, y + Math.cos(t + i * 0.8) * 6);
        statsCtx.stroke();
      }
    }

    if (boltCtx) {
      boltCtx.clearRect(0, 0, w, h);
      boltCtx.strokeStyle = "rgba(232,185,105,0.08)";
      boltCtx.lineWidth = 1.3;
      boltCtx.beginPath();
      const x = w * 0.77;
      boltCtx.moveTo(x, h * 0.05);
      boltCtx.lineTo(x - 34, h * 0.24);
      boltCtx.lineTo(x + 16, h * 0.24);
      boltCtx.lineTo(x - 30, h * 0.46);
      boltCtx.stroke();
    }

    if (textCtx) {
      textCtx.clearRect(0, 0, w, h);
      textCtx.fillStyle = "rgba(210,197,168,0.06)";
      textCtx.font = "12px Space Grotesk";
      const words = ["XIII", "YPA", "DVOA", "EPA", "SB", "MVP", "W-L", "ANY/A", "QBR"];
      for (let i = 0; i < 24; i += 1) {
        const text = words[i % words.length];
        const px = (i * 173 + (frame % 700)) % (w + 180) - 120;
        const py = 40 + ((i * 89) % (h - 80));
        textCtx.fillText(text, px, py);
      }
    }

    window.requestAnimationFrame(draw);
  };

  resize();
  draw();
  window.addEventListener("resize", resize);
}

form.addEventListener("submit", onSubmit);
copyBtn.addEventListener("click", copyCurrentResult);
if (shareBtn) {
  shareBtn.addEventListener("click", shareCurrentResult);
}
if (flipBtn) {
  flipBtn.addEventListener("click", (event) => {
    event.preventDefault();
    flipPrompt();
  });
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
scenarioInput.addEventListener("input", updateFlipVisibility);
const hasSharedPrompt = hydrateFromUrl();
setupExampleChips();
checkVersionHandshake();
hydrateLiveSuggestions();
startBackgroundLayers();
updateFlipVisibility();

if (hasSharedPrompt) {
  form.requestSubmit();
}
