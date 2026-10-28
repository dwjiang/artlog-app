import { Stack, useRouter } from "expo-router";
import { useVerticalBarEdgeIOS } from "expo-status-bar";
import { StyleSheet, View } from "react-native";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { isIOS26OrLater } from "@/lib/ios-version";
import { isJudgesDemo } from "@/lib/judges-demo";
import { countBadge } from "@/lib/social/unseen-notifications";

export type Feed = "friends" | "global";

const FEED_LABELS: Record<Feed, string> = { friends: "Friends", global: "Global" };
const FEED_ICONS = { friends: "person.2", global: "globe" } as const satisfies Record<Feed, string>;

type HomeToolbarProps = {
  requests: number;
  unseen: number;
  /** Unset while the landing feed is still being decided, which hides the switch. */
  feed: Feed | undefined;
  onFeedChange: (feed: Feed) => void;
};

export function HomeToolbar({ requests, unseen, feed, onFeedChange }: HomeToolbarProps) {
  const router = useRouter();
  const requestsBadge = countBadge(requests);
  const unseenBadge = countBadge(unseen);
  const actions = [
    { icon: "trophy", label: "Leaderboards", href: "/leaderboards", badge: undefined },
    {
      icon: "person.badge.plus",
      label: requestsBadge ? `Find Friends, ${requests} ${requests === 1 ? "request" : "requests"}` : "Find Friends",
      href: "/people",
      badge: requestsBadge,
    },
    {
      icon: "bell",
      label: unseenBadge ? `Notifications, ${unseenBadge} new` : "Notifications",
      href: "/notifications",
      badge: unseenBadge,
    },
  ] as const;
  const shownFeed = feed ?? "friends";
  const feedLabel = FEED_LABELS[shownFeed];
  // Side bars (iPhone Duo) show symbols only; a title-only item would stay behind in a horizontal bar over the content.
  // UIKit draws only the symbol when an item has both, so horizontal bars keep the word.
  const sideBars = useVerticalBarEdgeIOS() !== null;
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Menu
          hidden={!feed || isJudgesDemo()}
          icon={sideBars ? FEED_ICONS[shownFeed] : undefined}
          accessibilityLabel={`${feedLabel} feed`}
          tintColor={Gallery.ink}
        >
          <Stack.Toolbar.Label>{feedLabel}</Stack.Toolbar.Label>
          <Stack.Toolbar.MenuAction
            icon={FEED_ICONS.friends}
            isOn={feed === "friends"}
            onPress={() => onFeedChange("friends")}
          >
            {FEED_LABELS.friends}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon={FEED_ICONS.global}
            isOn={feed === "global"}
            onPress={() => onFeedChange("global")}
          >
            {FEED_LABELS.global}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {actions.map(({ icon, label, href, badge }) =>
          isIOS26OrLater() ? (
            <Stack.Toolbar.Button
              key={href}
              icon={icon}
              accessibilityLabel={label}
              tintColor={Gallery.ink}
              onPress={() => router.push(href)}
            >
              {badge && <Stack.Toolbar.Badge>{badge}</Stack.Toolbar.Badge>}
            </Stack.Toolbar.Button>
          ) : (
            // UIKit bar-item badges require iOS 26, so older bars host the same actions with visible counts.
            <Stack.Toolbar.View key={href}>
              <View style={styles.button}>
                <GalleryIconButton icon={icon} label={label} onPress={() => router.push(href)} />
                {badge && (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    pointerEvents="none"
                    style={styles.badge}
                  >
                    <Text allowFontScaling={false} style={styles.count}>
                      {badge}
                    </Text>
                  </View>
                )}
              </View>
            </Stack.Toolbar.View>
          ),
        )}
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44 },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: Gallery.badge,
    alignItems: "center",
    justifyContent: "center",
  },
  count: { color: Gallery.paper, fontSize: 11, lineHeight: 14, fontWeight: "600" },
});
