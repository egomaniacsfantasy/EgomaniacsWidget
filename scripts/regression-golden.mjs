const BASE = process.env.BASE_URL || "http://localhost:3000";

function parseOddsToProb(odds) {
  if (!odds) return null;
  if (String(odds).toUpperCase() === "NO CHANCE") return 0;
  const n = Number(String(odds).replace("+", ""));
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

async function ask(prompt) {
  const response = await fetch(`${BASE}/api/odds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ewa-client-version": "2026.02.20.1" },
    body: JSON.stringify({ prompt }),
  });
  const json = await response.json();
  return { response, json, prob: parseOddsToProb(json?.odds) };
}

const failures = [];
const passes = [];

function ok(condition, label, context = {}) {
  if (condition) passes.push(label);
  else failures.push({ label, context });
}

async function main() {
  const healthRes = await fetch(`${BASE}/api/health`);
  const health = await healthRes.json();
  ok(Boolean(health?.apiVersion), "health has apiVersion", { health });

  const bet = await ask("What's the best bet tonight?");
  ok(bet.json.status === "refused", "betting advice refused", bet.json);

  const friend = await ask("My friend Mark wins MVP");
  ok(friend.json.status === "refused", "friend prompt refused", friend.json);

  const q20 = await ask("A quarterback throws for 20 touchdowns this season");
  ok(q20.json.status === "ok" && (q20.prob ?? 0) >= 0.9, "any QB 20 TD near-lock", q20.json);

  const q20Int = await ask("A quarterback throws for 20 interceptions this season");
  ok(q20Int.json.status === "ok" && (q20Int.prob ?? 0) <= 0.7, "any QB 20 INT not near-lock", q20Int.json);

  const s17 = await ask("A team goes 17-0 in the NFL regular season this year");
  const e17 = await ask("A team ever goes 17-0 in the NFL regular season");
  ok((e17.prob ?? 0) >= (s17.prob ?? 1), "17-0 ever >= season", { s17: s17.json, e17: e17.json });

  const s017 = await ask("A team goes 0-17 in the NFL regular season this year");
  const e017 = await ask("A team ever goes 0-17 in the NFL regular season");
  ok((e017.prob ?? 0) >= (s017.prob ?? 1), "0-17 ever >= season", { s017: s017.json, e017: e017.json });

  const sb1 = await ask("Drake Maye wins 1 Super Bowl");
  const sb2 = await ask("Drake Maye wins 2 Super Bowls");
  ok((sb2.prob ?? 1) <= (sb1.prob ?? 0), "Maye 2 SB <= 1 SB", { sb1: sb1.json, sb2: sb2.json });

  const retire = await ask("Drake Maye retires this year");
  ok(retire.json.status === "ok", "retirement prompt returns odds", retire.json);

  const comebackActive = await ask("Drake Maye comes out of retirement");
  ok(comebackActive.json.status === "snark", "active-player comeback snark", comebackActive.json);

  const deadComeback = await ask("Babe Ruth comes out of retirement");
  ok(deadComeback.json.status === "ok" && String(deadComeback.json.odds).toUpperCase() === "NO CHANCE", "dead athlete comeback no chance", deadComeback.json);

  const longRetired = await ask("Brett Favre returns to play");
  ok(["ok", "snark"].includes(longRetired.json.status), "returns-to-play phrasing treated as sports", longRetired.json);

  const oline1 = await ask("Will Campbell catches 1 touchdown next season");
  const oline5a = await ask("Will Campbell catches 5 touchdowns next season");
  const oline5b = await ask("Will Campbell records 5 receiving touchdowns next season");
  ok(String(oline1.json.odds).toUpperCase() === "NO CHANCE", "OL 1 receiving TD no chance", oline1.json);
  ok(String(oline5a.json.odds).toUpperCase() === "NO CHANCE", "OL 5 receiving TD no chance", oline5a.json);
  ok(String(oline5b.json.odds).toUpperCase() === "NO CHANCE", "OL receiving phrasing parity no chance", oline5b.json);

  const wsA = await ask("Red Sox to win the WS");
  const wsB = await ask("Red Sox win the World Series");
  ok(wsA.json.status === "ok" && wsB.json.status === "ok", "WS phrasing both valid", { wsA: wsA.json, wsB: wsB.json });

  const afcA = await ask("Chiefs to win the AFC");
  const afcB = await ask("Chiefs win the AFC Championship");
  ok(afcA.json.status === "ok" && afcB.json.status === "ok", "AFC phrasing both valid", { afcA: afcA.json, afcB: afcB.json });

  const pA = await ask("Patriots make playoffs next season");
  const pB = await ask("Patriots make the playoffs next season");
  ok(pA.json.status === "ok" && pB.json.status === "ok", "playoffs phrasing both valid", { pA: pA.json, pB: pB.json });

  const mayCareerBad = await ask("Drake Maye plays his whole career on the Panthers");
  ok(mayCareerBad.json.status === "snark", "whole-career contradiction snark", mayCareerBad.json);

  const mayLower = await ask("drake maye retires this year");
  ok(mayLower.json.status === "ok", "lowercase name still resolves", mayLower.json);

  const versionMismatch = await fetch(`${BASE}/api/odds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ewa-client-version": "9999.00.00" },
    body: JSON.stringify({ prompt: "Chiefs win the Super Bowl" }),
  });
  const versionJson = await versionMismatch.json();
  ok(versionMismatch.status === 409 && versionJson.status === "outdated_client", "client/server version mismatch enforced", versionJson);

  const metricsRes = await fetch(`${BASE}/api/metrics`);
  const metrics = await metricsRes.json();
  ok(metrics.status === "ok" && Object.prototype.hasOwnProperty.call(metrics, "anchorHitRate"), "metrics include anchorHitRate", metrics);
  ok(Object.prototype.hasOwnProperty.call(metrics, "fallbackRate"), "metrics include fallbackRate", metrics);
  ok(Object.prototype.hasOwnProperty.call(metrics, "consistencyRepairs"), "metrics include consistencyRepairs", metrics);

  if (failures.length > 0) {
    console.error(`FAIL ${failures.length} checks, PASS ${passes.length} checks`);
    for (const f of failures) {
      console.error(`- ${f.label}`);
      console.error(JSON.stringify(f.context, null, 2));
    }
    process.exit(1);
  }

  console.log(`PASS ${passes.length} checks, FAIL 0`);
}

main().catch((error) => {
  console.error("Regression run failed", error);
  process.exit(1);
});
