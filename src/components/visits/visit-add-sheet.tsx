import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText } from "@/components/themed-text";
import { Colors, Gallery, Radius, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { reportError } from "@/lib/observability";
import { useMeasurementUnits } from "@/lib/settings/use-measurement-units";
import { showToast } from "@/lib/ui/toast";
import { formatDistance } from "@/lib/venue/resolve";
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

  async function start() {
    if (!here || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await startVisit(here.venueId);
      showToast("Visit started.");
      router.back();
    } catch (cause) {
      reportError(cause, "visit.start");
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
      {here && (
        <Option
          icon="building.columns"
          title="Start a visit here"
          detail={`${here.name}${distance ? ` · ${distance}` : ""}. Artworks you scan there join it until you end it.`}
          busy={busy}
          onPress={() => void start()}
        />
      )}
      {visit && (
        <ThemedText variant="secondary" themeColor="textSecondary">
          Your visit to {visit.venueName} is in progress.
        </ThemedText>
      )}
      <Option
        icon="calendar"
        title="Log a past visit"
        detail="Pick the museum and the day. Link artworks later."
        disabled={busy}
        onPress={() => router.replace("/visit-create")}
      />
      {error && (
        <ThemedText themeColor="error" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
    </ScrollView>
  );
}

function Option({
  icon,
  title,
  detail,
  busy = false,
  disabled = false,
  onPress,
}: {
  icon: string;
  title: string;
  detail: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}
    >
      <View style={styles.glyph}>
        <Image source={`sf:${icon}`} tintColor={Gallery.accent} style={styles.glyphIcon} />
      </View>
      <View style={styles.optionText}>
        <ThemedText style={styles.optionTitle}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      {busy ? (
        <LoadingRing accessibilityLabel="Starting the visit" />
      ) : (
        <Image source="sf:chevron.right" tintColor={Gallery.muted} style={styles.chevron} accessible={false} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, paddingTop: Spacing.four, gap: Spacing.three },
  option: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    paddingVertical: Spacing.two,
  },
  pressed: { opacity: 0.6 },
  glyph: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Gallery.highlight,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphIcon: { width: 22, height: 22 },
  optionText: { flex: 1, gap: Spacing.half },
  optionTitle: { fontWeight: "600" },
  chevron: { width: 10, height: 16 },
});
