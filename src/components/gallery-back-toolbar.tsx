import { Image } from "expo-image";
import { router, Stack, useNavigation } from "expo-router";
import { useState } from "react";
import { Pressable } from "react-native";
import { Gallery } from "@/constants/theme";
import { ThemedText } from "./themed-text";

type RouteState = {
  index?: number;
  routes: { name: string; state?: RouteState }[];
};

// Screens with an in-content title leave the header title blank, so the back button cannot inherit it.
const ROUTE_LABELS: Record<string, string> = {
  "(home)": "Home",
  "(scan)": "Scan",
  "(collection)": "Collection",
  "visit-place": "Visits",
  "saved/[savedId]": "Artwork",
  "journal/[visitId]": "Visit",
  "visit/[postId]": "Visit",
  "result/[scanId]": "Result",
  leaderboards: "Leaderboards",
  people: "Friends",
  "profile/[profileId]": "Profile",
  settings: "Settings",
  widgets: "Widgets",
  "all-artworks": "All artworks",
};

const focused = (state: RouteState) =>
  state.routes[state.index ?? state.routes.length - 1];

/** Names the deepest known screen under the focused one; a tab resolves to the screen it currently shows. */
export function previousScreenLabel(
  state: RouteState | undefined,
): string | undefined {
  if (!state) return undefined;
  let route: RouteState["routes"][number] | undefined =
    state.routes[(state.index ?? state.routes.length - 1) - 1];
  let label: string | undefined;
  while (route) {
    label = ROUTE_LABELS[route.name] ?? label;
    route = route.state ? focused(route.state) : undefined;
  }
  return label;
}

export function GalleryBackToolbar() {
  const navigation = useNavigation();
  // Read once: a screen pushed on top later would otherwise shift which route counts as previous.
  const [label] = useState(
    () => previousScreenLabel(navigation.getState()) ?? "Back",
  );
  return (
    <>
      <Stack.Screen options={{ headerBackVisible: false }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.View hidesSharedBackground>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label === "Back" ? "Back" : `Back to ${label}`}
            onPress={() => router.back()}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              minHeight: 44,
            }}
          >
            <Image
              source="sf:chevron.left"
              tintColor={Gallery.accent}
              style={{ width: 14, height: 22 }}
            />
            <ThemedText style={{ color: Gallery.accent, fontSize: 17 }}>
              {label}
            </ThemedText>
          </Pressable>
        </Stack.Toolbar.View>
      </Stack.Toolbar>
    </>
  );
}
