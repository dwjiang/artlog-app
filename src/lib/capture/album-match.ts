import type { IdentifyResponse } from "./stages";
export function albumMatch(
  response: Pick<IdentifyResponse, "outcome" | "best"> | undefined,
  targetObjectId?: string,
): "same" | "conflict" | "uncertain" {
  if (!targetObjectId || response?.outcome !== "confident" || !response.best) return "uncertain";
  return response.best.objectId === targetObjectId ? "same" : "conflict";
}
