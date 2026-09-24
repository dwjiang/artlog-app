import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AppState } from "react-native";
import { AddPhotosScreen } from "./add-photos-screen";
import { CaptureContextScreen } from "./capture-context-screen";
import { db } from "@/db/client";
import {
  artworkEncounters,
  artworkPhotos,
  notes,
  pendingScans,
  savedWorks,
  settings,
  visits,
} from "@/db/schema";
import { insertSavedWork, getSavedWork } from "@/db/repos/saved-works";
import { getPendingScan, enqueuePendingScan } from "@/db/repos/pending-scans";
import { upsertVisit } from "@/db/repos/visits";
import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import {
  readPhotoSession,
  updatePhotoSession,
} from "@/lib/capture/photo-draft";
import { draftFromCandidate } from "@/lib/result/snapshot";
import { contributeLabel } from "@/lib/label/contribute";
import { formStateFromFlow } from "@/lib/label/fields";

const owner = "device:test-installation";
let mockParams: {
  draftId: string;
  title?: string;
  savedId?: string;
  visitId?: string;
};
const mockPush = jest.fn(),
  mockBack = jest.fn(),
  mockNavigate = jest.fn(),
  mockDismissAll = jest.fn(),
  mockDismissTo = jest.fn();
jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void) =>
    jest.requireActual("react").useEffect(callback, [callback]),
  useRouter: () => ({
    navigate: mockNavigate,
    dismissAll: mockDismissAll,
    dismissTo: mockDismissTo,
  }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  },
  Stack: { Screen: () => null },
}));
jest.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true }));
jest.mock("react-native-vision-camera", () => ({
  Camera: () => null,
  usePhotoOutput: () => ({}),
}));
jest.mock("./camera-permission", () => ({ CameraPermission: () => null }));
jest.mock("../collection/native-segmented-picker", () => ({
  NativeSegmentedPicker: () => null,
}));
jest.mock("@/lib/capture/check-album-photo", () => ({
  checkAlbumPhoto: jest.fn(),
}));
jest.mock("@/lib/label/contribute", () => ({
  contributeLabel: jest.fn(),
  contributionErrorMessage: () => "Index save failed",
}));
jest.mock("@/lib/account/photo-transfer", () => ({
  removePhotoFile: jest.fn(),
}));
jest.mock("@/lib/files/photos", () => ({
  ...jest.requireActual("@/lib/files/photos"),
  captureFileUri: (path: string) => `file:///${path}`,
}));
jest.mock("@/lib/account/collection-sync", () => ({
  flushJournal: async () => {},
}));
jest.mock("@/lib/venue/venue-db", () => ({
  venueMetadataForIds: async (ids: string[]) =>
    ids[0] === "museum-met"
      ? [
          {
            id: "museum-met",
            key: "k",
            name: "The Met",
            lat: 40.78,
            lng: -73.96,
            website: null,
            region: "new-york",
          },
        ]
      : [],
}));
// A save at the museum starts its visit; the controller is out of scope here, so the visit row is written directly.
const mockVisitForSave = jest.fn();
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({ visit: undefined }),
  visitByDefault: () => true,
  visitForSave: (...args: unknown[]) => mockVisitForSave(...args),
}));
jest.mock("@/lib/convex-client", () => ({
  convex: {
    mutation: async () => ({
      collectionId: "remote",
      updatedAt: 1,
      updatedBy: "device",
    }),
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "saved-new" }));

beforeEach(async () => {
  jest.clearAllMocks();
  mockVisitForSave.mockImplementation(
    async (venueId: never, capturedAt: number) => {
      const visit = {
        localId: "3c9d5f1e-7a2b-4c8d-9e0f-1a2b3c4d5e6f",
        venueId,
        venueName: "The Met",
        startedAt: capturedAt,
        visitedOn: "1970-01-01",
        timeZone: "UTC",
      };
      await upsertVisit(visit);
      return visit;
    },
  );
  for (const table of [
    artworkPhotos,
    artworkEncounters,
    notes,
    savedWorks,
    pendingScans,
    visits,
    settings,
  ]) {
    db.delete(table).run();
  }
  AppState.currentState = "active";
  mockParams = {
    draftId: "saved-artwork",
    savedId: "artwork",
    title: "Water Lilies",
    visitId: "aea0b816-f46f-5312-a657-f92d1af2cb76",
  };
  await upsertVisit({
    localId: "aea0b816-f46f-5312-a657-f92d1af2cb76",
    venueId: "museum-met" as never,
    venueName: "The Met",
    visitedOn: "2026-09-01",
    timeZone: "UTC",
  });
  await upsertVisit({
    localId: "eaebe816-f46f-5312-a657-f92d1af2cb76",
    venueId: "museum-other" as never,
    venueName: "Other museum",
    visitedOn: "2026-09-02",
    timeZone: "UTC",
  });
  await insertSavedWork({
    localId: "artwork",
    title: "Water Lilies",
    artist: "Claude Monet",
    savedAt: 1,
    photoPath: "original.jpg",
    visitLocalId: "aea0b816-f46f-5312-a657-f92d1af2cb76",
    venueId: "museum-met" as never,
  });
  updatePhotoSession(owner, mockParams.draftId, {
    photos: [
      { localId: "detail", path: "detail.jpg", kind: "detail", capturedAt: 2 },
    ],
  });
});

it("retains an edited visit after leaving the session and saves only new photos to it", async () => {
  const capture = await render(<AddPhotosScreen />);
  await fireEvent.press(
    await screen.findByRole("button", {
      name: "The Met · 1 Sep 2026 · Change",
    }),
  );
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/capture-context",
    params: {
      draftId: "saved-artwork",
      visitId: "aea0b816-f46f-5312-a657-f92d1af2cb76",
      capturedAt: expect.any(String),
    },
  });
  await capture.unmount();
  const context = await render(<CaptureContextScreen />);
  expect(
    await screen.findByRole("button", {
      name: "The Met · 1 Sep 2026",
      selected: true,
    }),
  ).toBeOnTheScreen();
  await fireEvent.press(
    await screen.findByRole("button", { name: "Other museum · 2 Sep 2026" }),
  );
  expect(readPhotoSession(owner, "saved-artwork").visit).toEqual({
    kind: "visit",
    localId: "eaebe816-f46f-5312-a657-f92d1af2cb76",
  });
  await context.unmount();
  await render(<AddPhotosScreen />);
  expect(
    await screen.findByRole("button", {
      name: "Other museum · 2 Sep 2026 · Change",
    }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save 1 photo" }));
  expect(
    await screen.findByRole("button", { name: "Add a private note" }),
  ).toBeOnTheScreen();
  expect(screen.getByText("Other museum · 2 Sep 2026")).toBeOnTheScreen();
  expect(screen.getAllByLabelText("Saved photo preview")).toHaveLength(1);
  expect(selectArtworkPhotos("artwork").all()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "original.jpg",
        visitLocalId: "aea0b816-f46f-5312-a657-f92d1af2cb76",
      }),
      expect.objectContaining({
        path: "detail.jpg",
        visitLocalId: "eaebe816-f46f-5312-a657-f92d1af2cb76",
      }),
    ]),
  );
  await fireEvent.press(screen.getByRole("button", { name: "View artwork" }));
  expect(mockNavigate).toHaveBeenCalledWith({
    pathname: "/saved/[savedId]",
    params: { savedId: "artwork" },
  });
});

