import { useMutation } from "convex/react";
import { useMemo } from "react";
import { Linking } from "react-native";

import { useServerScope } from "@/lib/account/owner-store";
import { isNetworkError } from "@/lib/network-error";
import { reminderDay, reminderTimes } from "@/lib/notifications/exhibition-reminders";
import { offerNotifications } from "@/lib/notifications/offer";
import { notificationPermission } from "@/lib/notifications/permission";
import { getNotificationPreferences } from "@/lib/notifications/preferences";
import { reportError } from "@/lib/observability";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { playToggleHaptic } from "@/lib/ui/haptics";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Exhibition, ExploreMuseum } from "./types";

/** Tells the person what saving earns them: the first reminder's date, or how to turn reminders on. */
async function confirmSave(exhibition: Exhibition) {
  const [next] = reminderTimes(exhibition, Date.now());
  if (!next) return;
  if (!(await getNotificationPreferences()).exhibitionReminders) return;
  const permission = await notificationPermission();
  // The offer's own page explains reminders before iOS asks.
  if (permission === "undetermined") {
    offerNotifications("exhibitionReminders");
    return;
  }
  if (permission === "denied") {
    showToast("Added to Want to see. Turn on notifications to get reminders.", {
      label: "Settings",
      onPress: () => void Linking.openSettings(),
    });
    return;
  }
  const when = next.kind === "opening" ? "when it opens" : "a week before it closes";
  showToast(`Added to Want to see. You’ll get a reminder ${reminderDay(next.at)}, ${when}.`);
}

type SavedList<T> = {
  saved: ReadonlySet<string>;
  ready: boolean;
  error?: Error;
  retry: () => void;
  toggle: (item: T) => void;
};

// Collection sync publishes the account scope only after the guest claim completes.
function useSavedIds(query: typeof api.wantToSee.mine | typeof api.wantToSee.museums) {
  const deviceReady = useDeviceReady();
  const scope = useServerScope();
  return useSocialQuery(query, deviceReady && scope ? {} : "skip", "explore");
}

/** `ids` with `id` moved to the front when saved, or left out when removed. */
const toggled = <T extends string>(ids: T[], id: T, saved: boolean) => {
  const others = ids.filter((other) => other !== id);
  return saved ? [id, ...others] : others;
};

function updateFailed(cause: unknown, retry: () => void) {
  if (!isNetworkError(cause)) reportError(cause, "explore.want_to_see");
  showErrorToast("Couldn’t update Want to see.", retry);
}

/** Shows saved to Want to see, kept with the account or, before sign-in, this iPhone's install. */
export function useWantToSee(): SavedList<Exhibition> {
  const mine = useSavedIds(api.wantToSee.mine);
  const set = useMutation(api.wantToSee.set).withOptimisticUpdate((store, { exhibitionId, saved }) => {
    const current = store.getQuery(api.wantToSee.mine, {});
    if (current) store.setQuery(api.wantToSee.mine, {}, toggled(current, exhibitionId, saved));
  });
  const saved = useMemo(() => new Set<string>(mine.data), [mine.data]);

  async function apply(exhibition: Exhibition, on: boolean) {
    try {
      await set({ exhibitionId: exhibition.id as Id<"exhibitions">, saved: on });
    } catch (cause) {
      updateFailed(cause, () => void apply(exhibition, on));
      return;
    }
    if (on) {
      await confirmSave(exhibition).catch((cause: unknown) =>
        reportError(cause, "explore.want_to_see.confirm", { level: "warning" }),
      );
    }
  }

  return {
    saved,
    ready: mine.data !== undefined,
    error: mine.error,
    retry: mine.refresh,
    toggle: (exhibition) => {
      if (mine.data === undefined) return;
      const on = !saved.has(exhibition.id);
      playToggleHaptic(on);
      void apply(exhibition, on);
    },
  };
}

/** Museums saved to Want to see, kept like saved shows; they have no reminders. */
export function useWantToSeeMuseums(): SavedList<ExploreMuseum> {
  const mine = useSavedIds(api.wantToSee.museums);
  const set = useMutation(api.wantToSee.setMuseum).withOptimisticUpdate((store, { museumId, saved }) => {
    const current = store.getQuery(api.wantToSee.museums, {});
    if (current) store.setQuery(api.wantToSee.museums, {}, toggled(current, museumId, saved));
  });
  const saved = useMemo(() => new Set<string>(mine.data), [mine.data]);

  async function apply(museum: ExploreMuseum, on: boolean) {
    try {
      await set({ museumId: museum.id as Id<"museums">, saved: on });
    } catch (cause) {
      updateFailed(cause, () => void apply(museum, on));
    }
  }

  return {
    saved,
    ready: mine.data !== undefined,
    error: mine.error,
    retry: mine.refresh,
    toggle: (museum) => {
      if (mine.data === undefined) return;
      const on = !saved.has(museum.id);
      playToggleHaptic(on);
      void apply(museum, on);
    },
  };
}
