import { reportError } from "@/lib/observability";
import { venueMetadataForIds } from "@/lib/venue/venue-db";
import { SearchEmptyState } from "../empty-state";
import { Host } from "@expo/ui";
import { DatePicker } from "@expo/ui/swift-ui";
import { datePickerStyle, tint } from "@expo/ui/swift-ui/modifiers";
import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { upsertVisit } from "@/db/repos/visits";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { venueLocation } from "@/lib/venue/venue-location";
import {
  dateFromPicker,
  pickerDate,
  validVisitDate,
  venueTimeZone,
} from "@/lib/journal/visit-date";
import type { VenueRow } from "@/lib/venue/resolve";
import { MUSEUM_SEARCH_LIMIT, searchVenues } from "@/lib/venue/search-venues";
import { confirmPlace, useVenue } from "@/lib/venue/use-venue";
import type { PoiOption } from "@/lib/venue/venue-reducer";
import { getPoiSearch } from "../../../modules/poi-search/src";
import { countryName } from "@/lib/journal/history";
import { calendarDate, LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";
import { showToast } from "@/lib/ui/toast";
import { GalleryButton } from "../collection/gallery-button";
import { VisitMessage, VisitPage, visitStyles as styles } from "./visit-ui";

export function VisitCreateScreen() {
  const owner = useLocalOwner();
  const { savedId, venueId } = useLocalSearchParams<{
    savedId?: string;
    venueId?: string;
  }>();
  return (
    <CreateForm
      key={`${owner}:${savedId ?? ""}:${venueId ?? ""}`}
      savedId={savedId}
      initialVenueId={venueId}
    />
  );
}
/** Apple Maps is asked only when our table has nothing for the name; a short query would match too much of the world. */
const PLACE_SEARCH_MIN = 3;

async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number },
): Promise<PoiOption[]> {
  if (query.trim().length < PLACE_SEARCH_MIN) return [];
  const places = await getPoiSearch().searchByName(query, near?.lat, near?.lng);
  return places.map((place) => ({
    kind: "poi",
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
    ...(place.distanceMeters === undefined
      ? {}
      : { distanceM: place.distanceMeters }),
    city: place.city,
    country: place.country,
    ...(place.website ? { website: place.website } : {}),
  }));
}

export function placeLocation(place: PoiOption): string {
  return [place.city, countryName(place.country)].filter(Boolean).join(", ");
}

