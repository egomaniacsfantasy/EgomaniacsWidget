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
const PLACEHOLDER_ROTATE_MS = 3200;
const EXAMPLE_REFRESH_MS = 12000;
const CLIENT_API_VERSION = "2026.02.23.1";

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
  playerHeadshot.removeAttribute("src");
  playerHeadshot.alt = "";
  playerHeadshot.classList.add("hidden");
  playerHeadshotSecondary.removeAttribute("src");
  playerHeadshotSecondary.alt = "";
  playerHeadshotSecondary.classList.add("hidden");
  playerHeadshotCluster.classList.add("hidden");
}

function clearFreshness() {
  freshnessLine.textContent = "";
  freshnessLine.classList.add("hidden");
}

function clearSourceLine() {
  sourceLine.textContent = "";
  sourceLine.classList.add("hidden");
}

function parseAmericanOdds(oddsText) {
  const text = String(oddsText || "").trim();
  if (!text || text.toUpperCase() === "NO CHANCE") return null;
  const n = Number(text.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

function renderOddsDisplay(oddsText) {
  const n = parseAmericanOdds(oddsText);
  if (n !== null && n <= -10000) {
    oddsOutput.classList.add("lock-mode");
    oddsOutput.innerHTML = `IT'S A LOCK!<span class="odds-subline">(WELL, BASICALLY.)</span>`;
    return;
  }
  if (n !== null && n >= 10000) {
    oddsOutput.classList.add("lock-mode");
    oddsOutput.innerHTML = `NO SHOT.<span class="odds-subline">(LIKE, REALLY NO SHOT.)</span>`;
    return;
  }
  oddsOutput.classList.remove("lock-mode");
  oddsOutput.textContent = oddsText;
}

function formatOddsForShare(oddsText) {
  const n = parseAmericanOdds(oddsText);
  if (n !== null && n <= -10000) return "IT'S A LOCK!";
  if (n !== null && n >= 10000) return "NO SHOT.";
  return String(oddsText || "");
}

function syncShareCard(result, prompt) {
  shareOddsOutput.textContent = formatOddsForShare(result.odds);
  shareSummaryOutput.textContent = result.summaryLabel || prompt;
  shareProbabilityOutput.textContent = result.impliedProbability || "";

  if (result.sourceType === "sportsbook" && result.sourceBook) {
    shareSourceOutput.textContent = `${result.sourceBook} reference`;
  } else if (result.liveChecked) {
    shareSourceOutput.textContent = "Live context checked";
  } else {
    shareSourceOutput.textContent = "Hypothetical model";
  }
}

function showResult(result, prompt) {
  refusalCard.classList.add("hidden");
  resultCard.classList.remove("hidden");
  resultCard.classList.remove("result-pop");
  void resultCard.offsetWidth;
  resultCard.classList.add("result-pop");

  renderOddsDisplay(result.odds);
  probabilityOutput.textContent = result.impliedProbability;
  promptSummary.textContent = result.summaryLabel || prompt;
  resultTypeLabel.textContent = result.sourceType === "sportsbook" ? "Market Reference" : "Estimated Odds";
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

  if (result.headshotUrl) {
    playerHeadshot.src = result.headshotUrl;
    playerHeadshot.alt = result.playerName || result.summaryLabel || "Sports entity";
    playerHeadshot.classList.remove("hidden");
    playerHeadshotCluster.classList.remove("hidden");
    const hasSecondary = Boolean(
      result.secondaryHeadshotUrl &&
      result.secondaryHeadshotUrl !== result.headshotUrl
    );
    if (hasSecondary) {
      playerHeadshotSecondary.src = result.secondaryHeadshotUrl;
      playerHeadshotSecondary.alt = result.secondaryPlayerName || "Second sports figure";
      playerHeadshotSecondary.classList.remove("hidden");
    } else {
      playerHeadshotSecondary.removeAttribute("src");
      playerHeadshotSecondary.alt = "";
      playerHeadshotSecondary.classList.add("hidden");
    }
  } else {
    clearHeadshot();
  }

  syncShareCard(result, prompt);
}

function showRefusal(message, options = {}) {
  resultCard.classList.add("hidden");
  refusalCard.classList.remove("hidden");
  resultTypeLabel.textContent = "Estimated Odds";
  clearHeadshot();
  clearSourceLine();
  clearFreshness();
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
