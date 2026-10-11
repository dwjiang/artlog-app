import { act, render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { SyncUnavailableError } from "@/lib/network-error";

import {
  CollectionSync,
  flushCollectionMedia,
  flushJournal,
  pauseCollectionSync,
  resumeCollectionSync,
} from "./collection-sync";
import { captureOwner, getLocalOwner, switchOwner } from "./owner-store";
import { requestCollectionSync } from "./sync-events";

const mockRecognition = jest.fn();
const mockAlbums = jest.fn();
const mockGetSavedWork = jest.fn();
const mockSelectPhotos = jest.fn();
const mockUploadPhoto = jest.fn();
jest.mock("./photo-transfer", () => ({
  uploadCollectionPhoto: (...args: unknown[]) => mockUploadPhoto(...args),
  downloadCollectionPhoto: jest.fn(),
  removePhotoFile: jest.fn(),
}));
jest.mock("./recognition-sync", () => ({ syncSavedRecognition: (...args: unknown[]) => mockRecognition(...args) }));
jest.mock("./album-sync", () => ({ syncArtworkAlbums: (...args: unknown[]) => mockAlbums(...args) }));

const mockSync = jest.fn();
const mockPhotos = jest.fn();
const mockClaim = jest.fn();
const mockReportError = jest.fn();
const mockSetSetting = jest.fn();
let mockToken = "token";
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => mockToken }));
jest.mock("./photo-sync", () => ({
  syncCollectionPhotos: (...args: unknown[]) => mockPhotos(...args),
}));
let mockAccount: { scope: string; accountId: string | null };
let mockNetwork: (state: { isConnected: boolean }) => void;
let mockForeground: (state: AppStateStatus) => void;
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("convex/react", () => ({
  useQuery: (fn: unknown) =>
    jest.requireActual("convex/server").getFunctionName(fn) === "devices:me" ? { deviceId: "a" } : mockAccount,
}));
jest.mock("expo-network", () => ({
  addNetworkStateListener: (callback: typeof mockNetwork) => {
    mockNetwork = callback;
    return { remove: jest.fn() };
  },
}));
jest.mock("@/lib/convex-client", () => ({
  convex: { mutation: (...args: unknown[]) => mockClaim(...args) },
}));
let mockPending = false;
let mockJournalPending = false;
jest.mock("@/db/repos/artwork-album", () => ({
  albumMediaPending: (...args: unknown[]) => mockAlbumPending(...args),
  selectArtworkPhotos: (...args: unknown[]) => ({ all: () => mockSelectPhotos(...args) }),
}));
const mockAlbumPending = jest.fn((..._args: unknown[]) => mockPending);
jest.mock("@/db/repos/saved-works", () => ({
  getSavedWork: (...args: unknown[]) => mockGetSavedWork(...args),
  listUnsynced: async () => (mockJournalPending ? [{}] : []),
}));
jest.mock("@/db/repos/settings", () => ({
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));
jest.mock("@/db/repos/visits", () => ({ listUnsyncedVisits: () => [] }));
jest.mock("@/db/repos/journal-claim", () => ({
  claimLocalJournal: async () => {},
}));
jest.mock("./sync", () => ({
  syncJournal: (...args: unknown[]) => mockSync(...args),
}));
jest.mock("@/lib/observability", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
  addBreadcrumb: jest.fn(),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockSync.mockReset().mockResolvedValue(undefined);
  mockRecognition.mockReset().mockResolvedValue(undefined);
  mockAlbums.mockReset().mockResolvedValue(undefined);
  mockPhotos.mockReset().mockResolvedValue(undefined);
  mockClaim.mockReset().mockResolvedValue({ claimId: null, complete: true });
  mockReportError.mockReset();
  mockSetSetting.mockReset().mockResolvedValue(undefined);
  mockAccount = { scope: "account:a,b", accountId: "account" };
  mockToken = "token";
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "active",
  });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    mockForeground = listener;
    return { remove: jest.fn() };
  });
  resumeCollectionSync();
});
afterEach(() => {
  pauseCollectionSync();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
const tick = async () => {
  await act(() => jest.advanceTimersByTimeAsync(500));
};

it("syncs on launch, local changes, foreground and reconnect", async () => {
  await render(<CollectionSync />);
  await tick();
  expect(mockSync).toHaveBeenCalledTimes(1);
  requestCollectionSync();
  await tick();
  mockForeground("active");
  await tick();
  mockNetwork({ isConnected: true });
  await tick();
  expect(mockSync).toHaveBeenCalledTimes(4);
  await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(4);
});

it("keeps syncing notes while a photo transfer runs and retries a failed transfer on its own", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  let finishTransfer!: () => void;
  mockPhotos.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishTransfer = resolve;
      }),
  );
  await render(<CollectionSync />);
  await tick();
  await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(1);
  requestCollectionSync();
  await tick();
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockPhotos).toHaveBeenCalledTimes(1);
  mockPhotos.mockRejectedValueOnce(new Error("offline"));
  await act(async () => finishTransfer());
  await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(2);
  await act(() => jest.advanceTimersByTimeAsync(30_000));
  expect(mockPhotos).toHaveBeenCalledTimes(3);
  expect(mockSync).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  "transfers crops after an album failure and retains retries (crop failure: %s)",
  async (cropFails) => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("Photo download failed with HTTP 404");
    const cropFailure = new Error("Crop download failed with HTTP 500");
    mockAlbums.mockRejectedValueOnce(failure);
    if (cropFails) mockPhotos.mockRejectedValueOnce(cropFailure);

    await render(<CollectionSync />);
    await tick();
    await tick();

    expect(mockPhotos).toHaveBeenCalledTimes(1);
    expect(mockReportError.mock.calls).toEqual([
      [failure, "sync.photos"],
      ...(cropFails ? [[cropFailure, "sync.photos"]] : []),
    ]);
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    expect(mockAlbums).toHaveBeenCalledTimes(2);
    expect(mockPhotos).toHaveBeenCalledTimes(2);
  },
);