function CreateForm({
  savedId,
  initialVenueId,
}: {
  savedId?: string;
  initialVenueId?: string;
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
  const [venue, setVenue] = useState<VenueRow>();
  const [adding, setAdding] = useState<string>();
  const [now] = useState(Date.now);
  const [date, setDate] = useState(() => dateFromPicker(new Date(now)));
  useEffect(() => {
    if (!initialVenueId) return;
    let active = true;
    void venueMetadataForIds([initialVenueId])
      .then((rows) => {
        if (active && rows[0]) {
          setVenue(rows[0]);
          const museumToday = calendarDate(now, venueTimeZone(rows[0]));
          setDate((current) => (current > museumToday ? museumToday : current));
        }
      })
      .catch((cause) => reportError(cause, "visit.venue.load"));
    return () => {
      active = false;
    };
  }, [initialVenueId, now]);
  const [retry, setRetry] = useState(0);
  const [reflection, setReflection] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const submitting = useRef(false);
  const [localId] = useState(randomUUID);
  const timeZone = venue
    ? venueTimeZone(venue)
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = calendarDate(now, timeZone);
  const validDate = validVisitDate(date, timeZone, now);
  const currentResults =
    results?.query === query && results.retry === retry ? results : undefined;
  const venues = currentResults?.rows ?? [];
  const places = currentResults?.places ?? [];
  const searchError = currentResults?.error;
  const searching = !venue && query.trim().length >= 2 && !currentResults;
  useEffect(() => {
    let active = true;
    if (venue || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      void searchVenues(query)
        .then(async (rows) => {
          if (rows.length) return { rows, places: [] };
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
  }, [query, venue, retry, fix]);
  function chooseVenue(row: VenueRow) {
    setVenue(row);
    Keyboard.dismiss();
    // The device may already be on a later calendar day than the museum.
    const museumToday = calendarDate(now, venueTimeZone(row));
    setDate((current) => (current > museumToday ? museumToday : current));
  }
  /** A place from Apple Maps becomes a museum for everyone before this visit can use it. */
  async function choosePlace(place: PoiOption) {
    if (adding) return;
    const key = `${place.name}:${place.lat}:${place.lng}`;
    const session = captureOwner();
    setAdding(key);
    setError(undefined);
    try {
      const row = await confirmPlace(place, () => session.isOwnerCurrent());
      if (row) chooseVenue(row);
    } catch (cause) {
      reportError(cause, "visit.venue.confirm");
      if (session.isOwnerCurrent()) {
        setError(
          socialErrorMessage(cause)
            ?? "This museum could not be added. Check your connection and try again.",
        );
      }
    } finally {
      if (session.isOwnerCurrent()) setAdding(undefined);
    }
  }
  async function save() {
    if (!venue || submitting.current || !validDate) return;
    const session = captureOwner();
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    Keyboard.dismiss();
    try {
      await upsertVisit(
        {
          localId,
          venueId: venue.id,
          venueName: venue.name,
          visitedOn: date,
          timeZone,
          visibility: "private",
          reflection: reflection.trim() || null,
        },
        session.owner,
        savedId,
      );
      if (session.isOwnerCurrent()) {
        showToast(
          savedId
            ? "New visit linked. Other photos are unchanged."
            : "Visit saved.",
        );
        if (savedId) {
          router.dismissTo({
            pathname: "/saved/[savedId]",
            params: { savedId, visitId: localId },
          });
        } else router.back();
      }
    } catch (cause) {
      reportError(cause, "visit.create");
      if (session.isOwnerCurrent()) {
        setError(
          socialErrorMessage(cause)
            ?? "Your visit could not be saved. Try again.",
        );
      }
    } finally {
      if (session.isOwnerCurrent()) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          hidesSharedBackground
          tintColor={Gallery.accent}
          onPress={() => router.back()}
          disabled={busy}
        >
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <VisitPage>
        <Text style={styles.caption}>
          {savedId
            ? "This visit will be linked to your artwork when you save."
            : "You can save a visit without adding artworks."}
        </Text>
        <Text accessibilityRole="header" style={styles.heading}>
          Museum
        </Text>
        {venue ? (
          <View style={styles.card}>
            <Text style={styles.body}>{venue.name}</Text>
            <Text style={styles.caption}>{venueLocation(venue).location}</Text>
            <GalleryButton
              label="Change museum"
              disabled={busy}
              onPress={() => setVenue(undefined)}
            />
          </View>
        ) : (
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
              <VisitMessage
                action="Try again"
                onAction={() => setRetry((value) => value + 1)}
              >
                {searchError}
              </VisitMessage>
            ) : query.trim().length < 2 ? (
              <Text style={styles.caption}>Enter at least two characters.</Text>
            ) : !venues.length && !places.length ? (
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
                style={styles.card}
                onPress={() => chooseVenue(row)}
              >
                <Text style={styles.body}>{row.name}</Text>
                <Text style={styles.caption}>
                  {venueLocation(row).location}
                </Text>
              </Pressable>
            ))}
            {!venues.length && places.length > 0 && (
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
                        disabled: !!adding,
                      }}
                      disabled={!!adding}
                      style={styles.card}
                      onPress={() => {
                        void choosePlace(place);
                      }}
                    >
                      <Text style={styles.body}>{place.name}</Text>
                      <Text style={styles.caption}>
                        {adding === key
                          ? "Adding this museum…"
                          : placeLocation(place)}
                      </Text>
                    </Pressable>
                  );
                })}
              </>
            )}
            {venues.length === MUSEUM_SEARCH_LIMIT && (
              <Text style={styles.caption}>
                Showing the first {MUSEUM_SEARCH_LIMIT} museums. Add a city or
                more of the name to narrow your search.
              </Text>
            )}
          </>
        )}
        <View
          style={{
            padding: 14,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: Gallery.controlBorder,
            backgroundColor: Gallery.surface,
          }}
        >
          <Host matchContents={{ vertical: true }} colorScheme="light">
            <DatePicker
              title="Visit date"
              selection={pickerDate(date)}
              range={{ end: pickerDate(today) }}
              displayedComponents={["date"]}
              onDateChange={(value) => setDate(dateFromPicker(value))}
              modifiers={[datePickerStyle("compact"), tint(Gallery.accent)]}
            />
          </Host>
        </View>
        {!validDate && (
          <Text accessibilityRole="alert" style={styles.error}>
            Choose today or an earlier date at this museum.
          </Text>
        )}
        <Text accessibilityRole="header" style={styles.heading}>
          Notes
        </Text>
        <TextInput
          keyboardAppearance="light"
          selectionColor={Gallery.accent}
          accessibilityLabel="Notes"
          value={reflection}
          onChangeText={setReflection}
          multiline
          maxLength={LIMITS.note}
          editable={!busy}
          style={[styles.input, styles.reflection]}
        />
        <Text style={styles.caption}>
          Your visit stays private until you share it.
        </Text>
        <GalleryButton
          label="Add visit"
          variant="filled"
          fullWidth
          busy={busy}
          disabled={busy || !venue || !validDate}
          onPress={() => {
            void save();
          }}
        />
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </VisitPage>
    </>
  );
}
