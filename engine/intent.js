export function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function parseTimeHorizon(prompt) {
  const p = normalizeWhitespace(prompt).toLowerCase();
  const hasExplicitSeason = /\b(this year|this season|next year|next season|upcoming season|in \d{4})\b/.test(p);
  const hasHallOfFame = /\b(hall of fame|hof)\b/.test(p);
  if (/\b(next|over|within)\s+\d{1,2}\s+(years|seasons)\b/.test(p)) return "multi_year";
  if (/\b(next|over|within)\s+(two|three|four|five|six|seven|eight|nine|ten)\s+(years|seasons)\b/.test(p)) return "multi_year";
  if (/\b(ever|all[- ]time|at some point|someday)\b/.test(p)) return "ever";
  if (/\b(career|in his career|in her career|in their career)\b/.test(p)) return "career";
  // Hall of Fame prompts are long-horizon by default unless user explicitly asks for a specific season/year.
  if (hasHallOfFame && !hasExplicitSeason) return "career";
  // Product rule: in this app, "this year" and "next year" both map to the same upcoming season context.
  if (/\b(next year|next season|upcoming season)\b/.test(p)) return "season";
  if (/\b(this year|this season|in 2026|in 2027|in \d{4})\b/.test(p)) return "season";
  return "unspecified";
}

export function parseIntent(prompt) {
  const text = normalizeWhitespace(prompt);
  const lower = text.toLowerCase();
  const horizon = parseTimeHorizon(text);
  const league = /\bnfl\b/.test(lower)
    ? "nfl"
    : /\bnba\b/.test(lower)
      ? "nba"
      : /\bmlb\b/.test(lower)
        ? "mlb"
        : /\bnhl\b/.test(lower)
          ? "nhl"
          : "unknown";

  const isBettingAdvice = /\b(best bet|should i bet|parlay|units|wager|spread|moneyline|over\/under)\b/.test(lower);
  const isPlayerPrompt = /\b[a-z][a-z'.-]+\s+[a-z][a-z'.-]+\b/i.test(text);

  return {
    horizon,
    league,
    isBettingAdvice,
    isPlayerPrompt,
    raw: text,
  };
}
