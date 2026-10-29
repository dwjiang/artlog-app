import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  ArtistRow,
  type ArtistSummary,
  type CatalogArtwork,
  catalogArtworkImage,
  CatalogArtworkRow,
  useOpenCatalogArtwork,
} from "@/components/catalog/catalog-rows";
import { GalleryButton } from "@/components/collection/gallery-button";
import { SearchEmptyState } from "@/components/empty-state";
import { ExhibitionSearchRow } from "@/components/explore/exhibition-search-row";
import { ListSection } from "@/components/list-row";
import { ListSkeleton } from "@/components/loading-skeleton";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText as Text } from "@/components/themed-text";
import { MuseumSearchRow } from "@/components/venue/museum-search-row";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useCatalogReady } from "@/lib/catalog/use-catalog-ready";
import { useSavedCatalogWorks } from "@/lib/catalog/use-saved-catalog-works";
import { useExhibitionSearch } from "@/lib/explore/use-exhibition-search";
import { useRecentSearches } from "@/lib/social/recent-searches";
import type { PublicProfile } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { useSuggestions } from "@/lib/social/use-suggestions";
import { useVenueSearch } from "@/lib/venue/use-venue-search";
import { catalogSearchText } from "@/shared/catalog/text";
import { validateSearch } from "@/shared/social/contracts";

import { api } from "../../../convex/_generated/api";
import { PopularTags } from "./popular-tags";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileRow } from "./profile-row";
import { SearchChip, SearchChips } from "./search-chip";
import { SocialState } from "./social-state";
import { socialStyles } from "./social-styles";
import { SuggestionStrip } from "./suggested-people";
import { TagRow } from "./tag-row";
import { profileHref, tagHref } from "./tagged-text";

const SHOWN = 5;
const SHOWN_PEOPLE = 10;
const SHOWN_ARTWORKS = 3;
// Two spare rows stand in for hidden matches and tell Search whether "See all" has more.
const ARTWORK_PAGE = SHOWN_ARTWORKS + 2;

// The server rejects searches it can't run, so those never leave the phone.
function peopleSearch(text: string) {
  try {
    return validateSearch(text) && text;
  } catch {
    return "";
  }
}

/**
 * The Search tab: catalog artworks and artists, museums, exhibitions, tags and people, with recent searches, popular
 * tags and people to add before anything is typed.
 */
