import { ListIcon, ListRow } from "@/components/list-row";
import type { VenueRow } from "@/lib/venue/resolve";
import { venueLocation } from "@/lib/venue/venue-location";

/** A museum found by name or place, with the typed letters highlighted. */
export function MuseumSearchRow({
  venue,
  query,
  first,
  last,
  busy,
  disabled,
  onPress,
}: {
  venue: VenueRow;
  query: string;
  first: boolean;
  last: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { location } = venueLocation(venue);
  return (
    <ListRow
      first={first}
      last={last}
      title={venue.name}
      query={query}
      subtitle={location}
      leading={<ListIcon name="building.columns" />}
      accessory="chevron"
      accessibilityLabel={[venue.name, location].filter(Boolean).join(", ")}
      busy={busy}
      disabled={disabled}
      onPress={onPress}
    />
  );
}
