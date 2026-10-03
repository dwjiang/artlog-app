import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect } from "react";

import { offlineResultQuery } from "@/db/repos/offline-scan-results";
import type { PendingScan } from "@/db/schema";
import type { PhotoSessionDraft } from "@/lib/capture/photo-draft";
import { reportError } from "@/lib/observability";
import { selectResultCandidates } from "@/lib/result/state";
import { useScan } from "@/lib/result/use-scan";

export function useRecentScanMetadata(item: PendingScan, session: PhotoSessionDraft) {
  const { data, updatedAt, error } = useLiveQuery(offlineResultQuery(item.localId, item.owner), [
    item.localId,
    item.owner,
  ]);
  useEffect(() => {
    if (error) reportError(error, "queue.load_offline_metadata");
  }, [error]);
  const offline = data.find((row) => row.owner === item.owner && row.localId === item.localId)?.result;
  const scan = useScan(
    !session.saveInput && !offline && (updatedAt || error) && item.status === "identified"
      ? (item.scanId ?? undefined)
      : undefined,
  );
  // Match the result screen: a local match stays primary until the person opens the online result.
  const identified = !(scan instanceof Error) && scan?.status === "identified" ? scan : undefined;
  const result = offline ?? identified;
  const confirmed = !offline ? identified?.confirmed : undefined;
  const candidate = result && selectResultCandidates(result).primary;
  const details = session.saveInput?.draft ?? confirmed?.fields ?? candidate;
  const uncertain = session.saveInput
    ? session.saveInput.view?.kind === "soft"
    : !confirmed && !!candidate && (result?.outcome !== "confident" || candidate.identityStatus === "tentative");

  return {
    title: details?.title.trim() || "Artwork scan",
    attribution: [details?.artist?.trim(), details?.date?.trim()].filter(Boolean).join(" · "),
    uncertain,
  };
}
