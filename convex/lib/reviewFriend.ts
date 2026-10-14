import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The App Review test friend accepts every request at once (docs/social-and-journal.md). No sign-in reaches it:
// real Apple subjects never start with this prefix.
const REVIEW_PREFIX = "review:";
export const reviewProviderUserId = (username: string) => `${REVIEW_PREFIX}${username}`;

export async function isReviewFriend(ctx: QueryCtx, profile: Pick<Doc<"profiles">, "accountId">) {
  const account = await ctx.db.get("accounts", profile.accountId);
  return account?.provider === "apple" && account.providerUserId.startsWith(REVIEW_PREFIX);
}
