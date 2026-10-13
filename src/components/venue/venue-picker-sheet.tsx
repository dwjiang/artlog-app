import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, type TextInput, View, useWindowDimensions } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { EmptyMap } from "@/components/empty-state-art";
import { ListIcon, ListRow, ListSection } from "@/components/list-row";
import { LoadingRing } from "@/components/loading-ring";
import { SearchField } from "@/components/search-field";
import { ThemedText } from "@/components/themed-text";
import { Gallery, PinnedFooterBorder, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { museumDay } from "@/lib/journal/visit-date";
import { reportError } from "@/lib/observability";
import type { MeasurementUnits } from "@/lib/settings/measurement-units";
import { useMeasurementUnits } from "@/lib/settings/use-measurement-units";
import { playErrorHaptic } from "@/lib/ui/haptics";
import { type VenueRow, formatDistance } from "@/lib/venue/resolve";
import { searchVenues } from "@/lib/venue/search-venues";
import { confirmVisitStarted } from "@/lib/venue/use-start-visit";
import { useVenue, type VenueView } from "@/lib/venue/use-venue";
import { venueLocation } from "@/lib/venue/venue-location";
import { venueOptionKey, type VenueOption } from "@/lib/venue/venue-reducer";

import { MuseumMap, useOptionCoordinates } from "./museum-map";

function optionDistance(option: VenueOption, units: MeasurementUnits | undefined): string | undefined {
  return (units && formatDistance(option.distanceM ?? Number.NaN, units)) || undefined;
}

function optionNote(option: VenueOption, nearest: boolean): string | undefined {
  const parts = [
    option.kind === "poi" && option.category !== "unknown" ? option.category : "",
    nearest ? "Nearest" : "",
  ];
  return parts.filter(Boolean).join(" · ") || undefined;
}

/**
 * One sheet for the venue pill, the open visit's Change Museum, Start visit and the location prompt. `mode=change` offers
 * to keep the open visit rather than leave the museum; a museum chosen from the prompt (`mode=choose`) or after Start
 * visit (`mode=start`) starts a visit there, ending one paused elsewhere. Only the prompt takes a swipe away as "Not here".
 */
export function VenuePickerSheet() {
  const router = useRouter();
  const view = useVenue();
  const { mode } = useLocalSearchParams<{ mode?: "choose" | "start" | "change" }>();
  return (
    <ChooserSheet
      view={view}
      starts={mode === "choose" || mode === "start"}
      prompted={mode === "choose"}
      keepVisit={mode === "change" && view.visit ? () => router.back() : undefined}
    />
  );
}

function ChooserSheet({
  view,
  starts,
  prompted,
  keepVisit,
}: {
  view: VenueView;
  starts: boolean;
  prompted: boolean;
  keepVisit?: () => void;
}) {
  const { units, failed: unitsFailed } = useMeasurementUnits();
  const displayUnits = units ?? (unitsFailed ? "metric" : undefined);
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const sheetStyle = [styles.groupedContainer, useFittedFormSheetStyle()];
  const { status, options, error, confirm, dismiss, declinePrompt, resolve, fix, visit, startVisit } = view;
  // Starting a visit asks on a map with the nearest museum selected; the mode is fixed when the sheet opens.
  const [picking, setPicking] = useState(() => starts && view.options.length > 0);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    () => view.options[0] && venueOptionKey(view.options[0]),
  );
  const coordinates = useOptionCoordinates(picking ? options : []);
  const [location, requestLocation] = Location.useForegroundPermissions();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    query: string;
    rows: VenueRow[];
    error?: string;
  }>();
  const searching = !!query.trim();
  useEffect(() => {
    if (!searching) return;
    let active = true;
    const timer = setTimeout(() => {
      void searchVenues(query)
        .then((rows) => {
          if (active) setResults({ query, rows });
        })
        .catch((cause) => {
          reportError(cause, "venue.search");
          if (active) {
            setResults({
              query,
              rows: [],
              error: "Museums could not load. Try another search.",
            });
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, searching]);
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const searchInput = useRef<TextInput>(null);
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const answered = useRef(false);
  // Swiping the location prompt away declines it like "Continue without a museum", so it does not reopen here.
  useEffect(
    () => () => {
      if (prompted && !answered.current) declinePrompt();
    },
    [prompted, declinePrompt],
  );
  // Settings lists location only once iOS has asked, and Allow Once lapses when Artlog quits, so iOS asks here, straight
  // away: a custom ask beside "Continue without a museum" would be a skippable pre-prompt, which 5.1.1(iv) rejects.
  const asked = useRef(false);
  const asking = status === "denied" && location?.canAskAgain !== false && !failure;
  useEffect(() => {
    if (status !== "denied" || !location?.canAskAgain || asked.current) return;
    asked.current = true;
    void requestLocation()
      .then((answer) => (answer.granted ? resolve() : undefined))
      .catch((cause: unknown) => {
        reportError(cause, "venue.request-location", { level: "warning" });
        setFailure("Could not ask for location.");
      });
  }, [status, location, requestLocation, resolve]);

  async function choose(option: VenueOption) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(venueOptionKey(option));
    setFailure(undefined);
    let starting = false;
    try {
      const venueId = await confirm(option, request.signal);
      if (request.signal.aborted) return;
      if (venueId) setSelectedKey(venueId);
      if (starts && venueId) {
        starting = true;
        const started = await startVisit(venueId, {
          signal: request.signal,
          replaceVisitLocalId: visit?.localId,
        });
        if (request.signal.aborted) return;
        if (started.localId !== visit?.localId) confirmVisitStarted();
      }
      answered.current = true;
      router.back();
    } catch (cause) {
      if (!request.signal.aborted) reportError(cause, starting ? "visit.start" : "venue.confirm");
      if (!request.signal.aborted) {
        playErrorHaptic();
        setFailure(
          starting
            ? "Couldn’t start the visit. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not confirm the venue. Try again.",
        );
      }
    } finally {
      if (!request.signal.aborted) setBusy(undefined);
      if (pending.current === request) pending.current = undefined;
    }
  }

  function notHere() {
    pending.current?.abort();
    answered.current = true;
    dismiss();
    router.back();
  }

  const emptyDetail = keepVisit
    ? "Search by museum or city, or keep your current visit."
    : "Search by museum or city. You can also keep scanning without a museum.";
  const locating = status === "locating" || asking;
  const nearbyEmpty = !searching && !locating && options.length === 0;
  const endsVisit = starts && visit ? `Your visit to ${visit.venueName} ends when a new one starts.` : undefined;
  const leaveButton = (
    <GalleryButton
      label={keepVisit ? "Keep current visit" : "Continue without a museum"}
      fullWidth
      onPress={keepVisit ?? notHere}
    />
  );
  if (picking) {
    const selected = options.find((option) => venueOptionKey(option) === selectedKey);
    const pins = options.flatMap((option) => {
      const key = venueOptionKey(option);
      const coordinate = coordinates.get(key);
      return coordinate ? [{ key, name: option.name, ...coordinate }] : [];
    });
    const center = fix ?? pins[0];
    // Large text would leave the pinned actions little room to list museums above them.
    const pinned = fontScale <= 1.4;
    const actions = (
      <>
        {(failure ?? error) && (
          <ThemedText selectable themeColor="error" accessibilityRole="alert">
            {failure ?? error}
          </ThemedText>
        )}
        <ActionStack
          textActions={<GalleryButton label="Search for another museum" fullWidth onPress={() => setPicking(false)} />}
        >
          <GalleryButton
            label="Start visit"
            variant="filled"
            fullWidth
            disabled={!selected}
            busy={!!busy}
            busyLabel="Starting…"
            onPress={() => {
              if (selected) void choose(selected);
            }}
          />
        </ActionStack>
      </>
    );
    // react-native-screens stretches a scroll view directly under the sheet, or first along its first-subview path, to
    // the whole sheet, under the pinned actions. The unflattened wrapper and empty first view keep this one off both.
    return (
      <View collapsable={false} style={sheetStyle}>
        <View collapsable={false} />
        <ScrollView
          accessibilityLabel="Nearby museums"
          style={styles.pickerScroll}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.content, pinned && styles.pinnedContent]}
          bounces={false}
        >
          <ThemedText type="title" accessibilityRole="header">
            Start a visit?
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {options.length > 1
              ? "More than one museum is within a short walk."
              : "The nearest museum is a short walk away."}
            {endsVisit && ` ${endsVisit}`}
          </ThemedText>
          {center && <MuseumMap center={center} pins={pins} selectedKey={selectedKey} onSelect={setSelectedKey} />}
          <ListSection>
            {options.map((option, index) => {
              const key = venueOptionKey(option);
              return (
                <ListRow
                  key={key}
                  first={index === 0}
                  last={index === options.length - 1}
                  title={option.name}
                  subtitle={optionNote(option, index === 0)}
                  detail={optionDistance(option, displayUnits)}
                  leading={<ListIcon name="building.columns" />}
                  accessory="check"
                  accessibilityRole="radio"
                  selected={key === selectedKey}
                  disabled={!!busy}
                  onPress={() => setSelectedKey(key)}
                />
              );
            })}
          </ListSection>
          {/* Stays live while a confirmation is pending: it cancels that confirmation, like the list's exit does. */}
          <ListRow first last title="Not at a museum" onPress={notHere} />
          {!pinned && actions}
        </ScrollView>
        {pinned && <View style={styles.pickerFooter}>{actions}</View>}
      </View>
    );
  }
  return (
    <ScrollView
      style={sheetStyle}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <ThemedText type="title" accessibilityRole="header">
        Choose museum
      </ThemedText>
      {endsVisit && <ThemedText themeColor="textSecondary">{endsVisit}</ThemedText>}
      <SearchField
        inputRef={searchInput}
        value={query}
        label="Search museums"
        placeholder="Museum or city"
        showLabel={false}
        onChange={setQuery}
        onClear={() => setQuery("")}
      />
      {searching ? (
        results?.query !== query ? (
          <LoadingRing accessibilityLabel="Searching museums" />
        ) : results.error ? (
          <ThemedText themeColor="error" accessibilityRole="alert">
            {results.error}
          </ThemedText>
        ) : results.rows.length === 0 ? (
          <EmptyState
            inset={false}
            title="No museums found."
            detail="Try the city or a shorter name."
            visual={<EmptyMap />}
          />
        ) : (
          <ListSection>
            {results.rows.map((row, index) => (
              <ListRow
                key={row.id}
                first={index === 0}
                last={index === results.rows.length - 1}
                title={row.name}
                query={query}
                subtitle={venueLocation(row).location}
                leading={<ListIcon name="building.columns" />}
                accessory="chevron"
                busy={busy === row.id}
                disabled={!!busy}
                onPress={() => {
                  void choose({
                    kind: "seeded",
                    venueId: row.id,
                    name: row.name,
                    manual: museumDay(row, Date.now()),
                  });
                }}
              />
            ))}
          </ListSection>
        )
      ) : locating ? (
        <LoadingRing accessibilityLabel="Locating your museum" />
      ) : options.length === 0 ? (
        <EmptyState
          inset={false}
          title={status === "denied" ? "Location access is off." : "No nearby museums found."}
          detail={
            status !== "denied" ? emptyDetail : `Allow location in Settings to find nearby museums. ${emptyDetail}`
          }
          visual={<EmptyMap />}
        >
          <ActionStack
            textActions={
              <>
                {status === "denied" && (
                  <GalleryButton
                    label="Open Settings"
                    fullWidth
                    onPress={() => {
                      void Linking.openSettings().catch((cause) => {
                        reportError(cause, "venue.open-settings", {
                          level: "warning",
                        });
                        setFailure("Could not open Settings.");
                      });
                    }}
                  />
                )}
                {leaveButton}
              </>
            }
          >
            <GalleryButton
              label="Search museums"
              variant="filled"
              fullWidth
              onPress={() => searchInput.current?.focus()}
            />
          </ActionStack>
        </EmptyState>
      ) : (
        <ListSection title="Nearby">
          {options.map((option, index) => (
            <ListRow
              key={venueOptionKey(option)}
              first={index === 0}
              last={index === options.length - 1}
              title={option.name}
              subtitle={optionNote(option, index === 0)}
              detail={optionDistance(option, displayUnits)}
              leading={<ListIcon name="building.columns" />}
              accessory="chevron"
              busy={busy === venueOptionKey(option)}
              disabled={!!busy}
              onPress={() => {
                void choose(option);
              }}
            />
          ))}
        </ListSection>
      )}
      {(failure ?? error) && (
        <ThemedText selectable themeColor="error" accessibilityRole="alert">
          {failure ?? error}
        </ThemedText>
      )}
      {!nearbyEmpty && leaveButton}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  groupedContainer: { backgroundColor: Gallery.groupedBackground },
  content: { padding: Spacing.content, paddingTop: Spacing.four, gap: Spacing.three },
  pickerScroll: { flexGrow: 0 },
  pinnedContent: { paddingBottom: 0 },
  pickerFooter: {
    padding: Spacing.content,
    paddingTop: Spacing.three,
    gap: Spacing.three,
    ...PinnedFooterBorder,
  },
});
