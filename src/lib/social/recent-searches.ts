import { useEffect, useState, useSyncExternalStore } from "react";

import { getSetting, setSetting } from "@/db/repos/settings";
import { anonymousOwner, subscribeOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

import type { PublicProfile } from "./types";

// Kept in the local settings table, so erasing this iPhone's data also forgets them.
const KEY = "search.recent";
const LIMIT = 8;

export type RecentSearch = { kind: "tag"; tag: string } | { kind: "person"; profile: PublicProfile };

const identity = (entry: RecentSearch) =>
  entry.kind === "tag" ? `tag:${entry.tag}` : `person:${entry.profile.profileId}`;

export async function readRecentSearches(): Promise<RecentSearch[]> {
  try {
    const stored: unknown = JSON.parse((await getSetting(KEY)) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch (cause) {
    reportError(cause, "search.recent.read", { level: "warning" });
    return [];
  }
}

/** The tags and people opened from Search, newest first. */
export function useRecentSearches() {
  const installation = useSyncExternalStore(subscribeOwner, anonymousOwner, anonymousOwner);
  const [history, setHistory] = useState<{ installation: string; entries: RecentSearch[] }>({
    installation,
    entries: [],
  });
  const recent = history.installation === installation ? history.entries : [];
  useEffect(() => {
    let live = true;
    void readRecentSearches().then((entries) => {
      if (live) setHistory({ installation, entries });
    });
    return () => {
      live = false;
    };
  }, [installation]);
  return {
    recent,
    remember: (entry: RecentSearch) => {
      if (installation !== anonymousOwner()) return;
      const next = [entry, ...recent.filter((row) => identity(row) !== identity(entry))].slice(0, LIMIT);
      setHistory({ installation, entries: next });
      setSetting(KEY, JSON.stringify(next)).catch((cause) =>
        reportError(cause, "search.recent.save", { level: "warning" }),
      );
    },
  };
}
