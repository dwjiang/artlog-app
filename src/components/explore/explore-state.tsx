import { ScrollView, StyleSheet } from "react-native";

import { SocialState } from "@/components/social/social-state";
import { Gallery } from "@/constants/theme";
import type { ExploreView } from "@/lib/explore/use-explore";

/** What an Explore page shows until its city's shows arrive. */
export function ExploreState({ view }: { view: ExploreView }) {
  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.centered}>
      {view.status === "offline" ? (
        <SocialState title="You’re offline." detail="Connect to see exhibitions." icon="wifi.slash" />
      ) : view.status === "error" ? (
        <SocialState
          title="Couldn’t load exhibitions."
          detail="Check your connection and try again."
          action="Try again"
          onAction={view.retry}
        />
      ) : view.status === "empty" ? (
        <SocialState title="No exhibitions listed yet." icon="building.columns" />
      ) : (
        <SocialState title="Loading exhibitions…" loading />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  centered: { flexGrow: 1, justifyContent: "center" },
});
