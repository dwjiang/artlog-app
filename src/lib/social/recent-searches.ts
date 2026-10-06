import { useEffect, useState, useSyncExternalStore } from "react";

import { getSetting, setSetting } from "@/db/repos/settings";
import { anonymousOwner, subscribeOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

import type { PublicProfile } from "./types";

// Kept in the local settings table, so erasing this iPhone's data also forgets them.
const KEY = "search.recent";
const LIMIT = 8;

export type RecentSearch =
  | { kind: "tag"; tag: string }
  | { kind: "person"; profile: PublicProfile }
  | { kind: "artwork"; artwork: { artworkId: string; title: string; thumbnailUrl?: string } }
  | { kind: "artist"; artist: { artistId: string; name: string; coverUrl?: string } };

const identity = (entry: RecentSearch) => {
  switch (entry.kind) {
    case "tag":
      return `tag:${entry.tag}`;
    case "person":
      return `person:${entry.profile.profileId}`;
    case "artwork":
      return `artwork:${entry.artwork.artworkId}`;
    case "artist":
      return `artist:${entry.artist.artistId}`;
  }
};

type History = { installation: string; entries: RecentSearch[] };
// Search and its "See all" screens are mounted together; a save from one reaches the others.
const saved = new Set<(history: History) => void>();

export async function readRecentSearches(): Promise<RecentSearch[]> {
  try {
    const stored: unknown = JSON.parse((await getSetting(KEY)) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch (cause) {
    reportError(cause, "search.recent.read", { level: "warning" });
    return [];
  }
}

/** The artworks, artists, tags and people opened from Search, newest first. */
export function useRecentSearches() {
  const installation = useSyncExternalStore(subscribeOwner, anonymousOwner, anonymousOwner);
  const [history, setHistory] = useState<History>({ installation, entries: [] });
  const recent = history.installation === installation ? history.entries : [];
  useEffect(() => {
    let live = true;
    void readRecentSearches().then((entries) => {
      if (live) setHistory({ installation, entries });
    });
    const listener = (next: History) => {
      if (live && next.installation === installation) setHistory(next);
    };
    saved.add(listener);
    return () => {
      live = false;
      saved.delete(listener);
    };
  }, [installation]);
  const save = (entries: RecentSearch[]) => {
    if (installation !== anonymousOwner()) return;
    for (const listener of saved) listener({ installation, entries });
    setSetting(KEY, JSON.stringify(entries)).catch((cause) =>
      reportError(cause, "search.recent.save", { level: "warning" }),
    );
  };
  const others = (entry: RecentSearch) => recent.filter((row) => identity(row) !== identity(entry));
  return {
    recent,
    remember: (entry: RecentSearch) => save([entry, ...others(entry)].slice(0, LIMIT)),
    forget: (entry: RecentSearch) => save(others(entry)),
  };
}
