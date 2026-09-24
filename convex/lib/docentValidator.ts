import type { DocentSentence } from "./validators";

// Shared with the Python enrichment job through shared/docent/fixtures/docent-validator.json.
export const MAX_DOCENT_SENTENCES = 4;
export const MAX_SENTENCE_CHARS = 240;
export const MIN_SENTENCE_WORDS = 4;

export function validateDocent(sentences: DocentSentence[], sheetIds: ReadonlySet<string>): DocentSentence[] {
  const kept: DocentSentence[] = [];
  const seen = new Set<string>();
  for (const candidate of sentences) {
    if (kept.length >= MAX_DOCENT_SENTENCES) break;
    const sentence = candidate.sentence.replaceAll(/\s+/g, " ").trim();
    const factIds = [...new Set(candidate.factIds)];
    if (factIds.length === 0 || factIds.some((id) => !sheetIds.has(id))) continue;
    if (!sentence || sentence.length > MAX_SENTENCE_CHARS || sentence.split(" ").length < MIN_SENTENCE_WORDS) {
      continue;
    }
    if (seen.has(sentence)) continue;
    seen.add(sentence);
    kept.push({ sentence, factIds });
  }
  return kept;
}
