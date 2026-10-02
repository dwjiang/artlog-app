import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import { captureOwner, subscribeOwner } from "@/lib/account/owner-store";
import { convexErrorCode, isNetworkError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";

import { api } from "../../../convex/_generated/api";
import { relationshipClient } from "./relationship-client";
import type { PublicProfile } from "./types";
import type { SocialSession } from "./use-social-session";

type Person = Pick<PublicProfile, "profileId" | "name">;
type Change = { action: "block" } | { action: "unblock"; blockRevision: number };

/** Confirms, then blocks or unblocks someone; screens update from their live queries once the change lands. */
export function useBlock(session: SocialSession) {
  const [pending, setPending] = useState<Person["profileId"]>();
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const cancel = () => {
      request.current?.abort();
      request.current = null;
    };
    const unsubscribe = subscribeOwner(() => {
      cancel();
      setPending(undefined);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      cancel();
    };
  }, []);

  async function run(change: Change, person: Person, owner: ReturnType<typeof captureOwner>) {
    if (
      !mounted.current
      || !owner.isCurrent()
      || !owner.scope
      || request.current
      || session.status !== "ready"
      || !session.token
    ) {
      return;
    }
    const { action } = change;
    const controller = new AbortController();
    request.current = controller;
    const current = () => owner.isCurrent() && !controller.signal.aborted;
    setPending(person.profileId);
    try {
      const client = relationshipClient(session.token, controller.signal);
      const input = { profileId: person.profileId, scope: owner.scope };
      if (change.action === "unblock") {
        await client.mutation(
          api.friendships.unblock,
          { ...input, blockRevision: change.blockRevision },
          { skipQueue: true },
        );
      } else {
        await client.mutation(api.friendships.block, input, { skipQueue: true });
      }
      if (current()) showToast(`${action === "block" ? "Blocked" : "Unblocked"} ${person.name}.`);
    } catch (cause) {
      if (!current()) return;
      if (!isNetworkError(cause)) reportError(cause, `friendship.${action}`);
      if (convexErrorCode(cause) === "conflict") {
        showErrorToast("This block changed. Review its current status before trying again.");
      } else {
        showErrorToast(`Couldn’t ${action} ${person.name}.`, () => void run(change, person, owner));
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(undefined);
      }
    }
  }

  function confirm(change: Change, person: Person) {
    if (!mounted.current || request.current || session.status !== "ready" || !session.token) return;
    const { action } = change;
    const owner = captureOwner();
    const label = action === "block" ? "Block" : "Unblock";
    Alert.alert(
      `${label} ${person.name}?`,
      action === "block"
        ? "You’ll stop seeing each other’s walls, visits, and comments, and you’ll no longer be friends. Artlog won’t tell them, but we’ll review their profile."
        : "You’ll see each other’s walls and visits again. Your friendship won’t be restored.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: label,
          style: action === "block" ? "destructive" : "default",
          onPress: () => void run(change, person, owner),
        },
      ],
    );
  }

  return {
    pending,
    block: (person: Person) => confirm({ action: "block" }, person),
    unblock: (person: Person, blockRevision: number) => confirm({ action: "unblock", blockRevision }, person),
  };
}
