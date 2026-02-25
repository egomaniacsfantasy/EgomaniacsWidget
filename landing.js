const nav = document.getElementById("site-nav");
const menuBtn = document.getElementById("menu-btn");
const navLinks = document.getElementById("nav-links");

const heroHoustonOdds = document.getElementById("hero-houston-odds");
const heroLongwoodOdds = document.getElementById("hero-longwood-odds");
const heroBracketNote = document.getElementById("hero-bracket-note");
const heroTyped = document.getElementById("hero-typed");
const heroOddsResult = document.getElementById("hero-odds-result");
const heroImpliedResult = document.getElementById("hero-implied-result");

const bracketButtons = Array.from(document.querySelectorAll(".team-chip"));
const chipHouston = document.getElementById("chip-houston");
const chipLongwood = document.getElementById("chip-longwood");
const futuresKansas = document.getElementById("futures-kansas");
const futuresHouston = document.getElementById("futures-houston");
const futuresDuke = document.getElementById("futures-duke");
const futuresTennessee = document.getElementById("futures-tennessee");

const miniOddsForm = document.getElementById("mini-odds-form");
const miniInput = document.getElementById("mini-odds-input");
const miniSubmit = document.getElementById("mini-submit");
const miniStatus = document.getElementById("mini-status");
const miniLine = document.getElementById("mini-line");
const miniReason = document.getElementById("mini-reason");

const heroPromptExamples = [
  {
    prompt: "Bills win the Super Bowl before the Chiefs do",
    odds: "+420",
    implied: "19.2% implied",
  },
  {
    prompt: "Patrick Mahomes wins 5 MVPs",
    odds: "+330",
    implied: "23.3% implied",
  },
  {
    prompt: "Eagles make three straight Super Bowls",
    odds: "+780",
    implied: "11.4% implied",
  },
  {
    prompt: "A running back wins the Heisman before 2030",
    odds: "+250",
    implied: "28.6% implied",
  },
];

const miniPlaceholders = [
  "Lamar Jackson wins back-to-back MVPs",
  "A team goes 19-0 before 2030",
  "Bills win the Super Bowl before the Chiefs do",
  "A kicker wins Super Bowl MVP",
];

const heroBracketFrames = [
  {
    houstonOdds: "-3040",
    longwoodOdds: "+3040",
    note: "South region · repricing around one lock",
  },
  {
    houstonOdds: "-3150",
    longwoodOdds: "+3150",
    note: "Model pass · futures pressure shifts",
  },
  {
    houstonOdds: "-2990",
    longwoodOdds: "+2990",
    note: "Bracket weight settles after rerun",
  },
];

let apiVersion = "2026.02.23.12";
let heroPromptIndex = 0;
let heroFrameIndex = 0;
let placeholderIndex = 0;

function setScrolledNav() {
  if (!nav) return;
  nav.classList.toggle("is-scrolled", window.scrollY > 24);
}

function setupMobileNav() {
  if (!menuBtn || !navLinks) return;
  menuBtn.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
  });

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    });
  });
}

function revealOnScroll() {
  const sections = document.querySelectorAll(".section-reveal");
  if (!sections.length || !("IntersectionObserver" in window)) {
    sections.forEach((el) => el.classList.add("in-view"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in-view");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.15 }
  );

  sections.forEach((el) => observer.observe(el));
}

function animateHeroBracket() {
  if (!heroHoustonOdds || !heroLongwoodOdds || !heroBracketNote) return;
  window.setInterval(() => {
    heroFrameIndex = (heroFrameIndex + 1) % heroBracketFrames.length;
    const frame = heroBracketFrames[heroFrameIndex];
    heroHoustonOdds.textContent = frame.houstonOdds;
    heroLongwoodOdds.textContent = frame.longwoodOdds;
    heroBracketNote.textContent = frame.note;
  }, 3400);
}

function typeText(el, text, speed = 30) {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      el.textContent = text.slice(0, i);
      i += 1;
      if (i <= text.length) {
        window.setTimeout(tick, speed);
      } else {
        resolve();
      }
    };
    tick();
  });
}

