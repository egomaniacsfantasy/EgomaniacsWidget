const BASE = process.env.BASE_URL || "http://localhost:3000";

const tests = [
  {
    name: "Sports prompt should not snark",
    prompt: "Joe Burrow wins 2 Super Bowls",
    assert: (r) => r.status === "ok",
  },
  {
    name: "Friend prompt should refuse",
    prompt: "My friend John wins MVP",
    assert: (r) => r.status === "refused",
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
