const TRAILING_INSTRUCTION_PATTERNS = [
  /\b(explain|explanation|explain why|why)\b/i,
  /\b(give|show|return)\s+(odds\s+only|just\s+odds|only\s+odds)\b/i,
  /\b(odds\s+only|no\s+explanation|no\s+explainer|no\s+rationale)\b/i,
  /\b(brief|short)\s+(explanation|rationale)\b/i,
];

export function normalizeUnicode(text) {
  return String(text || "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

export function collapsePunctuation(text) {
  return String(text || "")
    .replace(/([!?.,;:])\1+/g, "$1")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, "...");
}

export function collapseWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function stripTrailingInstructions(text) {
  let out = String(text || "");
  // Remove trailing parenthetical instructions.
  out = out.replace(/\(([^)]{0,80})\)\s*$/g, (match, inner) => {
    return TRAILING_INSTRUCTION_PATTERNS.some((re) => re.test(inner)) ? "" : match;
  });
  // Remove trailing fragments after punctuation if they are instructions.
  // Avoid hyphen so we don't clip hyphenated idioms (e.g., "three-peat").
  out = out.replace(/([;,:])\s*([^;,:]{0,80})$/g, (match, sep, tail) => {
    return TRAILING_INSTRUCTION_PATTERNS.some((re) => re.test(tail)) ? "" : match;
  });
  // Remove standalone trailing instruction phrases.
  for (const re of TRAILING_INSTRUCTION_PATTERNS) {
    out = out.replace(new RegExp(`\\s+${re.source}\\s*[.!?]*\\s*$`, "i"), "");
  }
  return out;
}

export function normalizeForParsing(text) {
  let out = normalizeUnicode(text);
  out = stripTrailingInstructions(out);
  out = collapsePunctuation(out);
  out = collapseWhitespace(out);
  return out;
}

export function normalizeLower(text) {
  return normalizeForParsing(text).toLowerCase();
}
