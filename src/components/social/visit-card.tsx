import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActionSheetIOS, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ThemedText as Text } from "@/components/themed-text";
import { VisitSymbol } from "@/components/visits/visit-ui";
import { VISIT_VISIBILITY } from "@/components/visits/visit-visibility-picker";
import { Gallery, Typography } from "@/constants/theme";
import { visitDate } from "@/lib/social/presentation";
import { reportHref } from "@/lib/social/report";
import type { PublicProfile, SharedArtwork, SharedVisit } from "@/lib/social/types";

import { ProfileAvatar } from "./profile-avatar";
import { socialStyles } from "./social-styles";
import { VisitReactions } from "./visit-reactions";

export function ProfileIdentity({
  profile,
  interactive = true,
  showChevron = false,
  friend = false,
}: {
  profile: PublicProfile;
  interactive?: boolean;
  showChevron?: boolean;
  friend?: boolean;
}) {
  const router = useRouter();
  const content = (
    <>
      <ProfileAvatar name={profile.name} photoUrl={profile.photoUrl} size={showChevron ? 64 : 44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.name, showChevron && { fontSize: 24, lineHeight: 28 }]}>{profile.name}</Text>
        <Text style={socialStyles.caption}>@{profile.username}</Text>
      </View>
      {friend && <Text style={{ color: Gallery.accent, fontSize: 13 }}>✓ Friends</Text>}
      {showChevron && (
        <Text style={{ color: Gallery.muted }} accessible={false}>
          ›
        </Text>
      )}
    </>
  );
  return interactive ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${profile.name}’s profile`}
      onPress={() =>
        router.push({
          pathname: "/profile/[profileId]",
          params: { profileId: profile.profileId },
        })
      }
      style={styles.identity}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.identity}>{content}</View>
  );
}

const GAP = 8;
const MIN_HEIGHT = 100;
const aspect = ({ media }: { media: SharedArtwork["artwork"]["media"] }) =>
  media.width > 0 && media.height > 0 ? media.width / media.height : 1;

type Candidate = {
  key: string;
  media: SharedArtwork["artwork"]["media"];
  title: string;
};

/** One slot per leading artwork, so every ranked highlight appears; spare slots take their extra selected photos. */
function previewCandidates(artworks: (Pick<SharedArtwork, "artwork" | "photos"> & { itemId?: string })[]): Candidate[] {
  const shown = artworks.slice(0, 3);
  const candidates: Candidate[] = [];
  shown.forEach(({ itemId, artwork, photos }, index) => {
    const reserved = shown.length - index - 1;
    const limit = Math.max(1, 3 - candidates.length - reserved);
    (photos?.length ? photos : [artwork.media]).slice(0, limit).forEach((media, photo) =>
      candidates.push({
        key: `${itemId ?? index}:${photo}`,
        media,
        title: photo ? `${artwork.title}, photo ${photo + 1}` : artwork.title,
      }),
    );
  });
  return candidates;
}

/** Fit selected photos into an equal-height row while preserving each photo's proportions. */
export function VisitArtworks({
  artworks,
  token,
  compact = false,
}: {
  artworks: (Pick<SharedArtwork, "artwork" | "photos"> & { itemId?: string })[];
  token?: string | null;
  compact?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const candidates = previewCandidates(artworks);
  const fit = (count: number) =>
    (width - GAP * (count - 1)) / candidates.slice(0, count).reduce((sum, item) => sum + aspect(item), 0);
  const count = [3, 2].find((n) => n <= candidates.length && fit(n) >= MIN_HEIGHT) ?? Math.min(1, candidates.length);
  const preview = candidates.slice(0, count);
  const ratios = preview.map(aspect);
  const height = Math.min(count === 1 ? width * 1.25 : compact ? 236 : 300, Math.max(0, fit(count)));
  return (
    <View
      testID="visit-artworks"
      style={[styles.strip, { gap: GAP }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0
        && preview.map(({ key, media, title }, index) => (
          <View
            key={key}
            style={{
              width: height * ratios[index],
              height,
              overflow: "hidden",
            }}
          >
            <DisplayMedia media={media} label={title} token={token} width={height * ratios[index]} height={height} />
          </View>
        ))}
      {preview.length === 0 && <Text style={socialStyles.caption}>No artwork previews.</Text>}
    </View>
  );
}

export function VisitCard({
  visit,
  token,
  viewerProfileId,
  showAuthor = true,
}: {
  visit: SharedVisit;
  token?: string | null;
  viewerProfileId?: string;
  showAuthor?: boolean;
}) {
  const router = useRouter();
  const openVisit = () =>
    router.push({
      pathname: "/visit/[postId]",
      params: { postId: visit.postId },
    });
  const openProfile = () =>
    router.push({
      pathname: "/profile/[profileId]",
      params: { profileId: visit.author.profileId },
    });
  const actions = [
    { label: "View visit", run: openVisit },
    { label: `View ${visit.author.name}’s profile`, run: openProfile },
    ...(visit.author.profileId === viewerProfileId
      ? []
      : [{ label: "Report visit", run: () => router.push(reportHref("sharedVisit", visit.postId)) }]),
  ];
  const openMenu = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.label), "Cancel"],
        cancelButtonIndex: actions.length,
      },
      (index) => actions[index]?.run(),
    );
  return (
    <VisitFeedCard
      audience={visit.audience}
      author={visit.author}
      venue={visit.venue}
      visitedOn={visit.visitedOn}
      notes={visit.reflection}
      artworks={visit.artworks.page}
      hasMore={!visit.artworks.isDone}
      token={token}
      showAuthor={showAuthor}
      reactions={
        <VisitReactions visit={{ ...visit, media: visit.artworks.page[0]?.artwork.media }} onOpenVisit={openVisit} />
      }
      onOpenVisit={openVisit}
      onOpenProfile={openProfile}
      onOpenMenu={openMenu}
    />
  );
}

export function VisitFeedCard({
  audience,
  author,
  venue,
  visitedOn,
  notes,
  artworks,
  hasMore = false,
  token,
  showAuthor = true,
  inset = true,
  reactions,
  onOpenVisit,
  onOpenProfile,
  onOpenMenu,
}: {
  audience: SharedVisit["audience"];
  author: Pick<PublicProfile, "name" | "photoUrl">;
  venue: { name: string; city?: string };
  visitedOn: string;
  notes: string;
  artworks: (Pick<SharedArtwork, "artwork" | "photos"> & { itemId?: string })[];
  hasMore?: boolean;
  token?: string | null;
  showAuthor?: boolean;
  inset?: boolean;
  onOpenVisit?: () => void;
  onOpenProfile?: () => void;
  onOpenMenu?: () => void;
  reactions?: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const photoCount = artworks.reduce((sum, item) => sum + (item.photos?.length ?? 0), 0);
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
  const location = (
    <View style={styles.location}>
      <VisitSymbol name="mappin.and.ellipse" size={12} />
      <Text numberOfLines={1} style={styles.locationText}>
        {venue.name}
        {venue.city ? ` · ${venue.city}` : ""}
      </Text>
    </View>
  );
  const identity = (
    <>
      <ProfileAvatar name={author.name} photoUrl={author.photoUrl} size={40} />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.feedName}>{author.name}</Text>
          <Text accessible={false} style={styles.feedDate}>
            ·
          </Text>
          {date}
          {reach}
        </View>
        {location}
      </View>
    </>
  );
  const art = (
    <View>
      <VisitArtworks artworks={artworks} token={token} compact />
      {photoCount > 0 && (
        <View accessible={false} pointerEvents="none" style={styles.photoBadge}>
          <VisitSymbol name="photo" size={12} color={Gallery.ink} />
          <Text style={styles.photoBadgeText}>
            {photoCount}
            {hasMore ? "+" : ""}
          </Text>
        </View>
      )}
    </View>
  );
  return (
    <View style={[styles.card, !inset && { marginHorizontal: 0 }]}>
      {showAuthor ? (
        <View style={[styles.feedHeading, fontScale > 1.4 && { flexDirection: "column" }]}>
          {onOpenProfile ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${author.name}’s profile`}
              accessibilityHint={`Visit to ${venue.name} on ${visitDate(visitedOn)}`}
              onPress={onOpenProfile}
              style={styles.feedIdentity}
            >
              {identity}
            </Pressable>
          ) : (
            <View style={styles.feedIdentity}>{identity}</View>
          )}
          {onOpenMenu ? (
            <GalleryIconButton icon="ellipsis" label="More options" onPress={onOpenMenu} />
          ) : (
            <Text style={styles.feedDate} accessible={false}>
              ···
            </Text>
          )}
        </View>
      ) : (
        <View style={[styles.feedHeading, { flexWrap: "wrap" }]}>
          {location}
          {date}
          {reach}
        </View>
      )}
      {artworks.length > 0
        && (onOpenVisit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${author.name}’s visit to ${venue.name}`}
            onPress={onOpenVisit}
          >
            {art}
          </Pressable>
        ) : (
          art
        ))}
      {!!notes && (
        <Text selectable style={[styles.notes, artworks.length > 0 && { marginTop: 8 }]}>
          {notes}
        </Text>
      )}
      {reactions}
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
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
  },
  name: { ...Typography.secondary, fontWeight: "600", color: Gallery.ink },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Gallery.paper,
  },
  photoBadge: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: Gallery.paper,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  photoBadgeText: { fontSize: 11, lineHeight: 14, color: Gallery.ink },
});
