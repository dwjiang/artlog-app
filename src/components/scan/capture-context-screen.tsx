import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { EmptyTicket } from "@/components/empty-state-art";
import { ListSkeleton } from "@/components/loading-skeleton";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { listVisits } from "@/db/repos/visits";
import { useLocalOwner } from "@/lib/account/owner-store";
import { readPhotoSession, updatePhotoSession, type CaptureVisitChoice } from "@/lib/capture/photo-draft";
import { captureVisitChoice } from "@/lib/capture/visit-choice";
import { formatVisitDate, formatVisitStart } from "@/lib/journal/history";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";
import { useVenue } from "@/lib/venue/use-venue";
import { planSaveVisit } from "@/lib/venue/venue-reducer";

import type { Id } from "../../../convex/_generated/dataModel";
import { venueVisitLabel } from "./capture-context-button";

/** The museum option is the venue itself: the visit there starts or resumes with the save. */
const VENUE_OPTION = "venue";

function optionValue(choice: CaptureVisitChoice): string {
  return choice.kind === "none" ? "none" : choice.kind === "visit" ? choice.localId : VENUE_OPTION;
}

/** Picks the visit for one capture. The choice lives on the draft, so the next scan resolves its own visit again. */
export function CaptureContextScreen() {
  const owner = useLocalOwner();
  const {
    draftId = "",
    visitId,
    venueId,
    capturedAt,
  } = useLocalSearchParams<{
    draftId?: string;
    visitId?: string;
    venueId?: string;
    capturedAt?: string;
  }>();
  return (
    <CaptureContext
      key={`${owner}:${draftId}`}
      owner={owner}
      draftId={draftId}
      visitId={visitId}
      venueId={venueId as Id<"museums"> | undefined}
      capturedAt={Number(capturedAt) || undefined}
    />
  );
}

function CaptureContext({
  owner,
  draftId,
  visitId,
  venueId,
  capturedAt,
}: {
  owner: string;
  draftId: string;
  visitId?: string;
  venueId?: Id<"museums">;
  capturedAt?: number;
}) {
  const visits = useLiveQuery(listVisits(owner), [owner]);
  useEffect(() => {
    if (visits.error) reportError(visits.error, "capture.load_visits");
  }, [visits.error]);
  const { visit: open } = useVenue();
  const [openedAt] = useState(Date.now);
  const captureTime = capturedAt ?? openedAt;
  const [selected, setSelected] = useState<string>(() =>
    optionValue(
      captureVisitChoice({ visitLocalId: visitId, venueId, capturedAt: captureTime }, readPhotoSession(owner, draftId)),
    ),
  );
  const [venue, setVenue] = useState<{
    name: string;
    visitedOn: string;
    timeZone: string;
    today: boolean;
    day: string;
  }>();
  const availableVisits = visits.data.filter((visit) => visit.owner === owner);
  const venueOption = venueId && !visitId ? venueId : undefined;
  const noVisits = !!visits.updatedAt && !visits.error && availableVisits.length === 0 && !venueOption;
  useEffect(() => {
    let active = true;
    if (!venueOption) return;
    void venueVisitLabel(venueOption, captureTime).then(
      (label) => {
        if (active) setVenue(label);
      },
      (error: unknown) => {
        reportError(error, "capture.load_visit_label", { level: "warning" });
      },
    );
    return () => {
      active = false;
    };
  }, [venueOption, captureTime]);
  // A save at the museum joins the open visit there, or for a past capture the visit on the books for its day, so that
  // visit stands in for the museum and is the marked option. Any other save starts a new visit.
  const plan = venue && venueOption && planSaveVisit(open, venueOption, { ...venue, at: captureTime }, openedAt);
  const venueVisit =
    plan === "join"
      ? availableVisits.find((visit) => visit.localId === open?.localId)
      : plan === "past"
        ? availableVisits.find((visit) => visit.venueId === venueOption && visit.visitedOn === venue?.visitedOn)
        : undefined;
  const marked = selected === VENUE_OPTION && venueVisit ? venueVisit.localId : selected;

  function choose(value: string, choice: CaptureVisitChoice) {
    try {
      updatePhotoSession(owner, draftId, { visit: choice });
      setSelected(value);
      router.back();
    } catch (error) {
      reportError(error, "capture.save_visit");
      showErrorToast("Couldn’t save this visit choice. Your previous selection is unchanged.", () =>
        choose(value, choice),
      );
    }
  }

  function option(value: string, choice: CaptureVisitChoice, label: string, detail?: string) {
    const current = marked === value;
    return (
      <Pressable
        key={value}
        accessibilityRole="button"
        accessibilityLabel={detail ? `${label} · ${detail}` : label}
        accessibilityState={{ selected: current }}
        onPress={() => choose(value, choice)}
        style={({ pressed }) => [
          styles.option,
          current ? styles.selected : styles.unselected,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.optionText}>
          <ThemedText style={current && styles.selectedLabel}>{label}</ThemedText>
          {detail && (
            <ThemedText type="small" themeColor="textSecondary">
              {detail}
            </ThemedText>
          )}
        </View>
        <ThemedText style={{ color: current ? Gallery.accent : Gallery.muted }}>{current ? "✓" : "○"}</ThemedText>
      </Pressable>
    );
  }

  return (
    <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: "Save this artwork to…" }} />
      <ThemedText themeColor="textSecondary">
        Only this artwork changes. The next scan joins the visit you are at.
      </ThemedText>
      <View>{option("none", { kind: "none" }, "Artwork only")}</View>
      {!noVisits && (
        <>
          <ThemedText type="subtitle">Your visits</ThemedText>
        </>
      )}
      {visits.error ? (
        <ThemedText themeColor="error" accessibilityRole="alert">
          Couldn’t load your visits. Close this screen and reopen it to try again.
        </ThemedText>
      ) : !visits.updatedAt ? (
        <ListSkeleton label="Loading visits…" rows={3} />
      ) : (
        noVisits && (
          <EmptyState
            visual={<EmptyTicket />}
            title="No visits yet."
            detail="Create a visit to remember where you saw this artwork. You can also save it on its own."
          >
            <ActionStack
              textActions={
                <GalleryButton label="Save artwork only" fullWidth onPress={() => choose("none", { kind: "none" })} />
              }
            >
              <GalleryButton
                label="Create a visit"
                icon="plus"
                variant="filled"
                fullWidth
                onPress={() => router.push("/visit-create")}
              />
            </ActionStack>
          </EmptyState>
        )
      )}
      <View>
        {venueOption
          && venue
          && !venueVisit
          && option(
            VENUE_OPTION,
            { kind: "venue", venueId: venueOption },
            venue.name,
            `${venue.day} · Starts with this artwork`,
          )}
        {availableVisits.map((visit) =>
          option(
            visit.localId,
            { kind: "visit", localId: visit.localId },
            visit.venueName,
            open?.localId === visit.localId
              ? `Since ${formatVisitStart(open.startedAt, open.timeZone)}`
              : formatVisitDate(visit.visitedOn),
          ),
        )}
      </View>
      {!noVisits && <GalleryButton label="Create a visit" icon="plus" onPress={() => router.push("/visit-create")} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  content: { padding: Spacing.content, gap: Spacing.four },
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.three,
    gap: Spacing.two,
  },
  unselected: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gallery.separator,
  },
  optionText: { flex: 1, gap: Spacing.one },
  selected: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
  },
  selectedLabel: { fontWeight: "600" },
  pressed: { opacity: 0.7 },
});