it("does not start crop transfers after the album request outlives its owner scope", async () => {
  let failAlbum!: (error: Error) => void;
  mockAlbums.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        failAlbum = reject;
      }),
  );
  await render(<CollectionSync />);
  await tick();
  await tick();

  pauseCollectionSync();
  await act(async () => failAlbum(new Error("Photo download failed")));

  expect(mockPhotos).not.toHaveBeenCalled();
});

it("continues crop backups when an album photo keeps failing, and retries both", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockAlbums.mockRejectedValue(new Error("missing image"));
  await render(<CollectionSync />);
  await tick();
  await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTimeAsync(30_000));
  expect(mockAlbums).toHaveBeenCalledTimes(2);
  expect(mockPhotos).toHaveBeenCalledTimes(2);
});

it.each(["Network request failed", "Photo upload failed with HTTP 429"])(
  "defers crop backups after %s until the transfer queue retries",
  async (message) => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockAlbums.mockRejectedValueOnce(new Error(message));
    await render(<CollectionSync />);
    await tick();
    await tick();
    expect(mockAlbums).toHaveBeenCalledTimes(1);
    expect(mockPhotos).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTimeAsync(29_000));
    expect(mockAlbums).toHaveBeenCalledTimes(1);
    expect(mockPhotos).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    expect(mockAlbums).toHaveBeenCalledTimes(2);
    expect(mockPhotos).toHaveBeenCalledTimes(1);
  },
);

it("doubles a failing transfer's wait up to 15 minutes, ignores local changes meanwhile, and retries on reconnect", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  await render(<CollectionSync />);
  await tick();
  await tick();
  mockPending = false;
  mockJournalPending = true;
  mockPhotos.mockRejectedValue(new Error("Photo upload failed with HTTP 500"));
  let attempts = mockPhotos.mock.calls.length;
  // Retries scheduled from a timer can land a millisecond late, so those checks pass a wider window.
  const expectRetryAfter = async (wait: number, window = 1) => {
    await act(() => jest.advanceTimersByTimeAsync(wait - window));
    expect(mockPhotos).toHaveBeenCalledTimes(attempts);
    await act(() => jest.advanceTimersByTimeAsync(window));
    expect(mockPhotos).toHaveBeenCalledTimes(++attempts);
  };
  await flushCollectionMedia();
  expect(mockPhotos).toHaveBeenCalledTimes(++attempts);
  await expectRetryAfter(30_000);
  requestCollectionSync();
  await tick();
  expect(mockSync).toHaveBeenCalledTimes(3);
  await expectRetryAfter(60_000 - 500);
  for (const wait of [120_000, 240_000, 480_000, 900_000, 900_000]) await expectRetryAfter(wait);
  mockNetwork({ isConnected: true });
  await tick();
  await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(++attempts);
  mockPhotos.mockResolvedValue(undefined);
  await expectRetryAfter(900_000, 1_000);
  mockPhotos.mockRejectedValueOnce(new Error("Photo upload failed with HTTP 500"));
  requestCollectionSync();
  await tick();
  await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(++attempts);
  await expectRetryAfter(30_000, 1_000);
});

