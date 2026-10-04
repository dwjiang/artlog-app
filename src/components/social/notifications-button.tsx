import type { FunctionReturnType } from "convex/server";
import { setBadgeCountAsync } from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import { useCursorPages } from "@/lib/social/use-social-query";
import type { SocialSession } from "@/lib/social/use-social-session";
import { groupNotifications } from "@/shared/social/notifications";

import { api } from "../../../convex/_generated/api";

type UnseenPage = FunctionReturnType<typeof api.notifications.unseen>;
const unseenPage = (result: UnseenPage) => result;
const notificationId = (item: UnseenPage["page"][number]) => item.id;

/** Shown to everyone so the masthead keeps its layout; the page itself asks guests to sign in. */
export function NotificationsButton({ session }: { session: SocialSession }) {
  const router = useRouter();
  const { items, canLoadMore, loadMore } = useCursorPages(
    api.notifications.unseen,
    session.status === "ready" ? {} : "skip",
    session.key,
    unseenPage,
    notificationId,
  );
  const unseen = groupNotifications(items).length;
  useEffect(() => {
    if (unseen < 100 && canLoadMore) loadMore();
  }, [unseen, canLoadMore, loadMore]);
  // Pushes set the icon badge to the server's unseen count; while Artlog runs, the badge follows this bell.
  useEffect(() => {
    setBadgeCountAsync(unseen).catch((cause: unknown) =>
      reportError(cause, "notifications.badge", { level: "warning" }),
    );
  }, [unseen]);
  return (
    <View>
      <GalleryIconButton
        icon="bell"
        label={unseen > 0 ? `Notifications, ${unseen > 99 ? "99+" : unseen} new` : "Notifications"}
        onPress={() => router.push("/notifications")}
      />
      {unseen > 0 && (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.badge}>
          <Text allowFontScaling={false} style={styles.count}>
            {unseen > 99 ? "99+" : unseen}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 3,
    right: 1,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Gallery.paper,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  count: { color: Gallery.paper, fontSize: 11, lineHeight: 14, fontWeight: "600" },
});
