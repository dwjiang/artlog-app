import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { ListIcon, ListRow, ListSection } from "@/components/list-row";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { reportError } from "@/lib/observability";
import { useMeasurementUnits } from "@/lib/settings/use-measurement-units";
import { playErrorHaptic } from "@/lib/ui/haptics";
import { formatDistance } from "@/lib/venue/resolve";
import { confirmVisitStarted } from "@/lib/venue/use-start-visit";
import { useVenue } from "@/lib/venue/use-venue";

/**
 * "Add visit" asks which kind: a visit starting now at the museum the phone is at, which later saves there join, or
 * one logged for an earlier day. The first option only appears while a museum is resolved and no visit is open.
 */
export function VisitAddSheet() {
  const { venue, visit, startVisit } = useVenue();
  const { units, failed: unitsFailed } = useMeasurementUnits();
  const sheetStyle = [styles.container, useFittedFormSheetStyle()];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const here = !visit && venue ? venue : undefined;
  const distance =
    here?.distanceM === undefined
      ? undefined
      : formatDistance(here.distanceM, units ?? (unitsFailed ? "metric" : "metric"));

  const startDetail = here
    ? `${here.name}${distance ? ` · ${distance}` : ""}. Artworks you scan there join it until you end it.`
    : undefined;
  const pastDetail = "Pick the museum and the day. Link artworks later.";

  async function start() {
    if (!here || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await startVisit(here.venueId);
      confirmVisitStarted();
      router.back();
    } catch (cause) {
      reportError(cause, "visit.start");
      playErrorHaptic();
      setError("Couldn’t start the visit. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={sheetStyle}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      bounces={false}
    >
      <ThemedText type="subtitle" accessibilityRole="header">
        Add visit
      </ThemedText>
      {visit && (
        <ThemedText variant="secondary" themeColor="textSecondary">
          Your visit to {visit.venueName} is in progress.
        </ThemedText>
      )}
      <ListSection>
        {here && (
          <ListRow
            first
            title="Start a visit here"
            subtitle={startDetail}
            accessibilityHint={startDetail}
            leading={<ListIcon name="building.columns" />}
            accessory="chevron"
            busy={busy}
            disabled={busy}
            onPress={() => void start()}
          />
        )}
        <ListRow
          first={!here}
          last
          title="Log a past visit"
          subtitle={pastDetail}
          accessibilityHint={pastDetail}
          leading={<ListIcon name="calendar" />}
          accessory="chevron"
          disabled={busy}
          onPress={() => router.replace("/visit-create")}
        />
      </ListSection>
      {error && (
        <ThemedText themeColor="error" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: Gallery.groupedBackground },
  content: { padding: Spacing.content, paddingTop: Spacing.four, gap: Spacing.three },
});
