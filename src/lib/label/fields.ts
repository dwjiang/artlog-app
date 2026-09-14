import type { FunctionArgs } from 'convex/server';

import type { api } from '../../../convex/_generated/api';
import type { LabelEvidence, LabelFieldName, LabelFlowDisplay, LabelWarning } from '../../../convex/lib/validators';
import type { LabelInput } from './flow';

export const LABEL_FIELD_NAMES = ['title', 'artist', 'date', 'accession', 'medium', 'creditLine'] as const satisfies readonly LabelFieldName[];

export const LABEL_FIELD_LABELS: Record<LabelFieldName, string> = {
  title: 'Title', artist: 'Artist', date: 'Date', accession: 'Accession number', medium: 'Medium', creditLine: 'Credit line',
};

// Badge text per evidence kind; unverified kinds show none. Adding a kind means adding a label.
export const EVIDENCE_LABELS: Record<LabelEvidence, string | null> = {
  accession: 'From the museum’s records', qr: 'From the museum’s records', wikidata: 'Wikidata',
  tavily: 'From the web', 'tavily+image': 'From the museum’s site', weak: null, ocr: null,
};
export const EVIDENCE_SOURCES: Record<LabelEvidence, string | null> = {
  accession: 'the museum’s records', qr: 'the museum’s records', wikidata: 'Wikidata',
  tavily: 'the web', 'tavily+image': 'the museum’s site', weak: null, ocr: null,
};
export const EDITED_LABEL = 'Edited by you';

export const WARNING_MESSAGES: Record<LabelWarning, string> = {
  date_outside_lifespan: 'The date is outside the artist’s lifespan — please check',
  artist_not_found: 'We couldn’t find this artist — please check the spelling',
  venue_unlikely: 'This artist isn’t usually shown at this museum — please check',
};

export type FieldState = {
  value: string;
  /** The verifier's value; the field counts as edited once it differs or the lock was opened. */
  original: string;
  evidence?: LabelEvidence;
  locked: boolean;
  unlocked: boolean;
};
export type LabelFormState = Record<LabelFieldName, FieldState>;

export type SubmittedFields = FunctionArgs<typeof api.contributions.contribute>['fields'];

export function formStateFromFlow(flow: LabelFlowDisplay): LabelFormState {
  const state = {} as LabelFormState;
  for (const name of LABEL_FIELD_NAMES) {
    const field = flow.fields[name];
    state[name] = { value: field?.value ?? '', original: field?.value ?? '', evidence: field?.evidence, locked: field?.locked ?? false, unlocked: false };
  }
  return state;
}

/** Opening the lock downgrades the field's evidence even before a keystroke. */
export function unlockField(state: LabelFormState, name: LabelFieldName): LabelFormState {
  return { ...state, [name]: { ...state[name], locked: false, unlocked: true } };
}

export function setFieldValue(state: LabelFormState, name: LabelFieldName, value: string): LabelFormState {
  return { ...state, [name]: { ...state[name], value } };
}

export function isEdited(field: FieldState): boolean {
  return field.unlocked || field.value.trim() !== field.original;
}

export function badgeFor(field: FieldState): string | null {
  if (isEdited(field)) return EDITED_LABEL;
  return field.locked && field.evidence ? EVIDENCE_LABELS[field.evidence] : null;
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
export function toSubmittedFields(state: LabelFormState): SubmittedFields | null {
  const title = state.title.value.trim();
  const artist = state.artist.value.trim();
  if (!title || !artist) return null;
  const fields: SubmittedFields = {
    title: { value: title, edited: isEdited(state.title) }, artist: { value: artist, edited: isEdited(state.artist) },
  };
  for (const name of ['date', 'accession', 'medium', 'creditLine'] as const) {
    const value = state[name].value.trim();
    if (value) fields[name] = { value, edited: isEdited(state[name]) };
  }
  return fields;
}

/** True when any value differs from what the stored flow holds, so a contribution must re-verify first. */
export function differsFromFlow(state: LabelFormState, flow: LabelFlowDisplay): boolean {
  return LABEL_FIELD_NAMES.some((name) => state[name].value.trim() !== (flow.fields[name]?.value ?? ''));
}

export function canSaveLabel(state: LabelFormState): boolean {
  return state.title.value.trim().length > 0;
}

export function canShareLabel(state: LabelFormState): boolean {
  return toSubmittedFields(state) !== null;
}