async function animateHeroPrompt() {
  if (!heroTyped || !heroOddsResult || !heroImpliedResult) return;

  while (true) {
    const frame = heroPromptExamples[heroPromptIndex];
    heroTyped.textContent = "";
    await typeText(heroTyped, frame.prompt, 24);
    heroOddsResult.textContent = frame.odds;
    heroImpliedResult.textContent = frame.implied;
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    heroTyped.textContent = "";
    heroPromptIndex = (heroPromptIndex + 1) % heroPromptExamples.length;
  }
}

function setupBracketInline() {
  if (!bracketButtons.length) return;

  const neutral = {
    houstonOdds: "-3330",
    longwoodOdds: "+3330",
    kansas: "14.2%",
    houston: "11.8%",
    duke: "9.7%",
    tennessee: "7.0%",
  };
  const outcomes = {
    houston: {
      houstonOdds: "-6400",
      longwoodOdds: "+6400",
      kansas: "13.1%",
      houston: "17.2%",
      duke: "9.1%",
      tennessee: "6.8%",
      deltas: { kansas: -1.1, houston: 5.4, duke: -0.6, tennessee: -0.2 },
    },
    longwood: {
      houstonOdds: "+2500",
      longwoodOdds: "-2500",
      kansas: "18.3%",
      houston: "3.4%",
      duke: "11.5%",
      tennessee: "8.2%",
      deltas: { kansas: 4.1, houston: -8.4, duke: 1.8, tennessee: 1.2 },
    },
  };

  function applyState(state, deltas) {
    chipHouston.textContent = state.houstonOdds;
    chipLongwood.textContent = state.longwoodOdds;
    futuresKansas.textContent = state.kansas;
    futuresHouston.textContent = state.houston;
    futuresDuke.textContent = state.duke;
    futuresTennessee.textContent = state.tennessee;

    [futuresKansas, futuresHouston, futuresDuke, futuresTennessee].forEach((el) => {
      el.classList.remove("is-up", "is-down");
    });

    if (deltas) {
      const map = [
        [futuresKansas, deltas.kansas],
        [futuresHouston, deltas.houston],
        [futuresDuke, deltas.duke],
        [futuresTennessee, deltas.tennessee],
      ];
      map.forEach(([el, v]) => {
        if (v > 0) el.classList.add("is-up");
        if (v < 0) el.classList.add("is-down");
      });
    }
  }

  applyState(neutral);

  bracketButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const team = btn.dataset.team;
      const alreadyActive = btn.classList.contains("active");
      bracketButtons.forEach((b) => b.classList.remove("active"));

      if (alreadyActive || !team || !outcomes[team]) {
        applyState(neutral);
        return;
      }

      btn.classList.add("active");
      const state = outcomes[team];
      applyState(state, state.deltas);
    });
  });
}

function setRotatingPlaceholder() {
  if (!miniInput) return;
  window.setInterval(() => {
    if (document.activeElement === miniInput) return;
    placeholderIndex = (placeholderIndex + 1) % miniPlaceholders.length;
    miniInput.placeholder = miniPlaceholders[placeholderIndex];
  }, 3000);
}

async function loadApiVersion() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return;
    const payload = await response.json();
    if (payload && typeof payload.apiVersion === "string" && payload.apiVersion.trim()) {
      apiVersion = payload.apiVersion.trim();
    }
  } catch (_error) {
    // Keep default fallback.
  }
}

async function fetchMiniOdds(prompt) {
  const response = await fetch("/api/odds", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ewa-client-version": apiVersion,
    },
    body: JSON.stringify({ prompt }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error || payload?.message || "Unable to estimate right now.";
    throw new Error(message);
  }

  return payload;
}

