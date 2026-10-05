import { ListSection } from "@/components/list-row";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import { TagRow } from "./tag-row";

const SHOWN = 5;

/** Tags already in use that start with the one being typed, busiest first; nothing while no tag is being typed. */
type Props = { query?: string; disabled: boolean; canPick: (tag: string) => boolean; onPick: (tag: string) => void };
export function HashtagSuggestions({ query, ...props }: Props) {
  return query ? <MatchingTags query={query} {...props} /> : null;
}

function MatchingTags({ query, disabled, canPick, onPick }: Props & { query: string }) {
  const session = useSocialSession();
  const settled = useDebouncedValue(query, 150, "");
  const search = useSocialQuery(api.tags.search, settled ? { prefix: settled } : "skip", session.key);
  const tags = (search.data ?? []).filter(({ tag }) => canPick(tag)).slice(0, SHOWN);
  if (tags.length === 0) return null;
  return (
    <ListSection outlined>
      {tags.map(({ tag, postCount }, index) => (
        <TagRow
          key={tag}
          disabled={disabled}
          tag={tag}
          count={postCount}
          query={query}
          first={index === 0}
          last={index === tags.length - 1}
          onPress={() => onPick(tag)}
        />
      ))}
    </ListSection>
  );
}
