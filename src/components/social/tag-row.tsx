import { ListIcon, ListRow } from "@/components/list-row";

export const postCount = (count: number) => `${count} ${count === 1 ? "post" : "posts"}`;

/** A tag in a grouped list, with its public post count. */
export function TagRow({
  tag,
  count,
  query,
  first,
  last,
  chevron = false,
  disabled = false,
  onPress,
}: {
  tag: string;
  count?: number;
  /** The typed part of the tag, highlighted in the title. */
  query?: string;
  first?: boolean;
  last?: boolean;
  chevron?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const detail = count === undefined ? undefined : postCount(count);
  return (
    <ListRow
      title={`#${tag}`}
      query={query}
      leading={<ListIcon name="number" />}
      detail={detail}
      accessory={chevron ? "chevron" : undefined}
      accessibilityLabel={detail ? `#${tag}, ${detail}` : `#${tag}`}
      first={first}
      last={last}
      onPress={onPress}
      disabled={disabled}
    />
  );
}
