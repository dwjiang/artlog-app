import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { SearchEmptyState } from "@/components/empty-state";
import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { matchesVisitSearch, VisitGalleryArtwork, VisitGallerySearch } from "@/components/visits/visit-gallery";
import { VisitSymbol } from "@/components/visits/visit-ui";
import { VISIT_VISIBILITY } from "@/components/visits/visit-visibility-picker";
import { Gallery, Typography } from "@/constants/theme";
import { convexErrorCode } from "@/lib/network-error";
import { visitDate } from "@/lib/social/presentation";
import type { SharedArtwork, SharedVisit } from "@/lib/social/types";
import { useCursorPages } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import type { AvatarId } from "@/shared/social/avatars";

import { api } from "../../../convex/_generated/api";
import { ProfileAvatar } from "./profile-avatar";
import { ReportToolbar } from "./report-toolbar";
import { PageFooter, SocialGate, SocialState } from "./social-state";
import { socialStyles } from "./social-styles";
import { VisitReactions } from "./visit-reactions";

type Media = SharedArtwork["artwork"]["media"];
const artworksPage = (visit: SharedVisit) => visit.artworks;
const artworkId = (item: SharedArtwork) => item.itemId;

export function VisitScreen({ postId, openComments = false }: { postId: string; openComments?: boolean }) {
  const session = useSocialSession();
  return (
    <VisitGallery key={`${session.key}:${postId}`} postId={postId} session={session} openComments={openComments} />
  );
}

function VisitGallery({
  postId,
  session,
  openComments,
}: {
  postId: string;
  session: ReturnType<typeof useSocialSession>;
  openComments: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const { fontScale } = useWindowDimensions();
  const columns = fontScale > 1.4 ? 1 : 2;
  const ready = !session.offline && ["ready", "signed-out", "profile-required"].includes(session.status);
  const visit = useCursorPages(
    api.sharedVisits.get,
    ready && postId ? { postId } : "skip",
    session.key,
    artworksPage,
    artworkId,
  );
  const unavailable = !postId || convexErrorCode(visit.error) === "not_found";
  const totalCount = visit.first?.artworkCount ?? visit.items.length;
  const showSearch = totalCount >= 5;
  const query = showSearch ? search.trim() : "";
  const { canLoadMore, loadMore } = visit;
  // A search covers the whole shared visit, including pages the viewer has not scrolled to yet.
  useEffect(() => {
    if (ready && query && canLoadMore) loadMore();
  }, [ready, query, canLoadMore, loadMore]);
  const items = ready && !unavailable ? visit.items.filter((item) => matchesVisitSearch(item.artwork, query)) : [];
  const countLabel = `${totalCount}${visit.first?.artworkCount === undefined && !visit.done ? "+" : ""}`;
  const author = visit.first?.author;
  return (
    <>
      {author && session.status !== "loading" && author.profileId !== session.profileId && (
        <ReportToolbar kind="sharedVisit" id={postId} />
      )}
      <FlatList
        key={columns}
        style={socialStyles.root}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={artworkId}
        numColumns={columns}
        columnWrapperStyle={columns === 2 ? styles.row : undefined}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          ready ? (
            <RefreshControl refreshing={visit.refreshing} tintColor="transparent" onRefresh={visit.refresh} />
          ) : undefined
        }
        ListHeaderComponent={
          ready && !unavailable && visit.first && author ? (
            <>
              {visit.refreshing && (
                <LoadingRing accessibilityLabel="Refreshing visit" style={{ paddingVertical: 12 }} />
              )}
              <SharedVisitHeading
                audience={visit.first.audience}
                venue={visit.first.venue}
                visitedOn={visit.first.visitedOn}
                owner={{
                  name: author.name,
                  username: author.username,
                  photoUrl: author.photoUrl,
                  avatar: author.avatar,
                  onPress: () =>
                    router.push({
                      pathname: "/profile/[profileId]",
                      params: { profileId: author.profileId },
                    }),
                }}
              />
              {!!visit.first.reflection && (
                <Text selectable style={styles.reflection}>
                  {visit.first.reflection}
                </Text>
              )}
              <View style={{ marginBottom: 12 }}>
                <VisitReactions visit={visit.first} openComments={openComments} />
              </View>
              <SharedCountHeading label={`${countLabel} ${countLabel === "1" ? "artwork" : "artworks"} shared`} />
              {showSearch && <VisitGallerySearch value={search} onChangeText={setSearch} />}
            </>
          ) : null
        }
        renderItem={({ item }) => (
          <SharedArtworkTile
            title={item.artwork.title}
            artist={item.artwork.artist}
            photos={item.photos ?? []}
            token={session.token}
            onPress={() =>
              router.push({
                pathname: "/artwork",
                params: { kind: "visit", postId, itemId: item.itemId },
              })
            }
          />
        )}
        ListEmptyComponent={
          !ready ? (
            <SocialGate session={session} />
          ) : unavailable ? (
            <SocialState
              action="Back to Home"
              onAction={() => {
                router.dismissAll();
                router.navigate("/");
              }}
              title="Visit unavailable."
              detail="This visit is no longer shared with you."
            />
          ) : visit.done && !visit.loading && !visit.error ? (
            <SharedEmpty query={query} />
          ) : null
        }
        ListFooterComponent={
          ready && !unavailable && !(visit.refreshing && items.length > 0 && !visit.error) ? (
            <PageFooter {...visit} count={items.length} noun="artworks" skeleton="gallery" />
          ) : null
        }
        onEndReached={ready ? visit.loadMore : undefined}
        onEndReachedThreshold={0.4}
      />
    </>
  );
}

