import { ListIcon, ListRow, ListSection } from "@/components/list-row";
import { countryName } from "@/lib/journal/history";
import type { VenueRow } from "@/lib/venue/resolve";
import { PLACE_SEARCH_MIN, type VenueSearch } from "@/lib/venue/use-venue-search";
import { venueOptionKey, type PoiOption } from "@/lib/venue/venue-reducer";

import { MuseumSearchRow } from "./museum-search-row";

export function museumSearchFailure(failed: NonNullable<VenueSearch["failed"]>): string {
  return failed === "places" ? "Apple Maps could not be reached. Try again." : "Museums could not load. Try again.";
}

export function museumSearchEmptyDetail(query: string): string {
  return query.trim().length < PLACE_SEARCH_MIN
    ? "Type more of the name to search Apple Maps too."
    : "Try the city or a shorter name.";
}

/** A museum search's matches: museums from our table, or the Apple Maps places asked for when it has none. */
export function MuseumSearchResults({
  query,
  search: { rows, places },
  busyKey,
  disabled,
  onChooseVenue,
  onChoosePlace,
}: {
  query: string;
  search: VenueSearch;
  /** The `venueOptionKey` of the match being confirmed. */
  busyKey?: string;
  disabled?: boolean;
  onChooseVenue: (venue: VenueRow) => void;
  onChoosePlace: (place: PoiOption) => void;
}) {
  return (
    <>
      {rows.length > 0 && (
        <ListSection>
          {rows.map((row, index) => (
            <MuseumSearchRow
              key={row.id}
              venue={row}
              first={index === 0}
              last={index === rows.length - 1}
              query={query}
              busy={busyKey === row.id}
              disabled={disabled}
              onPress={() => onChooseVenue(row)}
            />
          ))}
        </ListSection>
      )}
      {places.length > 0 && (
        <ListSection title="From Apple Maps">
          {places.map((place, index) => {
            const key = venueOptionKey(place);
            const location = [place.city, countryName(place.country)].filter(Boolean).join(", ");
            return (
              <ListRow
                key={key}
                first={index === 0}
                last={index === places.length - 1}
                title={place.name}
                query={query}
                subtitle={busyKey === key ? "Adding this museum…" : location}
                leading={<ListIcon name="mappin.and.ellipse" />}
                accessory="chevron"
                busy={busyKey === key}
                accessibilityLabel={[place.name, location].filter(Boolean).join(", ")}
                disabled={disabled}
                onPress={() => onChoosePlace(place)}
              />
            );
          })}
        </ListSection>
      )}
    </>
  );
}
