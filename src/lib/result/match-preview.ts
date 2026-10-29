import { useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";

import type { ResultCandidate } from "./state";

export type MatchPreview = {
  candidate: ResultCandidate;
  /** The owner's photo of the artwork, shown above the candidate's own image. */
  photoUri?: string;
  onChoose: (candidate: ResultCandidate) => void;
};

// Only the list under the preview can open one, so a single slot is enough; the id rejects a restored stale route.
let current: (MatchPreview & { id: string }) | undefined;
let nextId = 0;

export function storeMatchPreview(preview: MatchPreview): string {
  const id = String(++nextId);
  current = { ...preview, id };
  return id;
}

export function getMatchPreview(id: string | undefined): MatchPreview | undefined {
  return current?.id === id ? current : undefined;
}

/** Opens a candidate's preview without choosing it; choosing happens only from the preview. */
export function useMatchPreview({
  photo,
  onChoose,
}: {
  /** The owner's photo of the artwork, read when a preview opens. */
  photo: () => string | undefined;
  onChoose: (candidate: ResultCandidate) => void;
}) {
  const router = useRouter();
  return (candidate: ResultCandidate) => {
    const id = storeMatchPreview({ candidate, photoUri: photo(), onChoose });
    router.push({ pathname: "/match-preview", params: { id } });
  };
}

/** For a screen whose matches also appear in a sheet: Back from a preview opened there opens the sheet again. */
export function useSheetMatchPreview({
  photo,
  onChoose,
  reopenSheet,
}: {
  photo: () => string | undefined;
  onChoose: (candidate: ResultCandidate) => void;
  reopenSheet: () => void;
}) {
  const focused = useIsFocused();
  const wasFocused = useRef(focused);
  const fromSheet = useRef(false);
  const open = useMatchPreview({
    photo,
    onChoose: (candidate) => {
      fromSheet.current = false;
      onChoose(candidate);
    },
  });

  useEffect(() => {
    if (focused && !wasFocused.current && fromSheet.current) {
      fromSheet.current = false;
      reopenSheet();
    }
    wasFocused.current = focused;
  }, [focused, reopenSheet]);

  return (candidate: ResultCandidate, { inSheet = false }: { inSheet?: boolean } = {}) => {
    fromSheet.current = inSheet;
    open(candidate);
  };
}
