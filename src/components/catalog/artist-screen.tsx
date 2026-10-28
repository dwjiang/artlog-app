import { Image } from "expo-image";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useState, type ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ArtworkTile } from "@/components/collection/collection-artworks";
import { MotionPressable } from "@/components/motion-pressable";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ProfileHeader } from "@/components/social/profile-header";
import { loadingFirstPage, PageFooter, SocialState, StateScreen } from "@/components/social/social-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { useScrollTitle } from "@/hooks/use-scroll-title";
import { useCatalogReady } from "@/lib/catalog/use-catalog-ready";
import { useSavedCatalogWorks } from "@/lib/catalog/use-saved-catalog-works";
import { isIOS26OrLater } from "@/lib/ios-version";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import { gridColumns } from "@/lib/ui/grid-columns";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";
import { artistKey } from "@/shared/catalog/text";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { type CatalogArtwork, useOpenCatalogArtwork } from "./catalog-rows";

const worksPage = (result: { page: CatalogArtwork[]; cursor: string | null; isDone: boolean }) => result;
const workId = (work: CatalogArtwork) => work.artworkId;
const GAP = 14;
// Tall pictures stop at this height-to-width ratio so one portrait doesn't stretch its row.
const MAX_TILE_RATIO = 1.18;

/** An artist's page: your saves of their work first, then every catalog work by them. */
export function ArtistScreen({ artistId }: { artistId: Id<"artists"> }) {
  const catalog = useCatalogReady();
  const artist = useSocialQuery(api.artists.get, catalog.ready ? { artistId } : "skip", catalog.scope);
  const works = useCursorPages(
    api.artists.works,
    catalog.ready && artist.data ? { artistId } : "skip",
    catalog.scope,
    worksPage,
    workId,
  );
  const saved = useSavedCatalogWorks();
  const headerHeight = useHeaderHeight();
  const { top } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  const { scrollRef, headingRef, measureHeading, onScroll } = useScrollTitle(artist.data?.name ?? "");
  const columns = gridColumns(2, width, fontScale);
  const tileWidth = Math.max(1, (width - Spacing.content * 2 - (columns - 1) * GAP) / columns);

  if (!catalog.ready && catalog.offline) {
    return <State title="You’re offline." detail="Connect to open this artist." icon="wifi.slash" />;
  }
  if (artist.error) {
    return (
      <State
        title="Couldn’t load this artist."
        detail="Check your connection and try again."
        action="Try again"
        onAction={artist.refresh}
      />
    );
  }
  if (artist.data === null) {
    return <State title="Artist unavailable." detail="No works by this artist are in the catalog now." />;
  }
  const person = artist.data;
  const key = person?.key;
  const yourSaves = key ? [...saved.values()].filter((work) => artistKey(work.artist) === key) : [];
  const opening = !person || (yourSaves.length === 0 && loadingFirstPage(works, works.items.length));
  // The avatar fits between iOS 26 bar items, as on a profile; older bars blur their full width.
  const raisedBy = isIOS26OrLater() ? headerHeight - top : 0;
  return (
    <SafeAreaScrollView
      ref={scrollRef}
      style={styles.page}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      scrollEnabled={!opening}
      onContentSizeChange={measureHeading}
      onScroll={onScroll}
    >
      <View style={{ marginTop: -raisedBy }}>
        <ProfileHeader
          identity={person && { name: person.name, avatarPhotoUrl: person.coverUrl }}
          stats={[{ noun: "work", count: person?.workCount }]}
          headingRef={headingRef}
          onHeadingLayout={measureHeading}
        />
      </View>
      {yourSaves.length > 0 && (
        <Section title="Your saves">
          <Grid columns={columns}>
            {yourSaves.map((work) => (
              <ArtworkTile key={work.localId} work={work} width={tileWidth} />
            ))}
          </Grid>
        </Section>
      )}
      {(works.items.length > 0 || works.loading) && (
        <Section title="Works">
          <Grid columns={columns}>
            {works.items.map((work) => (
              <CatalogTile key={work.artworkId} work={work} saved={saved.get(work.artworkId)} width={tileWidth} />
            ))}
          </Grid>
        </Section>
      )}
      <PageFooter
        loading={works.loading}
        error={works.error}
        done={works.done}
        count={works.items.length}
        loadMore={works.loadMore}
        refresh={works.refresh}
        canLoadMore={works.canLoadMore}
        noun="works"
        skeleton="gallery"
      />
    </SafeAreaScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="section" accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Grid({ columns, children }: { columns: number; children: ReactNode }) {
  return <View style={[styles.grid, columns === 1 && styles.single]}>{children}</View>;
}

/** A catalog work in the artist's grid; a work you saved opens your copy. */
function CatalogTile({ work, saved, width }: { work: CatalogArtwork; saved?: SavedWork; width: number }) {
  const open = useOpenCatalogArtwork();
  const [shape, setShape] = useState<{ uri: string; aspect: number }>();
  const aspect = shape && shape.uri === work.thumbnailUrl ? shape.aspect : 1;
  const height = Math.min(width / aspect, width * MAX_TILE_RATIO);
  const details = [work.date, work.institution].filter(Boolean).join(" · ");
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={[work.title, details, saved && "Saved"].filter(Boolean).join(", ")}
      onPress={() => open(work.artworkId, saved)}
      style={{ width, gap: Spacing.two }}
    >
      {work.thumbnailUrl ? (
        <Image
          source={work.thumbnailUrl}
          contentFit="contain"
          accessible={false}
          style={{ width: height * aspect, height }}
          onLoad={({ source }) => {
            if (source.width > 0 && source.height > 0 && work.thumbnailUrl) {
              setShape({ uri: work.thumbnailUrl, aspect: source.width / source.height });
            }
          }}
        />
      ) : (
        <View style={[styles.placeholder, { width, height: width }]} />
      )}
      <View style={styles.caption}>
        <Text variant="secondary" style={styles.title}>
          {work.title}
        </Text>
        {saved ? (
          <Text variant="metadata" style={styles.saved}>
            Saved
          </Text>
        ) : (
          !!details && (
            <Text variant="metadata" themeColor="textSecondary">
              {details}
            </Text>
          )
        )}
      </View>
    </MotionPressable>
  );
}

function State(props: Parameters<typeof SocialState>[0]) {
  return (
    <StateScreen>
      <SocialState {...props} />
    </StateScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingBottom: Spacing.five },
  section: { gap: Spacing.compact, paddingTop: Spacing.four },
  heading: { paddingHorizontal: Spacing.content },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, rowGap: 22, paddingHorizontal: Spacing.content },
  single: { flexDirection: "column" },
  placeholder: { backgroundColor: Gallery.fill, borderRadius: Radius.thumbnail },
  caption: { gap: 2 },
  title: { fontWeight: "600" },
  saved: { color: Gallery.accent, fontWeight: "600" },
});
