import { reportError } from "@/lib/observability";
import { useEffect, useState } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import type { LabelFlowDisplay } from "../../../convex/lib/validators";
import { loadLabelDraft } from "./draft";
import { formStateFromFlow, type LabelFormState } from "./fields";

export function useLabelForm(
  scanId: Id<"scans"> | undefined,
  flow: LabelFlowDisplay | undefined,
  museumSearchUpdatedAt?: number,
) {
  const [form, setForm] = useState<LabelFormState>();
  const [error, setError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState({
    scanId,
    flow,
    attempt,
    museumSearchUpdatedAt,
  });

  if (
    source.scanId !== scanId
    || source.flow !== flow
    || source.attempt !== attempt
    || source.museumSearchUpdatedAt !== museumSearchUpdatedAt
  ) {
    setSource({ scanId, flow, attempt, museumSearchUpdatedAt });
    setForm(undefined);
    setError(undefined);
  }

  useEffect(() => {
    let active = true;
    if (scanId && flow) {
      loadLabelDraft(scanId, museumSearchUpdatedAt).then(
        (draft) => {
          if (active) setForm(draft ?? formStateFromFlow(flow));
        },
        (cause: unknown) => {
          reportError(cause, "label.restore_draft");
          console.warn("Could not restore the label draft", cause);
          if (active) {
            setError(new Error("Couldn’t load your label edits. Try again."));
          }
        },
      );
    }
    return () => {
      active = false;
    };
  }, [scanId, flow, attempt, museumSearchUpdatedAt]);

  return {
    form,
    setForm,
    error,
    retry: () => setAttempt((current) => current + 1),
  };
}