it("backs up the registered device before Apple sign-in and switches scope after linking", async () => {
  mockAccount = { scope: "a", accountId: null };
  const screen = await render(<CollectionSync />);
  await tick();
  requestCollectionSync();
  await tick();
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockSync.mock.calls[0][1]).toMatchObject({
    deviceId: "a",
    accountId: null,
  });
  mockAccount = { scope: "account:a,b", accountId: "account" };
  await screen.rerender(<CollectionSync />);
  await tick();
  expect(mockSync).toHaveBeenCalledTimes(3);
});

it("invalidates an outstanding response immediately without waiting for an offline request", async () => {
  let finish!: () => void;
  mockSync.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render(<CollectionSync />);
  await tick();
  const isCurrent = mockSync.mock.calls[0][2] as () => boolean;
  expect(isCurrent()).toBe(true);
  expect(pauseCollectionSync()).toBeUndefined();
  expect(isCurrent()).toBe(false);
  await act(async () => finish());
});

it("suspends capture scope until the account claim finishes and invalidates it on sign-out", async () => {
  switchOwner("device:test-installation", "anonymous-scope");
  const before = captureOwner();
  let finish!: (value: { claimId: null; complete: boolean }) => void;
  mockClaim.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = await render(<CollectionSync />);
  await tick();
  expect(before.isCurrent()).toBe(false);
  expect(captureOwner().scope).toBeUndefined();
  expect(getLocalOwner()).toBe("device:test-installation");
  await act(async () => finish({ claimId: null, complete: true }));
  expect(getLocalOwner()).toBe("account:account");
  const linked = captureOwner();
  mockAccount = { scope: "anonymous-next", accountId: null };
  await screen.rerender(<CollectionSync />);
  expect(linked.isCurrent()).toBe(false);
  expect(getLocalOwner()).toBe("device:test-installation");
});

it("rejects flushJournal with the sync failure, keeps the scheduled retry, and reports a paused or backgrounded queue", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  await render(<CollectionSync />);
  await tick();
  const failure = new Error("Network request failed");
  mockSync.mockRejectedValueOnce(failure);
  await expect(flushJournal()).rejects.toBe(failure);
  expect(mockReportError).toHaveBeenCalledWith(failure, "sync.journal");
  expect(mockSync).toHaveBeenCalledTimes(2);
  await act(() => jest.advanceTimersByTimeAsync(30_000));
  expect(mockSync).toHaveBeenCalledTimes(3);
  await expect(flushJournal()).resolves.toBeUndefined();
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "background",
  });
  await expect(flushJournal()).rejects.toBeInstanceOf(SyncUnavailableError);
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "active",
  });
  pauseCollectionSync();
  await expect(flushJournal()).rejects.toBeInstanceOf(SyncUnavailableError);
});

it("lets flushCollectionMedia through a transfer failure unless the caller depends on the missing media", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  await render(<CollectionSync />);
  await tick();
  const failure = new Error("Photo exceeds the upload limit");
  mockPhotos.mockRejectedValue(failure);
  mockPending = false;
  mockJournalPending = false;
  const before = {
    sync: mockSync.mock.calls.length,
    photos: mockPhotos.mock.calls.length,
  };
  await expect(flushCollectionMedia({ photoLocalIds: ["other"] })).resolves.toBeUndefined();
  expect(mockAlbumPending).toHaveBeenLastCalledWith("account:account", {
    photoLocalIds: ["other"],
  });
  // Nothing pending: no sync round trip is spent on the caller's behalf.
  expect(mockSync).toHaveBeenCalledTimes(before.sync);
  expect(mockPhotos).toHaveBeenCalledTimes(before.photos);
  mockJournalPending = true;
  await expect(flushCollectionMedia({ photoLocalIds: ["other"] })).resolves.toBeUndefined();
  expect(mockSync).toHaveBeenCalledTimes(before.sync + 1);
  expect(mockPhotos).toHaveBeenCalledTimes(before.photos + 1);
  mockPending = true;
  await expect(flushCollectionMedia({ photoLocalIds: ["hung"] })).rejects.toBe(failure);
  expect(mockReportError).toHaveBeenCalledWith(failure, "sync.photos");
  mockPhotos.mockResolvedValue(undefined);
  await expect(flushCollectionMedia({ photoLocalIds: ["hung"] })).rejects.toBeInstanceOf(SyncUnavailableError);
  mockPhotos.mockImplementationOnce(async () => {
    mockPending = false;
  });
  await expect(flushCollectionMedia({ photoLocalIds: ["hung"] })).resolves.toBeUndefined();
});

it("reports a failed owner persistence without exposing the owner or stopping the sync", async () => {
  const failure = new Error("Database unavailable");
  mockAccount = { scope: "a", accountId: null };
  mockSetSetting.mockRejectedValueOnce(failure);
  await render(<CollectionSync />);
  await tick();
  expect(mockReportError).toHaveBeenCalledWith(failure, "sync.persist_owner");
  expect(mockSync).toHaveBeenCalledTimes(1);
});

