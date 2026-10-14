import { ConvexError } from "convex/values";

import { isOffensive, isSevere } from "../../shared/social/offensive-text";
import type { Id } from "../_generated/dataModel";
import { env, type QueryCtx } from "../_generated/server";
import { MODERATION_MAX_TOKENS, MODERATION_PROMPT, MODERATION_SCHEMA, parseModeration } from "./labelPrompt";
import { reportBackendError } from "./observability";
import { mentions } from "./textMatch";
import { chatJson } from "./tokenFactory";

export type ModerationResult = {
  flagged: boolean;
  method: "model" | "blocklist";
  calls: number;
};

// Personal-information shapes a wall label never carries; accession numbers and years do not match.
const PII_PATTERNS = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/,
  /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,
  /\b(?:\d{4}[\s-]?){3}\d{4}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
];

export function blocklistTerms(): string[] {
  return (env.MODERATION_BLOCKLIST ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

export function blocklistFlags(text: string): boolean {
  return PII_PATTERNS.some((pattern) => pattern.test(text)) || blocklistTerms().some((term) => mentions(text, term));
}

export async function checkText(values: (string | null | undefined)[]): Promise<ModerationResult> {
  const text = values
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
  if (!text) return { flagged: false, method: "blocklist", calls: 0 };
  const model = env.MODERATION_MODEL;
  if (!model) {
    return { flagged: blocklistFlags(text), method: "blocklist", calls: 0 };
  }
  try {
    const { value, calls } = await chatJson({
      model,
      system: MODERATION_PROMPT,
      user: JSON.stringify({ input: text, schema: MODERATION_SCHEMA }),
      schemaName: "moderation",
      schema: MODERATION_SCHEMA,
      maxTokens: MODERATION_MAX_TOKENS,
      parse: parseModeration,
    });
    return { flagged: value.flagged, method: "model", calls };
  } catch (error) {
    await reportBackendError(error, "moderation.checkText");
    const calls = error instanceof ConvexError && typeof error.data.calls === "number" ? error.data.calls : 0;
    console.warn("Moderation model unavailable; falling back to the blocklist", error);
    return { flagged: blocklistFlags(text), method: "blocklist", calls };
  }
}

const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";
// Past this the word list answers instead, so a slow classifier never holds up a post.
const OPENAI_TIMEOUT_MS = 3_000;
// Shorter titles would swap out ordinary words.
const MIN_RECORD_TITLE_LENGTH = 3;

/**
 * Which texts must not be shared. Slurs and the strongest swearing always fail, because OpenAI passes swearing that
 * isn't aimed at anyone. OpenAI's classifier reads the rest in context, and the full word list answers when it can't.
 * Titles of the linked museum or community records become "the artwork" first, so a work named "Bitch" can be discussed.
 */
export async function flaggedUserTexts(texts: string[], recordTitles: string[]): Promise<boolean[]> {
  const inputs = texts.map((text) => withoutTitles(text, recordTitles).trim());
  const asked = inputs.filter((input) => input && !isSevere(input));
  const verdicts = asked.length > 0 ? await openAiVerdicts(asked) : undefined;
  let next = 0;
  return inputs.map((input) => !!input && (isSevere(input) || (verdicts?.[next++] ?? isOffensive(input))));
}

export async function safetyChecksOn(ctx: QueryCtx, accountId: Id<"accounts">): Promise<boolean> {
  return (await ctx.db.get("accounts", accountId))?.safetyChecks === true;
}

/** Text someone writes for others reaches OpenAI only after they turn on safety checks; until then it can't be posted. */
export async function requireSafetyChecks(ctx: QueryCtx, accountId: Id<"accounts">) {
  if (!(await safetyChecksOn(ctx, accountId))) throw new ConvexError({ code: "safety_checks_off" });
}

export async function requireAllowedBio(bio: string | undefined, safetyChecks: boolean) {
  if (!bio?.trim()) return;
  if (!safetyChecks) throw new ConvexError({ code: "safety_checks_off" });
  const [flagged] = await flaggedUserTexts([bio], []);
  if (flagged) throw new ConvexError({ code: "profile_not_allowed" });
}

function withoutTitles(text: string, titles: string[]): string {
  let result = text;
  const swappable = titles.map((title) => title.trim()).filter((title) => title.length >= MIN_RECORD_TITLE_LENGTH);
  for (const title of swappable.sort((a, b) => b.length - a.length)) {
    const escaped = title.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replaceAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), "the artwork");
  }
  return result;
}

async function openAiVerdicts(inputs: string[]): Promise<boolean[] | undefined> {
  if (!env.OPENAI_API_KEY) return undefined;
  try {
    const response = await fetch(OPENAI_MODERATION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input: inputs }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenAI moderation answered ${response.status}`);
    const { results } = (await response.json()) as { results?: unknown };
    if (!Array.isArray(results) || results.length !== inputs.length) {
      throw new Error("OpenAI moderation answered an unexpected shape");
    }
    return results.map((result) => {
      if (typeof result?.flagged !== "boolean") throw new Error("OpenAI moderation answered an unexpected shape");
      return result.flagged;
    });
  } catch (error) {
    console.warn("OpenAI moderation unavailable; falling back to the word list", error);
    if (!(error instanceof Error && error.name === "TimeoutError")) {
      await reportBackendError(error, "moderation.flaggedUserTexts");
    }
    return undefined;
  }
}