function setupMiniOddsForm() {
  if (!miniOddsForm || !miniInput || !miniSubmit || !miniStatus || !miniLine || !miniReason) return;

  miniOddsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = String(miniInput.value || "").trim();
    if (!prompt) {
      miniStatus.textContent = "Enter an NFL scenario.";
      miniLine.textContent = "";
      miniReason.textContent = "";
      return;
    }

    miniSubmit.setAttribute("disabled", "disabled");
    miniStatus.textContent = "Estimating...";
    miniLine.textContent = "";
    miniReason.textContent = "";

    try {
      const payload = await fetchMiniOdds(prompt);
      if (payload.status === "ok") {
        miniStatus.textContent = "Estimated.";
        miniLine.textContent = `${payload.odds || "n/a"} | ${payload.impliedProbability || "n/a"} implied`;
        miniReason.textContent =
          Array.isArray(payload.assumptions) && payload.assumptions.length
            ? payload.assumptions[0]
            : payload.sourceLabel || "Model estimate returned.";
      } else {
        miniStatus.textContent = payload.title || "Unable to price this prompt.";
        miniLine.textContent = "";
        miniReason.textContent = payload.message || "Try a different NFL scenario.";
      }
    } catch (error) {
      miniStatus.textContent = "Estimator unavailable.";
      miniLine.textContent = "";
      miniReason.textContent = error?.message || "Try again in a moment.";
    } finally {
      miniSubmit.removeAttribute("disabled");
    }
  });
}

