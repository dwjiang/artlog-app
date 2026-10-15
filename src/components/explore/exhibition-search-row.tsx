import { CatalogThumbnail } from "@/components/catalog/catalog-rows";
import { ListRow } from "@/components/list-row";
import { exhibitionStatus } from "@/lib/explore/exhibition-timing";
import type { Exhibition, ExploreMuseum } from "@/lib/explore/types";

import { ExhibitionStatusLine } from "./exhibition-status";

/** A show in a grouped list of search results, with its timing and museum. */
export function ExhibitionSearchRow({
  exhibition,
  museum,
  today,
  query,
  first,
  last,
  onPress,
}: {
  exhibition: Exhibition;
  museum?: ExploreMuseum;
  today: string;
  query: string;
  first: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const status = exhibitionStatus(exhibition, today);
  return (
    <ListRow
      title={exhibition.title}
      query={query}
      subtitle={<ExhibitionStatusLine status={status} detail={museum?.name} />}
      leading={<CatalogThumbnail uri={exhibition.image?.uri} />}
      accessory="chevron"
      accessibilityLabel={[exhibition.title, status.label, museum?.name].filter(Boolean).join(", ")}
      first={first}
      last={last}
      onPress={onPress}
    />
  );
}
