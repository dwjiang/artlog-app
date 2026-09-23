import { eq, like } from "drizzle-orm";

import { db } from "../client";
import { settings } from "../schema";

export async function getSetting(key: string): Promise<string | undefined> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value;
}

export async function listSettings(prefix: string): Promise<{ key: string; value: string }[]> {
  const rows = await db
    .select()
    .from(settings)
    .where(like(settings.key, `${prefix}%`));
  return rows.filter((row) => row.key.startsWith(prefix));
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function removeSetting(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}
