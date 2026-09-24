const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const NAME_QUALIFIERS: Record<string, string> = {
  elder: "elder",
  younger: "younger",
  jr: "junior",
  junior: "junior",
  sr: "senior",
  senior: "senior",
  ii: "ii",
  iii: "iii",
  iv: "iv",
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

export function jaccard(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

// Page titles carry site names and artists around separators: "Artist - Title - Museum".
export function segments(value: string): string[] {
  const parts = value
    .split(/\s+[|\-–—:]\s+|\s*\|\s*|\.\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? [value, ...parts] : [value];
}

export function titleSimilarity(label: string, page: string): number {
  return Math.max(
    0,
    ...segments(page).map((segment) => jaccard(label, segment)),
  );
}

export const TITLE_MATCH_THRESHOLD = 0.6;

const DERIVATIVE_QUALIFIERS =
  /\b(?:study|studies|sketch|poster|print|copy|after|replica)\b/g;

export function titleQualifiersMatch(a: string, b: string): boolean {
  const qualifiers = (title: string) =>
    new Set(
      (normalizeText(title).match(DERIVATIVE_QUALIFIERS) ?? []).map((term) =>
        term === "studies" ? "study" : term,
      ),
    );
  const left = qualifiers(a);
  const right = qualifiers(b);
  return left.size === right.size && [...left].every((term) => right.has(term));
}

export function titleMatches(label: string, page: string): boolean {
  return (
    titleQualifiersMatch(label, page)
    && titleSimilarity(label, page) >= TITLE_MATCH_THRESHOLD
  );
}

export function exactTitle(label: string, page: string): boolean {
  const wanted = normalizeText(label);
  return (
    wanted !== ""
    && segments(page).some((segment) => normalizeText(segment) === wanted)
  );
}

export function mentions(text: string, phrase: string): boolean {
  const wanted = normalizeText(phrase);
  return wanted !== "" && ` ${normalizeText(text)} `.includes(` ${wanted} `);
}

function nameTokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token && !NAME_SUFFIXES.has(token));
}

function personNameTokens(value: string): string[] {
  const parts = value
    .split(",")
    .map((part) =>
      nameTokens(part).filter(
        (token) => token !== "the" && !Object.hasOwn(NAME_QUALIFIERS, token),
      ),
    )
    .filter((part) => part.length);
  // A comma separates family and given names; suffix-only parts have already been removed.
  return parts.length === 2 ? [...parts[1], ...parts[0]] : parts.flat();
}

export function personMatches(a: string, b: string): boolean {
  const qualifier = (name: string) =>
    normalizeText(name)
      .split(" ")
      .map((token) => NAME_QUALIFIERS[token])
      .find(Boolean);
  const [leftQualifier, rightQualifier] = [qualifier(a), qualifier(b)];
  if (leftQualifier && rightQualifier && leftQualifier !== rightQualifier) {
    return false;
  }
  const left = personNameTokens(a);
  const right = personNameTokens(b);
  if (!left.length || !right.length) return false;
  if (jaccard(left.join(" "), right.join(" ")) === 1) return true;
  const last = left[left.length - 1];
  if (last !== right[right.length - 1] || last.length < 3) return false;
  if (left.length === 1 || right.length === 1) return true;
  const [first, other] = [left[0], right[0]];
  return (
    first === other
    || (first.length === 1 && other.startsWith(first))
    || (other.length === 1 && first.startsWith(other))
  );
}

export function artistMentioned(text: string, artist: string): boolean {
  if (mentions(text, artist)) return true;
  const tokens = nameTokens(artist);
  if (tokens.length < 2) return false;
  const last = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1);
  const initials = given.map((token) => token[0]);
  return [
    `${last} ${given.join(" ")}`,
    `${initials.join(" ")} ${last}`,
    `${initials.join("")} ${last}`,
  ].some((variant) => mentions(text, variant));
}