it("saves an unsaved artwork and every added photo directly from the session", async () => {
  await enqueuePendingScan({
    localId: "capture",
    photoPath: "capture.jpg",
    cropPath: "crop.jpg",
    capturedAt: 1,
    status: "queued",
    modelVersion: "m",
    attemptModelVersion: "m",
    vector: [],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    createdAt: 1,
  });
  const capture = (await getPendingScan("capture"))!;
  mockParams = { draftId: capture.photoPath, title: "My edited title" };
  updatePhotoSession(owner, capture.photoPath, {
    visit: { kind: "visit", localId: "eaebe816-f46f-5312-a657-f92d1af2cb76" },
    saveInput: {
      capture,
      draft: { ...draftFromCandidate(), title: "My edited title" },
    },
    photos: [
      { localId: "extra", path: "extra.jpg", kind: "detail", capturedAt: 2 },
    ],
  });
  await render(<AddPhotosScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Save 2 photos" }));
  expect(await screen.findByText("My edited title")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Add a private note" }),
  ).toBeOnTheScreen();
  expect((await getSavedWork("saved-new"))?.title).toBe("My edited title");
  expect(
    selectArtworkPhotos("saved-new")
      .all()
      .map((photo) => photo.visitLocalId),
  ).toEqual([
    "eaebe816-f46f-5312-a657-f92d1af2cb76",
    "eaebe816-f46f-5312-a657-f92d1af2cb76",
  ]);
  expect(readPhotoSession(owner, capture.photoPath).photos).toEqual([]);
  expect(mockBack).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole("button", { name: "Scan next artwork" }),
  );
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/(scan)/scan");
});

