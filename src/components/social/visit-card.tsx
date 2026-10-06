import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActionSheetIOS, StyleSheet, useWindowDimensions, View } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { ArtBand } from "@/components/visits/art-band";
import { VisitSymbol } from "@/components/visits/visit-ui";
import { VISIT_VISIBILITY } from "@/components/visits/visit-visibility-picker";
import { Gallery } from "@/constants/theme";
import { visitDate } from "@/lib/social/presentation";
import { reportHref } from "@/lib/social/report";
import type { SharedVisit } from "@/lib/social/types";
import { useCursorPages } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { ProfileAvatar } from "./profile-avatar";
import { PageFooter } from "./social-state";
import { TaggedText } from "./tagged-text";
import { VisitReactions } from "./visit-reactions";
import { WentWithLine } from "./went-with-line";

const artworksPage = (visit: SharedVisit) => visit.artworks;
const artworkId = (item: SharedVisit["artworks"]["page"][number]) => item.itemId;
// Feed pages scan only the original highlights, so a finished page can still omit surviving artworks.
const hasMoreArtworks = (visit: SharedVisit) =>
  !visit.artworks.isDone || (visit.artworkCount ?? 0) > visit.artworks.page.length;

/** The visit's artworks on its wallpaper. The card arrives with the first few; the rest load at the end of the row. */
function VisitArt({ visit, token }: { visit: SharedVisit; token?: string | null }) {
  const router = useRouter();
  const session = useSocialSession();
  const [more, setMore] = useState(false);
  const loadRest = more || visit.artworks.page.length === 0;
  const rest = useCursorPages(
    api.sharedVisits.get,
    loadRest ? { postId: visit.postId } : "skip",
    session.key,
    artworksPage,
    artworkId,
  );
  const first = new Set(visit.artworks.page.map(artworkId));
  const extra = loadRest ? rest.items.filter((item) => !first.has(item.itemId)) : [];
  const artworks = [...visit.artworks.page, ...extra];
  const { canLoadMore, loadMore } = rest;
  // Later pages start over from the first artwork, so keep loading until one adds an artwork the card lacks.
  const repeating = loadRest && extra.length === 0;
  useEffect(() => {
    if (repeating && canLoadMore) loadMore();
  }, [repeating, canLoadMore, loadMore]);
  return (
    <>
      <ArtBand
        wallpaper={visit}
        artworks={artworks.map(({ itemId, artwork, photos }) => {
          const media = photos?.[0] ?? artwork.media;
          return {
            key: itemId,
            title: artwork.title,
            artist: artwork.artist,
            aspect: media.width / media.height,
            photoCount: photos?.length,
            onPress: () =>
              router.push({
                pathname: "/artwork",
                params: { kind: "visit", postId: visit.postId, itemId },
              }),
            renderImage: (size) => <DisplayMedia media={media} label={artwork.title} token={token} {...size} />,
          };
        })}
        onEndReached={() => {
          if (!hasMoreArtworks(visit)) return;
          if (loadRest) loadMore();
          else setMore(true);
        }}
        footer={loadRest && rest.loading ? <LoadingRing accessibilityLabel="Loading more artworks" /> : undefined}
      />
      {loadRest && rest.error && <PageFooter {...rest} count={artworks.length} noun="artworks" />}
    </>
  );
}

