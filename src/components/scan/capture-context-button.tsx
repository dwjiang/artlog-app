import tzLookup from "@photostructure/tz-lookup";
import { Image } from "expo-image";
import { useFocusEffect, router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { TextSkeleton } from "@/components/loading-skeleton";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { getVisit } from "@/db/repos/visits";
import type { Visit } from "@/db/schema";
import { useLocalOwner } from "@/lib/account/owner-store";
import { readPhotoSession } from "@/lib/capture/photo-draft";
import { captureVisitChoice } from "@/lib/capture/visit-choice";
import { formatVisitDate } from "@/lib/journal/history";
import { reportError } from "@/lib/observability";
import { venueMetadataForIds } from "@/lib/venue/venue-db";
import { isVisitToday } from "@/lib/venue/venue-reducer";
import { calendarDate } from "@/shared/journal/limits";

import type { Id } from "../../../convex/_generated/dataModel";

function dayLabel(visitedOn: string, today: boolean): string {
  return today ? "Today" : formatVisitDate(visitedOn);
}

type VisitSummary = { name: string; day: string } | "none" | "unavailable";

function visitSummary(visit: Pick<Visit, "venueName" | "visitedOn" | "timeZone">, now = Date.now()): VisitSummary {
  return {
    name: visit.venueName,
    day: dayLabel(visit.visitedOn, isVisitToday(visit, now)),
  };
}

// The row leads with the day so a long museum name truncates before the date does.
function formatVisit(summary: VisitSummary, variant: "chip" | "row"): string {
  if (summary === "none") return variant === "chip" ? "No visit" : "None";
  if (summary === "unavailable") {
    return variant === "chip" ? "Visit unavailable" : "Unavailable";
  }
  return variant === "chip" ? `${summary.name} · ${summary.day}` : `${summary.day} · ${summary.name}`;
}

/** The museum a save starts or joins a visit at, with the visit's day taken from the capture in the museum's time zone. */
export async function venueVisitLabel(
  venueId: Id<"museums">,
  capturedAt: number,
  now = Date.now(),
): Promise<{ name: string; visitedOn: string; timeZone: string; today: boolean; day: string } | undefined> {
  const [venue] = await venueMetadataForIds([venueId]);
  if (!venue) return undefined;
  const timeZone = tzLookup(venue.lat, venue.lng);
  const visitedOn = calendarDate(capturedAt, timeZone);
  const today = isVisitToday({ visitedOn, timeZone }, now);
  return {
    name: venue.name,
    visitedOn,
    timeZone,
    today,
    day: dayLabel(visitedOn, today),
  };
}

export type CaptureContextCapture = {
  photoPath: string;
  visitLocalId?: string | null;
  venueId?: Id<"museums"> | null;
  capturedAt?: number;
};

/** The visit this capture will save to: its own, the museum it was scanned at, or the draft's override. Tapping picks another for this shot only. The row variant sits in a save bar. */
export function CaptureContextButton({
  capture,
  disabled,
  variant = "chip",
}: {
  capture: CaptureContextCapture;
  disabled?: boolean;
  variant?: "chip" | "row";
}) {
  const owner = useLocalOwner();
  const [summary, setSummary] = useState<VisitSummary>();
  const { photoPath: draftId, visitLocalId, venueId, capturedAt } = capture;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        const choice = captureVisitChoice({ visitLocalId, venueId, capturedAt }, readPhotoSession(owner, draftId));
        let next: VisitSummary = "none";
        if (choice.kind === "visit") {
          const visit = await getVisit(choice.localId, owner);
          next = visit ? visitSummary(visit) : "unavailable";
        } else if (choice.kind === "venue") {
          const venue = await venueVisitLabel(choice.venueId, capturedAt ?? Date.now());
          next = venue ? { name: venue.name, day: venue.day } : "unavailable";
        }
        if (active) setSummary(next);
      }
      void load().catch((error: unknown) => {
        reportError(error, "capture.load_visit_context", { level: "warning" });
        if (active) setSummary("unavailable");
      });
      return () => {
        active = false;
      };
    }, [owner, draftId, visitLocalId, venueId, capturedAt]),
  );
  const label = summary && formatVisit(summary, variant);
  const row = variant === "row";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? `${row ? `Visit: ${label}` : label} · Change` : "Loading visit…"}
      accessibilityHint="Chooses the visit for this artwork"
      accessibilityState={{ disabled: !!disabled || !label, busy: !label }}
      disabled={disabled || !label}
      onPress={() =>
        router.push({
          pathname: "/capture-context",
          params: {
            draftId,
            visitId: visitLocalId ?? undefined,
            venueId: venueId ?? undefined,
            capturedAt: capturedAt === undefined ? undefined : String(capturedAt),
          },
        })
      }
      style={({ pressed }) => [row ? styles.row : styles.chip, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Image source="sf:mappin.and.ellipse" tintColor={Gallery.muted} style={styles.icon} />
      <View style={row ? styles.rowText : styles.chipText}>
        {row && (
          <ThemedText variant="metadata" themeColor="textSecondary">
            Visit
          </ThemedText>
        )}
        {label ? (
          <ThemedText type="smallBold" numberOfLines={row ? undefined : 1} style={styles.label}>
            {label}
          </ThemedText>
        ) : (
          <TextSkeleton label="Loading visit…" width={140} />
        )}
      </View>
      <Image source={row ? "sf:chevron.right" : "sf:chevron.down"} tintColor={Gallery.muted} style={styles.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingLeft: Spacing.compact,
    paddingRight: Spacing.compact,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Gallery.ink,
    backgroundColor: Gallery.surface,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.compact,
  },
  rowText: { flex: 1, gap: Spacing.half },
  chipText: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  icon: { width: 16, height: 16 },
  chevron: { width: 10, height: 10 },
  label: { flexShrink: 1, fontSize: 15, lineHeight: 20 },
});
