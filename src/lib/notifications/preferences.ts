import { inArray } from "drizzle-orm";
import { useEffect, useState } from "react";

import { db } from "@/db/client";
import { setSetting } from "@/db/repos/settings";
import { settings } from "@/db/schema";
import { reportError } from "@/lib/observability";

export type NotificationPreference = "friends" | "reactions" | "mentions" | "companions" | "visitReminders";
export type NotificationPreferences = Record<NotificationPreference, boolean>;

const keys: Record<NotificationPreference, string> = {
  friends: "notify-friends",
  reactions: "notify-reactions",
  mentions: "notify-mentions",
  companions: "notify-companions",
  visitReminders: "notify-visit-reminders",
};
const listeners = new Set<() => void>();

/** Every kind starts on; the system permission is the first gate. */
export function readPreferences(rows: readonly { key: string; value: string }[]): NotificationPreferences {
  const off = new Set(rows.filter((row) => row.value === "off").map((row) => row.key));
  return {
    friends: !off.has(keys.friends),
    reactions: !off.has(keys.reactions),
    mentions: !off.has(keys.mentions),
    companions: !off.has(keys.companions),
    visitReminders: !off.has(keys.visitReminders),
  };
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return readPreferences(
    await db
      .select()
      .from(settings)
      .where(inArray(settings.key, Object.values(keys))),
  );
}

export async function setNotificationPreference(preference: NotificationPreference, on: boolean): Promise<void> {
  await setSetting(keys[preference], on ? "on" : "off");
  for (const listener of listeners) listener();
}

export function useNotificationPreferences(): { preferences?: NotificationPreferences; failed: boolean } {
  const [state, setState] = useState<{ preferences?: NotificationPreferences; failed: boolean }>({ failed: false });
  useEffect(() => {
    let latest = 0;
    const load = () => {
      const read = ++latest;
      getNotificationPreferences().then(
        (preferences) => {
          if (read === latest) setState({ preferences, failed: false });
        },
        (cause: unknown) => {
          reportError(cause, "notifications.preferences.load", { level: "warning" });
          if (read === latest) setState((current) => ({ ...current, failed: true }));
        },
      );
    };
    listeners.add(load);
    load();
    return () => {
      latest = -1;
      listeners.delete(load);
    };
  }, []);
  return state;
}