export function VisitCard({
  visit,
  token,
  viewerProfileId,
  openComments = false,
  onBlock,
}: {
  visit: SharedVisit;
  token?: string | null;
  viewerProfileId?: string;
  openComments?: boolean;
  /** Offers Block in the card's menu; signed-in viewers with a profile only. */
  onBlock?: (author: SharedVisit["author"]) => void;
}) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const leaveVisit = useMutation(api.visitCompanions.leave);
  const { author, venue, visitedOn, audience, companions } = visit;
  const hasArtworks = visit.artworks.page.length > 0 || hasMoreArtworks(visit);
  const openProfile = () =>
    router.push({
      pathname: "/profile/[profileId]",
      params: { profileId: author.profileId },
    });
  const others = author.profileId !== viewerProfileId;
  const leave = () =>
    leaveVisit({ postId: visit.postId }).then(
      () => showToast("Removed from this visit."),
      (cause: unknown) => showErrorToast(socialErrorMessage(cause) ?? "Couldn’t remove you from this visit.", leave),
    );
  const companion = companions.some((person) => person.profileId === viewerProfileId);
  const actions = [
    { label: `View ${author.name}’s profile`, run: openProfile },
    ...(companion ? [{ label: "Remove me from this visit", run: () => void leave() }] : []),
    ...(others ? [{ label: "Report visit", run: () => router.push(reportHref("sharedVisit", visit.postId)) }] : []),
    ...(others && onBlock ? [{ label: `Block ${author.name}`, run: () => onBlock(author) }] : []),
  ];
  const openMenu = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.label), "Cancel"],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: others && onBlock ? actions.length - 1 : undefined,
      },
      (index) => actions[index]?.run(),
    );
  const date = (
    <Text accessibilityLabel={visitDate(visitedOn)} style={styles.feedDate}>
      {visitDate(visitedOn, undefined, "short")}
    </Text>
  );
  // Public is the default reach, so only a narrower audience is named.
  const reach = audience !== "public" && (
    <View style={styles.reach}>
      <VisitSymbol name={VISIT_VISIBILITY[audience].icon} size={11} />
      <Text style={styles.feedDate}>{audience === "private" ? "Only you" : "Friends"}</Text>
    </View>
  );
  return (
    <View style={styles.card}>
      <View style={[styles.feedHeading, fontScale > 1.4 && { flexDirection: "column" }]}>
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={`View ${author.name}’s profile`}
          accessibilityHint={`Visit to ${venue.name} on ${visitDate(visitedOn)}`}
          onPress={openProfile}
          style={styles.feedIdentity}
        >
          <ProfileAvatar name={author.name} photoUrl={author.photoUrl} avatar={author.avatar} size={40} />
          <View style={{ flex: 1, gap: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.feedName}>{author.name}</Text>
              <Text accessible={false} style={styles.feedDate}>
                ·
              </Text>
              {date}
              {reach}
            </View>
            <View style={styles.location}>
              <VisitSymbol name="mappin.and.ellipse" size={12} />
              <Text numberOfLines={1} style={styles.locationText}>
                {venue.name}
                {venue.city ? ` · ${venue.city}` : ""}
              </Text>
            </View>
          </View>
        </MotionPressable>
        <GalleryIconButton icon="ellipsis" label="More options" onPress={openMenu} />
      </View>
      {companions.length > 0 && (
        <WentWithLine people={companions} style={[styles.wentWith, fontScale > 1.4 && { marginLeft: 0 }]} />
      )}
      {hasArtworks && (
        <View style={styles.art}>
          <VisitArt visit={visit} token={token} />
        </View>
      )}
      {!!visit.reflection && (
        <TaggedText selectable style={[styles.notes, hasArtworks && { marginTop: 12 }]}>
          {visit.reflection}
        </TaggedText>
      )}
      <VisitReactions visit={visit} openComments={openComments} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    paddingTop: 19,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Gallery.softBorder,
  },
  feedHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  feedIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    minHeight: 44,
  },
  // Hangs under the name: avatar 40 plus the identity gap 11, tucked into the heading's bottom margin.
  wentWith: { marginLeft: 51, marginTop: -6, marginBottom: 12 },
  feedName: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: Gallery.ink,
  },
  nameRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 6,
  },
  reach: { flexDirection: "row", alignItems: "center", gap: 3 },
  location: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  locationText: {
    fontSize: 12,
    lineHeight: 18,
    color: Gallery.muted,
    flexShrink: 1,
  },
  feedDate: { fontSize: 12, lineHeight: 18, color: Gallery.muted },
  notes: { fontSize: 14, lineHeight: 21, color: Gallery.ink },
  art: { marginHorizontal: -20 },
});
