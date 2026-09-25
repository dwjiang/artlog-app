import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export function normalizeAccession(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replaceAll(/\s+/g, " ");
}

export async function museumIdentityKeys(input: { accession?: string; pageUrl?: string; names?: string }) {
  const identities: string[] = [];
  const accession = input.accession && normalizeAccession(input.accession);
  if (accession) identities.push(`accession:${accession}`);
  if (input.pageUrl) {
    const url = new URL(input.pageUrl);
    url.hash = "";
    url.searchParams.sort();
    identities.push(`page:${url.href}`);
  }
  // A museum identifier distinguishes identically named works at the same venue.
  if (identities.length === 0 && input.names) {
    identities.push(`names:${input.names}`);
  }
  return Promise.all(
    identities.map(async (identity) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
      return {
        key: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
        specific: !identity.startsWith("names:"),
      };
    }),
  );
}

export async function registerMuseumObject(
  ctx: MutationCtx,
  object: Pick<Doc<"objects">, "ownerId" | "artworkId" | "accession" | "pageUrl">,
): Promise<void> {
  const venueId = object.ownerId;
  if (!venueId) return;
  for (const { key } of await museumIdentityKeys(object)) {
    const existing = await ctx.db
      .query("museumWorkIdentities")
      .withIndex("by_venue_identity", (q) => q.eq("venueId", venueId).eq("identity", key))
      .unique();
    if (!existing) {
      await ctx.db.insert("museumWorkIdentities", {
        venueId,
        identity: key,
        artworkId: object.artworkId,
      });
    } else if (existing.artworkId !== object.artworkId) {
      await ctx.db.patch("museumWorkIdentities", existing._id, { artworkId: object.artworkId });
    }
  }
}
