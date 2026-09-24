import { buildSnapshot, canSave, draftFromCandidate } from "./snapshot";
import { toResultViewState } from "./state";
import {
  bridge,
  confidentScan,
  lilies,
  missScan,
  softScan,
} from "@/components/scan/result/__fixtures__/scan";

it("pre-fills the draft from the candidate and leaves an unidentified card blank", () => {
  expect(draftFromCandidate(lilies)).toEqual({
    title: "Water Lilies",
    artist: "Claude Monet",
    date: "1916",
    medium: "Oil on canvas",
    institution: "Metropolitan Museum of Art",
  });
  expect(draftFromCandidate(undefined)).toEqual({
    title: "",
    artist: "",
    date: "",
    medium: "",
    institution: "",
  });
});

it("allows an unidentified artwork without a title", () => {
  expect(canSave(draftFromCandidate(undefined))).toBe(true);
  expect(canSave({ ...draftFromCandidate(undefined), title: "   " })).toBe(
    true,
  );
  expect(canSave({ ...draftFromCandidate(undefined), title: "Untitled" })).toBe(
    true,
  );
});

it("suggests the server fields only for a confident card, even when the user edited them", () => {
  const view = toResultViewState(confidentScan);
  expect(buildSnapshot(draftFromCandidate(lilies), view).suggested).toEqual({
    title: "Water Lilies",
    artist: "Claude Monet",
  });
  const edited = buildSnapshot(
    { ...draftFromCandidate(lilies), title: "Nymphéas" },
    view,
  );
  expect(edited.snapshot.title).toBe("Nymphéas");
  expect(edited.suggested).toEqual({
    title: "Water Lilies",
    artist: "Claude Monet",
  });
});

it("never suggests on soft, chosen or unidentified cards", () => {
  expect(
    buildSnapshot(
      draftFromCandidate(softScan.best),
      toResultViewState(softScan),
    ).suggested,
  ).toBeNull();
  expect(
    buildSnapshot(
      draftFromCandidate(bridge),
      toResultViewState(confidentScan, { chosenObjectId: bridge.objectId }),
    ).suggested,
  ).toBeNull();
  expect(
    buildSnapshot(
      { ...draftFromCandidate(undefined), title: "Typed" },
      toResultViewState(missScan),
    ).suggested,
  ).toBeNull();
});

it("trims the fields and drops blank optional ones", () => {
  const { snapshot } = buildSnapshot(
    {
      title: " Water Lilies ",
      artist: " Claude Monet",
      date: " ",
      medium: "",
      institution: "The Met ",
    },
    toResultViewState(confidentScan),
  );
  expect(snapshot).toEqual({
    title: "Water Lilies",
    artist: "Claude Monet",
    date: undefined,
    medium: undefined,
    institution: "The Met",
  });
});