export function SearchScreen() {
  const router = useRouter();
  const session = useSocialSession();
  const catalog = useCatalogReady();
  const saved = useSavedCatalogWorks();
  const openArtwork = useOpenCatalogArtwork();
  const { recent, remember, forget } = useRecentSearches();
  const [text, setText] = useState("");
  const query = text.trim();
  // Each settled value runs every search, so brief pauses while typing shouldn't settle.
  const settled = useDebouncedValue(query, 300, "");
  const online = !session.offline;
  // A leading # asks for tags only, and a leading @ for people only.
  const tagPrefix = settled.replace(/^#/, "");
  const people = settled.startsWith("#") ? "" : peopleSearch(settled);
  const art = /^[#@]/.test(settled) || !catalogSearchText(settled) ? "" : settled;
  const catalogResults = useSocialQuery(
    api.catalog.search,
    catalog.ready && art ? { query: art, limit: ARTWORK_PAGE } : "skip",
    catalog.scope,
  );
  // `settled` has already waited for typing to pause.
  const venues = useVenueSearch(art, 0);
  const museumCandidates = venues.result?.rows ?? [];
  const museumVisibility = useSocialQuery(
    api.exhibitions.discoverableMuseumIds,
    online && art && museumCandidates.length > 0 ? { museumIds: museumCandidates.map((museum) => museum.id) } : "skip",
    "explore",
  );
  const shows = useExhibitionSearch(art);
  const popular = useSocialQuery(api.tags.popular, online ? {} : "skip", session.key);
  const tags = useSocialQuery(api.tags.search, online && tagPrefix ? { prefix: tagPrefix } : "skip", session.key);
  const profiles = useSocialQuery(
    api.profiles.search,
    online && people ? { query: people, limit: SHOWN } : "skip",
    session.key,
  );
  const suggestions = useSuggestions(session);
  // Guests, and people with no one to suggest yet, see the newest profiles instead.
  const browsing = online && !query && session.status !== "loading" && !suggestions.loading;
  const newest = useSocialQuery(
    api.profiles.discover,
    browsing && suggestions.people.length === 0 ? { limit: SHOWN_PEOPLE + 1, excludeDismissed: true } : "skip",
    session.key,
  );
  const newestPeople = (newest.data?.page ?? [])
    .filter(
      (person) => person.profileId !== session.profileId && !suggestions.hiddenProfileIds.includes(person.profileId),
    )
    .slice(0, SHOWN_PEOPLE)
    .map((profile) => ({ profile }));
  const openTag = (tag: string) => {
    remember({ kind: "tag", tag });
    router.push(tagHref(tag));
  };
  const openPerson = (profile: PublicProfile) => {
    remember({ kind: "person", profile });
    router.push(profileHref(profile.profileId));
  };
  const rememberArtwork = ({ artworkId, title, thumbnailUrl }: CatalogArtwork) =>
    remember({ kind: "artwork", artwork: { artworkId, title, thumbnailUrl } });
  const rememberArtist = ({ artistId, name, coverUrl }: ArtistSummary) =>
    remember({ kind: "artist", artist: { artistId, name, coverUrl } });
  const openArtist = (artist: { artistId: string; name: string; coverUrl?: string }) => {
    remember({ kind: "artist", artist });
    router.push({ pathname: "/artist/[artistId]", params: { artistId: artist.artistId } });
  };
  const openMuseum = (museum: { museumId: string; name: string }) => {
    remember({ kind: "museum", museum });
    router.push({ pathname: "/museum/[museumId]", params: { museumId: museum.museumId } });
  };
  const openExhibition = (exhibition: { exhibitionId: string; title: string; imageUrl?: string }) => {
    remember({ kind: "exhibition", exhibition });
    router.push({ pathname: "/exhibition/[exhibitionId]", params: { exhibitionId: exhibition.exhibitionId } });
  };
  const artistResults = art ? (catalogResults.data?.artists ?? []) : [];
  const artworkPage = art ? catalogResults.data?.artworks : undefined;
  const artworkResults = (artworkPage?.page ?? []).slice(0, SHOWN_ARTWORKS);
  const moreArtworks = !!artworkPage && (artworkPage.page.length > SHOWN_ARTWORKS || !artworkPage.isDone);
  const visibleMuseumIds = new Set(museumVisibility.data);
  const museumResults = art ? museumCandidates.filter((museum) => visibleMuseumIds.has(museum.id)).slice(0, SHOWN) : [];
  const exhibitionResults = art ? (shows.data?.exhibitions ?? []) : [];
  const tagResults = settled && tagPrefix ? (tags.data ?? []).slice(0, SHOWN) : [];
  const peopleResults = people ? (profiles.data?.page ?? []) : [];
  const searching =
    settled !== query
    || (!!tagPrefix && tags.loading)
    || (!!people && profiles.loading)
    || (!!art
      && (!catalog.ready || catalogResults.loading || !venues.result || museumVisibility.loading || shows.loading));
  const searchError =
    (!!tagPrefix && tags.error)
    || (!!people && profiles.error)
    || (!!art && (catalogResults.error || venues.result?.failed || museumVisibility.error || shows.error));
  const results =
    artistResults.length
    + artworkResults.length
    + museumResults.length
    + exhibitionResults.length
    + tagResults.length
    + peopleResults.length;
  let content;
  let state;
  if (!online) {
    state = (
      <SocialState title="You’re offline." detail="Connect to search artworks, museums and people." icon="wifi.slash" />
    );
  } else if (!query) {
    const popularTags = popular.data ?? [];
    const suggested = suggestions.people.length > 0;
    const strip = suggested ? suggestions.people : newestPeople;
    const sections = (
      <>
        {recent.length > 0 && (
          <ListSection title="Recent" flush>
            <SearchChips>
              {recent.map((entry) => {
                switch (entry.kind) {
                  case "tag":
                    return (
                      <SearchChip
                        key={`tag:${entry.tag}`}
                        label={`#${entry.tag}`}
                        accessibilityLabel={`#${entry.tag}`}
                        onPress={() => openTag(entry.tag)}
                        onRemove={() => forget(entry)}
                      />
                    );
                  case "person":
                    return (
                      <SearchChip
                        key={entry.profile.profileId}
                        label={entry.profile.name}
                        leading={
                          <ProfileAvatar
                            name={entry.profile.name}
                            photoUrl={entry.profile.photoUrl}
                            avatar={entry.profile.avatar}
                            size={24}
                          />
                        }
                        accessibilityLabel={`View ${entry.profile.name}’s profile`}
                        onPress={() => openPerson(entry.profile)}
                        onRemove={() => forget(entry)}
                      />
                    );
                  case "artwork": {
                    const { artwork } = entry;
                    const image = catalogArtworkImage(artwork.thumbnailUrl, saved.get(artwork.artworkId));
                    return (
                      <SearchChip
                        key={`artwork:${artwork.artworkId}`}
                        label={artwork.title}
                        leading={
                          image ? (
                            <Image
                              source={image}
                              cachePolicy={image.startsWith("file:") ? "memory" : "disk"}
                              accessible={false}
                              style={styles.chipThumbnail}
                            />
                          ) : undefined
                        }
                        accessibilityLabel={artwork.title}
                        onPress={() => {
                          remember(entry);
                          openArtwork(artwork.artworkId, saved.get(artwork.artworkId));
                        }}
                        onRemove={() => forget(entry)}
                      />
                    );
                  }
                  case "artist":
                    return (
                      <SearchChip
                        key={`artist:${entry.artist.artistId}`}
                        label={entry.artist.name}
                        leading={<ProfileAvatar photoUrl={entry.artist.coverUrl} size={24} />}
                        accessibilityLabel={entry.artist.name}
                        onPress={() => openArtist(entry.artist)}
                        onRemove={() => forget(entry)}
                      />
                    );
                  case "museum":
                    return (
                      <SearchChip
                        key={`museum:${entry.museum.museumId}`}
                        label={entry.museum.name}
                        leading={
                          <Image
                            source="sf:building.columns"
                            tintColor={Gallery.muted}
                            accessible={false}
                            style={styles.chipSymbol}
                          />
                        }
                        accessibilityLabel={entry.museum.name}
                        onPress={() => openMuseum(entry.museum)}
                        onRemove={() => forget(entry)}
                      />
                    );
                  case "exhibition": {
                    const { exhibition } = entry;
                    return (
                      <SearchChip
                        key={`exhibition:${exhibition.exhibitionId}`}
                        label={exhibition.title}
                        leading={
                          exhibition.imageUrl ? (
                            <Image source={exhibition.imageUrl} accessible={false} style={styles.chipThumbnail} />
                          ) : undefined
                        }
                        accessibilityLabel={exhibition.title}
                        onPress={() => openExhibition(exhibition)}
                        onRemove={() => forget(entry)}
                      />
                    );
                  }
                }
              })}
            </SearchChips>
          </ListSection>
        )}
        {popularTags.length > 0 && (
          <ListSection title="Popular tags" flush>
            <PopularTags tags={popularTags} onOpen={openTag} />
          </ListSection>
        )}
        {popular.error ? (
          <SearchFailure noun="popular tags" onRetry={popular.refresh} />
        ) : popular.loading && popularTags.length === 0 ? (
          <ListSkeleton card label="Loading popular tags…" />
        ) : null}
        {newest.error && <SearchFailure noun="people" onRetry={newest.refresh} />}
      </>
    );
    const empty =
      recent.length === 0
      && popularTags.length === 0
      && !popular.loading
      && !popular.error
      && strip.length === 0
      && session.status !== "loading"
      && !suggestions.loading
      && !newest.loading
      && !newest.error;
    if (empty) {
      state = (
        <SearchEmptyState
          title="Find artworks, museums and people."
          detail="Search by title, artist, museum, name, @username or #tag."
        />
      );
    }
    content = (
      <>
        <View style={styles.sections}>{sections}</View>
        {strip.length > 0 && (
          <View style={styles.people}>
            <SuggestionStrip
              people={strip}
              title={suggested ? "Suggested" : "New on Artlog"}
              invite={session.status === "ready"}
              session={session}
              onDismiss={suggestions.dismiss}
              refresh={suggested ? suggestions.refresh : newest.refresh}
              seeAll={() => router.push("/people")}
            />
          </View>
        )}
      </>
    );
  } else if (results === 0 && !moreArtworks && !searchError) {
    if (searching) {
      content = (
        <View style={styles.sections}>
          <ListSkeleton card label="Searching…" />
        </View>
      );
    } else {
      state = <SearchEmptyState detail="Try another title, artist, museum, name or tag." />;
    }
  } else {
    content = (
      <View style={styles.sections}>
        {!!art && catalogResults.error && (
          <SearchFailure noun="artists and artworks" onRetry={catalogResults.refresh} />
        )}
        {artistResults.length > 0 && (
          <ListSection title="Artists">
            {artistResults.map((artist, index) => (
              <ArtistRow
                key={artist.artistId}
                artist={artist}
                query={art}
                first={index === 0}
                last={index === artistResults.length - 1}
                onOpen={() => rememberArtist(artist)}
              />
            ))}
          </ListSection>
        )}
        {(artworkResults.length > 0 || moreArtworks) && (
          <ListSection
            title="Artworks"
            action={
              moreArtworks
                ? {
                    label: "See all",
                    onPress: () => router.push({ pathname: "/search-artworks", params: { query: art } }),
                  }
                : undefined
            }
          >
            {artworkResults.map((artwork, index) => (
              <CatalogArtworkRow
                key={artwork.artworkId}
                artwork={artwork}
                saved={saved.get(artwork.artworkId)}
                query={art}
                first={index === 0}
                last={index === artworkResults.length - 1}
                onOpen={() => rememberArtwork(artwork)}
              />
            ))}
          </ListSection>
        )}
        {!!art && (venues.result?.failed || museumVisibility.error) && (
          <SearchFailure noun="museums" onRetry={venues.result?.failed ? venues.retry : museumVisibility.refresh} />
        )}
        {museumResults.length > 0 && (
          <ListSection title="Museums">
            {museumResults.map((venue, index) => (
              <MuseumSearchRow
                key={venue.id}
                venue={venue}
                query={art}
                first={index === 0}
                last={index === museumResults.length - 1}
                onPress={() => openMuseum({ museumId: venue.id, name: venue.name })}
              />
            ))}
          </ListSection>
        )}
        {!!art && shows.error && <SearchFailure noun="exhibitions" onRetry={shows.refresh} />}
        {exhibitionResults.length > 0 && (
          <ListSection title="Exhibitions">
            {exhibitionResults.map((exhibition, index) => (
              <ExhibitionSearchRow
                key={exhibition.id}
                exhibition={exhibition}
                museum={shows.data?.museums.find((museum) => museum.id === exhibition.museumId)}
                today={shows.today}
                query={art}
                first={index === 0}
                last={index === exhibitionResults.length - 1}
                onPress={() =>
                  openExhibition({
                    exhibitionId: exhibition.id,
                    title: exhibition.title,
                    ...(exhibition.image ? { imageUrl: exhibition.image.uri } : {}),
                  })
                }
              />
            ))}
          </ListSection>
        )}
        {!!tagPrefix && tags.error && <SearchFailure noun="tags" onRetry={tags.refresh} />}
        {tagResults.length > 0 && (
          <ListSection title="Tags">
            {tagResults.map(({ tag, postCount }, index) => (
              <TagRow
                key={tag}
                tag={tag}
                count={postCount}
                query={tagPrefix}
                chevron
                first={index === 0}
                last={index === tagResults.length - 1}
                onPress={() => openTag(tag)}
              />
            ))}
          </ListSection>
        )}
        {peopleResults.length > 0 && (
          <ListSection title="People">
            {peopleResults.map((profile, index) => (
              <ProfileRow
                key={profile.profileId}
                profile={profile}
                query={people}
                first={index === 0}
                last={index === peopleResults.length - 1}
                onOpen={() => remember({ kind: "person", profile: publicFields(profile) })}
              />
            ))}
          </ListSection>
        )}
        {!!people && profiles.error && <SearchFailure noun="people" onRetry={profiles.refresh} />}
      </View>
    );
  }
  return (
    <>
      <Stack.SearchBar
        placeholder="Artworks, museums and people"
        autoCapitalize="none"
        hideWhenScrolling={false}
        onChangeText={(event) => setText(event.nativeEvent.text)}
        onCancelButtonPress={() => setText("")}
      />
      <SafeAreaScrollView
        style={[socialStyles.root, styles.page]}
        contentContainerStyle={[styles.content, state && { paddingBottom: 0 }]}
        contentInsetAdjustmentBehavior="automatic"
        bounces={!state}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {state ?? content}
      </SafeAreaScrollView>
    </>
  );
}

function SearchFailure({ noun, onRetry }: { noun: string; onRetry: () => void }) {
  return (
    <View>
      <Text accessibilityRole="alert">Couldn’t load {noun}.</Text>
      <GalleryButton label={`Retry ${noun}`} onPress={onRetry} />
    </View>
  );
}

const publicFields = ({ profileId, username, name, bio, photoUrl, avatar, publishedWallCount }: PublicProfile) => ({
  profileId,
  username,
  name,
  bio,
  photoUrl,
  avatar,
  publishedWallCount,
});

const styles = StyleSheet.create({
  page: { backgroundColor: Gallery.groupedBackground },
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.five },
  sections: { gap: Spacing.four, paddingHorizontal: Spacing.content },
  people: { paddingTop: Spacing.four },
  chipThumbnail: { width: 24, height: 24, borderRadius: Radius.thumbnail },
  chipSymbol: { width: 20, height: 18 },
});
