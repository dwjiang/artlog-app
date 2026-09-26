import type { ActionCtx } from "../_generated/server";
import { queryPinecone, type SearchMatch } from "./pinecone";

export async function searchVectorIndex(
  _ctx: ActionCtx,
  vector: number[],
  partition: string,
  limit: number,
): Promise<SearchMatch[]> {
  const matches = await queryPinecone(vector, partition, limit);
  return matches.filter((match) => match.id.endsWith(`:${partition}`));
}
