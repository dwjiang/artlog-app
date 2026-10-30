const models = new Set([
  "nvidia/Nemotron-3.5-Super-VL",
  "nvidia/Nemotron-3_5-Lightning",
  "nvidia/Nemotron-3-Ultra-550b-a55b",
]);
const stages = new Set(["fetch", "http", "response", "completion", "json", "schema"]);
const finishReasons = new Set(["stop", "length", "content_filter", "tool_calls", "function_call"]);
const numericLimits: Record<string, number> = {
  calls: 2,
  maxTokens: 10_000_000,
  promptTokens: 10_000_000,
  completionTokens: 10_000_000,
  elapsedMs: 3_600_000,
  timeoutMs: 3_600_000,
  inputChars: 100_000_000,
  outputChars: 10_000_000,
};

// Re-allowlist at both collection and transmission; never serialize provider objects or prompts.
export function tokenFactoryDiagnostics(value: unknown): Record<string, string | number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const source = value as Record<string, unknown>;
  const result: Record<string, string | number> = { version: 1 };
  if (typeof source.model === "string") result.model = models.has(source.model) ? source.model : "other";
  if (typeof source.stage === "string" && stages.has(source.stage)) result.stage = source.stage;
  if (typeof source.finishReason === "string" && finishReasons.has(source.finishReason)) {
    result.finishReason = source.finishReason;
  }
  for (const [key, maximum] of Object.entries(numericLimits)) {
    const number = source[key];
    if (typeof number === "number" && Number.isSafeInteger(number) && number >= 0 && number <= maximum) {
      result[key] = number;
    }
  }
  return result;
}