function setupLightningBackground() {
  const ambientCanvas = document.getElementById("lightning-ambient");
  const textCanvas = document.getElementById("lightning-text");
  const boltCanvas = document.getElementById("lightning-bolts");
  if (
    !(ambientCanvas instanceof HTMLCanvasElement) ||
    !(textCanvas instanceof HTMLCanvasElement) ||
    !(boltCanvas instanceof HTMLCanvasElement)
  ) {
    return;
  }

  const ambientCtx = ambientCanvas.getContext("2d");
  const textCtx = textCanvas.getContext("2d");
  const boltCtx = boltCanvas.getContext("2d");
  if (!ambientCtx || !textCtx || !boltCtx) return;

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = reducedMotionQuery.matches;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let noiseTime = 0;
  let lastTs = 0;
  let running = false;
  let ambientRafId = 0;
  let textRafId = 0;
  let boltRafId = 0;
  let boltTimeoutId = 0;
  let resizeTimeoutId = 0;
  const FIXED_SEED = 31337;

  let activeBolt = null;
  let fragments = [];
  let safeZones = [];
  let textNeedsRender = true;
  let illuminationActive = false;

  const categoryPools = {
    odds: [
      "-110", "+3300", "-450", "+220", "-175", "+550", "EVEN", "-3040", "+1400",
      "-800", "+290", "-115", "+6500", "-2200", "+380", "-330", "+4500", "-650",
      "+105", "-190", "+180", "-240", "+3300", "-1800",
    ],
    lines: [
      "NE ML -110", "KC -450", "BUF +220", "LAR O/U 48.5",
      "PHI -3.5", "SF ML -175", "DAL +7", "MIA O55.5",
      "HOU -3300", "DEN +14.5", "ATL ML +310", "LV O/U 42",
      "IND +6.5", "TEN ML -140", "GB -2.5 -115", "CLE +3 -108",
      "NYG +380", "BAL -6.5", "SEA +240", "MIN -1.5",
    ],
    implied: [
      "45.3 WIN%", "61.2%", "28.6% IMP", "73.4%", "19.2% IMP",
      "50.0%", "88.1%", "33.3%", "12.8% TITLE", "67.9%",
      "7.4% IMP", "94.2%", "22.4% IMP", "15.1%", "8.3% CHAMP",
    ],
    baseball: [
      ".344 AVG", "1.43 ERA", ".387 OBP", ".612 SLG", "142 wRC+",
      "3.21 FIP", "0.98 WHIP", "34.2 K%", ".301/.388/.534",
      "2.88 xFIP", "58.1 GB%", "11.4 K/9", "2.1 BB/9", "186 OPS+",
      ".278 BABIP", "4.8 WAR", ".412 wOBA", "96.2 EV", "47.3 LA",
    ],
    basketball: [
      "KP #4", "AdjEM 28.4", "AdjO 118.2", "AdjD 89.4", "BPI 94.3",
      "67.8 eFG%", "38.4 3P%", "NET #12", "SEED 1", "T-Rank 8",
      "Barttorvik 3", "ELO 1842", "SOS .614", "72.4 PPG", "58.2 OPP",
      "+14.2 NET", "31.8 PACE", "103.4 ORTG", "22-6 SU", "18-10 ATS",
      "BARTHAG .942", "WAB +4.2", "LUCK +0.038",
    ],
    football: [
      "4,832 YDS", "38 TD", "118.4 RTG", "71.2 CMP%", "8.4 Y/A",
      "QBR 84.2", "2,066 RYD", "6.3 YPC", "14.2 YPR", "DVOA +24.8",
      "EPA/P 0.24", "CPOE +4.1", "ANY/A 8.3", "3rd 48.2%",
      "RZ TD 84%", "SR 52.3%", "TPRK 4", "PROE +3.8", "WPA 4.22",
    ],
    roman: [
      "XIV", "XLVIII", "IX", "MMXXV", "XCIX", "IV", "LXIII",
      "LVII", "XXXII", "XVI", "XLII", "LI", "VII", "XCVIII",
      "MMXXIV", "LXVI", "XLIV", "LXXXVIII",
    ],
    greek: ["Σ", "Δ", "μ", "σ", "π", "Ω", "β", "λ", "φ", "θ"],
    latin: [
      "ALEA IACTA EST", "SORS", "EVENTUS", "PROBABILITAS", "CALCULUS", "FATA",
      "FORTES FORTUNA", "FATA VIAM INVENIENT", "SORS IMMANIS", "RATIO", "NUMERUS",
      "VINCULUM", "CASUS", "FORTUNA AUDACES IUVAT",
    ],
  };

  const categoryStyle = {
    greek: { font: "serif", min: 28, max: 36, base: 0.055, maxOpacity: 0.09 },
    odds: { font: "mono", min: 8, max: 15, base: 0.05, maxOpacity: 0.085 },
    roman: { font: "serif", min: 12, max: 34, base: 0.045, maxOpacity: 0.08 },
    implied: { font: "mono", min: 8, max: 13, base: 0.045, maxOpacity: 0.075 },
    lines: { font: "mono", min: 8, max: 12, base: 0.04, maxOpacity: 0.07 },
    baseball: { font: "mono", min: 8, max: 11, base: 0.038, maxOpacity: 0.068 },
    basketball: { font: "mono", min: 8, max: 11, base: 0.038, maxOpacity: 0.068 },
    football: { font: "mono", min: 8, max: 11, base: 0.038, maxOpacity: 0.068 },
    latin: { font: "serif", min: 7, max: 13, base: 0.035, maxOpacity: 0.06 },
  };

  function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function hash2d(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function smoothstep(v) {
    return v * v * (3 - 2 * v);
  }

  function valueNoise2d(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const xf = x - x0;
    const yf = y - y0;

    const v00 = hash2d(x0, y0);
    const v10 = hash2d(x0 + 1, y0);
    const v01 = hash2d(x0, y0 + 1);
    const v11 = hash2d(x0 + 1, y0 + 1);

    const u = smoothstep(xf);
    const v = smoothstep(yf);
    const xa = v00 * (1 - u) + v10 * u;
    const xb = v01 * (1 - u) + v11 * u;
    return xa * (1 - v) + xb * v;
  }

  function noise2d(x, y) {
    return valueNoise2d(x, y) * 2 - 1;
  }

  function resizeCanvases() {
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    width = window.innerWidth;
    height = window.innerHeight;

    [ambientCanvas, textCanvas, boltCanvas].forEach((canvas) => {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });

    ambientCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boltCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    safeZones = buildSafeZones();
    fragments = createFragments();
    textNeedsRender = true;
  }

  function clearBoltLayer() {
    boltCtx.clearRect(0, 0, width, height);
  }

  function clearTextLayer() {
    textCtx.clearRect(0, 0, width, height);
  }

  function buildSafeZones() {
    const selector = ".hero-copy-col, .tool-card, .hero-preview-card, nav, footer, h1, h2, h3, p, button, .btn, .inline-demo";
    const zones = [];
    document.querySelectorAll(selector).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      zones.push({
        x: r.left - 20,
        y: r.top - 12,
        w: r.width + 40,
        h: r.height + 24,
      });
    });
    zones.push({ x: 0, y: height * 0.2, w: width * 0.55, h: height * 0.6 });
    zones.push({ x: width * 0.55, y: height * 0.1, w: width * 0.43, h: height * 0.8 });
    return zones;
  }

  function overlapsAny(rect, occupied) {
    return occupied.some((o) => !(rect.x + rect.w < o.x || o.x + o.w < rect.x || rect.y + rect.h < o.y || o.y + o.h < rect.y));
  }

  function inSafeZone(rect) {
    return safeZones.some((zone) => overlapsAny(rect, [zone]));
  }

  function pickBucket(rand) {
    if (rand < 0.22) return "left";
    if (rand < 0.44) return "right";
    if (rand < 0.59) return "top";
    if (rand < 0.74) return "bottom";
    return "middle";
  }

  function pickPointInBucket(bucket, rng) {
    if (bucket === "left") return { x: width * (0 + rng() * 0.12), y: height * rng() };
    if (bucket === "right") return { x: width * (0.88 + rng() * 0.12), y: height * rng() };
    if (bucket === "top") return { x: width * rng(), y: height * (0 + rng() * 0.12) };
    if (bucket === "bottom") return { x: width * rng(), y: height * (0.88 + rng() * 0.12) };
    return { x: width * (0.12 + rng() * 0.76), y: height * (0.12 + rng() * 0.76) };
  }

  function measureFragmentRect(fragment) {
    const fontFamily =
      fragment.fontType === "mono"
        ? '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace'
        : '"Instrument Serif", Georgia, serif';
    textCtx.save();
    textCtx.font = `${fragment.size}px ${fontFamily}`;
    const m = textCtx.measureText(fragment.text);
    textCtx.restore();
    const widthPx = m.width + 5;
    const heightPx = fragment.size + 3;
    return {
      x: fragment.x - 2,
      y: fragment.y - heightPx + 2,
      w: widthPx + 5,
      h: heightPx + 3,
    };
  }

  function buildCategorySequence(count, rng) {
    const weighted = [
      "odds", "odds", "lines", "lines", "implied", "implied",
      "baseball", "basketball", "football", "roman", "greek", "latin",
    ];
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push(weighted[Math.floor(rng() * weighted.length)]);
    }
    return out;
  }

  function fragmentCountForViewport() {
    if (width < 768) return 30 + Math.floor(width % 11);
    if (width < 1200) return 55 + Math.floor(width % 16);
    return 80 + Math.floor(width % 21);
  }

  function createFragments() {
    const rng = seededRng(FIXED_SEED + width * 31 + height * 17);
    const count = fragmentCountForViewport();
    const sequence = buildCategorySequence(count, rng);
    const occupied = [];
    const out = [];

    let greekCount = 0;
    let romanLargeCount = 0;
    let latinPhraseCount = 0;

    for (let i = 0; i < sequence.length; i += 1) {
      const category = sequence[i];
      const style = categoryStyle[category];
      if (!style) continue;

      if (category === "greek" && greekCount >= 4) continue;
      if (category === "latin" && latinPhraseCount >= 5) continue;

      let placed = false;
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const bucket = pickBucket(rng());
        const point = pickPointInBucket(bucket, rng);
        const text = categoryPools[category][Math.floor(rng() * categoryPools[category].length)];
        const size = style.min + rng() * (style.max - style.min);
        const baseOpacity = Math.min(style.maxOpacity, style.base + rng() * 0.025);
        const rotation = -3 + rng() * 6;
        const fragment = {
          category,
          text,
          x: point.x,
          y: point.y,
          size,
          baseOpacity,
          currentOpacity: baseOpacity,
          maxOpacity: style.maxOpacity,
          fontType: style.font,
          rotation,
          litUntil: 0,
        };
        const rect = measureFragmentRect(fragment);
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height) continue;
        if (inSafeZone(rect) || overlapsAny(rect, occupied)) continue;

        occupied.push(rect);
        out.push(fragment);
        placed = true;
        if (category === "greek") greekCount += 1;
        if (category === "latin" && /\s/.test(text)) latinPhraseCount += 1;
        if (category === "roman" && size >= 28) romanLargeCount += 1;
        if (category === "roman" && romanLargeCount > 4) {
          out.pop();
          occupied.pop();
          romanLargeCount -= 1;
          placed = false;
          continue;
        }
        break;
      }
      if (!placed) continue;
    }

    return out;
  }

  function renderTextLayer() {
    clearTextLayer();
    if (!fragments.length) return;

    fragments.forEach((fragment) => {
      const fontFamily =
        fragment.fontType === "mono"
          ? '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace'
          : '"Instrument Serif", Georgia, serif';
      textCtx.save();
      textCtx.translate(fragment.x, fragment.y);
      textCtx.rotate((fragment.rotation * Math.PI) / 180);
      textCtx.globalAlpha = fragment.currentOpacity;
      textCtx.fillStyle = "#f0e6d0";
      textCtx.font = `${fragment.size}px ${fontFamily}`;
      textCtx.textBaseline = "alphabetic";

      if (fragment.fontType === "serif") {
        const chars = fragment.text.split("");
        let cursor = 0;
        const spacing = fragment.size * 0.18;
        for (let i = 0; i < chars.length; i += 1) {
          const ch = chars[i];
          textCtx.fillText(ch, cursor, 0);
          cursor += textCtx.measureText(ch).width + spacing;
        }
      } else {
        textCtx.fillText(fragment.text, 0, 0);
      }
      textCtx.restore();
    });
    textNeedsRender = false;
  }

  function drawAmbient(ts) {
    if (!running) return;
    if (lastTs === 0) lastTs = ts;
    const delta = Math.min(64, ts - lastTs);
    lastTs = ts;
    noiseTime += delta;

    ambientCtx.clearRect(0, 0, width, height);
    const layers = reducedMotion ? 3 : 4;

    for (let i = 0; i < layers; i += 1) {
      const x = width * (0.3 + 0.4 * noise2d(i * 10.3, noiseTime * 0.0003));
      const y = height * (0.2 + 0.6 * noise2d(i * 10.3 + 100, noiseTime * 0.0002));
      const radius = 300 + 150 * noise2d(i * 10.3 + 200, noiseTime * 0.0004);
      const gradient = ambientCtx.createRadialGradient(x, y, 0, x, y, radius);
      const baseA = reducedMotion ? 0.02 : 0.04;
      const midA = reducedMotion ? 0.01 : 0.02;
      gradient.addColorStop(0, `rgba(180, 140, 40, ${baseA})`);
      gradient.addColorStop(0.4, `rgba(160, 120, 20, ${midA})`);
      gradient.addColorStop(1, "rgba(0,0,0,0)");

      ambientCtx.fillStyle = gradient;
      ambientCtx.beginPath();
      ambientCtx.ellipse(x, y, radius, radius * 0.6, 0, 0, Math.PI * 2);
      ambientCtx.fill();
    }

    ambientRafId = window.requestAnimationFrame(drawAmbient);
  }

  function stepTextIllumination() {
    if (!running || !illuminationActive) return;
    const now = performance.now();
    let stillActive = false;
    for (let i = 0; i < fragments.length; i += 1) {
      const fragment = fragments[i];
      if (fragment.currentOpacity > fragment.baseOpacity) {
        if (now > fragment.litUntil) {
          fragment.currentOpacity *= 0.92;
          if (fragment.currentOpacity < fragment.baseOpacity) {
            fragment.currentOpacity = fragment.baseOpacity;
          } else {
            stillActive = true;
          }
        } else {
          stillActive = true;
        }
      }
    }
    textNeedsRender = true;
    renderTextLayer();
    illuminationActive = stillActive;
    if (illuminationActive) {
      textRafId = window.requestAnimationFrame(stepTextIllumination);
    } else {
      textRafId = 0;
    }
  }

  function generateBolt(startX, startY, endX, endY, roughness = 2.5) {
    const dist = Math.hypot(endX - startX, endY - startY);
    if (dist < 4) return [[startX, startY], [endX, endY]];

    const midX = (startX + endX) / 2 + (Math.random() - 0.5) * roughness * dist * 0.4;
    const midY = (startY + endY) / 2 + (Math.random() - 0.5) * roughness * dist * 0.2;

    const left = generateBolt(startX, startY, midX, midY, roughness * 0.6);
    const right = generateBolt(midX, midY, endX, endY, roughness * 0.6);
    left.pop();
    return left.concat(right);
  }

  function drawBolt(points, alpha, widthPx = 1) {
    if (!points.length) return;
    boltCtx.beginPath();
    boltCtx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      boltCtx.lineTo(points[i][0], points[i][1]);
    }

    boltCtx.strokeStyle = `rgba(220, 180, 80, ${alpha * 0.15})`;
    boltCtx.lineWidth = widthPx * 6;
    boltCtx.shadowBlur = 20;
    boltCtx.shadowColor = "rgba(220, 180, 80, 0.3)";
    boltCtx.stroke();

    boltCtx.strokeStyle = `rgba(240, 220, 140, ${alpha * 0.6})`;
    boltCtx.lineWidth = widthPx;
    boltCtx.shadowBlur = 8;
    boltCtx.stroke();

    boltCtx.strokeStyle = `rgba(255, 245, 220, ${alpha * 0.3})`;
    boltCtx.lineWidth = widthPx * 0.4;
    boltCtx.shadowBlur = 0;
    boltCtx.stroke();
  }

  function screenFlash() {
    const flash = document.createElement("div");
    flash.className = "lightning-flash";
    document.body.appendChild(flash);
    window.setTimeout(() => {
      flash.remove();
    }, 150);
  }

  function illuminateNearbyText(points) {
    if (!fragments.length || !points.length || reducedMotion) return;
    const sampleStep = Math.max(1, Math.floor(points.length / 36));
    let touched = false;

    fragments.forEach((fragment) => {
      const fragX = fragment.x;
      const fragY = fragment.y;
      let nearBolt = false;

      for (let i = 0; i < points.length; i += sampleStep) {
        const [bx, by] = points[i];
        if (Math.hypot(fragX - bx, fragY - by) < 180) {
          nearBolt = true;
          break;
        }
      }

      if (nearBolt) {
        const boosted = Math.min(fragment.maxOpacity, fragment.baseOpacity * 3);
        fragment.currentOpacity = Math.max(fragment.currentOpacity, boosted);
        fragment.litUntil = performance.now() + 60;
        touched = true;
      }
    });

    if (touched) {
      illuminationActive = true;
      textNeedsRender = true;
      renderTextLayer();
      if (!textRafId) {
        textRafId = window.requestAnimationFrame(stepTextIllumination);
      }
    }
  }

  function renderBoltFrame() {
    if (!running || !activeBolt) return;
    clearBoltLayer();
    drawBolt(activeBolt.main, activeBolt.alpha, 1.2);
    activeBolt.branches.forEach((branch) => {
      drawBolt(branch.points, activeBolt.alpha * 0.6, branch.width);
    });

    activeBolt.alpha -= 0.08;
    if (activeBolt.alpha > 0) {
      boltRafId = window.requestAnimationFrame(renderBoltFrame);
    } else {
      activeBolt = null;
      clearBoltLayer();
    }
  }

  function scheduleNextBolt() {
    if (!running || reducedMotion) return;
    const nextDelay = 4500 + Math.random() * 6500;
    boltTimeoutId = window.setTimeout(triggerLightningEvent, nextDelay);
  }

  function triggerLightningEvent() {
    if (!running || reducedMotion || document.hidden) return;

    const startFromTop = Math.random() > 0.32;
    const startX = startFromTop
      ? width * (0.1 + Math.random() * 0.8)
      : Math.random() > 0.5
        ? 0
        : width;
    const startY = startFromTop ? 0 : height * (0.12 + Math.random() * 0.48);
    const endX = startX + (Math.random() - 0.5) * width * 0.3;
    const endY = height * (0.3 + Math.random() * 0.5);

    const mainBolt = generateBolt(startX, startY, endX, endY);
    const branches = [];
    const branchCount = 2 + Math.floor(Math.random() * 3);

    for (let b = 0; b < branchCount; b += 1) {
      const branchStartIdx = Math.floor(mainBolt.length * (0.3 + Math.random() * 0.4));
      const point = mainBolt[Math.max(0, Math.min(mainBolt.length - 1, branchStartIdx))];
      if (!point) continue;
      const [bx, by] = point;
      const branchEndX = bx + (Math.random() - 0.5) * 200;
      const branchEndY = by + Math.random() * 150;
      branches.push({
        points: generateBolt(bx, by, branchEndX, branchEndY, 1.8),
        width: 0.5 + Math.random() * 0.3,
      });
    }

    activeBolt = { main: mainBolt, branches, alpha: 1 };
    const allBoltPoints = mainBolt.concat(...branches.map((branch) => branch.points));
    illuminateNearbyText(allBoltPoints);
    screenFlash();
    if (boltRafId) window.cancelAnimationFrame(boltRafId);
    boltRafId = window.requestAnimationFrame(renderBoltFrame);
    scheduleNextBolt();
  }

  function stopAnimations() {
    running = false;
    if (ambientRafId) window.cancelAnimationFrame(ambientRafId);
    if (textRafId) window.cancelAnimationFrame(textRafId);
    if (boltRafId) window.cancelAnimationFrame(boltRafId);
    if (boltTimeoutId) window.clearTimeout(boltTimeoutId);
    ambientRafId = 0;
    textRafId = 0;
    boltRafId = 0;
    boltTimeoutId = 0;
    lastTs = 0;
    activeBolt = null;
    illuminationActive = false;
    clearBoltLayer();
  }

  function startAnimations() {
    if (running) return;
    running = true;
    ambientCanvas.style.opacity = reducedMotion ? "0.5" : "1";
    textCanvas.style.opacity = "1";
    boltCanvas.style.opacity = reducedMotion ? "0" : "1";
    ambientRafId = window.requestAnimationFrame(drawAmbient);
    if (textNeedsRender) renderTextLayer();
    if (!reducedMotion) {
      const firstDelay = 1200 + Math.random() * 2200;
      boltTimeoutId = window.setTimeout(triggerLightningEvent, firstDelay);
    }
  }

  function onResize() {
    if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
    resizeTimeoutId = window.setTimeout(() => {
      resizeCanvases();
      renderTextLayer();
    }, 140);
  }

  function onVisibilityChange() {
    if (document.hidden) {
      stopAnimations();
    } else {
      startAnimations();
    }
  }

  function onReducedMotionChange(event) {
    reducedMotion = event.matches;
    stopAnimations();
    startAnimations();
  }

  document.fonts.ready.then(() => {
    resizeCanvases();
    renderTextLayer();
  });
  resizeCanvases();
  renderTextLayer();
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  reducedMotionQuery.addEventListener("change", onReducedMotionChange);
  startAnimations();
}

window.addEventListener("scroll", setScrolledNav, { passive: true });
setScrolledNav();
setupMobileNav();
revealOnScroll();
setupLightningBackground();
animateHeroBracket();
animateHeroPrompt();
setupBracketInline();
setRotatingPlaceholder();
loadApiVersion();
setupMiniOddsForm();
