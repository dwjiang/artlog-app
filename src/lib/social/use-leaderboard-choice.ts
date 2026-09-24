import { reportError } from "@/lib/observability";
import { useEffect, useRef, useState } from "react";
import { getSetting, setSetting } from "@/db/repos/settings";

export type LeaderboardChoice = {
  audience: "friends" | "global";
  metric: "visits" | "artworks";
  period: "month" | "all";
};
const DEFAULT_CHOICE: LeaderboardChoice = {
  audience: "friends",
  metric: "visits",
  period: "month",
};
const KEY = "leaderboard-choice";

function readChoice(value: string | undefined): LeaderboardChoice {
  if (!value) return DEFAULT_CHOICE;
  try {
    const choice = JSON.parse(value);
    return {
      audience: choice?.audience === "global" ? "global" : "friends",
      metric: choice?.metric === "artworks" ? "artworks" : "visits",
      period: choice?.period === "all" ? "all" : "month",
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function useLeaderboardChoice() {
  const [choice, setChoice] = useState<LeaderboardChoice>(DEFAULT_CHOICE);
  const [error, setError] = useState<string>();
  const changed = useRef(false),
    latest = useRef(choice),
    writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void getSetting(KEY)
      .then((value) => {
        if (active && !changed.current) {
          latest.current = readChoice(value);
          setChoice(latest.current);
        }
      })
      .catch((cause) => {
        reportError(cause, "leaderboard.filters.load");
        if (active) setError("Your saved filters could not load.");
      });
    return () => {
      active = false;
    };
  }, []);
  function changeChoice(update: Partial<LeaderboardChoice>) {
    changed.current = true;
    const next = { ...latest.current, ...update };
    latest.current = next;
    setChoice(next);
    setError(undefined);
    writes.current = writes.current
      .then(() => setSetting(KEY, JSON.stringify(next)))
      .catch((cause) => {
        reportError(cause, "leaderboard.filters.save");
        setError("These filters could not be remembered. Your current selection still works.");
      });
  }
  return { choice, changeChoice, error };
}
