import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect } from "react";

import { listSavedWorks } from "@/db/repos/saved-works";
import type { SavedWork } from "@/db/schema";
import { useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

import { savedCopyOf } from "./save";
import { buildSnapshot, type SnapshotDraft } from "./snapshot";
import type { ResultViewState } from "./state";

/** The work already in this person's collection that saving the card's `draft` would add its photo to. */
export function useSavedCopy(view: ResultViewState, draft: SnapshotDraft): SavedWork | undefined {
  const owner = useLocalOwner();
  const { data, error } = useLiveQuery(listSavedWorks(owner), [owner]);
  useEffect(() => {
    if (error) reportError(error, "result.saved_copy");
  }, [error]);
  return savedCopyOf(
    data.filter((work) => work.owner === owner),
    view,
    buildSnapshot(draft, view).snapshot,
  );
}
