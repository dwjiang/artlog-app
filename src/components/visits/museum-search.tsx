import { useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";

import { SearchEmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeleton";
import { SearchField } from "@/components/search-field";
import { ThemedText as Text } from "@/components/themed-text";
import {
  MuseumSearchResults,
  museumSearchEmptyDetail,
  museumSearchFailure,
} from "@/components/venue/museum-search-results";
import { captureOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";
import type { VenueRow } from "@/lib/venue/resolve";
import { MUSEUM_SEARCH_LIMIT } from "@/lib/venue/search-venues";
import { confirmPlace, useVenue } from "@/lib/venue/use-venue";
import { useVenueSearch } from "@/lib/venue/use-venue-search";
import { venueOptionKey, type PoiOption } from "@/lib/venue/venue-reducer";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { VisitMessage, visitStyles as styles } from "./visit-ui";

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
  // A new query keeps the last answer up until its own arrives, so the list does not flash to a skeleton on every
  // keystroke; a retry shows the skeleton.
  const { latest: results, retry } = useVenueSearch(query, 200, { near: fix });
  const [adding, setAdding] = useState<string>();
  const selection = useRef<AbortController | null>(null);
  useEffect(() => () => selection.current?.abort(), []);
  const searching = !!query.trim() && !results;
  function choose(row: VenueRow) {
    Keyboard.dismiss();
    onChoose(row);
  }
  async function choosePlace(place: PoiOption) {
    if (selection.current || disabled) return;
    const key = venueOptionKey(place);
    const session = captureOwner();
    const request = new AbortController();
    selection.current = request;
    const wanted = () => !request.signal.aborted && session.isOwnerCurrent();
    setAdding(key);
    try {
      const row = await confirmPlace(place, wanted);
      if (row && wanted()) choose(row);
    } catch (cause) {
      if (!wanted()) return;
      reportError(cause, "visit.venue.confirm");
      if (session.isOwnerCurrent()) {
        showErrorToast(socialErrorMessage(cause) ?? "Couldn’t add this museum.", () => void choosePlace(place));
      }
    } finally {
      selection.current = null;
      if (wanted()) setAdding(undefined);
    }
  }
  return (
    <>
      <SearchField
        label="Search museums"
        placeholder="Museum or city"
        value={query}
        maxLength={LIMITS.searchMax}
        showLabel={false}
        onChange={setQuery}
        onClear={() => setQuery("")}
      />
      {searching ? (
        <ListSkeleton label="Searching museums…" rows={3} card />
      ) : results?.failed ? (
        <VisitMessage action="Try again" onAction={retry}>
          {museumSearchFailure(results.failed)}
        </VisitMessage>
      ) : results && results.rows.length === 0 && results.places.length === 0 ? (
        <SearchEmptyState
          title="No museums found."
          detail={museumSearchEmptyDetail(results.query)}
          onClear={() => setQuery("")}
        />
      ) : null}
      {results && (
        <MuseumSearchResults
          query={results.query}
          search={results}
          busyKey={adding}
          disabled={disabled || !!adding}
          onChooseVenue={choose}
          onChoosePlace={(place) => {
            void choosePlace(place);
          }}
        />
      )}
      {results?.rows.length === MUSEUM_SEARCH_LIMIT && (
        <Text style={styles.caption}>
          Showing the first {MUSEUM_SEARCH_LIMIT} museums. Add a city or more of the name to narrow your search.
        </Text>
      )}
    </>
  );
}