export function SharedVisitHeading({
  audience,
  venue,
  visitedOn,
  owner,
}: {
  audience: SharedVisit["audience"];
  venue: { name: string; city?: string };
  visitedOn: string;
  owner: {
    name: string;
    username?: string;
    photoUrl?: string;
    avatar?: AvatarId;
    onPress?: () => void;
  };
}) {
  const identity = (
    <>
      <ProfileAvatar name={owner.name} photoUrl={owner.photoUrl} avatar={owner.avatar} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={styles.ownerText}>{owner.name}</Text>
        {owner.username && <Text style={styles.meta}>@{owner.username}</Text>}
      </View>
      {owner.onPress && <VisitSymbol name="chevron.right" size={12} />}
    </>
  );
  return (
    <View style={styles.heading}>
      <View style={styles.stampRow}>
        {owner.onPress ? (
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel={`View ${owner.name}’s profile`}
            style={styles.owner}
            onPress={owner.onPress}
          >
            {identity}
          </MotionPressable>
        ) : (
          <View style={styles.owner}>{identity}</View>
        )}
        <View style={styles.status}>
          <VisitSymbol name={VISIT_VISIBILITY[audience].icon} size={11} color={Gallery.ink} />
          <Text style={styles.statusText}>{VISIT_VISIBILITY[audience].label}</Text>
        </View>
      </View>
      <Text selectable accessibilityRole="header" style={styles.museum}>
        {venue.name}
      </Text>
      <Text selectable style={styles.meta}>
        {visitDate(visitedOn)}
        {venue.city ? ` · ${venue.city}` : ""}
      </Text>
    </View>
  );
}

function SharedCountHeading({ label }: { label: string }) {
  return (
    <View style={styles.galleryHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {label}
      </Text>
    </View>
  );
}

function SharedEmpty({ query }: { query: string }) {
  return query ? (
    <SearchEmptyState title="No artworks found." detail="Try an artist or artwork title." />
  ) : (
    <View style={styles.empty}>
      <Text style={styles.meta}>This visit was shared without artworks.</Text>
    </View>
  );
}

/** One artwork in a shared visit: the first selected photo, a photo-count badge, title, and artist. */
export function SharedArtworkTile({
  title,
  artist,
  photos,
  token,
  onPress,
}: {
  title: string;
  artist: string | null;
  photos: Media[];
  token?: string | null;
  onPress?: () => void;
}) {
  const media = photos[0];
  const { fontScale } = useWindowDimensions();
  const cardStyle = [styles.card, fontScale > 1.4 && { width: "100%" as const, marginBottom: 20 }];
  const tile = (
    <VisitGalleryArtwork
      stageAspect={1.04}
      title={title}
      artist={artist}
      photoCount={photos.length}
      aspectRatio={media ? media.width / media.height : 1}
    >
      {(width) =>
        media ? (
          <DisplayMedia media={media} label={title} token={token} width={width} />
        ) : (
          <View
            style={{
              width,
              height: width,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: Gallery.fill,
            }}
          >
            <Text style={styles.photoPlaceholder}>No photo shared</Text>
          </View>
        )
      }
    </VisitGalleryArtwork>
  );
  return onPress ? (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={`View ${title}`}
      accessibilityHint={`${artist || "Artist unknown"}. ${photos.length} shared photos.`}
      style={cardStyle}
      onPress={onPress}
    >
      {tile}
    </MotionPressable>
  ) : (
    <View
      accessible
      accessibilityLabel={`${title}, ${artist || "Artist unknown"}, ${photos.length} shared photos`}
      style={cardStyle}
    >
      {tile}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 7,
    paddingBottom: 40,
  },
  row: { gap: 13, marginBottom: 20 },
  card: { width: "48%", flexShrink: 1 },
  heading: { paddingBottom: 12 },
  stampRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 14,
  },
  status: {
    flexDirection: "row",
    maxWidth: "100%",
    alignItems: "center",
    gap: 5,
    borderWidth: 0.5,
    borderColor: Gallery.separator,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  statusText: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: Gallery.ink,
  },
  owner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
  },
  ownerText: {
    flexShrink: 1,
    ...Typography.secondary,
    fontWeight: "600",
    color: Gallery.ink,
  },
  museum: { ...Typography.pageTitle, color: Gallery.ink, marginBottom: 8 },
  meta: { fontSize: 13, lineHeight: 20, color: Gallery.muted },
  reflection: {
    ...Typography.body,
    color: Gallery.ink,
    marginBottom: 20,
  },
  galleryHeader: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
    marginTop: 2,
    paddingTop: 15,
    paddingBottom: 12,
  },
  sectionTitle: {
    ...Typography.section,
    color: Gallery.ink,
    alignSelf: "flex-start",
    backgroundColor: Gallery.highlight,
    paddingHorizontal: 5,
  },
  empty: { gap: 7, paddingVertical: 24 },
  photoPlaceholder: {
    color: Gallery.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    padding: 5,
  },
});
