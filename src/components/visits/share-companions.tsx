import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState, SearchEmptyState } from "@/components/empty-state";
import { ListIcon, ListRow, ListSection } from "@/components/list-row";
import { ListSkeleton } from "@/components/loading-skeleton";
import { SafeAreaFlatList } from "@/components/safe-area-scroll";
import { SearchField } from "@/components/search-field";
import { AvatarStack } from "@/components/social/avatar-stack";
import { ProfileAvatar } from "@/components/social/profile-avatar";
import { SocialState } from "@/components/social/social-state";
import { joinNames } from "@/components/social/went-with-line";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import type { PublicProfile } from "@/lib/social/types";
import { useFriends } from "@/lib/social/use-friends";
import { useSocialSession } from "@/lib/social/use-social-session";
import { LIMITS, normalizeSearch } from "@/shared/journal/limits";

import type { Id } from "../../../convex/_generated/dataModel";

type ProfileId = Id<"profiles">;

/** Profiles for the picked ids, from the friend list or, for people it no longer has, the last published post. */
export function usePickedCompanions(ids: readonly ProfileId[], published: readonly PublicProfile[]) {
  const session = useSocialSession();
  const friends = useFriends(session, session.profileId ?? undefined);
  const known = new Map([...published, ...(friends.data ?? [])].map((person) => [person.profileId, person]));
  return ids.flatMap((id) => known.get(id) ?? []);
}

/** The Share Visit row that opens the picker; it lists who is picked. */
export function ShareCompanionsRow({
  people,
  disabled,
  onPress,
}: {
  people: readonly PublicProfile[];
  disabled: boolean;
  onPress: () => void;
}) {
  const names = joinNames(people.map((person) => person.name));
  return (
    <ListSection outlined>
      <ListRow
        title="Went with"
        subtitle={
          names ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <AvatarStack people={people.slice(0, 3)} size={20} />
              <Text style={{ ...Typography.secondary, color: Gallery.muted, flexShrink: 1 }}>{names}</Text>
            </View>
          ) : undefined
        }
        leading={<ListIcon name="person.2" />}
        accessory="chevron"
        accessibilityLabel={names ? `Went with ${names}` : "Went with"}
        accessibilityHint="Choose friends who came along"
        first
        last
        disabled={disabled}
        onPress={onPress}
      />
    </ListSection>
  );
}

/** Friends to pick from, up to the companion limit; changes apply to the draft as they are made. */
export function CompanionPicker({
  selected,
  disabled,
  onChange,
}: {
  selected: readonly ProfileId[];
  disabled: boolean;
  onChange: (ids: ProfileId[]) => void;
}) {
  const session = useSocialSession();
  const friends = useFriends(session, session.profileId ?? undefined);
  const [search, setSearch] = useState("");
  const people = friends.data ?? [];
  const query = normalizeSearch(search);
  const rows = people.filter((person) => normalizeSearch(`${person.name} ${person.username}`).includes(query));
  const full = selected.length >= LIMITS.companions;
  const toggle = (id: ProfileId) =>
    onChange(selected.includes(id) ? selected.filter((picked) => picked !== id) : [...selected, id]);
  return (
    <SafeAreaFlatList
      style={{ backgroundColor: Gallery.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      bounces={rows.length > 0}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: Spacing.content, paddingBottom: rows.length > 0 ? 32 : 0 }}
      data={rows}
      keyExtractor={(person) => person.profileId}
      ListHeaderComponent={
        people.length > 0 ? (
          <View style={{ gap: 10, paddingVertical: 14 }}>
            <SearchField
              value={search}
              label="Search friends"
              showLabel={false}
              filled
              onChange={setSearch}
              onClear={() => setSearch("")}
            />
            {full && <Text style={{ color: Gallery.muted }}>{`You can add up to ${LIMITS.companions} people.`}</Text>}
          </View>
        ) : null
      }
      renderItem={({ item: person, index }) => {
        const picked = selected.includes(person.profileId);
        return (
          <ListRow
            title={person.name}
            query={search}
            subtitle={`@${person.username}`}
            leading={<ProfileAvatar name={person.name} photoUrl={person.photoUrl} avatar={person.avatar} size={40} />}
            accessibilityRole="checkbox"
            accessibilityLabel={person.name}
            accessory="toggle"
            selected={picked}
            disabled={disabled || (!picked && full)}
            first={index === 0}
            last={index === rows.length - 1}
            onPress={() => toggle(person.profileId)}
          />
        );
      }}
      ListEmptyComponent={
        friends.error ? (
          <SocialState title="Couldn’t load your friends." action="Try again" onAction={friends.refresh} />
        ) : friends.loading || friends.data === undefined ? (
          <ListSkeleton label="Loading friends…" avatar card />
        ) : people.length === 0 ? (
          <EmptyState inset={false} title="No friends yet." detail="Add friends to say who came along.">
            <GalleryButton label="Find friends" variant="filled" fullWidth onPress={() => router.push("/people")} />
          </EmptyState>
        ) : (
          <SearchEmptyState title="No matches." detail="Try another name." onClear={() => setSearch("")} />
        )
      }
    />
  );
}
