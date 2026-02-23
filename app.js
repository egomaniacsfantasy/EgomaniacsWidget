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
const entityStrip = document.getElementById("entity-strip");
const headshotProfilePop = document.getElementById("headshot-profile-pop");
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
const CLIENT_API_VERSION = "2026.02.23.7";
const FEEDBACK_COUNT_KEY = "ewa_feedback_estimate_count";
const FEEDBACK_LAST_SHOWN_KEY = "ewa_feedback_last_shown_ts";
const FEEDBACK_RATED_MAP_KEY = "ewa_feedback_rated_map";
const FEEDBACK_SESSION_ID_KEY = "ewa_feedback_session_id";
const FEEDBACK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FEEDBACK_ASK_EVERY_N = 3;

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
  if (!feedbackPop || !result || result.status !== "ok") return;
  const count = getStoredNumber(FEEDBACK_COUNT_KEY, 0) + 1;
  setStoredValue(FEEDBACK_COUNT_KEY, count);

  const key = buildFeedbackKey(prompt, result);
  const rated = getFeedbackRatedMap();
  if (rated[key]) return;

  const lastShown = getStoredNumber(FEEDBACK_LAST_SHOWN_KEY, 0);
  const now = Date.now();
  if (count < 2) return;
  if (count % FEEDBACK_ASK_EVERY_N !== 0) return;
  if (now - lastShown < FEEDBACK_MIN_INTERVAL_MS) return;

  feedbackContext = {
    prompt,
    result: {
      status: result.status,
      odds: result.odds,
      impliedProbability: result.impliedProbability,
      summaryLabel: result.summaryLabel,
      sourceType: result.sourceType,
      sourceLabel: result.sourceLabel,
      asOfDate: result.asOfDate,
    },
    key,
  };
  feedbackQuestion.textContent = "Was this estimate helpful?";
  feedbackThanks.classList.add("hidden");
  feedbackPop.classList.remove("feedback-closing", "feedback-thanked");
  feedbackPop.classList.remove("hidden");
  setStoredValue(FEEDBACK_LAST_SHOWN_KEY, now);
}

async function submitFeedback(vote) {
  if (!feedbackContext || !["up", "down"].includes(vote)) return;
  feedbackUpBtn?.setAttribute("disabled", "true");
  feedbackDownBtn?.setAttribute("disabled", "true");
  const body = {
    vote,
    prompt: feedbackContext.prompt,
    result: feedbackContext.result,
    clientVersion: CLIENT_API_VERSION,
    sessionId: getOrCreateSessionId(),
  };
  try {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_error) {
    // We still thank the user to avoid friction.
  }

  const rated = getFeedbackRatedMap();
  rated[feedbackContext.key] = vote;
  setFeedbackRatedMap(rated);
  feedbackPop.classList.add("feedback-thanked");
  feedbackThanks.classList.remove("hidden");
  feedbackQuestion.textContent = "Feedback received.";
  statusLine.textContent = "Thanks for your feedback.";
  setTimeout(() => {
    closeFeedbackPopAnimated();
  }, 800);
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
  const bits = [];
  if (info.team) bits.push(info.team);
  if (info.position) bits.push(info.position);
  if (Number.isFinite(Number(info.age)) && Number(info.age) > 0) bits.push(`Age ${Number(info.age)}`);
  if (Number.isFinite(Number(info.yearsExp)) && Number(info.yearsExp) >= 0) bits.push(`${Number(info.yearsExp)} yrs exp`);
  if (info.status) bits.push(String(info.status).toUpperCase());
  return bits.join(" • ");
}

function hideHeadshotProfile() {
  if (!headshotProfilePop) return;
  headshotProfilePop.classList.add("hidden");
}

function showHeadshotProfile(info, anchor = "primary") {
  if (!headshotProfilePop || !headshotProfileName || !headshotProfileMeta) return;
  if (!info || !info.name) return;
  headshotProfileName.textContent = info.name;
  headshotProfileMeta.textContent = formatPlayerMeta(info);
  if (anchor === "secondary") {
    headshotProfilePop.style.left = "auto";
    headshotProfilePop.style.right = "0";
  } else {
    headshotProfilePop.style.right = "auto";
    headshotProfilePop.style.left = "0";
  }
  headshotProfilePop.classList.remove("hidden");
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
  assets.slice(0, 12).forEach((asset, idx, arr) => {
    if (!asset?.imageUrl) return;
    const img = document.createElement("img");
    img.className = "entity-avatar";
    img.src = asset.imageUrl;
    img.alt = asset.name || asset.kind || "Entity";
    img.loading = "lazy";
    const info = asset.info && typeof asset.info === "object" ? asset.info : { name: asset.name || "Entity" };
    img.addEventListener("click", () => {
      const anchor = idx >= Math.floor(arr.length / 2) ? "secondary" : "primary";
      showHeadshotProfile(info, anchor);
    });
    entityStrip.appendChild(img);
  });

  if (!entityStrip.children.length) {
    entityStrip.classList.add("hidden");
    return false;
  }
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
  shareSummaryOutput.textContent = getDisplaySummaryLabel(result.summaryLabel, prompt);
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

function getDisplaySummaryLabel(summaryLabel, prompt) {
  const label = normalizeSummaryText(summaryLabel);
  if (!label) return normalizeSummaryText(prompt);
  if (isAwkwardSummaryEnding(label)) return normalizeSummaryText(prompt);
  return label;
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
  promptSummary.textContent = getDisplaySummaryLabel(result.summaryLabel, prompt);
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
    playerHeadshotCluster.classList.add("hidden");
  } else if (result.headshotUrl) {
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
      },
      body: JSON.stringify({ prompt }),
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
    const merged = uniqByNormalized([...(prompts || []).filter(isNflPrompt), ...DEFAULT_EXAMPLE_POOL]).filter(isNflPrompt);
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
playerHeadshotSecondary.addEventListener("click", () => {
  if (!secondaryPlayerInfo?.name) return;
  const isHidden = headshotProfilePop?.classList.contains("hidden");
  if (!isHidden && headshotProfileName?.textContent === secondaryPlayerInfo.name) {
    hideHeadshotProfile();
    return;
  }
  showHeadshotProfile(secondaryPlayerInfo, "secondary");
});
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (
    headshotProfilePop?.contains(target) ||
    playerHeadshot.contains(target) ||
    playerHeadshotSecondary.contains(target)
  ) {
    return;
  }
  hideHeadshotProfile();
});
if (feedbackUpBtn) {
  feedbackUpBtn.addEventListener("click", () => submitFeedback("up"));
}
if (feedbackDownBtn) {
  feedbackDownBtn.addEventListener("click", () => submitFeedback("down"));
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