it("uploads saved scans on their own queue, so media flushes never wait for them and failures retry alone", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  let failUpload!: (error: Error) => void;
  mockRecognition.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        failUpload = reject;
      }),
  );
  await render(<CollectionSync />);
  await tick();
  await tick();
  expect(mockRecognition).toHaveBeenCalledTimes(1);
  expect(mockPhotos).toHaveBeenCalledTimes(1);
  mockPending = true;
  mockPhotos.mockImplementationOnce(async () => {
    mockPending = false;
  });
  await expect(flushCollectionMedia({ photoLocalIds: ["photo"] })).resolves.toBeUndefined();
  expect(mockPhotos).toHaveBeenCalledTimes(2);
  const failure = new Error("Network request failed");
  await act(async () => failUpload(failure));
  expect(mockReportError).toHaveBeenCalledWith(failure, "sync.recognition");
  await act(() => jest.advanceTimersByTimeAsync(29_000));
  expect(mockRecognition).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTimeAsync(1_000));
  expect(mockRecognition).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  "links an uploaded crop only to its source in the current album (changed: %s)",
  async (changed) => {
    mockGetSavedWork.mockResolvedValue({
      photoPath: "old-source.jpg",
      cropPhotoLocalId: "source-photo",
      cropPath: changed ? "new-crop.jpg" : "crop.jpg",
    });
    mockSelectPhotos.mockReturnValue([
      { localId: "source-photo", path: "source.jpg" },
      { localId: "private-photo", path: "other.jpg" },
    ]);
    mockUploadPhoto.mockClear();
    mockPhotos.mockImplementationOnce(
      async (deps: { upload: (id: string, kind: string, path: string) => Promise<unknown> }) => {
        await deps.upload("artwork", "crop", "crop.jpg");
      },
    );
    await render(<CollectionSync />);
    await tick();
    await tick();
    expect(mockUploadPhoto).toHaveBeenCalledWith(
      "token",
      "account:a,b",
      "artwork",
      "crop",
      "crop.jpg",
      expect.any(Function),
      changed ? undefined : "source-photo",
    );
  },
);

it("does not carry an old account's failed request backoff into the next account", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  let fail!: (error: Error) => void;
  mockSync.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  const screen = await render(<CollectionSync />);
  await tick();
  mockAccount = { scope: "account:next", accountId: "next" };
  await screen.rerender(<CollectionSync />);
  await tick();
  const failure = new Error("Old session failed");
  await act(async () => fail(failure));
  await tick();
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockSync.mock.calls[1][1].owner).toBe("account:next");
  expect(mockReportError).not.toHaveBeenCalledWith(failure, "sync.journal");
});

it("rejects a direct journal flush if its account changes while the request runs", async () => {
  const screen = await render(<CollectionSync />);
  await tick();
  let finish!: () => void;
  mockSync.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const outcome = flushJournal().then(
    () => null,
    (error: unknown) => error,
  );
  await act(async () => {});
  mockAccount = { scope: "account:next", accountId: "next" };
  await screen.rerender(<CollectionSync />);
  await act(async () => finish());
  expect(await outcome).toBeInstanceOf(SyncUnavailableError);
});

it("rejects a media flush if its account changes during a transfer", async () => {
  const screen = await render(<CollectionSync />);
  await tick();
  await tick();
  mockPending = true;
  let finish!: () => void;
  mockPhotos.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const outcome = flushCollectionMedia({ photoLocalIds: ["photo"] }).then(
    () => null,
    (error: unknown) => error,
  );
  await act(async () => {});
  mockAccount = { scope: "account:next", accountId: "next" };
  await screen.rerender(<CollectionSync />);
  await act(async () => finish());
  expect(await outcome).toBeInstanceOf(SyncUnavailableError);
});

it("keeps a linked scope across a token refresh but suspends it again when the account scope changes", async () => {
  const screen = await render(<CollectionSync />);
  await tick();
  expect(captureOwner()).toMatchObject({
    owner: "account:account",
    scope: "account:a,b",
  });
  const linked = captureOwner();
  mockToken = "rotated";
  await screen.rerender(<CollectionSync />);
  expect(linked.isCurrent()).toBe(true);
  expect(captureOwner().scope).toBe("account:a,b");
  mockClaim.mockImplementationOnce(() => new Promise(() => {}));
  mockAccount = { scope: "account:a,b:2", accountId: "account" };
  await screen.rerender(<CollectionSync />);
  await tick();
  expect(linked.isCurrent()).toBe(false);
  expect(captureOwner()).toMatchObject({
    owner: "account:account",
    scope: undefined,
  });
});
