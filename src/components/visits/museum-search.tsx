import { useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";

import { SearchEmptyState } from "@/components/empty-state";
import { ListIcon, ListRow, ListSection } from "@/components/list-row";
import { ListSkeleton } from "@/components/loading-skeleton";
import { SearchField } from "@/components/search-field";
import { ThemedText as Text } from "@/components/themed-text";
import { captureOwner } from "@/lib/account/owner-store";
import { countryName } from "@/lib/journal/history";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";
import type { VenueRow } from "@/lib/venue/resolve";
import { MUSEUM_SEARCH_LIMIT, searchVenues } from "@/lib/venue/search-venues";
import { confirmPlace, useVenue } from "@/lib/venue/use-venue";
import { venueLocation } from "@/lib/venue/venue-location";
import type { PoiOption } from "@/lib/venue/venue-reducer";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { getPoiSearch } from "../../../modules/poi-search/src";
import { VisitMessage, visitStyles as styles } from "./visit-ui";

/** Apple Maps is asked only when our table has nothing for the name; a short query would match too much of the world. */
const PLACE_SEARCH_MIN = 3;

async function searchPlaces(query: string, near?: { lat: number; lng: number }): Promise<PoiOption[]> {
  if (query.trim().length < PLACE_SEARCH_MIN) return [];
  const places = await getPoiSearch().searchByName(query, near?.lat, near?.lng);
  return places.map((place) => ({
    kind: "poi",
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
    ...(place.distanceMeters === undefined ? {} : { distanceM: place.distanceMeters }),
    city: place.city,
    country: place.country,
    ...(place.website ? { website: place.website } : {}),
  }));
}

function placeLocation(place: PoiOption): string {
  return [place.city, countryName(place.country)].filter(Boolean).join(", ");
}

/** Searches our museum table, then Apple Maps; a place from Apple Maps becomes a museum for everyone once chosen. */
export function MuseumSearch({
  onChoose,
  disabled = false,
}: {
  onChoose: (venue: VenueRow) => void;
  disabled?: boolean;
}) {
  const { fix } = useVenue();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    query: string;
    retry: number;
    rows: VenueRow[];
    places: PoiOption[];
    error?: string;
  }>();
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState<string>();
  const selection = useRef<AbortController | null>(null);
  useEffect(() => () => selection.current?.abort(), []);
  const currentResults = results?.query === query && results.retry === retry ? results : undefined;
  const venues = currentResults?.rows ?? [];
  const places = currentResults?.places ?? [];
  const searchError = currentResults?.error;
  const hasQuery = !!query.trim();
  const searching = hasQuery && !currentResults;
  useEffect(() => {
    let active = true;
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      void searchVenues(query)
        .then(async (rows) => {
          if (rows.length > 0) return { rows, places: [] };
          // Apple Maps is the fallback, so its failure is reported as its own rather than blamed on the table that answered.
          const places = await searchPlaces(query, fix).catch((cause) => {
            reportError(cause, "visit.places.search");
            return undefined;
          });
          return places
            ? { rows, places }
            : {
                rows,
                places: [],
                error: "Apple Maps could not be reached. Try again.",
              };
        })
        .then((found) => {
          if (active) setResults({ query, retry, ...found });
        })
        .catch((cause) => {
          reportError(cause, "visit.venues.search");
          if (active) {
            setResults({
              query,
              retry,
              rows: [],
              places: [],
              error: "Museums could not load. Try again.",
            });
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, retry, fix]);
  function choose(row: VenueRow) {
    Keyboard.dismiss();
    onChoose(row);
  }
  async function choosePlace(place: PoiOption) {
    if (selection.current || disabled) return;
    const key = `${place.name}:${place.lat}:${place.lng}`;
    const session = captureOwner();
    const request = new AbortController();
    selection.current = request;
    const wanted = () => !request.signal.aborted && session.isOwnerCurrent();
    setAdding(key);
    try {
      const row = await confirmPlace(place, wanted);
      if (row && wanted()) choose(row);
    } catch (cause) {
      if (!wanted()) return;
      reportError(cause, "visit.venue.confirm");
      if (session.isOwnerCurrent()) {
        showErrorToast(socialErrorMessage(cause) ?? "Couldn’t add this museum.", () => void choosePlace(place));
      }
    } finally {
      selection.current = null;
      if (wanted()) setAdding(undefined);
    }
  }
  return (
    <>
      <SearchField
        label="Search museums"
        placeholder="Museum or city"
        value={query}
        maxLength={LIMITS.searchMax}
        showLabel={false}
        onChange={setQuery}
        onClear={() => setQuery("")}
      />
      {searching ? (
        <ListSkeleton label="Searching museums…" rows={3} card />
      ) : searchError ? (
        <VisitMessage action="Try again" onAction={() => setRetry((value) => value + 1)}>
          {searchError}
        </VisitMessage>
      ) : hasQuery && venues.length === 0 && places.length === 0 ? (
        <SearchEmptyState
          title="No museums found."
          detail={
            query.trim().length < PLACE_SEARCH_MIN
              ? "Type more of the name to search Apple Maps too."
              : "Try the city or a shorter name."
          }
          onClear={() => setQuery("")}
        />
      ) : null}
      {venues.length > 0 && (
        <ListSection>
          {venues.map((row, index) => {
            const { location } = venueLocation(row);
            return (
              <ListRow
                key={row.id}
                first={index === 0}
                last={index === venues.length - 1}
                title={row.name}
                query={query}
                subtitle={location}
                leading={<ListIcon name="building.columns" />}
                accessory="chevron"
                accessibilityLabel={`${row.name}, ${location || row.name}`}
                disabled={disabled}
                onPress={() => choose(row)}
              />
            );
          })}
        </ListSection>
      )}
      {venues.length === 0 && places.length > 0 && (
        <ListSection title="From Apple Maps">
          {places.map((place, index) => {
            const key = `${place.name}:${place.lat}:${place.lng}`;
            return (
              <ListRow
                key={key}
                first={index === 0}
                last={index === places.length - 1}
                title={place.name}
                query={query}
                subtitle={adding === key ? "Adding this museum…" : placeLocation(place)}
                leading={<ListIcon name="mappin.and.ellipse" />}
                accessory="chevron"
                busy={adding === key}
                accessibilityLabel={`${place.name}, ${placeLocation(place) || place.name}`}
                disabled={disabled || !!adding}
                onPress={() => {
                  void choosePlace(place);
                }}
              />
            );
          })}
        </ListSection>
      )}
      {venues.length === MUSEUM_SEARCH_LIMIT && (
        <Text style={styles.caption}>
          Showing the first {MUSEUM_SEARCH_LIMIT} museums. Add a city or more of the name to narrow your search.
        </Text>
      )}
    </>
  );
}
