import { useQueries, type RequestForQueries } from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { toConfirmedFields, type LabelFormState } from "@/lib/label/fields";
import { reportError } from "@/lib/observability";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ConfirmedFields } from "../../../convex/lib/validators";
import type { ResultCandidate } from "./state";

export const MATCH_DELAY_MS = 400;

export type NamingFields = Pick<ConfirmedFields, "title" | "artist" | "date">;

const same = (a?: NamingFields, b?: NamingFields) =>
  a?.title === b?.title && a?.artist === b?.artist && a?.date === b?.date;

/**
 * Catalogue works the form names, looked up once typing pauses. `fields` are the details the
 * matches came from, so a pick links exactly what the server checked.
 */
export function useCorpusMatches(scanId: Id<"scans"> | undefined, form: LabelFormState) {
  const typed = toConfirmedFields(form);
  const title = typed?.title;
  const artist = typed?.artist;
  const date = typed?.date;
  const [fields, setFields] = useState<NamingFields | undefined>(() => (title ? { title, artist, date } : undefined));
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = title ? { title, artist, date } : undefined;
      setFields((previous) => (same(previous, next) ? previous : next));
    }, MATCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, artist, date]);
  const ready = useDeviceReady();
  const query = useMemo(
    (): RequestForQueries =>
      ready && scanId && fields ? { matches: { query: api.scans.corpusMatches, args: { scanId, fields } } } : {},
    [ready, scanId, fields],
  );
  const { matches }: { matches?: ResultCandidate[] | Error } = useQueries(query);
  useEffect(() => {
    if (matches instanceof Error) reportError(matches, "result.corpus_matches");
  }, [matches]);
  return { matches: Array.isArray(matches) ? matches : [], fields };
}
