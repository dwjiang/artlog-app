import type { FunctionArgs } from "convex/server";

import type { api } from "../../../convex/_generated/api";
import type {
  LabelEvidence,
  LabelFieldName,
  LabelFlowDisplay,
  LabelWarning,
} from "../../../convex/lib/validators";
import type { LabelInput } from "./flow";

export const LABEL_FIELD_NAMES = [
  "title",
  "artist",
  "date",
  "accession",
  "medium",
  "creditLine",
] as const satisfies readonly LabelFieldName[];

export const LABEL_FIELD_LABELS: Record<LabelFieldName, string> = {
  title: "Title",
  artist: "Artist",
  date: "Date",
  accession: "Accession number",
  medium: "Medium",
  creditLine: "Credit line",
};

export const WARNING_MESSAGES: Record<LabelWarning, string> = {
  date_outside_lifespan:
    "The date is outside the artist’s lifespan — please check",
  artist_not_found: "We couldn’t find this artist — please check the spelling",
  venue_unlikely:
    "This artist isn’t usually shown at this museum — please check",
};

export type FieldState = {
  value: string;
  /** The verifier's value; the field counts as edited while its value differs from it. */
  original: string;
  evidence?: LabelEvidence;
  /** Verified and still matching the verifier's value. */
  locked: boolean;
  /** Verified, but the value has diverged; typing the original back restores the lock. */
  unlocked: boolean;
};
export type LabelFormState = Record<LabelFieldName, FieldState>;

export type SubmittedFields = FunctionArgs<
  typeof api.contributions.contribute
>["fields"];

export function formStateFromFlow(flow: LabelFlowDisplay): LabelFormState {
  const state = {} as LabelFormState;
  for (const name of LABEL_FIELD_NAMES) {
    const field = flow.fields[name];
    state[name] = {
      value: field?.value ?? "",
      original: field?.value ?? "",
      evidence: field?.evidence,
      locked: field?.locked ?? false,
      unlocked: false,
    };
  }
  return state;
}

/** Opening the lock downgrades the field's evidence even before a keystroke. */
export function unlockField(
  state: LabelFormState,
  name: LabelFieldName,
): LabelFormState {
  return {
    ...state,
    [name]: { ...state[name], locked: false, unlocked: true },
  };
}

/** A verified field's lock follows its value, so a typo that is corrected does not leave the field downgraded. */
export function setFieldValue(
  state: LabelFormState,
  name: LabelFieldName,
  value: string,
): LabelFormState {
  const field = state[name];
  const verified = field.locked || field.unlocked;
  const diverged = value.trim() !== field.original;
  return {
    ...state,
    [name]: {
      ...field,
      value,
      locked: verified && !diverged,
      unlocked: verified && diverged,
    },
  };
}

export function isEdited(field: FieldState): boolean {
  return field.unlocked || field.value.trim() !== field.original;
}

export function toVerifyInput(state: LabelFormState): LabelInput {
  const input: LabelInput = {};
  for (const name of LABEL_FIELD_NAMES) {
    const value = state[name].value.trim();
    if (value) input[name] = value;
  }
  return input;
}

/** The contribution's fields; `null` until both a title and an artist are present (contributions.ts requires them). */
export function toSubmittedFields(
  state: LabelFormState,
): SubmittedFields | null {
  const title = state.title.value.trim();
  const artist = state.artist.value.trim();
  if (!title || !artist) return null;
  const fields: SubmittedFields = {
    title: { value: title, edited: isEdited(state.title) },
    artist: { value: artist, edited: isEdited(state.artist) },
  };
  for (const name of ["date", "accession", "medium", "creditLine"] as const) {
    const value = state[name].value.trim();
    if (value) fields[name] = { value, edited: isEdited(state[name]) };
  }
  return fields;
}

/** True when any value differs from what the stored flow holds, so a contribution must re-verify first. */
export function differsFromFlow(
  state: LabelFormState,
  flow: LabelFlowDisplay,
): boolean {
  return LABEL_FIELD_NAMES.some(
    (name) => state[name].value.trim() !== (flow.fields[name]?.value ?? ""),
  );
}

export function canSaveLabel(state: LabelFormState): boolean {
  return state.title.value.trim().length > 0;
}

export function canShareLabel(state: LabelFormState): boolean {
  return toSubmittedFields(state) !== null;
}
