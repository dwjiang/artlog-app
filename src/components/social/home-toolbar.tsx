import { Stack, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { isIOS26OrLater } from "@/lib/ios-version";
import { countBadge } from "@/lib/social/unseen-notifications";

export function HomeToolbar({ requests, unseen }: { requests: number; unseen: number }) {
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
  return (
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
