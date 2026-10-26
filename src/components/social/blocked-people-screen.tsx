import type { FunctionReturnType } from "convex/server";
import { StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { SafeAreaFlatList } from "@/components/safe-area-scroll";
import { Gallery, Spacing } from "@/constants/theme";
import type { PublicProfile } from "@/lib/social/types";
import { useBlock } from "@/lib/social/use-block";
import { useCursorPages } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import { ProfileRow } from "./profile-row";
import { PageFooter, SocialGate, StateScreen } from "./social-state";
import { socialStyles } from "./social-styles";

const blockedPage = (result: FunctionReturnType<typeof api.friendships.listBlocked>) => result;
const profileId = (person: PublicProfile) => person.profileId;

export function BlockedPeopleScreen() {
  const session = useSocialSession();
  const blocking = useBlock(session);
  const blocked = useCursorPages(
    api.friendships.listBlocked,
    session.status === "ready" ? {} : "skip",
    session.key,
    blockedPage,
    profileId,
  );
  if (session.status !== "ready") {
    return (
      <StateScreen grouped>
        <SocialGate session={session} />
      </StateScreen>
    );
  }
  return (
    <SafeAreaFlatList
      style={styles.page}
      contentContainerStyle={[socialStyles.content, styles.content, blocked.items.length === 0 && { paddingBottom: 0 }]}
      contentInsetAdjustmentBehavior="automatic"
      bounces={blocked.items.length > 0}
      data={blocked.items}
      keyExtractor={profileId}
      renderItem={({ item, index }) => (
        <View style={styles.inset}>
          <ProfileRow
            profile={item}
            interactive={false}
            first={index === 0}
            last={index === blocked.items.length - 1}
            trailing={
              <GalleryButton
                label="Unblock"
                accessibilityLabel={`Unblock ${item.name}`}
                variant="outlined"
                busy={blocking.pending === item.profileId}
                disabled={blocking.pending !== undefined}
                onPress={() => blocking.unblock(item, item.blockRevision)}
              />
            }
          />
        </View>
      )}
      ListEmptyComponent={
        blocked.done && !blocked.loading && !blocked.error ? (
          <EmptyState title="No blocked people." detail="To block someone, tap ⋯ on their profile." />
        ) : undefined
      }
      ListFooterComponent={
        <PageFooter {...blocked} count={blocked.items.length} noun="blocked people" skeleton="card" />
      }
      onEndReached={blocked.loadMore}
      onEndReachedThreshold={0.4}
    />
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.groupedBackground },
  content: { paddingTop: Spacing.three },
  inset: { paddingHorizontal: Spacing.content },
});
