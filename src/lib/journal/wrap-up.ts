import { and, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect } from "react";

import { db } from "@/db/client";
import { setSetting } from "@/db/repos/settings";
import { settings } from "@/db/schema";
import { reportError } from "@/lib/observability";

/** One pending review per owner; a newer closed visit replaces an older unreviewed one. */
const wrapUpKey = (owner: string) => `wrapUpVisit:${owner}`;

export async function markWrapUp(owner: string, localId: string): Promise<void> {
  await setSetting(wrapUpKey(owner), localId);
}

export async function clearWrapUp(owner: string, localId: string): Promise<void> {
  db.delete(settings)
    .where(and(eq(settings.key, wrapUpKey(owner)), eq(settings.value, localId)))
    .run();
}

export function usePendingWrapUp(owner: string): string | undefined {
  const key = wrapUpKey(owner);
  const { data, error } = useLiveQuery(db.select().from(settings).where(eq(settings.key, key)), [key]);
  useEffect(() => {
    if (error) reportError(error, "visit.wrap-up.load", { level: "warning" });
  }, [error]);
  return data.find((row) => row.key === key)?.value;
}
