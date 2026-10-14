import { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers, pattern } from "obscenity";

import { normalizeSearch } from "../journal/limits";

// The stock list flags real names (Dick, Cock, Cummings, Hooker, Negro, Semenov), so those words give way to their
// unambiguous compounds, and whitelisted names cover the rest.
const NAME_WORDS = new Set(["anal", "cock", "cum", "dick", "hooker", "negro", "semen"]);
const ADDED_WORDS = {
  cocksucker: pattern`cocksucker`,
  dickhead: pattern`dickhead`,
  raghead: pattern`raghead`,
  spic: pattern`|spic|`,
  wetback: pattern`wetback`,
};
// Slurs and the strongest swearing, refused even where OpenAI would pass swearing aimed at no one.
const SEVERE_WORDS = new Set([
  "abeed",
  "abo",
  "africoon",
  "arabush",
  "boonga",
  "chingchong",
  "chink",
  "cocksucker",
  "cunt",
  "fag",
  "fuck",
  "kike",
  "nigger",
  "raghead",
  "retard",
  "spastic",
  "spic",
  "tranny",
  "wetback",
]);
// "ngga" covers Indonesian names like Angga and places like Tenggara.
const WHITELIST = [
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
  // Artwork titles and subjects people write about.
  "balaam and the ass",
  "balaam's ass",
  "balaam’s ass",
  "ox and ass",
  "ox and the ass",
  "piss christ",
  "rape of europa",
  "rape of the sabine women",
  "whore of babylon",
];

function matcherFor(keep: (word: string) => boolean) {
  const words = new DataSet<{ originalWord: string }>().addAll(englishDataset);
  for (const [originalWord, added] of Object.entries(ADDED_WORDS)) {
    words.addPhrase((phrase) => phrase.setMetadata({ originalWord }).addPattern(added));
  }
  const dataset = words.removePhrasesIf((phrase) => !keep(phrase.metadata?.originalWord ?? "")).build();
  return new RegExpMatcher({
    ...dataset,
    whitelistedTerms: [...(dataset.whitelistedTerms ?? []), ...WHITELIST],
    ...englishRecommendedTransformers,
  });
}
const matcher = matcherFor((word) => !NAME_WORDS.has(word));
const severeMatcher = matcherFor((word) => SEVERE_WORDS.has(word));

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

// Usernames separate words with underscores, and the whitelist matches only unaccented, space-separated words
// ("van dyke", "bich").
const matchable = (text: string) => normalizeSearch(text.replaceAll("_", " "));

export function isOffensive(text: string): boolean {
  return matcher.hasMatch(matchable(text));
}

export function isSevere(text: string): boolean {
  return severeMatcher.hasMatch(matchable(text));
}

/** Whether a display name or username may be shown publicly: not offensive and not posing as Artlog staff. */
export function isAllowedIdentity(text: string): boolean {
  // Whole words, so names like "Stuart Logan" don't read as "artlog".
  const words = normalizeSearch(text).split(/[^a-z]+/);
  return !isOffensive(text) && !words.some((word) => word.startsWith("artlog")) && !STAFF_NAMES.has(words.join(""));
}
