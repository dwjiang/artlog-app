import { randomUUID } from "expo-crypto";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, TextInput, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { upsertVisit } from "@/db/repos/visits";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { useVisits } from "@/lib/journal/use-visits";
import { dateFromPicker, museumDayAtMost, validVisitDate, venueTimeZone } from "@/lib/journal/visit-date";
import { reportError } from "@/lib/observability";
import { showToast } from "@/lib/ui/toast";
import type { VenueRow } from "@/lib/venue/resolve";
import { useVenue } from "@/lib/venue/use-venue";
import { venueMetadataForIds } from "@/lib/venue/venue-db";
import { venueLocation } from "@/lib/venue/venue-location";
import { calendarDate, LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { MuseumSearch } from "./museum-search";
import { VisitDatePicker } from "./visit-date-picker";
import { VisitMessage, VisitPage, visitStyles as styles } from "./visit-ui";

export function VisitCreateScreen() {
  const owner = useLocalOwner();
  const { savedId, venueId } = useLocalSearchParams<{
    savedId?: string;
    venueId?: string;
  }>();
  return <CreateForm key={`${owner}:${savedId ?? ""}:${venueId ?? ""}`} savedId={savedId} initialVenueId={venueId} />;
}
function CreateForm({ savedId, initialVenueId }: { savedId?: string; initialVenueId?: string }) {
  const [venue, setVenue] = useState<VenueRow>();
  const [now] = useState(Date.now);
  const [date, setDate] = useState(() => dateFromPicker(new Date(now)));
  useEffect(() => {
    if (!initialVenueId) return;
    let active = true;
    void venueMetadataForIds([initialVenueId])
      .then((rows) => {
        const [row] = rows;
        if (active && row) {
          setVenue(row);
          setDate((current) => museumDayAtMost(current, venueTimeZone(row), now));
        }
      })
      .catch((cause) => reportError(cause, "visit.venue.load"));
    return () => {
      active = false;
    };
  }, [initialVenueId, now]);
  const [reflection, setReflection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const [localId] = useState(randomUUID);
  const timeZone = venue ? venueTimeZone(venue) : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = calendarDate(now, timeZone);
  const validDate = validVisitDate(date, timeZone, now);
  function chooseVenue(row: VenueRow) {
    setVenue(row);
    // The device may already be on a later calendar day than the museum.
    setDate((current) => museumDayAtMost(current, venueTimeZone(row), now));
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
        showToast(savedId ? "New visit linked. Other photos are unchanged." : "Visit saved.");
        if (savedId) {
          router.dismissTo({
            pathname: "/saved/[savedId]",
            params: { savedId, visitId: localId },
          });
        } else {
          router.back();
        }
      }
    } catch (cause) {
      reportError(cause, "visit.create");
      if (session.isOwnerCurrent()) {
        setError(socialErrorMessage(cause) ?? "Your visit could not be saved. Try again.");
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
            <GalleryButton label="Change museum" disabled={busy} onPress={() => setVenue(undefined)} />
          </View>
        ) : (
          <MuseumSearch onChoose={chooseVenue} disabled={busy} />
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
          <VisitDatePicker value={date} latest={today} onChange={setDate} />
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
        <Text style={styles.caption}>Your visit stays private until you share it.</Text>
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

/** Moves a visit to another museum, keeping its day unless that is still in the future there. */
export function VisitMuseumScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  const { move } = useVenue();
  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState<string>();
  const active = useRef(true);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
      };
    }, []),
  );
  function cancel() {
    active.current = false;
    router.back();
  }
  async function choose(row: VenueRow) {
    const session = captureOwner();
    if (!active.current || !visit || busy || session.owner !== visit.owner) return;
    if (row.id === visit.venueId) {
      router.back();
      return;
    }
    setBusy(true);
    setMoveError(undefined);
    try {
      const timeZone = venueTimeZone(row);
      await move(visit.localId, {
        venueId: row.id,
        venueName: row.name,
        timeZone,
        visitedOn: museumDayAtMost(visit.visitedOn, timeZone),
      });
      if (active.current && session.isOwnerCurrent()) router.back();
    } catch (cause) {
      reportError(cause, "visit.move.museum");
      if (session.isOwnerCurrent()) setMoveError("The museum could not be changed. Try again.");
    } finally {
      if (session.isOwnerCurrent()) setBusy(false);
    }
  }
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button hidesSharedBackground tintColor={Gallery.accent} onPress={cancel}>
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <VisitPage>
        {visit ? (
          <>
            <MuseumSearch
              disabled={busy}
              onChoose={(row) => {
                void choose(row);
              }}
            />
            {moveError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {moveError}
              </Text>
            )}
          </>
        ) : (
          <VisitMessage loading={loading && !error} skeleton="list">
            {error ? "This visit could not load." : loading ? "Loading visit…" : "This visit is unavailable."}
          </VisitMessage>
        )}
      </VisitPage>
    </>
  );
}
