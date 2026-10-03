import { useEffect, useRef, useState } from "react";

import { captureOwner } from "@/lib/account/owner-store";
import { convexErrorCode } from "@/lib/network-error";
import { offerNotifications } from "@/lib/notifications/offer";
import { reportError } from "@/lib/observability";
import { showToast } from "@/lib/ui/toast";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { relationshipClient } from "./relationship-client";
import type { FriendshipAction, Relationship } from "./types";
import { useSocialQuery } from "./use-social-query";
import type { SocialSession } from "./use-social-session";

/** A relationship the caller already holds (a browse page embeds one per row), so no per-person subscription opens. */
export type RelationshipSource = { data: Relationship; refresh: () => void };

export function useFriendship(profileId: Id<"profiles">, session: SocialSession, source?: RelationshipSource) {
  const enabled = session.status === "ready" && profileId !== session.profileId;
  const own = useSocialQuery(api.friendships.getState, enabled && !source ? { profileId } : "skip", session.key);
  const query = source ? { ...source, error: undefined } : own;
  const [confirmed, setConfirmed] = useState<Relationship>();
  const [pending, setPending] = useState<FriendshipAction>();
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [profileId, session.key],
  );
  const state =
    !enabled || query.error || !query.data
      ? undefined
      : confirmed && confirmed.revision > query.data.revision && confirmed.blockRevision >= query.data.blockRevision
        ? confirmed
        : query.data;

  async function act(action: FriendshipAction) {
    if (!enabled || !state || !session.token || request.current) return;
    const owner = captureOwner();
    const controller = new AbortController();
    request.current = controller;
    const current = () => owner.isCurrent() && !controller.signal.aborted;
    const client = relationshipClient(session.token, controller.signal);
    setPending(action);
    setError(undefined);
    try {
      const result = await client.mutation(
        api.friendships[action],
        { profileId, revision: state.revision },
        { skipQueue: true },
      );
      if (current()) {
        setConfirmed(result);
        if (action === "accept") showToast("You’re now friends.");
        if (action === "request") offerNotifications();
        return true;
      }
    } catch (cause) {
      if (!current()) return;
      reportError(cause, `friendship.${action}`);
      if (convexErrorCode(cause) === "conflict" || convexErrorCode(cause) === "invalid_relationship") {
        setConfirmed(undefined);
        setError("This friendship changed. Review the updated options and try again.");
        query.refresh();
      } else {
        setError(socialErrorMessage(cause) ?? "Couldn’t update this friendship. Check your connection and try again.");
      }
    } finally {
      if (current()) {
        request.current = null;
        setPending(undefined);
      }
    }
  }

  return {
    state,
    pending,
    error: error ?? (query.error ? (socialErrorMessage(query.error) ?? "Couldn’t load this friendship.") : undefined),
    act,
    refresh: () => {
      setError(undefined);
      setConfirmed(undefined);
      query.refresh();
    },
  };
}
