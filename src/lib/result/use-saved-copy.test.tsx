import { renderHook, waitFor } from "@testing-library/react-native";

import { bridge, confidentScan, lilies, softScan } from "@/components/scan/result/__fixtures__/scan";
import { insertSavedWork } from "@/db/repos/saved-works";

import { draftFromCandidate } from "./snapshot";
import { toResultViewState } from "./state";
import { useSavedCopy } from "./use-saved-copy";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

beforeAll(async () => {
  await insertSavedWork({
    localId: "saved-lilies",
    savedAt: 1,
    title: lilies.title,
    artist: lilies.artist,
    objectId: lilies.objectId,
    artworkId: lilies.artworkId,
  });
  await insertSavedWork({
    localId: "saved-bridge",
    savedAt: 2,
    title: bridge.title,
    artist: bridge.artist,
    objectId: bridge.objectId,
    artworkId: bridge.artworkId,
  });
});

it("finds the saved work a confident match would add its photo to", async () => {
  const hook = await renderHook(() => useSavedCopy(toResultViewState(confidentScan), draftFromCandidate(lilies)));
  await waitFor(() => expect(hook.result.current?.localId).toBe("saved-lilies"));
});

it("leaves a renamed draft or a possible match unsaved, as their saves make a new work", async () => {
  const renamed = await renderHook(() =>
    useSavedCopy(toResultViewState(confidentScan), { ...draftFromCandidate(lilies), title: "Nymphéas" }),
  );
  const possible = await renderHook(() => useSavedCopy(toResultViewState(softScan), draftFromCandidate(bridge)));
  // Let both live queries answer before checking that neither found a copy.
  const check = await renderHook(() => useSavedCopy(toResultViewState(confidentScan), draftFromCandidate(lilies)));
  await waitFor(() => expect(check.result.current).toBeDefined());
  expect(renamed.result.current).toBeUndefined();
  expect(possible.result.current).toBeUndefined();
});
