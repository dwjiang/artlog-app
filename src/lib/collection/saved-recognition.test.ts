import { getFunctionName } from "convex/server";

import { upsertFromRemote } from "@/db/repos/saved-works";
import { flushJournal } from "@/lib/account/collection-sync";
import { switchOwner } from "@/lib/account/owner-store";
import { syncSavedRecognition } from "@/lib/account/recognition-sync";
import { SyncUnavailableError } from "@/lib/network-error";

import type { Id } from "../../../convex/_generated/dataModel";
import { identifySavedArtwork, acceptSavedRecognition } from "./saved-recognition";

jest.mock("@/lib/account/collection-sync", () => ({ flushJournal: jest.fn() }));
jest.mock("@/lib/account/recognition-sync", () => ({ syncSavedRecognition: jest.fn() }));
jest.mock("@/db/repos/saved-works", () => ({ upsertFromRemote: jest.fn() }));
jest.mock("@/lib/files/unreferenced-photos", () => ({ removeUnreferencedPhotos: jest.fn() }));
const mockAction = jest.fn();
const mockMutation = jest.fn();
jest.mock("@/lib/convex-client", () => ({
  convex: {
    action: (...args: unknown[]) => mockAction(...args),
    mutation: (...args: unknown[]) => mockMutation(...args),
  },
}));
const work = { owner: "account:mine", localId: "painting" };
const result = { attempt: 1, outcome: "miss", candidates: [] };
beforeEach(() => {
  jest.resetAllMocks();
  switchOwner(work.owner, "scope");
  mockAction.mockResolvedValue(result);
  jest.mocked(upsertFromRemote).mockResolvedValue([]);
});

it("syncs saved data before searching and does not require the original device's scan ID", async () => {
  await expect(identifySavedArtwork(work)).resolves.toEqual(result);
  expect(flushJournal).toHaveBeenCalledTimes(1);
  expect(syncSavedRecognition).toHaveBeenCalledWith(
    { owner: work.owner, scope: "scope" },
    expect.any(Function),
    "painting",
  );
  expect(getFunctionName(mockAction.mock.calls[0][0])).toBe("savedRecognition:identify");
  expect(mockAction.mock.calls[0][1]).toEqual({ scope: "scope", localId: "painting" });
});

it("does not search or accept for a different account or apply responses after an account switch", async () => {
  switchOwner("account:other", "other-scope");
  await expect(identifySavedArtwork(work)).rejects.toThrow(SyncUnavailableError);
  expect(mockAction).not.toHaveBeenCalled();
  switchOwner(work.owner, "scope");
  mockAction.mockImplementation(async () => {
    switchOwner("account:other", "other-scope");
    return result;
  });
  await expect(identifySavedArtwork(work)).resolves.toBeNull();
  switchOwner(work.owner, "scope");
  mockMutation.mockImplementation(async () => {
    switchOwner("account:other", "other-scope");
    return {};
  });
  await expect(acceptSavedRecognition(work, 1, "object" as Id<"objects">)).resolves.toBe(false);
  expect(upsertFromRemote).not.toHaveBeenCalled();
});
