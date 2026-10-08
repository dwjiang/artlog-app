import { randomUUID } from "expo-crypto";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ListSkeleton } from "@/components/loading-skeleton";
import { useRichTextInput } from "@/components/social/rich-text-input";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery } from "@/constants/theme";
import { upsertVisit } from "@/db/repos/visits";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { useVisits } from "@/lib/journal/use-visits";
import { dateFromPicker, museumDayAtMost, validVisitDate, venueTimeZone } from "@/lib/journal/visit-date";
import { useMakeVisit } from "@/lib/journal/visitless-saves";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import type { VenueRow } from "@/lib/venue/resolve";
import { useVenue } from "@/lib/venue/use-venue";
import { venueMetadataForIds } from "@/lib/venue/venue-db";
import { venueLocation } from "@/lib/venue/venue-location";
import { calendarDate, LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { MuseumSearch } from "./museum-search";
import { VisitDatePicker } from "./visit-date-picker";
import { CancelToolbar, CommitToolbar } from "./visit-sheet-toolbar";
import { VisitMessage, VisitPage, visitStyles as styles } from "./visit-ui";

function VisitFormPage({ children }: { children: ReactNode }) {
  const { bottom } = useSafeAreaInsets();
  return (
    <>
      <VisitPage style={{ backgroundColor: Gallery.groupedBackground }}>{children}</VisitPage>
      <ToastLayer offset={-bottom} />
    </>
  );
}

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
  const tagging = useRichTextInput({
    text: reflection,
    onChangeText: setReflection,
    maxLength: LIMITS.note,
    editable: !busy,
    place: { kind: "visit", audience: "private", companionIds: [] },
    docked: true,
  });
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
      <CancelToolbar disabled={busy} onPress={() => router.back()} />
      <CommitToolbar
        label="Add"
        busyLabel="Adding visit"
        busy={busy}
        disabled={!venue || !validDate}
        onPress={() => {
          void save();
        }}
      />

      <VisitFormPage>
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
          {...tagging.inputProps}
          multiline
          style={[styles.input, styles.reflection]}
        />
        {tagging.suggestions}
        <Text style={styles.caption}>Your visit stays private until you share it.</Text>
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </VisitFormPage>
    </>
  );
}

/** Picks the museum for saves that missed a visit, then files them under its visit for their day. */
export function AddToVisitScreen() {
  const { savedIds, capturedAt, photoIds } = useLocalSearchParams<{
    savedIds?: string;
    capturedAt?: string;
    photoIds?: string;
  }>();
  const navigation = useNavigation();
  const { busy, make } = useMakeVisit({
    onAdded: () => {
      if (navigation.isFocused()) router.back();
    },
  });
  const ids = savedIds?.split(",").filter(Boolean) ?? [];
  const capture =
    capturedAt !== undefined && photoIds !== undefined && Number.isSafeInteger(Number(capturedAt))
      ? { capturedAt: Number(capturedAt), photoIds: photoIds.split(",").filter(Boolean) }
      : undefined;
  return (
    <>
      <CancelToolbar disabled={busy} onPress={() => router.back()} />
      <VisitFormPage>
        <MuseumSearch disabled={busy} onChoose={(row) => make(ids, row.id, capture)} />
      </VisitFormPage>
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
      if (session.isOwnerCurrent()) showErrorToast("Couldn’t change the museum.", () => void choose(row));
    } finally {
      if (session.isOwnerCurrent()) setBusy(false);
    }
  }
  return (
    <>
      <CancelToolbar onPress={cancel} />
      <VisitFormPage>
        {visit ? (
          <>
            <MuseumSearch
              disabled={busy}
              onChoose={(row) => {
                void choose(row);
              }}
            />
          </>
        ) : loading && !error ? (
          <ListSkeleton label="Loading visit…" rows={3} card />
        ) : (
          <VisitMessage>{error ? "This visit could not load." : "This visit is unavailable."}</VisitMessage>
        )}
      </VisitFormPage>
    </>
  );
}
