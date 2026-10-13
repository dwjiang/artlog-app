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
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Exhibition } from "./types";

/** Tells the person what saving earns them: the first reminder's date, or how to turn reminders on. */
async function confirmSave(exhibition: Exhibition) {
  const [next] = reminderTimes(exhibition, Date.now());
  if (!next) return;
  if (!(await getNotificationPreferences()).exhibitionReminders) return;
  const permission = await notificationPermission();
  // The offer's own page explains reminders before iOS asks.
  if (permission === "undetermined") {
    offerNotifications();
    return;
  }
  if (permission === "denied") {
    showToast("Saved. Turn on notifications to get reminders.", {
      label: "Settings",
      onPress: () => void Linking.openSettings(),
    });
    return;
  }
  const when = next.kind === "opening" ? "when it opens" : "a week before it closes";
  showToast(`Saved. You’ll get a reminder ${reminderDay(next.at)}, ${when}.`);
}

/** Shows saved to Want to see, kept with the account or, before sign-in, this iPhone's install. */
export function useWantToSee(): {
  saved: ReadonlySet<string>;
  ready: boolean;
  error?: Error;
  retry: () => void;
  toggle: (exhibition: Exhibition) => void;
} {
  const deviceReady = useDeviceReady();
  // Collection sync publishes the account scope only after the guest claim completes.
  const scope = useServerScope();
  const mine = useSocialQuery(api.wantToSee.mine, deviceReady && scope ? {} : "skip", "explore");
  const set = useMutation(api.wantToSee.set).withOptimisticUpdate((store, { exhibitionId, saved }) => {
    const current = store.getQuery(api.wantToSee.mine, {});
    if (!current) return;
    const others = current.filter((id) => id !== exhibitionId);
    store.setQuery(api.wantToSee.mine, {}, saved ? [exhibitionId, ...others] : others);
  });
  const saved = useMemo(() => new Set<string>(mine.data), [mine.data]);

  async function apply(exhibition: Exhibition, on: boolean) {
    try {
      await set({ exhibitionId: exhibition.id as Id<"exhibitions">, saved: on });
    } catch (cause) {
      if (!isNetworkError(cause)) reportError(cause, "explore.want_to_see");
      showErrorToast("Couldn’t update Want to see.", () => void apply(exhibition, on));
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
      if (mine.data !== undefined) void apply(exhibition, !saved.has(exhibition.id));
    },
  };
}
