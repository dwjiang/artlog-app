import { ConvexError } from "convex/values";

import { env } from "../_generated/server";
import { validateVector } from "./modelVersion";

export const PINECONE_NAMESPACE = "recognition";
export type SearchMatch = { id: string; score: number };
export type SearchRecord = { id: string; values: number[]; metadata: { partition: string } };
export type SearchMeasurement = {
  elapsedMs: number;
  responseBytes: number;
  readUnits: number | null;
  egressBytes: number | null;
};

export function pineconeHost(): string {
  const host = env.PINECONE_INDEX_HOST?.replace(/^https:\/\//, "");
  if (!env.PINECONE_API_KEY || !host || !/^[a-z0-9.-]+\.pinecone\.io$/.test(host)) {
    throw new ConvexError({ code: "search_unconfigured" });
  }
  return host;
}

async function request(
  path: string,
  body?: object,
  observe?: (measurement: SearchMeasurement) => void,
): Promise<Record<string, unknown>> {
  const host = pineconeHost();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const started = performance.now();
  try {
    const response = await fetch(`https://${host}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Api-Key": env.PINECONE_API_KEY!,
        "Content-Type": "application/json",
        "X-Pinecone-Api-Version": "2025-10",
      },
      body: body ? JSON.stringify({ namespace: PINECONE_NAMESPACE, ...body }) : undefined,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new ConvexError({ code: "search_error", reason: `http_${response.status}` });
    const responseText = observe ? await response.text() : undefined;
    const data: unknown = responseText === undefined ? await response.json() : JSON.parse(responseText);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ConvexError({ code: "search_error", reason: "bad_response" });
    }
    const result = data as Record<string, unknown>;
    if (observe) {
      const usage = result.usage as { readUnits?: unknown; egressBytes?: unknown } | undefined;
      const readUnits = usage?.readUnits;
      const egressBytes = usage?.egressBytes;
      observe({
        elapsedMs: performance.now() - started,
        responseBytes: new TextEncoder().encode(responseText).byteLength,
        readUnits: typeof readUnits === "number" && Number.isFinite(readUnits) && readUnits >= 0 ? readUnits : null,
        egressBytes:
          typeof egressBytes === "number" && Number.isFinite(egressBytes) && egressBytes >= 0 ? egressBytes : null,
      });
    }
    return result;
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError({
      code: "search_error",
      reason: controller.signal.aborted ? "timeout" : error instanceof SyntaxError ? "bad_response" : "network",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function queryPinecone(
  vector: number[],
  partition: string,
  limit: number,
  observe?: (measurement: SearchMeasurement) => void,
): Promise<SearchMatch[]> {
  validateVector(vector);
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new ConvexError({ code: "bad_candidates" });
  const data = await request(
    "/query",
    {
      vector,
      topK: limit,
      filter: { partition: { $eq: partition } },
      includeValues: false,
      includeMetadata: false,
    },
    observe,
  );
  if (!Array.isArray(data.matches) || data.matches.length > limit) {
    throw new ConvexError({ code: "search_error", reason: "bad_response" });
  }
  return data.matches.map((match: unknown) => {
    if (
      !match
      || typeof match !== "object"
      || !("id" in match)
      || !("score" in match)
      || typeof match.id !== "string"
      || typeof match.score !== "number"
      || !Number.isFinite(match.score)
      || Math.abs(match.score) > 1.00001
    ) {
      throw new ConvexError({ code: "search_error", reason: "bad_response" });
    }
    return { id: match.id, score: Math.max(-1, Math.min(1, match.score)) };
  });
}

export async function upsertPinecone(vectors: SearchRecord[]): Promise<void> {
  if (vectors.length === 0) return;
  for (const record of vectors) validateVector(record.values);
  const data = await request("/vectors/upsert", { vectors });
  if (data.upsertedCount !== vectors.length) throw new ConvexError({ code: "search_error", reason: "bad_response" });
}

export async function deletePinecone(ids: string[]): Promise<void> {
  if (ids.length > 0) await request("/vectors/delete", { ids });
}

export async function verifyPinecone(records: SearchRecord[]): Promise<boolean> {
  for (let start = 0; start < records.length; start += 16) {
    const batch = records.slice(start, start + 16);
    const params = new URLSearchParams({ namespace: PINECONE_NAMESPACE });
    for (const record of batch) params.append("ids", record.id);
    const data = await request(`/vectors/fetch?${params}`);
    if (!data.vectors || typeof data.vectors !== "object") return false;
    const vectors = data.vectors as Record<string, SearchRecord>;
    for (const record of batch) {
      const found = vectors[record.id];
      if (
        !found
        || found.metadata?.partition !== record.metadata.partition
        || !Array.isArray(found.values)
        || found.values.length !== record.values.length
        || found.values.some((value, i) => Math.fround(value) !== Math.fround(record.values[i]))
      ) {
        return false;
      }
    }
  }
  return true;
}
