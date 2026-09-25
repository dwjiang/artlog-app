import { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers, pattern } from "obscenity";

import { normalizeSearch } from "../journal/limits";

// The stock list flags real names (Dick, Cock, Cummings, Hooker, Negro, Semenov), so those words give way to their
// unambiguous compounds, and whitelisted names cover the rest.
const NAME_WORDS = new Set(["anal", "cock", "cum", "dick", "hooker", "negro", "semen"]);
const dataset = new DataSet<{ originalWord: string }>()
  .addAll(englishDataset)
  .removePhrasesIf((phrase) => NAME_WORDS.has(phrase.metadata?.originalWord ?? ""))
  .addPhrase((phrase) => phrase.addPattern(pattern`cocksucker`).addPattern(pattern`dickhead`))
  .addPhrase((phrase) =>
    phrase
      .addPattern(pattern`raghead`)
      .addPattern(pattern`wetback`)
      .addPattern(pattern`|spic|`),
  )
  .build();
const matcher = new RegExpMatcher({
  ...dataset,
  // "ngga" covers Indonesian names like Angga and places like Tenggara.
  whitelistedTerms: [
    ...(dataset.whitelistedTerms ?? []),
    "ashit",
    "asselijn",
    "assheton",
    "bich",
    "dikshit",
    "fagan",
    "fagel",
    "fagen",
    "fager",
    "faggin",
    "fagin",
    "fagioli",
    "fagundes",
    "fockema",
    "fu",
    "fuka",
    "fuku",
    "kshitij",
    "ngga",
    "pissarro",
    "pisseleu",
    "pornchai",
    "pornpimol",
    "pornsak",
    "pornthip",
    "pussycat",
    "schinkel",
    "shitao",
    "shittu",
    "slutsky",
    "wankel",
    "wankhede",
    "wankowicz",
  ],
  ...englishRecommendedTransformers,
});

const STAFF_NAMES = new Set([
  "admin",
  "administrator",
  "help",
  "mod",
  "moderator",
  "official",
  "root",
  "security",
  "staff",
  "support",
  "system",
  "team",
]);

export function isOffensive(text: string): boolean {
  // Usernames separate words with underscores, and the whitelist matches only unaccented, space-separated words
  // ("van dyke", "bich").
  return matcher.hasMatch(normalizeSearch(text.replaceAll("_", " ")));
}

/** Whether a display name or username may be shown publicly: not offensive and not posing as Artlog staff. */
export function isAllowedIdentity(text: string): boolean {
  // Whole words, so names like "Stuart Logan" don't read as "artlog".
  const words = normalizeSearch(text).split(/[^a-z]+/);
  return !isOffensive(text) && !words.some((word) => word.startsWith("artlog")) && !STAFF_NAMES.has(words.join(""));
}
