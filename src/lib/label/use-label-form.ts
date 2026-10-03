import { useEffect, useState } from "react";

import { reportError } from "@/lib/observability";

import type { Id } from "../../../convex/_generated/dataModel";
import type { ConfirmedFields, LabelFlowDisplay } from "../../../convex/lib/validators";
import { loadLabelDraft } from "./draft";
import { confirmedLabelForm, formStateFromFlow, type LabelFormState } from "./fields";

/** The label's form: details already confirmed from this reading, else the saved draft, else the reading itself. */
export function useLabelForm(
  scanId: Id<"scans"> | undefined,
  flow: LabelFlowDisplay | undefined,
  confirmed?: ConfirmedFields,
) {
  const confirmedForm = () => (flow && confirmed ? confirmedLabelForm(flow, confirmed) : undefined);
  const [form, setForm] = useState<LabelFormState | undefined>(confirmedForm);
  const [error, setError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState({ scanId, flow, confirmed, attempt });

  if (
    source.scanId !== scanId
    || source.flow !== flow
    || source.confirmed !== confirmed
    || source.attempt !== attempt
  ) {
    setSource({ scanId, flow, confirmed, attempt });
    setForm(confirmedForm());
    setError(undefined);
  }

  useEffect(() => {
    let active = true;
    if (scanId && flow && !confirmed) {
      loadLabelDraft(scanId).then(
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
  }, [scanId, flow, confirmed, attempt]);

  return {
    form,
    setForm,
    error,
    retry: () => setAttempt((current) => current + 1),
  };
}
