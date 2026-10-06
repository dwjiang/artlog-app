import { ListRow } from "@/components/list-row";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { MentionPlace } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import { ProfileAvatar } from "./profile-avatar";
import { SuggestionSection } from "./suggestion-section";

const ROLES = { author: "Author", companion: "Went with" } as const;

type Props = {
  /** The typed part of the handle; empty right after `@`, absent while no handle is being typed. */
  query?: string;
  place: MentionPlace;
  disabled: boolean;
  docked: boolean;
  canPick: (username: string) => boolean;
  onPick: (username: string) => void;
};

/** People who could read the text and whose name or username starts with the typed handle, nearest first. */
export function MentionSuggestions({ query, ...props }: Props) {
  return query === undefined ? null : <MatchingPeople query={query} {...props} />;
}

function MatchingPeople({ query, place, disabled, docked, canPick, onPick }: Props & { query: string }) {
  const session = useSocialSession();
  const settled = useDebouncedValue(query, 150, query);
  const search = useSocialQuery(
    api.mentions.suggest,
    session.status === "ready" ? { query: settled, place } : "skip",
    session.key,
  );
  const people = (search.data ?? []).filter(({ profile }) => canPick(profile.username));
  if (people.length === 0) return null;
  return (
    <SuggestionSection docked={docked}>
      {people.map(({ profile, role }, index) => (
        <ListRow
          key={profile.profileId}
          disabled={disabled}
          title={profile.name}
          query={query}
          subtitle={`@${profile.username}`}
          leading={<ProfileAvatar name={profile.name} photoUrl={profile.photoUrl} avatar={profile.avatar} size={32} />}
          detail={role && ROLES[role]}
          accessibilityLabel={[profile.name, `@${profile.username}`, role && ROLES[role]].filter(Boolean).join(", ")}
          first={index === 0}
          last={index === people.length - 1}
          onPress={() => onPick(profile.username)}
        />
      ))}
    </SuggestionSection>
  );
}