it("names a chosen visit that has since been deleted instead of calling it the current visit", async () => {
  updatePhotoSession(owner, mockParams.draftId, {
    visit: { kind: "visit", localId: "deleted-visit" },
    photos: [
      { localId: "detail", path: "detail.jpg", kind: "detail", capturedAt: 2 },
    ],
  });
  await render(<AddPhotosScreen />);
  expect(
    await screen.findByRole("button", { name: "Visit unavailable · Change" }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save 1 photo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save the photos. Your draft is still here.",
  );
  expect(
    selectArtworkPhotos("artwork")
      .all()
      .map((photo) => photo.path),
  ).toEqual(["original.jpg"]);
});

it("reloads scan bytes from storage for automatic sharing and retries without saving twice", async () => {
  const descriptors = new Uint8Array([1, 2, 3]).buffer,
    keypoints = new Uint8Array([4, 5]).buffer;
  await enqueuePendingScan({
    localId: "capture",
    photoPath: "capture.jpg",
    cropPath: "crop.jpg",
    capturedAt: 1,
    status: "identified",
    scanId: "scan-1" as never,
    venueId: "museum-met" as never,
    modelVersion: "m",
    attemptModelVersion: "m",
    vector: [],
    descriptors,
    keypoints,
    createdAt: 1,
  });
  const capture = (await getPendingScan("capture"))!;
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
  mockParams = { draftId: capture.photoPath, title: "Water Lilies" };
  updatePhotoSession(owner, capture.photoPath, {
    saveInput: {
      capture,
      draft: { ...draftFromCandidate(), title: "Water Lilies" },
      contribution: { scanId: "scan-1" as never, capture, state },
    },
  });
  jest.mocked(contributeLabel).mockRejectedValueOnce(new Error("offline"));
  await render(<AddPhotosScreen />);
  expect(screen.getByText(/Also saves the confirmed label/)).toBeOnTheScreen();
  expect(screen.queryByText("Only you can see these photos.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Save 1 photo" }));
  expect(
    await screen.findByText(
      "Index save failed. Your artwork is saved to your collection.",
    ),
  ).toBeOnTheScreen();
  expect(contributeLabel).toHaveBeenCalledWith(
    expect.objectContaining({
      capture: expect.objectContaining({ descriptors, keypoints }),
    }),
  );
  jest.mocked(contributeLabel).mockResolvedValue({
    contributionId: "contribution-1" as never,
    status: "tentative",
  });
  await fireEvent.press(
    screen.getByRole("button", { name: "Retry saving to the shared index" }),
  );
  expect(
    await screen.findByText(
      "An artwork crop was saved to the shared index. Your wall and shared visits haven’t changed.",
    ),
  ).toBeOnTheScreen();
  expect(selectArtworkPhotos("saved-new").all()).toHaveLength(1);
  // The capture was scanned at the Met with no visit yet: the save started one.
  expect(selectArtworkPhotos("saved-new").all()[0].visitLocalId).toBe(
    "3c9d5f1e-7a2b-4c8d-9e0f-1a2b3c4d5e6f",
  );
});

it("saves a conflicting photo as its own artwork in the museum visit the context chip names, dated by the scan rather than the photo", async () => {
  await enqueuePendingScan({
    localId: "capture",
    photoPath: "capture.jpg",
    cropPath: "crop.jpg",
    capturedAt: 1,
    status: "queued",
    venueId: "museum-met" as never,
    modelVersion: "m",
    attemptModelVersion: "m",
    vector: [],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    createdAt: 1,
  });
  const capture = (await getPendingScan("capture"))!;
  mockParams = { draftId: capture.photoPath, title: "Water Lilies" };
  updatePhotoSession(owner, capture.photoPath, {
    saveInput: {
      capture,
      draft: { ...draftFromCandidate(), title: "Water Lilies" },
    },
    photos: [
      {
        localId: "other",
        path: "other.jpg",
        kind: "full",
        capturedAt: 7,
        review: "conflict",
      },
    ],
  });
  await render(<AddPhotosScreen />);
  expect(
    await screen.findByRole("button", {
      name: "The Met · 31 Dec 1969 · Change",
    }),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Save as a separate artwork" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Save as a separate artwork" }),
    ).toBeNull(),
  );
  expect(mockVisitForSave).toHaveBeenCalledWith("museum-met", 1);
  expect(await getSavedWork("saved-new")).toMatchObject({
    title: "Unidentified artwork",
    savedAt: 7,
    visitLocalId: "3c9d5f1e-7a2b-4c8d-9e0f-1a2b3c4d5e6f",
    venueId: "museum-met",
    venueName: "The Met",
  });
  expect(readPhotoSession(owner, capture.photoPath).photos).toEqual([]);
});

it("keeps unresolved photos in the draft until the owner explicitly confirms them", async () => {
  updatePhotoSession(owner, mockParams.draftId, {
    photos: [
      {
        localId: "detail",
        path: "detail.jpg",
        kind: "full",
        capturedAt: 2,
        review: "uncertain",
      },
    ],
  });
  await render(<AddPhotosScreen />);
  expect(screen.getByRole("button", { name: "Save 1 photo" })).toBeDisabled();
  await fireEvent.press(
    screen.getByRole("button", { name: "Keep with this artwork" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save 1 photo" }));
  expect(await screen.findByText("Saved to your collection")).toBeOnTheScreen();
  expect(selectArtworkPhotos("artwork").all()).toHaveLength(2);
});
