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
import { TextSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { SearchField } from "@/components/search-field";
import { ThemedText } from "@/components/themed-text";
import { ArtworkPreviews, VisitSymbol } from "@/components/visits/visit-ui";
import { Colors, Gallery, PinnedFooterBorder, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisits } from "@/lib/journal/use-visits";
import { museumDay } from "@/lib/journal/visit-date";
import { reportError } from "@/lib/observability";
import type { MeasurementUnits } from "@/lib/settings/measurement-units";
import { useMeasurementUnits } from "@/lib/settings/use-measurement-units";
import { type VenueRow, formatDistance } from "@/lib/venue/resolve";
import { searchVenues } from "@/lib/venue/search-venues";
import { useVenue, type VenueView } from "@/lib/venue/use-venue";
import { venueLocation } from "@/lib/venue/venue-location";
import { activeVisit, venueOptionKey, type CurrentVisit, type VenueOption } from "@/lib/venue/venue-reducer";

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
 * One sheet for the venue pill, the visit bar and the location prompt: the visit open at this museum, or the chooser.
 * A visit paused elsewhere opens the chooser like `mode=choose` does; "Not here" then leaves that visit alone.
 */
export function VenuePickerSheet() {
  const view = useVenue();
  const { mode: requested } = useLocalSearchParams<{ mode?: string }>();
  const { visit } = view;
  // The mode is fixed when the sheet opens: a confirmation in the chooser closes the sheet rather than flipping it.
  const [mode, setMode] = useState<"visit" | "change" | "choose">(
    activeVisit(view) && requested !== "choose" ? "visit" : "choose",
  );
  if (mode === "visit" && visit && view.status !== "denied") {
    return <VisitSheet visit={visit} onChange={() => setMode("change")} />;
  }
  return (
    <ChooserSheet
      view={view}
      prompted={requested === "choose"}
      keepVisit={visit && mode === "change" ? () => setMode("visit") : undefined}
    />
  );
}

/** The open visit at this museum: its header opens the visit detail; the two actions change the museum or end it. */
function VisitSheet({ visit, onChange }: { visit: CurrentVisit; onChange: () => void }) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const { visits, loading, error } = useVisits();
  const summary = visits.find((row) => row.localId === visit.localId);
  const works = summary?.works ?? [];
  const sheetStyle = [styles.container, useFittedFormSheetStyle()];
  const since = `Since ${formatVisitStart(visit.startedAt, visit.timeZone)}`;
  const count = `${works.length} ${works.length === 1 ? "artwork" : "artworks"} this visit`;
  const details =
    loading && !error
      ? undefined
      : error
        ? "Artwork count unavailable"
        : summary?.location
          ? `${summary.location} · ${count}`
          : count;
  const meta = details ? `${since} · ${details}` : since;
  const stacked = fontScale >= 1.5;
  return (
    <ScrollView
      style={sheetStyle}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      bounces={false}
    >
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`${visit.venueName}, ${meta}`}
        accessibilityHint="Opens the visit"
        onPress={() =>
          router.replace({
            pathname: "/journal/[visitId]",
            params: { visitId: visit.localId },
          })
        }
        style={styles.header}
      >
        <View style={styles.headerText}>
          <ThemedText type="title">{visit.venueName}</ThemedText>
          <ThemedText themeColor="textSecondary">{meta}</ThemedText>
          {!details && <TextSkeleton label="Loading visit artwork count" width={180} />}
        </View>
        <VisitSymbol name="chevron.right" size={13} />
      </MotionPressable>
      {works.length > 0 && <ArtworkPreviews works={works} overflow />}
      <View style={stacked ? styles.stackedActions : styles.actions}>
        <View style={stacked ? undefined : styles.action}>
          <GalleryButton label="Change museum" variant="outlined" fullWidth onPress={onChange} />
        </View>
        <View style={stacked ? undefined : styles.action}>
          <GalleryButton
            label="End visit"
            variant="filled"
            fullWidth
            onPress={() =>
              router.replace({
                pathname: "/journal/[visitId]",
                params: { visitId: visit.localId, endVisit: "true" },
              })
            }
          />
        </View>
      </View>
    </ScrollView>
  );
}

function ChooserSheet({ view, prompted, keepVisit }: { view: VenueView; prompted: boolean; keepVisit?: () => void }) {
  const { units, failed: unitsFailed } = useMeasurementUnits();
  const displayUnits = units ?? (unitsFailed ? "metric" : undefined);
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const sheetStyle = [styles.groupedContainer, useFittedFormSheetStyle()];
  const { status, options, error, confirm, dismiss, declinePrompt, resolve, fix } = view;
  // The location prompt asks on a map with the nearest museum selected; the mode is fixed when the sheet opens.
  const [picking, setPicking] = useState(() => prompted && view.options.length > 0);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    () => view.options[0] && venueOptionKey(view.options[0]),
  );
  const coordinates = useOptionCoordinates(picking ? options : []);
  // Settings lists location only once iOS has asked, so a permission never answered is asked for here instead.
  const [location, requestLocation] = Location.useForegroundPermissions();
  const askable = location?.canAskAgain !== false;
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

  async function choose(option: VenueOption) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(venueOptionKey(option));
    setFailure(undefined);
    try {
      await confirm(option, request.signal);
      if (request.signal.aborted) return;
      answered.current = true;
      router.back();
    } catch (cause) {
      if (!request.signal.aborted) reportError(cause, "venue.confirm");
      if (!request.signal.aborted) {
        setFailure(cause instanceof Error ? cause.message : "Could not confirm the venue. Try again.");
      }
    } finally {
      if (!request.signal.aborted) setBusy(undefined);
      if (pending.current === request) pending.current = undefined;
    }
  }

  function allowLocation() {
    setFailure(undefined);
    void requestLocation()
      .then((answer) => (answer.granted ? resolve() : undefined))
      .catch((cause: unknown) => {
        reportError(cause, "venue.request-location", { level: "warning" });
        setFailure("Could not ask for location.");
      });
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
  const nearbyEmpty = !searching && status !== "locating" && options.length === 0;
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
            label="Continue"
            variant="filled"
            fullWidth
            disabled={!selected}
            busy={!!busy}
            busyLabel="Confirming…"
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
            Which museum are you in?
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {options.length > 1
              ? "More than one museum is within a short walk."
              : "The nearest museum is a short walk away."}
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
      ) : status === "locating" ? (
        <LoadingRing accessibilityLabel="Locating your museum" />
      ) : options.length === 0 ? (
        <EmptyState
          inset={false}
          title={status === "denied" ? "Location access is off." : "No nearby museums found."}
          detail={
            status !== "denied"
              ? emptyDetail
              : `Allow location${askable ? "" : " in Settings"} to find nearby museums. ${emptyDetail}`
          }
          visual={<EmptyMap />}
        >
          <ActionStack
            textActions={
              <>
                {status === "denied" && askable && (
                  <GalleryButton label="Allow location" fullWidth onPress={allowLocation} />
                )}
                {status === "denied" && !askable && (
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
  container: { backgroundColor: Colors.light.background },
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
  header: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  headerText: { flex: 1, gap: Spacing.two },
  actions: { flexDirection: "row", gap: Spacing.two },
  stackedActions: { gap: Spacing.two },
  action: { flex: 1 },
});
