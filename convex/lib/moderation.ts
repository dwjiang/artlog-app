import { ConvexError } from "convex/values";

import { env } from "../_generated/server";
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
