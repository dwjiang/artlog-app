import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import {
  ArtistRow,
  type ArtistSummary,
  type CatalogArtwork,
  CatalogArtworkRow,
  useOpenCatalogArtwork,
} from "@/components/catalog/catalog-rows";
import { GalleryButton } from "@/components/collection/gallery-button";
import { SearchEmptyState } from "@/components/empty-state";
import { ListSection } from "@/components/list-row";
import { ListSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useCatalogReady } from "@/lib/catalog/use-catalog-ready";
import { useSavedCatalogWorks } from "@/lib/catalog/use-saved-catalog-works";
import { useRecentSearches } from "@/lib/social/recent-searches";
import type { PublicProfile } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { useSuggestions } from "@/lib/social/use-suggestions";
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
 * The Search tab: catalog artworks and artists, tags and people, with recent searches, popular tags and people to add
 * before anything is typed.
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
  const artistResults = art ? (catalogResults.data?.artists ?? []) : [];
  const artworkPage = art ? catalogResults.data?.artworks : undefined;
  const artworkResults = (artworkPage?.page ?? []).slice(0, SHOWN_ARTWORKS);
  const moreArtworks = !!artworkPage && (artworkPage.page.length > SHOWN_ARTWORKS || !artworkPage.isDone);
  const tagResults = settled && tagPrefix ? (tags.data ?? []).slice(0, SHOWN) : [];
  const peopleResults = people ? (profiles.data?.page ?? []) : [];
  const searching =
    settled !== query
    || (!!tagPrefix && tags.loading)
    || (!!people && profiles.loading)
    || (!!art && (!catalog.ready || catalogResults.loading));
  const searchError = (!!tagPrefix && tags.error) || (!!people && profiles.error) || (!!art && catalogResults.error);
  const results = artistResults.length + artworkResults.length + tagResults.length + peopleResults.length;
  let content;
  let state;
  if (!online) {
    state = (
      <SocialState
        title="You’re offline."
        detail="Connect to search artworks, artists, tags and people."
        icon="wifi.slash"
      />
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
                    return (
                      <SearchChip
                        key={`artwork:${artwork.artworkId}`}
                        label={artwork.title}
                        leading={
                          artwork.thumbnailUrl ? (
                            <Image source={artwork.thumbnailUrl} accessible={false} style={styles.chipThumbnail} />
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
    content = empty ? (
      <SearchEmptyState
        title="Find artworks, artists and people."
        detail="Search by title, artist, name, @username or #tag."
      />
    ) : (
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
      state = <SearchEmptyState detail="Try another title, artist, name or tag." />;
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
        placeholder="Artworks, artists and people"
        autoCapitalize="none"
        hideWhenScrolling={false}
        onChangeText={(event) => setText(event.nativeEvent.text)}
        onCancelButtonPress={() => setText("")}
      />
      <ScrollView
        style={[socialStyles.root, styles.page]}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {state ?? content}
      </ScrollView>
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
  content: { flexGrow: 1, paddingTop: Spacing.two, paddingBottom: Spacing.five },
  sections: { gap: Spacing.four, paddingHorizontal: Spacing.content },
  people: { paddingTop: Spacing.four },
  chipThumbnail: { width: 24, height: 24, borderRadius: Radius.thumbnail },
});
