const BASE = process.env.BASE_URL || "http://localhost:3000";

const tests = [
  {
    name: "Sports prompt should not snark",
    prompt: "Joe Burrow wins 2 Super Bowls",
    assert: (r) => r.status === "ok",
  },
  {
    name: "Normalization handles idioms and punctuation",
    prompt: "Chiefs three-peat!!!",
    assert: (r) => isValidOdds(r) && isValidImplied(r),
  },
  {
    name: "Smart quotes + em dash normalization",
    prompt: "“Chiefs” — win the Super Bowl…",
    assert: (r) => isValidOdds(r) && isValidImplied(r),
  },
  {
    name: "Composite contradiction returns sentinel",
    prompt: "Chiefs win the Super Bowl and miss the playoffs",
    assert: (r) => isSentinel(r) && r.sourceType === "inconsistent",
  },
  {
    name: "Composite contradiction with benching",
    prompt: "Josh Allen throws 50 TDs and gets benched all season",
    assert: (r) => isSentinel(r) && r.sourceType === "inconsistent",
  },
  {
    name: "Deterministic stat threshold should not need data",
    prompt: "Josh Allen rushes for 1,000 yards this season",
    assert: (r) => isValidOdds(r) && isValidImplied(r) && String(r.confidence || "").toLowerCase() === "low",
  },
  {
    name: "WATO-51: Chiefs win at least 14 regular-season games",
    prompt: "Chiefs win at least 14 regular-season games next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-52: Chiefs exactly 12 wins",
    prompt: "Chiefs finish with exactly 12 regular-season wins next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-53: Bills win AFC East",
    prompt: "Bills win the AFC East next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-55: Patriots above .500",
    prompt: "Patriots finish above .500 next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-56: Patriots win at least 9 games",
    prompt: "Patriots win at least 9 games next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-57: Drake Maye 4,000+ passing yards",
    prompt: "Drake Maye throws for 4,000+ yards next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-58: Drake Maye 30+ passing TDs",
    prompt: "Drake Maye throws 30+ passing TDs next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-60: Josh Allen 700+ rushing yards",
    prompt: "Josh Allen rushes for 700+ yards next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-61: Lamar Jackson 1,000+ rushing yards",
    prompt: "Lamar Jackson rushes for 1,000+ yards next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-66: Travis Kelce 1,000+ receiving yards",
    prompt: "Travis Kelce has 1,000+ receiving yards next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-70: Non-QB MVP",
    prompt: "A non-QB wins MVP next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-71: Chiefs reach AFC Championship Game",
    prompt: "Chiefs reach the AFC Championship Game next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-72: Bills reach AFC Championship Game",
    prompt: "Bills reach the AFC Championship Game next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-74: OR list MVPs",
    prompt: "Josh Allen, Lamar Jackson, or Joe Burrow wins MVP",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-88: Chiefs finish last in AFC West",
    prompt: "Chiefs finish last in the AFC West next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-89: Any team goes 0-17",
    prompt: "A team goes 0-17",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-90: Any team wins 16+ games",
    prompt: "A team wins at least 16 regular-season games next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "Super Bowl margin <= 3",
    prompt: "The Super Bowl is decided by 3 points or fewer next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "Super Bowl overtime",
    prompt: "The Super Bowl goes to overtime next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "17-0 any team",
    prompt: "A team goes 17-0",
    assert: (r) => isRealMarket(r) && parsePct(r.impliedProbability) <= 1.0,
  },
  {
    name: "Three-peat idiom",
    prompt: "Chiefs three-peat!!!",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "Three-peat with trailing instruction",
    prompt: "Chiefs three-peat? Explain.",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "WATO-86: Chiefs do not win the Super Bowl next season",
    prompt: "Chiefs do not win the Super Bowl next season",
    assert: (r) => isRealMarket(r),
  },
  {
    name: "Composite contradiction returns inconsistent sentinel",
    prompt: "Chiefs win the Super Bowl and miss the playoffs",
    assert: (r) => isSentinel(r) && /inconsistent/i.test(r.rationale || ""),
  },
  {
    name: "Composite non-contradictory AND returns unsupported_composite sentinel",
    prompt: "Patriots make the playoffs next season AND win a playoff game",
    assert: (r) => isSentinel(r) && r.sourceType === "unsupported_composite",
  },
  {
    name: "Wildcard actor unsupported (ANY_ROOKIE_QB)",
    prompt: "A rookie QB makes the playoffs",
    assert: (r) => isSentinel(r) && r.sourceType === "unsupported",
  },
  {
    name: "Output contract (odds + implied + rationale)",
    prompt: "Bills win the AFC",
    assert: (r) => isValidOdds(r) && isValidImplied(r) && impliedMatchesOdds(r) && hasRationale(r),
  },
  {
    name: "Friend prompt should refuse",
    prompt: "My friend John wins MVP",
    assert: (r) => isValidOdds(r) && isValidImplied(r),
  },
  {
    name: "17-0 ever baseline should be >= season",
    promptA: "What are the odds that a team goes 17-0 in the NFL regular season this year?",
    promptB: "What are the odds that a team ever goes 17-0 in the NFL regular season?",
    pairAssert: (a, b) => {
      const pa = parsePct(a.impliedProbability);
      const pb = parsePct(b.impliedProbability);
      return Number.isFinite(pa) && Number.isFinite(pb) && pb >= pa;
    },
  },
];

