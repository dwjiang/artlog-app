import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { SearchEmptyState } from "@/components/empty-state";
import { ListSection } from "@/components/list-row";
import { ListSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { useCurrentMinute } from "@/hooks/use-current-minute";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useRecentSearches, type RecentSearch } from "@/lib/social/recent-searches";
import type { PublicProfile } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { validateSearch } from "@/shared/social/contracts";

import { api } from "../../../convex/_generated/api";
import { ProfileRow } from "./profile-row";
import { SocialState } from "./social-state";
import { socialStyles } from "./social-styles";
import { TagRow } from "./tag-row";
import { tagHref } from "./tagged-text";

const SHOWN = 5;

// The server rejects searches it can't run, so those never leave the phone.
function peopleSearch(text: string) {
  try {
    return validateSearch(text) && text;
  } catch {
    return "";
  }
}

/** The Search tab: tags and people, with recent and popular tags before anything is typed. */
export function SearchScreen() {
  const router = useRouter();
  const session = useSocialSession();
  const { recent, remember } = useRecentSearches();
  const [text, setText] = useState("");
  const query = text.trim();
  const settled = useDebouncedValue(query, 200, "");
  const online = !session.offline;
  const asOf = useCurrentMinute();
  // A leading # asks for tags only.
  const tagPrefix = settled.replace(/^#/, "");
  const people = settled.startsWith("#") ? "" : peopleSearch(settled);
  const popular = useSocialQuery(api.tags.popular, online ? { asOf } : "skip", session.key);
  const [lastPopular, setLastPopular] = useState<{ scope: string; tags: NonNullable<typeof popular.data> }>();
  if (popular.data !== undefined && (lastPopular?.scope !== session.key || lastPopular.tags !== popular.data)) {
    setLastPopular({ scope: session.key, tags: popular.data });
  }
  const tags = useSocialQuery(api.tags.search, online && tagPrefix ? { prefix: tagPrefix } : "skip", session.key);
  const profiles = useSocialQuery(
    api.profiles.search,
    online && people ? { query: people, limit: SHOWN } : "skip",
    session.key,
  );
  const openTag = (tag: string) => {
    remember({ kind: "tag", tag });
    router.push(tagHref(tag));
  };
  const tagResults = settled && tagPrefix ? (tags.data ?? []).slice(0, SHOWN) : [];
  const peopleResults = people ? (profiles.data?.page ?? []) : [];
  const searching = settled !== query || (!!tagPrefix && tags.loading) || (!!people && profiles.loading);
  const searchError = (!!tagPrefix && tags.error) || (!!people && profiles.error);
  let content;
  let state;
  if (!online) {
    state = <SocialState title="You’re offline." detail="Connect to search tags and people." icon="wifi.slash" />;
  } else if (!query) {
    const popularTags = popular.data ?? (lastPopular?.scope === session.key ? lastPopular.tags : []);
    content = (
      <>
        {recent.length > 0 && (
          <ListSection title="Recent">
            {recent.map((entry, index) => (
              <RecentRow
                key={entry.kind === "tag" ? `tag:${entry.tag}` : entry.profile.profileId}
                entry={entry}
                first={index === 0}
                last={index === recent.length - 1}
                onOpenTag={openTag}
                onOpenPerson={(profile) => remember({ kind: "person", profile })}
              />
            ))}
          </ListSection>
        )}
        {popularTags.length > 0 && (
          <ListSection title="Popular this week">
            {popularTags.map(({ tag, postCount }, index) => (
              <TagRow
                key={tag}
                tag={tag}
                count={postCount}
                chevron
                first={index === 0}
                last={index === popularTags.length - 1}
                onPress={() => openTag(tag)}
              />
            ))}
          </ListSection>
        )}
        {popular.error ? (
          <SearchFailure noun="popular tags" onRetry={popular.refresh} />
        ) : popular.loading && popularTags.length === 0 ? (
          <ListSkeleton card label="Loading popular tags…" />
        ) : null}
      </>
    );
  } else if (tagResults.length === 0 && peopleResults.length === 0 && !searchError) {
    if (searching) content = <ListSkeleton card label="Searching…" />;
    else state = <SearchEmptyState detail="Try another name or tag." />;
  } else {
    content = (
      <>
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
      </>
    );
  }
  return (
    <>
      <Stack.SearchBar
        placeholder="People and tags"
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
        {state ?? <View style={styles.sections}>{content}</View>}
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

function RecentRow({
  entry,
  first,
  last,
  onOpenTag,
  onOpenPerson,
}: {
  entry: RecentSearch;
  first: boolean;
  last: boolean;
  onOpenTag: (tag: string) => void;
  onOpenPerson: (profile: PublicProfile) => void;
}) {
  if (entry.kind === "tag") {
    return <TagRow tag={entry.tag} chevron first={first} last={last} onPress={() => onOpenTag(entry.tag)} />;
  }
  return <ProfileRow profile={entry.profile} first={first} last={last} onOpen={() => onOpenPerson(entry.profile)} />;
}

const styles = StyleSheet.create({
  page: { backgroundColor: Gallery.groupedBackground },
  content: { flexGrow: 1, paddingTop: Spacing.two, paddingBottom: Spacing.five },
  sections: { gap: Spacing.four, paddingHorizontal: Spacing.content },
});
