import { ConvexHttpClient } from "convex/browser";
import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useRef, useState } from "react";

import { captureOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import type { Suggestion } from "./types";
import { useSocialQuery } from "./use-social-query";
import type { SocialSession } from "./use-social-session";

/** People to suggest and the viewer's friend count; a hidden person leaves the list before the server confirms. */
export function useSuggestions(session: SocialSession) {
  const query = useSocialQuery(
    api.suggestions.list,
    session.status === "ready" && !session.offline ? {} : "skip",
    session.key,
  );
  const [hidden, setHidden] = useState<{ key: string; ids: readonly string[] }>({ key: session.key, ids: [] });
  const currentHidden = hidden.key === session.key ? hidden : { key: session.key, ids: [] };
  if (hidden.key !== session.key) setHidden(currentHidden);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    const pending = requests.current;
    return () => {
      for (const controller of pending) controller.abort();
      pending.clear();
    };
  }, [session.key]);

  async function change(person: Suggestion, action: "dismiss" | "restore", owner = captureOwner()) {
    if (session.status !== "ready" || session.offline || !session.token || !owner.isCurrent()) return;
    const { profileId } = person.profile;
    const updateHidden = (hide: boolean) =>
      setHidden((previous) =>
        previous.key === session.key
          ? {
              key: session.key,
              ids: hide ? [...previous.ids, profileId] : previous.ids.filter((id) => id !== profileId),
            }
          : previous,
      );
    const controller = new AbortController();
    requests.current.add(controller);
    const current = () => owner.isCurrent() && !controller.signal.aborted;
    // Bind each write and its Undo/Retry to the initiating account, including after a reconnect.
    const client = new ConvexHttpClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
      auth: session.token,
      logger: false,
      fetch: (input, options) => expoFetch(input, { ...options, signal: controller.signal }),
    });
    if (action === "dismiss") updateHidden(true);
    try {
      await client.mutation(api.suggestions[action], { profileId }, { skipQueue: true });
      if (!current()) return;
      if (action === "restore") updateHidden(false);
      else showToast("Suggestion hidden.", { label: "Undo", onPress: () => void change(person, "restore", owner) });
    } catch (cause) {
      if (!current()) return;
      reportError(cause, `suggestions.${action}`);
      if (action === "dismiss") updateHidden(false);
      showErrorToast(
        socialErrorMessage(cause)
          ?? (action === "dismiss" ? "Couldn’t hide this suggestion." : "Couldn’t restore this suggestion."),
        () => void change(person, action, owner),
      );
    } finally {
      requests.current.delete(controller);
    }
  }
  return {
    people: query.data?.people.filter((person) => !currentHidden.ids.includes(person.profile.profileId)) ?? [],
    friendCount: query.data?.friendCount,
    loading: query.loading,
    error: query.error,
    refresh: query.refresh,
    dismiss: (person: Suggestion) => void change(person, "dismiss"),
  };
}
