import type { LabelFlowDisplay } from "../../../convex/lib/validators";
import {
  canShareLabel,
  confirmedLabelForm,
  differsFromFlow,
  formStateFromFlow,
  formStateFromValues,
  isEdited,
  setFieldValue,
  toConfirmedFields,
  toSubmittedFields,
  toVerifyInput,
  unlockField,
} from "./fields";

const verified: LabelFlowDisplay = {
  stage: "verified",
  evidence: ["accession", "wikidata"],
  warnings: [],
  moderation: "clear",
  updatedAt: 1,
  fields: {
    title: { value: "The Thinker", evidence: "accession", locked: true },
    artist: { value: "Auguste Rodin", evidence: "wikidata", locked: true },
    date: { value: "1880", evidence: "weak", locked: false },
    medium: {
      value: "bronze",
      evidence: "ocr",
      locked: false,
      confidence: 0.7,
    },
  },
};

it("starts from the verifier’s values with their locks, leaving unread fields blank", () => {
  const state = formStateFromFlow(verified);
  expect(state.title).toEqual({
    value: "The Thinker",
    original: "The Thinker",
    evidence: "accession",
    locked: true,
    unlocked: false,
  });
  expect(state.date).toMatchObject({
    value: "1880",
    evidence: "weak",
    locked: false,
  });
  expect(state.accession).toEqual({
    value: "",
    original: "",
    evidence: undefined,
    locked: false,
    unlocked: false,
  });
  expect(isEdited(state.title)).toBe(false);
  expect(isEdited(state.date)).toBe(false);
});

it("unlocking marks a verified field edited even before a keystroke", () => {
  const state = unlockField(formStateFromFlow(verified), "title");
  expect(state.title).toMatchObject({
    locked: false,
    unlocked: true,
    value: "The Thinker",
  });
  expect(isEdited(state.title)).toBe(true);
  expect(state.artist.locked).toBe(true);
});

it("typing over a verified field opens its lock and typing the verified value back restores it", () => {
  const base = formStateFromFlow(verified);
  const changed = setFieldValue(base, "title", "The Thinker, cast");
  expect(changed.title).toMatchObject({ locked: false, unlocked: true });
  expect(isEdited(changed.title)).toBe(true);
  expect(toSubmittedFields(changed)?.title).toEqual({
    value: "The Thinker, cast",
    edited: true,
  });
  const restored = setFieldValue(changed, "title", " The Thinker ");
  expect(restored.title).toMatchObject({
    locked: true,
    unlocked: false,
    value: " The Thinker ",
  });
  expect(isEdited(restored.title)).toBe(false);
  expect(toSubmittedFields(restored)?.title).toEqual({
    value: "The Thinker",
    edited: false,
  });
});

it("typing over an unverified field marks it edited and reverting clears it", () => {
  let state = setFieldValue(formStateFromFlow(verified), "medium", "bronze, cast 1916");
  expect(isEdited(state.medium)).toBe(true);
  state = setFieldValue(state, "medium", " bronze ");
  expect(isEdited(state.medium)).toBe(false);
});

it("builds the contribution’s fields with per-field edit flags and needs a title and an artist", () => {
  const base = formStateFromFlow(verified);
  expect(toSubmittedFields(base)).toEqual({
    title: { value: "The Thinker", edited: false },
    artist: { value: "Auguste Rodin", edited: false },
    date: { value: "1880", edited: false },
    medium: { value: "bronze", edited: false },
  });
  const edited = setFieldValue(unlockField(base, "artist"), "accession", " 1917.42 ");
  expect(toSubmittedFields(edited)).toMatchObject({
    artist: { value: "Auguste Rodin", edited: true },
    accession: { value: "1917.42", edited: true },
  });
  expect(toSubmittedFields(setFieldValue(base, "artist", ""))).toBeNull();
  expect(canShareLabel(setFieldValue(base, "artist", ""))).toBe(false);
});

it("confirms any titled details, trimmed, and nothing without a title", () => {
  const base = formStateFromFlow(verified);
  expect(toConfirmedFields(setFieldValue(setFieldValue(base, "artist", ""), "title", " The Thinker "))).toEqual({
    title: "The Thinker",
    date: "1880",
    medium: "bronze",
  });
  expect(toConfirmedFields(setFieldValue(base, "title", "  "))).toBeNull();
  expect(toConfirmedFields(formStateFromValues({ title: "Harbour at dusk" }))).toEqual({ title: "Harbour at dusk" });
});

it("rebuilds confirmed label details against the reading, so only changed fields count as edited", () => {
  const form = confirmedLabelForm(verified, { title: "The Thinker", artist: "Auguste Rodin", date: "1880–81" });
  expect(toSubmittedFields(form)).toEqual({
    title: { value: "The Thinker", edited: false },
    artist: { value: "Auguste Rodin", edited: false },
    date: { value: "1880–81", edited: true },
  });
});

it("knows when the form differs from the stored flow and what to re-verify", () => {
  const base = formStateFromFlow(verified);
  expect(differsFromFlow(base, verified)).toBe(false);
  expect(differsFromFlow(unlockField(base, "title"), verified)).toBe(false);
  const changed = setFieldValue(base, "date", "1880–81");
  expect(differsFromFlow(changed, verified)).toBe(true);
  expect(toVerifyInput(changed)).toEqual({
    title: "The Thinker",
    artist: "Auguste Rodin",
    date: "1880–81",
    medium: "bronze",
  });
});