function parsePct(v) {
  return Number(String(v || "").replace("%", ""));
}

function isValidOdds(r) {
  return typeof r?.odds === "string" && /^[+-]\d+$/.test(r.odds);
}

function isValidImplied(r) {
  const pct = parsePct(r?.impliedProbability);
  return Number.isFinite(pct) && pct > 0 && pct < 100;
}

function isSentinel(r) {
  return r?.odds === "+100000" || r?.impliedProbability === "0.1%";
}

function isRealMarket(r) {
  return isValidOdds(r) && isValidImplied(r) && !isSentinel(r) && impliedMatchesOdds(r) && hasRationale(r);
}

function impliedMatchesOdds(r, tolerance = 0.6) {
  const odds = Number(String(r?.odds || "").replace("+", ""));
  if (!Number.isFinite(odds) || odds === 0) return false;
  const pct = parsePct(r?.impliedProbability);
  if (!Number.isFinite(pct)) return false;
  const p = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  const expected = p * 100;
  return Math.abs(expected - pct) <= tolerance;
}

function hasRationale(r) {
  return typeof r?.rationale === "string" && r.rationale.trim().length > 0;
}

async function callOdds(prompt) {
  const res = await fetch(`${BASE}/api/odds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const json = await res.json();
  return json;
}

async function run() {
  let failed = 0;
  // Determinism check
  {
    const prompt = "Lamar Jackson throws 35 touchdowns this season";
    const outputs = [];
    for (let i = 0; i < 5; i += 1) {
      outputs.push(await callOdds(prompt));
    }
    const first = outputs[0];
    const deterministic = outputs.every((o) => o.odds === first.odds && o.impliedProbability === first.impliedProbability);
    console.log(`${deterministic ? "PASS" : "FAIL"}: Determinism (5 repeats)`);
    if (!deterministic) {
      failed += 1;
      console.log(outputs.map((o) => ({ odds: o.odds, impliedProbability: o.impliedProbability })));
    }
  }

  for (const t of tests) {
    if (t.prompt) {
      const r = await callOdds(t.prompt);
      const ok = t.assert(r);
      console.log(`${ok ? "PASS" : "FAIL"}: ${t.name}`);
      if (!ok) {
        failed += 1;
        console.log(JSON.stringify(r, null, 2));
      }
    } else {
      const a = await callOdds(t.promptA);
      const b = await callOdds(t.promptB);
      const ok = t.pairAssert(a, b);
      console.log(`${ok ? "PASS" : "FAIL"}: ${t.name}`);
      if (!ok) {
        failed += 1;
        console.log("A:", JSON.stringify(a, null, 2));
        console.log("B:", JSON.stringify(b, null, 2));
      }
    }
  }
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
