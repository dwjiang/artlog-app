import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, TextInput } from "react-native";

import { SearchEmptyState } from "@/components/empty-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { captureOwner } from "@/lib/account/owner-store";
import { countryName } from "@/lib/journal/history";
import { reportError } from "@/lib/observability";
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
  const [error, setError] = useState<string>();
  const selection = useRef<AbortController | null>(null);
  useEffect(() => () => selection.current?.abort(), []);
  const currentResults = results?.query === query && results.retry === retry ? results : undefined;
  const venues = currentResults?.rows ?? [];
  const places = currentResults?.places ?? [];
  const searchError = currentResults?.error;
  const searching = query.trim().length >= 2 && !currentResults;
  useEffect(() => {
    let active = true;
    if (query.trim().length < 2) return;
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
    setError(undefined);
    try {
      const row = await confirmPlace(place, wanted);
      if (row && wanted()) choose(row);
    } catch (cause) {
      if (!wanted()) return;
      reportError(cause, "visit.venue.confirm");
      if (session.isOwnerCurrent()) {
        setError(socialErrorMessage(cause) ?? "This museum could not be added. Check your connection and try again.");
      }
    } finally {
      selection.current = null;
      if (wanted()) setAdding(undefined);
    }
  }
  return (
    <>
      <TextInput
        keyboardAppearance="light"
        selectionColor={Gallery.accent}
        placeholderTextColor={Gallery.muted}
        accessibilityLabel="Search museums"
        placeholder="Museum or city"
        value={query}
        maxLength={LIMITS.searchMax}
        onChangeText={setQuery}
        autoCorrect={false}
        style={styles.input}
        returnKeyType="search"
      />
      {searching ? (
        <VisitMessage loading skeleton="list">
          Searching museums…
        </VisitMessage>
      ) : searchError ? (
        <VisitMessage action="Try again" onAction={() => setRetry((value) => value + 1)}>
          {searchError}
        </VisitMessage>
      ) : query.trim().length < 2 ? (
        <Text style={styles.caption}>Enter at least two characters.</Text>
      ) : venues.length === 0 && places.length === 0 ? (
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
      {venues.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="button"
          accessibilityLabel={`${row.name}, ${venueLocation(row).location || row.name}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          style={styles.card}
          onPress={() => choose(row)}
        >
          <Text style={styles.body}>{row.name}</Text>
          <Text style={styles.caption}>{venueLocation(row).location}</Text>
        </Pressable>
      ))}
      {venues.length === 0 && places.length > 0 && (
        <>
          <Text accessibilityRole="header" style={styles.caption}>
            From Apple Maps
          </Text>
          {places.map((place) => {
            const key = `${place.name}:${place.lat}:${place.lng}`;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${place.name}, ${placeLocation(place) || place.name}`}
                accessibilityState={{
                  busy: adding === key,
                  disabled: disabled || !!adding,
                }}
                disabled={disabled || !!adding}
                style={styles.card}
                onPress={() => {
                  void choosePlace(place);
                }}
              >
                <Text style={styles.body}>{place.name}</Text>
                <Text style={styles.caption}>{adding === key ? "Adding this museum…" : placeLocation(place)}</Text>
              </Pressable>
            );
          })}
        </>
      )}
      {venues.length === MUSEUM_SEARCH_LIMIT && (
        <Text style={styles.caption}>
          Showing the first {MUSEUM_SEARCH_LIMIT} museums. Add a city or more of the name to narrow your search.
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </>
  );
}
