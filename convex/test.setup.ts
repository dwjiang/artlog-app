import { afterEach, vi } from "vitest";

import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { SearchRecord } from "./lib/pinecone";
import { searchVectorIndex } from "./lib/vectorSearch";

vi.mock("./lib/vectorSearch", () => ({
  searchVectorIndex: vi.fn(async (ctx: ActionCtx, vector: number[], partition: string, limit: number) => {
    const matches: { id: string; score: number }[] = [];
    let cursor: string | null = null;
    do {
      const page: { records: SearchRecord[]; cursor: string | null } = await ctx.runAction(
        internal.vectorSync.exportPage,
        { cursor },
      );
      for (const row of page.records) {
        if (row.metadata.partition !== partition) continue;
        const dot = vector.reduce((sum, value, i) => sum + value * row.values[i], 0);
        const norm = Math.sqrt(
          vector.reduce((sum, value) => sum + value * value, 0)
            * row.values.reduce((sum, value) => sum + value * value, 0),
        );
        matches.push({ id: row.id, score: dot / norm });
      }
      cursor = page.cursor;
    } while (cursor !== null);
    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }),
}));

afterEach(() => vi.mocked(searchVectorIndex).mockReset());
