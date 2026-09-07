const CHARACTERS_PER_TOKEN = 3.6;

export function estimateTokens(text) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return 0;
  const byCharacters = normalized.length / CHARACTERS_PER_TOKEN;
  const byWords = normalized.split(" ").length * 1.3;
  return Math.ceil(Math.max(byCharacters, byWords));
}

export const TOKEN_ESTIMATE_NOTE = `Token counts are an estimate: max(characters / ${CHARACTERS_PER_TOKEN}, words x 1.3), which overcounts against every major tokenizer so budgets fail early rather than late.`;
