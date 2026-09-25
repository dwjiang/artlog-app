import { AppState } from "react-native";

import { db } from "@/db/client";
import { saveArtworkSession } from "@/db/repos/artwork-album";
import { enqueuePendingScan, deletePendingScan } from "@/db/repos/pending-scans";
import { softDeleteSavedWork } from "@/db/repos/saved-works";
import { listSettings, removeSetting } from "@/db/repos/settings";
import { artworkPhotos, savedWorks } from "@/db/schema";
import { switchOwner } from "@/lib/account/owner-store";

import type { Id } from "../../../convex/_generated/dataModel";
import { contributeLabel } from "./contribute";
import { formStateFromFlow } from "./fields";
import { flushPendingShares, shareSavedLabel, startPendingShareFlusher } from "./share-saved-label";

const mockNetworkState = jest.fn();
const mockNetworkListener = jest.fn();
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("./contribute", () => ({
  contributeLabel: jest.fn(),
  contributionErrorMessage: (error: Error) => error.message,
}));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => mockNetworkState(),
  addNetworkStateListener: (listener: unknown) => mockNetworkListener(listener),
}));

const owner = "device:test-installation";
const scanId = "scan-1" as Id<"scans">;
const descriptors = new Uint8Array([1, 2, 3]).buffer;
const keypoints = new Uint8Array([4, 5]).buffer;
const state = formStateFromFlow({
  stage: "verified",
  moderation: "clear",
  evidence: ["ocr"],
  warnings: [],
  updatedAt: 1,
  fields: {
    title: { value: "Water Lilies", evidence: "ocr", locked: false },
    artist: { value: "Claude Monet", evidence: "ocr", locked: false },
  },
});
const capture = {
  localId: "capture",
  owner,
  photoPath: "capture.jpg",
  cropPath: "crop.jpg",
  descriptors,
  keypoints,
};
const input = { scanId, capture, state };
const outcome = {
  contributionId: "contribution-1" as Id<"contributions">,
  status: "tentative" as const,
};
const queued = () => listSettings(`pendingShare:${owner}:`);
const pendingScan = {
  localId: "capture",
  photoPath: "capture.jpg",
  cropPath: "crop.jpg",
  capturedAt: 1,
  status: "identified" as const,
  scanId,
  modelVersion: "m",
  attemptModelVersion: "m",
  vector: [],
  descriptors,
  keypoints,
  createdAt: 1,
};
// Mirrors saveResult: the capture's album row anchors the artwork it was saved as.
const saveCapture = () =>
  saveArtworkSession(
    "saved-1",
    {
      localId: "saved-1",
      title: "Water Lilies",
      artist: "Claude Monet",
      savedAt: 1,
    },
    [
      {
        localId: "capture",
        savedLocalId: "saved-1",
        kind: "full",
        capturedAt: 1,
        path: "capture.jpg",
      },
    ],
    undefined,
    owner,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  switchOwner(owner, "test-scope");
  mockNetworkState.mockResolvedValue({ isInternetReachable: true });
  mockNetworkListener.mockReturnValue({ remove: jest.fn() });
  for (const row of await queued()) await removeSetting(row.key);
  await deletePendingScan("capture", owner);
  await db.delete(artworkPhotos);
  await db.delete(savedWorks);
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

it("clears the queued share once the contribution succeeds", async () => {
  jest.mocked(contributeLabel).mockImplementation(async () => {
    expect((await queued()).map((row) => row.key)).toEqual([`pendingShare:${owner}:${scanId}`]);
    return outcome;
  });
  expect(await shareSavedLabel(input, "saved-1")).toEqual({ result: outcome });
  expect(await queued()).toEqual([]);
});

it("keeps a share queued after a transport failure and drops it after a failure the person must fix", async () => {
  jest.mocked(contributeLabel).mockRejectedValueOnce(new Error("Network request failed"));
  expect(await shareSavedLabel(input, "saved-1")).toEqual({
    error: "Network request failed",
  });
  expect((await queued()).map((row) => JSON.parse(row.value))).toEqual([
    {
      scanId,
      captureLocalId: "capture",
      savedLocalId: "saved-1",
      state,
    },
  ]);
  jest.mocked(contributeLabel).mockRejectedValueOnce(new Error("label_unverified"));
  expect(await shareSavedLabel(input, "saved-1")).toEqual({
    error: "label_unverified",
  });
  expect(await queued()).toEqual([]);
});

it("reuses an in-flight attempt for the same scan instead of contributing twice", async () => {
  let finish!: (value: typeof outcome) => void;
  jest.mocked(contributeLabel).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const first = shareSavedLabel(input, "saved-1");
  const second = shareSavedLabel(input, "saved-1");
  await Promise.resolve();
  finish(outcome);
  expect(await Promise.all([first, second])).toEqual([{ result: outcome }, { result: outcome }]);
  expect(contributeLabel).toHaveBeenCalledTimes(1);
});

it("flushes queued shares with the capture bytes reloaded from the phone and drops shares whose capture is gone", async () => {
  jest.mocked(contributeLabel).mockRejectedValueOnce(new Error("Network request failed"));
  await shareSavedLabel(input, "saved-1");
  await shareSavedLabel(
    {
      ...input,
      scanId: "scan-2" as Id<"scans">,
      capture: { ...capture, localId: "missing" },
    },
    "saved-2",
  );
  mockNetworkState.mockResolvedValueOnce({ isInternetReachable: false });
  await flushPendingShares();
  expect(contributeLabel).toHaveBeenCalledTimes(2);
  await enqueuePendingScan({ ...pendingScan, venueId: "museum-met" as Id<"museums"> }, owner);
  saveCapture();
  jest.mocked(contributeLabel).mockResolvedValue(outcome);
  await flushPendingShares();
  expect(contributeLabel).toHaveBeenLastCalledWith({
    scanId,
    capture: expect.objectContaining({
      localId: "capture",
      descriptors,
      keypoints,
    }),
    state,
  });
  expect(await queued()).toEqual([]);
});

it("keeps a queued share after the artwork is deleted and the same scan is saved again as a new artwork", async () => {
  await enqueuePendingScan(pendingScan, owner);
  saveCapture();
  await softDeleteSavedWork("saved-1", Date.now(), owner);
  // saveResult gives the second save's copy of the photo a fresh id; the capture's original row stays tombstoned.
  saveArtworkSession(
    "saved-2",
    {
      localId: "saved-2",
      title: "Water Lilies",
      artist: "Claude Monet",
      savedAt: 2,
    },
    [
      {
        localId: "capture-again",
        savedLocalId: "saved-2",
        kind: "full",
        capturedAt: 1,
        path: "capture.jpg",
      },
    ],
    undefined,
    owner,
  );
  jest.mocked(contributeLabel).mockRejectedValueOnce(new Error("Network request failed"));
  await shareSavedLabel(input, "saved-2");
  jest.mocked(contributeLabel).mockResolvedValue(outcome);
  await flushPendingShares();
  expect(contributeLabel).toHaveBeenCalledTimes(2);
  expect(await queued()).toEqual([]);
});

it("keeps a queued share after its artwork is merged into another", async () => {
  await enqueuePendingScan(pendingScan, owner);
  saveCapture();
  jest.mocked(contributeLabel).mockRejectedValueOnce(new Error("Network request failed"));
  await shareSavedLabel(input, "saved-1");
  saveArtworkSession(
    "target",
    {
      localId: "target",
      title: "Water Lilies",
      artist: "Claude Monet",
      savedAt: 2,
    },
    [],
    undefined,
    owner,
  );
  await db.update(artworkPhotos).set({ savedLocalId: "target" });
  await softDeleteSavedWork("saved-1", Date.now(), owner);
  jest.mocked(contributeLabel).mockResolvedValue(outcome);
  await flushPendingShares();
  expect(contributeLabel).toHaveBeenCalledTimes(2);
  expect(await queued()).toEqual([]);
});

it("drops a queued share once its artwork is deleted instead of publishing it on reconnect", async () => {
  jest.mocked(contributeLabel).mockRejectedValueOnce(new Error("Network request failed"));
  await shareSavedLabel(input, "saved-1");
  await enqueuePendingScan(pendingScan, owner);
  saveCapture();
  await softDeleteSavedWork("saved-1", Date.now(), owner);
  await flushPendingShares();
  expect(contributeLabel).toHaveBeenCalledTimes(1);
  expect(await queued()).toEqual([]);
});

it("retries on start, reconnect and foreground until stopped", async () => {
  jest.mocked(contributeLabel).mockRejectedValue(new Error("Network request failed"));
  await shareSavedLabel(input, "saved-1");
  await enqueuePendingScan(pendingScan, owner);
  saveCapture();
  const removeAppState = jest.fn();
  let onAppState: ((state: string) => void) | undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    onAppState = listener as typeof onAppState;
    return { remove: removeAppState };
  });
  const stop = startPendingShareFlusher();
  await flushPendingShares();
  expect(contributeLabel).toHaveBeenCalledTimes(2);
  const onNetwork = mockNetworkListener.mock.calls[0][0] as (state: {
    isInternetReachable?: boolean;
    isConnected?: boolean;
  }) => void;
  onNetwork({ isInternetReachable: true });
  await flushPendingShares();
  expect(contributeLabel).toHaveBeenCalledTimes(3);
  onAppState!("active");
  await flushPendingShares();
  expect(contributeLabel).toHaveBeenCalledTimes(4);
  stop();
  expect(mockNetworkListener.mock.results[0].value.remove).toHaveBeenCalled();
  expect(removeAppState).toHaveBeenCalled();
});
