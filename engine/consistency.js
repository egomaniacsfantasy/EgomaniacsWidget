function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function americanOddsToProbabilityPct(oddsText) {
  const n = Number(String(oddsText || "").replace(/[+]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  const p = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return clamp(p * 100, 0.01, 99.9);
}

function toAmericanOdds(probabilityPct) {
  const p = clamp(probabilityPct / 100, 0.001, 0.999);
  if (p >= 0.5) return `${-Math.round((p / (1 - p)) * 100)}`;
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

export function applyConsistencyRules({ prompt, intent, result, companion }) {
  if (!result || result.status !== "ok") return result;
  if (String(result.odds || "").toUpperCase() === "NO CHANCE") return result;

  let prob = americanOddsToProbabilityPct(result.odds);
  if (!Number.isFinite(prob)) return result;
  const notes = [];

  // Rule 1: "ever" should not be less likely than equivalent "season" event.
  if (intent?.horizon === "ever" && companion?.seasonProbabilityPct) {
    if (prob < companion.seasonProbabilityPct) {
      prob = companion.seasonProbabilityPct;
      notes.push("Repaired horizon monotonicity: ever >= season.");
    }
  }

  // Rule 2: impossible phrases.
  const lower = String(prompt || "").toLowerCase();
  if (/\b(dead|deceased)\b/.test(lower) && /\bcomes out of retirement|returns? to play\b/.test(lower)) {
    return {
      ...result,
      odds: "NO CHANCE",
      impliedProbability: "0.0%",
      confidence: "High",
      sourceType: "constraint_model",
      sourceLabel: "Hard impossibility constraint",
      assumptions: ["Scenario is infeasible by hard-world constraints."],
    };
  }

  const patched = {
    ...result,
    odds: toAmericanOdds(prob),
    impliedProbability: `${prob.toFixed(1)}%`,
  };

  if (notes.length) {
    patched.assumptions = [...(Array.isArray(result.assumptions) ? result.assumptions : []), ...notes];
  }
  return patched;
}
