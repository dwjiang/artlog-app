import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import * as SQLite from "expo-sqlite";
import type { ReactNode } from "react";
import { AppState } from "react-native";

import { db } from "@/db/client";
import { enqueuePendingScan, pendingScansQuery } from "@/db/repos/pending-scans";
import { getSavedWork } from "@/db/repos/saved-works";
import * as visits from "@/db/repos/visits";
import { notes, savedWorks } from "@/db/schema";
import { updatePhotoSession } from "@/lib/capture/photo-draft";
import { clearLabelDraft } from "@/lib/label/draft";
import { resolveWithLabel } from "@/lib/result/feedback";

import type { Id } from "../../../convex/_generated/dataModel";
import { SHARING_NOTICE } from "./label/contribution-status";
import { ResultScreen } from "./result-screen";
import {
  bridge,
  confidentScan,
  confidentScanWithoutProse,
  docent,
  factSheet,
  failedScan,
  haystacks,
  lilies,
  missScan,
  SCAN_ID,
  softScan,
  unsupportedScan,
} from "./result/__fixtures__/scan";
import { DOCENT_RETRY } from "./result/docent-section";
import { LABEL_BUTTON } from "./result/save-bar";

jest.mock("@/lib/audio/use-listening");
jest.mock("@/lib/audio/use-cached-narration-duration", () => ({
  useCachedNarrationDuration: () => undefined,
}));
jest.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));
jest.mock("./capture-context-button", () => ({
  CaptureContextButton: () => null,
}));
jest.mock("./capture-photos-button", () => ({
  CapturePhotosButton: () => null,
  useCapturePhotos: () => ({
    photoCount: 1,
    open: jest.fn(),
    unavailable: false,
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
const mockSign = jest.fn();
const mockSaveMutation = jest.fn();
const mockHaptic = jest.fn();
const mockAuth = { isAuthenticated: true };
let mockUuid = 0;
let mockFocused = true;
const mockNetwork = { isInternetReachable: true };
let client: ConvexReactClient;
const results = new Map<string, unknown>();
const listeners = new Set<() => void>();
const databaseListeners = new Set<Parameters<typeof SQLite.addDatabaseChangeListener>[0]>();

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/files/photos", () => ({
  ...jest.requireActual("@/lib/files/photos"),
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("@/lib/venue/venue-db", () => ({
  venueNameById: async () => "Legion of Honor",
}));
jest.mock("@/lib/attested-write", () => ({
  signPayload: (payload: unknown) => mockSign(payload),
}));
jest.mock("@/lib/queue/queue", () => ({ retryPendingScan: jest.fn() }));
jest.mock("@/lib/label/contribute", () => ({
  contributeLabel: jest.fn(),
  contributionErrorMessage: () => "Couldn’t save to the shared index right now",
}));
jest.mock("expo-network", () => ({ useNetworkState: () => mockNetwork }));
jest.mock("@/lib/convex-client", () => ({
  convex: {
    mutation: (fn: unknown, args: unknown) =>
      mockSaveMutation(jest.requireActual("convex/server").getFunctionName(fn), args),
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => `saved-${++mockUuid}` }));
jest.mock("expo-router/react-navigation", () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock("expo-router", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const Action = ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
    >
      <Text>{children}</Text>
    </Pressable>
  );
  return {
    useRouter: () => ({
      push: mockPush,
      navigate: mockPush,
      replace: mockReplace,
      dismissAll: mockDismissAll,
    }),
    Stack: { Toolbar: Object.assign(View, { Button: Action, Menu: View, MenuAction: Action }) },
  };
});
jest.mock("expo-haptics", () => ({
  notificationAsync: (type: string) => mockHaptic(type),
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useConvexAuth: () => mockAuth,
}));

beforeAll(async () => {
  await visits.upsertVisit({
    visitedOn: "1970-01-01",
    timeZone: "UTC",
    localId: "aea0b816-f46f-5312-a657-f92d1af2cb76",
    venueId: "museum-met" as Id<"museums">,
    venueName: "The Met",
    startedAt: 1,
  });
  await enqueuePendingScan({
    localId: "capture-1",
    photoPath: "photos/c1.jpg",
    cropPath: "crops/c1.jpg",
    vector: [0.1],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    modelVersion: "m",
    attemptModelVersion: "m",
    venueId: "museum-met" as Id<"museums">,
    visitLocalId: "aea0b816-f46f-5312-a657-f92d1af2cb76",
    capturedAt: 1,
    status: "identified",
    scanId: SCAN_ID,
    createdAt: 1,
  });
  await enqueuePendingScan({
    localId: "capture-9",
    photoPath: "photos/c9.jpg",
    cropPath: "crops/c9.jpg",
    vector: [0.1],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    modelVersion: "m",
    attemptModelVersion: "m",
    capturedAt: 2,
    status: "queued",
    createdAt: 2,
  });
});

beforeEach(async () => {
  db.delete(notes).run();
  db.delete(savedWorks).run();
  mockFocused = true;
  jest.resetAllMocks();
  mockNetwork.isInternetReachable = true;
  await clearLabelDraft(SCAN_ID);
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove() {} }));
  databaseListeners.clear();
  jest.spyOn(SQLite, "addDatabaseChangeListener").mockImplementation((listener) => {
    databaseListeners.add(listener);
    return {
      remove: () => {
        databaseListeners.delete(listener);
      },
    };
  });
  mockAuth.isAuthenticated = true;
  mockSign.mockResolvedValue({
    nonce: "nonce-1",
    assertionBase64: "",
    payloadJson: "p",
  });
  mockSaveMutation.mockResolvedValue({
    collectionId: "col-1",
    updatedAt: 20,
    updatedBy: "device",
  });
  mockHaptic.mockResolvedValue(undefined);
  results.clear();
  listeners.clear();
  results.set("devices:me", {
    deviceId: "device-1",
    attested: false,
    trustWeight: 1,
  });
  results.set("scans:get", confidentScan);
  client = new ConvexReactClient("https://test.convex.cloud", {
    logger: false,
  });
  jest.spyOn(client, "watchQuery").mockImplementation((...[query]: Parameters<ConvexReactClient["watchQuery"]>) => ({
    localQueryResult: () => {
      const result = results.get(getFunctionName(query));
      if (result instanceof Error) throw result;
      return result;
    },
    onUpdate: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    localQueryLogs: () => undefined,
    journal: () => undefined,
  }));
  jest.spyOn(client, "mutation").mockImplementation(async (...[fn]: Parameters<ConvexReactClient["mutation"]>) => {
    if (getFunctionName(fn) === "feedback:rejectMatch") {
      return { feedbackId: "fb-1", canResolve: true };
    }
    return null;
  });
});
afterEach(async () => {
  await client.close();
  jest.restoreAllMocks();
});

function publish(scan: unknown) {
  return act(() => {
    results.set("scans:get", scan);
    for (const listener of listeners) listener();
  });
}

async function openDetails() {
  const edit = within(screen.getByLabelText("Scan options")).queryByRole("button", { name: "Edit Details" });
  if (edit) await fireEvent.press(edit);
}

function result(scanId: string = SCAN_ID, manual = false) {
  return (
    <ConvexProvider client={client}>
      <ResultScreen scanId={scanId} manual={manual} />
    </ConvexProvider>
  );
}

async function identifiedCapture(localId: string) {
  await enqueuePendingScan({
    localId,
    photoPath: `photos/${localId}.jpg`,
    cropPath: `crops/${localId}.jpg`,
    vector: [0.1],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    modelVersion: "m",
    attemptModelVersion: "m",
    capturedAt: 1,
    createdAt: 1,
    status: "identified",
    scanId: localId as Id<"scans">,
  });
}

async function inRecentScans(localId: string) {
  return (await pendingScansQuery()).some((row) => row.localId === localId);
}

it("keeps a viewed result in recent scans until it is saved", async () => {
  const localId = "viewed-result";
  await identifiedCapture(localId);
  await render(result(localId));
  expect(await screen.findByText("Match")).toBeOnTheScreen();
  expect(await inRecentScans(localId)).toBe(true);
  await fireEvent.press(
    screen.getByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  );
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await inRecentScans(localId)).toBe(false);
});

it.each([
  ["unsupported", unsupportedScan],
  ["failed", failedScan],
  ["unavailable", null],
] as const)("keeps a scan in the queue when its server card is %s", async (kind, scan) => {
  const localId = `recent-${kind}`;
  await identifiedCapture(localId);
  results.set("scans:get", scan);
  await render(result(localId));
  await waitFor(() =>
    expect(screen.getByLabelText("Your photo of this painting").props.source).toEqual([
      { uri: `file:///documents/crops/${localId}.preview.jpg` },
    ]),
  );
  expect(await inRecentScans(localId)).toBe(true);
});

it("shows listen controls and the audio guide transcript inline once narration exists", async () => {
  results.set("artworks:enrichment", {
    rightsStatus: "public_domain",
    narrationOpening: "Water Lilies, by Claude Monet.",
    narrationAvailable: true,
    narrationFacts: [{ id: "f9", sourceUrl: "https://museum.example/lilies", sourceLabel: "Test Museum" }],
    narration: [
      { sentence: "Water Lilies, by Claude Monet.", factIds: [] },
      { sentence: "Monet grew these lilies in his garden at Giverny.", factIds: ["f9"] },
    ],
  });
  await render(result());
  expect(screen.getByRole("header", { name: "About this work" })).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Play audio guide" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Add to queue" })).toBeEnabled();
  expect(await screen.findByText("Audio guide transcript")).toBeOnTheScreen();
  expect(screen.getByText("Monet grew these lilies in his garden at Giverny.")).toBeOnTheScreen();
  expect(screen.getByRole("link", { name: "Test Museum" })).toBeOnTheScreen();
});

it("shows a confident match with its fields, chip, prose, sources and news", async () => {
  await render(result());
  expect(await screen.findByText("Match")).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Title")).toBeNull();
  await openDetails();
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("Water Lilies");
  expect(screen.getByLabelText("Artist").props.defaultValue).toBe("Claude Monet");
  expect(screen.getByLabelText("Date").props.defaultValue).toBe("1916");
  expect(screen.getByLabelText("Medium").props.defaultValue).toBe("Oil on canvas");
  expect(screen.getByLabelText("Institution").props.defaultValue).toBe("Metropolitan Museum of Art");
  expect(screen.getByRole("header", { name: "About this work" })).toBeOnTheScreen();
  expect(screen.getByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  expect(screen.getByRole("link", { name: "The Met" })).toBeOnTheScreen();
  expect(screen.getByText("From the web")).toBeOnTheScreen();
  expect(screen.getByRole("link", { name: "Example News" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Scan the Label" })).toBeOnTheScreen();
  expect(screen.queryByText("Other possibilities")).toBeNull();
  expect(screen.getByRole("button", { name: "Not right?" })).toBeOnTheScreen();
  await waitFor(() =>
    expect(screen.getByLabelText("Your photo of this painting").props.source).toEqual([
      { uri: "file:///documents/crops/c1.preview.jpg" },
    ]),
  );
  expect(screen.getByRole("button", { name: "Adjust crop" })).toBeEnabled();
  expect(client.watchQuery).toHaveBeenCalledWith(expect.anything(), { scanId: SCAN_ID }, {});
});

it("asks the server to write the background again after a failed run", async () => {
  results.set("scans:get", { ...confidentScanWithoutProse, docentStatus: "failed" });
  await render(result());
  expect(await screen.findByText("Couldn’t load background information for this work.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: DOCENT_RETRY }));
  await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(1));
  expect(getFunctionName(jest.mocked(client.mutation).mock.calls[0][0])).toBe("docent:retry");
  expect(jest.mocked(client.mutation).mock.calls[0][1]).toEqual({ scanId: SCAN_ID });
});

it("keeps the card usable while the prose is still being written, then fills it in", async () => {
  results.set("scans:get", confidentScanWithoutProse);
  await render(result());
  expect(await screen.findByLabelText("Loading artwork information…")).toBeOnTheScreen();
  await openDetails();
  await fireEvent.changeText(screen.getByLabelText("Title"), "Nymphéas");
  await publish({
    ...confidentScanWithoutProse,
    docent: confidentScan.docent,
    factSheet: confidentScan.factSheet,
  });
  expect(await screen.findByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  );
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "Nymphéas",
  });
});

it("shows a soft match as a maybe with the suggestions and the label button", async () => {
  results.set("scans:get", softScan);
  await render(result());
  expect(await screen.findByText("Maybe")).toBeOnTheScreen();
  expect(screen.getByLabelText("Maybe, 62% confidence")).toBeOnTheScreen();
  expect(screen.getByText("12% confidence")).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("The Japanese Footbridge");
  expect(screen.getByText("Other possibilities")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  expect(screen.queryByText("About this work")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: LABEL_BUTTON }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/label/[scanId]",
    params: { scanId: SCAN_ID },
  });
});

it("keeps optional details hidden on an unidentified card and offers every candidate", async () => {
  results.set("scans:get", missScan);
  await render(result());
  expect(await screen.findByText("Unidentified")).toBeOnTheScreen();
  expect(screen.getByText("20% confidence")).toBeOnTheScreen();
  expect(screen.getByText("31% confidence")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", {
      name: /^The Japanese Footbridge, Claude Monet/,
    }),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Save photo for later" })).toBeEnabled();
  expect(screen.getByText(LABEL_BUTTON)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Not right?" })).toBeNull();
  // Typed details are confirmed on their own screen, which then reopens this card naming the work.
  await openDetails();
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/enter-details/[scanId]", params: { scanId: SCAN_ID } });
});

it.each([softScan, missScan, failedScan])(
  "saves a $outcome scan as a photo without adopting an unconfirmed identity",
  async (scan) => {
    results.set("scans:get", scan);
    await render(result());
    const save = await screen.findByRole("button", {
      name: "Save photo for later",
    });
    expect(screen.queryByLabelText("Title")).toBeNull();
    await fireEvent.press(save);
    expect(await screen.findByText("Saved to collection")).toBeOnTheScreen();
    expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
      title: "Unidentified artwork",
      artist: "",
      objectId: null,
      photoPath: "photos/c1.jpg",
    });
    expect(mockSaveMutation).toHaveBeenCalledWith(
      "collections:saveToCollection",
      expect.objectContaining({ suggested: null, objectId: undefined }),
    );
  },
);

it("saves a runner-up picked on a soft card with its object instead of a bare photo", async () => {
  results.set("scans:get", softScan);
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: /^Haystacks, Claude Monet/ }));
  expect(screen.queryByRole("button", { name: "Save photo for later" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Save with these details" }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "Haystacks",
    artist: "Claude Monet",
    objectId: haystacks.objectId,
  });
  expect(mockSaveMutation).toHaveBeenCalledWith(
    "collections:saveToCollection",
    expect.objectContaining({ objectId: haystacks.objectId, suggested: null }),
  );
});

it("fills the fields from a suggestion picked on a soft card without sending feedback", async () => {
  results.set("scans:get", softScan);
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: /^Haystacks, Claude Monet/ }));
  await openDetails();
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("Haystacks");
  expect(screen.getByLabelText("Maybe, 12% confidence")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /^Haystacks, Claude Monet/ })).toBeNull();
  expect(
    screen.getByRole("button", { name: /^The Japanese Footbridge, Claude Monet, 62% confidence$/ }),
  ).toBeOnTheScreen();
  expect(client.mutation).not.toHaveBeenCalled();
});

it("saves an untouched confident card locally, tells the server the suggestion was kept, and links to the collection", async () => {
  await render(result());
  await fireEvent.press(
    await screen.findByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  );
  const link = await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  const savedId = `saved-${mockUuid}`;
  expect(mockHaptic).toHaveBeenCalledWith("success");
  expect(await getSavedWork(savedId)).toMatchObject({
    title: "Water Lilies",
    artist: "Claude Monet",
    scanId: SCAN_ID,
    objectId: lilies.objectId,
    cropPath: "crops/c1.preview.jpg",
    venueName: "The Met",
  });
  await waitFor(() =>
    expect(mockSaveMutation).toHaveBeenCalledWith(
      "collections:saveToCollection",
      expect.objectContaining({
        localId: savedId,
        scanId: SCAN_ID,
        objectId: lilies.objectId,
        visitLocalId: "aea0b816-f46f-5312-a657-f92d1af2cb76",
        snapshot: expect.objectContaining({
          title: "Water Lilies",
          artist: "Claude Monet",
        }),
        suggested: { title: "Water Lilies", artist: "Claude Monet" },
      }),
    ),
  );
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(await screen.findByLabelText("Private note")).toBeOnTheScreen();
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/saved/[savedId]",
    params: { savedId },
  });
});

it("removes match choices after saving a soft card", async () => {
  results.set("scans:get", softScan);
  await render(result());
  await openDetails();
  await fireEvent.changeText(await screen.findByLabelText("Title"), "My painting");
  expect(screen.getByRole("button", { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  );
  const link = await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  const savedId = `saved-${mockUuid}`;
  expect(screen.queryByText("Other possibilities")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Haystacks, Claude Monet/ })).toBeNull();
  expect(screen.getByText((await getSavedWork(savedId))!.title)).toBeOnTheScreen();
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/saved/[savedId]",
    params: { savedId },
  });
});

it.each([confidentScan, softScan])("locks the draft and match choices while saving a $outcome card", async (scan) => {
  results.set("scans:get", scan);
  const visit = await visits.getVisit("aea0b816-f46f-5312-a657-f92d1af2cb76");
  let finishVisit!: (value: typeof visit) => void;
  jest.spyOn(visits, "getVisit").mockReturnValueOnce(
    new Promise((resolve) => {
      finishVisit = resolve;
    }),
  );
  await render(result());
  await openDetails();
  const saveButton = await screen.findByRole("button", {
    name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
  });
  const savePromise = fireEvent.press(saveButton);
  await screen.findByRole("button", {
    name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    value: { text: "Saving…" },
  });
  await fireEvent.changeText(screen.getByLabelText("Title"), "Edited while saving");
  try {
    expect(screen.getByLabelText("Title").props.editable).toBe(false);
    expect(
      screen.getByRole("button", {
        name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
        value: { text: "Saving…" },
      }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Not right?" })).toBeNull();
    expect(screen.queryByText("Other possibilities")).toBeNull();
    expect(screen.getByRole("button", { name: /^Scan the label$/i })).toBeDisabled();
  } finally {
    await act(async () => {
      finishVisit(visit);
      await savePromise;
    });
  }
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  const savedTitle = scan.outcome === "confident" ? scan.best?.title : "Unidentified artwork";
  expect(screen.getByText(savedTitle!)).toBeOnTheScreen();
  expect((await getSavedWork(`saved-${mockUuid}`))?.title).toBe(savedTitle);
  expect(mockSaveMutation).toHaveBeenCalledWith(
    "collections:saveToCollection",
    expect.objectContaining({
      snapshot: expect.objectContaining({ title: savedTitle }),
    }),
  );
});

it("unlocks the draft and match choices after a local save fails so the user can correct and retry", async () => {
  results.set("scans:get", softScan);
  jest.spyOn(visits, "getVisit").mockRejectedValueOnce(new Error("Local read failed"));
  jest.spyOn(console, "warn").mockImplementation(() => {});
  await render(result());
  await fireEvent.press(
    await screen.findByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  );
  expect(await screen.findByText("Couldn’t save. Try again.")).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText("Title").props.editable).toBe(true);
  expect(screen.getByRole("button", { name: "Not right?" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: LABEL_BUTTON })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: /^Haystacks, Claude Monet/ }));
  await openDetails();
  await fireEvent.changeText(screen.getByLabelText("Title"), "My haystacks");
  await fireEvent.press(
    screen.getByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  );
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "My haystacks",
    objectId: haystacks.objectId,
  });
});

it('records a rejection when "Not right?" opens, resolves it with the picked runner-up and re-renders as a maybe', async () => {
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
  expect(await screen.findByText("Other possible matches")).toBeOnTheScreen();
  await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(1));
  expect(mockSign).toHaveBeenCalledWith(
    JSON.stringify({
      objectId: lilies.objectId,
      operation: "rejectMatch",
      scanId: SCAN_ID,
    }),
  );
  expect(jest.mocked(client.mutation).mock.calls[0][1]).toEqual({
    scanId: SCAN_ID,
    objectId: lilies.objectId,
    nonce: "nonce-1",
    assertionBase64: "",
  });

  await fireEvent.press(
    screen.getByRole("button", {
      name: /^The Japanese Footbridge, Claude Monet/,
    }),
  );
  await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(2));
  expect(getFunctionName(jest.mocked(client.mutation).mock.calls[1][0])).toBe("feedback:resolveRejection");
  expect(jest.mocked(client.mutation).mock.calls[1][1]).toEqual({
    feedbackId: "fb-1",
    resolution: { kind: "runner_up", objectId: bridge.objectId },
  });
  expect(screen.queryByText("Let’s get it right.")).toBeNull();
  expect(screen.getByText("Maybe")).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("The Japanese Footbridge");
  expect(screen.queryByText("About this work")).toBeNull();
  expect(screen.getByRole("button", { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Water Lilies, Claude Monet/ })).toBeOnTheScreen();
  expect(screen.getByText(LABEL_BUTTON)).toBeOnTheScreen();
});

it("restores previous matches after repeated picks through Not right", async () => {
  await render(result());
  for (const candidate of [bridge, haystacks, lilies]) {
    await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
    const matches = screen.getAllByRole("button", { name: new RegExp(`^${candidate.title},`) });
    await fireEvent.press(matches[matches.length - 1]);
    expect(screen.getByText(`Could this be ${candidate.title}?`)).toBeOnTheScreen();
    for (const other of [lilies, bridge, haystacks].filter((work) => work !== candidate)) {
      expect(screen.getByRole("button", { name: new RegExp(`^${other.title},`) })).toBeOnTheScreen();
    }
    expect(screen.queryByRole("button", { name: new RegExp(`^${candidate.title},`) })).toBeNull();
  }
});

it.each([false, true])("keeps the first correction when revisiting a rejected match (pending: %s)", async (pending) => {
  jest
    .mocked(client.mutation)
    .mockImplementation(async (...[fn, args]: Parameters<ConvexReactClient["mutation"]>) =>
      getFunctionName(fn) === "feedback:rejectMatch"
        ? { feedbackId: `fb-${(args as { objectId: string }).objectId}`, canResolve: true }
        : null,
    );
  let finishSigning = () => {};
  if (pending) {
    const gate = new Promise<void>((resolve) => {
      finishSigning = resolve;
    });
    mockSign.mockImplementation(async () => {
      await gate;
      return { nonce: "nonce-1", assertionBase64: "", payloadJson: "p" };
    });
  }
  await render(result());
  for (const candidate of [bridge, lilies, haystacks]) {
    await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
    const matches = screen.getAllByRole("button", { name: new RegExp(`^${candidate.title},`) });
    await fireEvent.press(matches[matches.length - 1]);
    expect(screen.getByText(`Could this be ${candidate.title}?`)).toBeOnTheScreen();
  }
  expect(mockSign).toHaveBeenCalledTimes(2);
  await act(async () => finishSigning());
  await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(4));
  const resolutions = jest
    .mocked(client.mutation)
    .mock.calls.filter(([fn]) => getFunctionName(fn) === "feedback:resolveRejection")
    .map(([, args]) => args);
  expect(resolutions).toEqual([
    { feedbackId: `fb-${lilies.objectId}`, resolution: { kind: "runner_up", objectId: bridge.objectId } },
    { feedbackId: `fb-${bridge.objectId}`, resolution: { kind: "runner_up", objectId: lilies.objectId } },
  ]);
});

it.each(["pick", "label"])(
  "does not resolve feedback completed in an earlier visit when choosing %s",
  async (action) => {
    jest.mocked(client.mutation).mockResolvedValue({ feedbackId: "fb-1", canResolve: false });
    await render(result());
    await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
    await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(1));
    if (action === "pick") {
      await fireEvent.press(screen.getByRole("button", { name: /^The Japanese Footbridge,/ }));
    } else {
      await fireEvent.press(screen.getByRole("button", { name: "Scan the museum label" }));
      await act(async () => resolveWithLabel(client, SCAN_ID, "contrib-1" as Id<"contributions">));
    }
    expect(screen.queryByText("This device can’t send feedback yet.")).toBeNull();
    expect(client.mutation).toHaveBeenCalledTimes(1);
  },
);

it("routes to the label from the sheet and keeps the choices when feedback cannot be sent", async () => {
  mockSign.mockResolvedValue(null);
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
  expect(await screen.findByText("This device can’t send feedback yet.")).toBeOnTheScreen();
  expect(client.mutation).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Scan the museum label" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/label/[scanId]",
    params: { scanId: SCAN_ID },
  });
  expect(screen.queryByRole("button", { name: "Scan the museum label" })).toBeNull();
});

it("hands a recorded rejection to the label screen so a verified label can resolve it", async () => {
  await publish(softScan);
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
  await fireEvent.press(screen.getByRole("button", { name: "Scan the museum label" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/label/[scanId]",
    params: { scanId: SCAN_ID },
  });
  resolveWithLabel(client, SCAN_ID, "contrib-1" as Id<"contributions">);
  await waitFor(() =>
    expect(client.mutation).toHaveBeenCalledWith(expect.anything(), {
      feedbackId: "fb-1",
      resolution: { kind: "label", contributionId: "contrib-1" },
    }),
  );
});

it("can still resolve a rejection after returning from label capture without a contribution", async () => {
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
  await fireEvent.press(screen.getByRole("button", { name: "Scan the museum label" }));
  await fireEvent.press(screen.getByRole("button", { name: "Not right?" }));
  await fireEvent.press(screen.getByRole("button", { name: /^The Japanese Footbridge,/ }));
  await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(2));
  expect(jest.mocked(client.mutation).mock.calls[1][1]).toEqual({
    feedbackId: "fb-1",
    resolution: { kind: "runner_up", objectId: bridge.objectId },
  });
  await act(async () => resolveWithLabel(client, SCAN_ID, "contrib-1" as Id<"contributions">));
  expect(client.mutation).toHaveBeenCalledTimes(2);
});

it("opens the label while the rejection challenge waits for network", async () => {
  mockSign.mockImplementation(() => new Promise(() => {}));
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
  await fireEvent.press(screen.getByRole("button", { name: "Scan the museum label" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/label/[scanId]",
    params: { scanId: SCAN_ID },
  });
});

it("waits for the device before querying and shows the unsupported, failed and queued states", async () => {
  mockAuth.isAuthenticated = false;
  const view = await render(result());
  expect(await screen.findByLabelText("Identifying…")).toBeOnTheScreen();
  expect(client.watchQuery).not.toHaveBeenCalled();
  mockAuth.isAuthenticated = true;
  results.set("scans:get", unsupportedScan);
  await view.rerender(result());
  expect(await screen.findByText("Update required.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Update the app" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", {
      name: /^Save (to collection|photo for later)$/,
    }),
  ).toBeEnabled();
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  await publish(failedScan);
  expect(await screen.findByText("Identification failed.")).toBeOnTheScreen();
  expect(screen.getByText("The photo couldn’t be read. Try scanning the painting again.")).toBeOnTheScreen();
  expect(screen.queryByText("bad_features")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await view.rerender(result("local-capture-9"));
  expect(await screen.findByText("Waiting for signal")).toBeOnTheScreen();
  await waitFor(() =>
    expect(screen.getByLabelText("Your photo of this painting").props.source).toEqual([
      { uri: "file:///documents/crops/c9.preview.jpg" },
    ]),
  );
});

it("saves an unsupported scan anyway with a typed title and keeps its scan id", async () => {
  results.set("scans:get", unsupportedScan);
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: "Add details (optional)" }));
  await fireEvent.changeText(await screen.findByLabelText("Title"), "Blue room");
  await fireEvent.press(
    screen.getByRole("button", {
      name: /^Save (to collection|photo for later)$/,
    }),
  );
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "Blue room",
    scanId: SCAN_ID,
    objectId: null,
    cropPath: "crops/c1.preview.jpg",
  });
  await waitFor(() =>
    expect(mockSaveMutation).toHaveBeenCalledWith(
      "collections:saveToCollection",
      expect.objectContaining({ scanId: SCAN_ID, suggested: null }),
    ),
  );
});

it("starts a fresh card when the same screen receives another scan id", async () => {
  const view = await render(result());
  await fireEvent.press(
    await screen.findByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  );
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  results.set("scans:get", softScan);
  await view.rerender(result("scan-2"));
  expect(await screen.findByText("Maybe")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/^(View artwork|Saved · View in collection)$/)).toBeNull();
  expect(screen.getByRole("button", { name: "Not right?" })).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText("Title").props.editable).toBe(true);
});

it("shows a failed card when the server refuses the scan", async () => {
  results.set("scans:get", null);
  await render(result());
  expect(await screen.findByText("Identification failed.")).toBeOnTheScreen();
  expect(screen.queryByText(haystacks.title)).toBeNull();
});

it("explains an invalid scan link without exposing server details and offers a way out", async () => {
  results.set(
    "scans:get",
    new Error("[CONVEX Q(scans:get)] [Request ID: secret] ArgumentValidationError: Invalid scanId\nCalled by client"),
  );
  await render(result("invalid-scan"));
  expect(await screen.findByText("This scan link is invalid or no longer available.")).toBeOnTheScreen();
  expect(screen.queryByText(/Request ID|Called by client/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Scan another artwork" }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith("/(tabs)/(scan)/scan");
  expect(mockReplace).not.toHaveBeenCalled();
});

it("keeps a tentative visitor suggestion visible and editable", async () => {
  results.set("scans:get", {
    ...softScan,
    best: { ...softScan.best!, identityStatus: "tentative" },
    runnerUps: [{ ...haystacks, identityStatus: "tentative" }],
  });
  await render(result());
  expect(await screen.findByText("Maybe")).toBeOnTheScreen();
  expect(screen.getAllByText("Shared by a visitor. Label not independently confirmed.")).toHaveLength(2);
  await openDetails();
  expect(screen.getByLabelText("Title").props.editable).toBe(true);
  expect(screen.getByRole("button", { name: "Not right?" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  ).toBeEnabled();
  expect(screen.queryByText("About this work")).toBeNull();
});

it("saves edited tentative metadata without implying confirmation", async () => {
  results.set("scans:get", {
    ...softScan,
    best: { ...softScan.best!, identityStatus: "tentative" },
  });
  await render(result());
  await openDetails();
  await fireEvent.changeText(await screen.findByLabelText("Title"), "My reading of the label");
  await fireEvent.press(
    screen.getByRole("button", {
      name: /^(Save (to collection|with these details|photo for later)|Confirm & save)$/,
    }),
  );
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "My reading of the label",
  });
  expect(mockSaveMutation).toHaveBeenCalledWith(
    "collections:saveToCollection",
    expect.objectContaining({ suggested: null }),
  );
  expect(screen.getByText("My reading of the label")).toBeOnTheScreen();
});

it("opens editing from Scan options and finishes it with Done without losing the draft", async () => {
  await render(result());
  expect(await screen.findByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  await openDetails();
  expect(within(screen.getByLabelText("Scan options")).queryByRole("button", { name: "Edit Details" })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Title"), "Nymphéas");
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  expect(screen.getByText("Nymphéas")).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("Nymphéas");
});

it("shows About this work inline while keeping the save action available", async () => {
  await render(result());
  expect(await screen.findByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "About this work" })).toBeOnTheScreen();
  expect(screen.getByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "About this work" })).toBeNull();
  expect(screen.queryByRole("link", { name: "About this work" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  expect(screen.getByRole("button", { name: "Save to collection" })).toBeEnabled();
});

const labelReading = {
  stage: "verified",
  evidence: ["wikidata"],
  warnings: [],
  moderation: "clear",
  updatedAt: 1,
  fields: {
    title: { value: "Water Lilies", evidence: "wikidata", locked: true },
    artist: { value: "Claude Monet", evidence: "wikidata", locked: true },
    date: { value: "1915", evidence: "ocr", locked: false },
  },
} as const;
const confirmedFromLabel = {
  ...missScan,
  labelFlow: labelReading,
  confirmed: {
    source: "label",
    fields: { title: "Water Lilies", artist: "Claude Monet", date: "1916" },
    confirmedAt: 5,
  },
  docent,
  docentStatus: "ready",
  factSheet,
} as const;

it("names a work from confirmed label details, with its own background and no match choices", async () => {
  results.set("scans:get", confirmedFromLabel);
  await render(result());
  expect(await screen.findByText("From the label")).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByText("Claude Monet · 1916")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "About this work" })).toBeOnTheScreen();
  expect(screen.getByText(docent[0].sentence, { exact: false })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Report description" })).toBeOnTheScreen();
  expect(screen.queryByText("Other possibilities")).toBeNull();
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  expect(screen.queryByRole("button", { name: "Not right?" })).toBeNull();
  // Both the header link and Scan options reopen the label the details came from.
  for (const edit of screen.getAllByRole("button", { name: /^Edit details$/i })) await fireEvent.press(edit);
  expect(mockPush.mock.calls).toEqual([
    [{ pathname: "/label/[scanId]", params: { scanId: SCAN_ID } }],
    [{ pathname: "/label/[scanId]", params: { scanId: SCAN_ID } }],
  ]);
});

it("saves confirmed label details as the work and shares the label, as the notice says", async () => {
  results.set("scans:get", confirmedFromLabel);
  const { contributeLabel } = jest.requireMock<typeof import("@/lib/label/contribute")>("@/lib/label/contribute");
  jest.mocked(contributeLabel).mockResolvedValue({
    contributionId: "contrib-1" as Id<"contributions">,
    status: "tentative",
  });
  await render(result());
  expect(await screen.findByText(SHARING_NOTICE)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save to collection" }));
  expect(await screen.findByText("Saved to collection")).toBeOnTheScreen();
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "Water Lilies",
    artist: "Claude Monet",
    date: "1916",
    objectId: null,
    artworkId: null,
    scanId: SCAN_ID,
  });
  expect(mockSaveMutation).toHaveBeenCalledWith(
    "collections:saveToCollection",
    expect.objectContaining({ suggested: null, objectId: undefined }),
  );
  await waitFor(() =>
    expect(contributeLabel).toHaveBeenCalledWith({
      scanId: SCAN_ID,
      capture: expect.objectContaining({ localId: "capture-1" }),
      state: expect.objectContaining({
        title: expect.objectContaining({ value: "Water Lilies", locked: true }),
        date: expect.objectContaining({ value: "1916", unlocked: false }),
      }),
    }),
  );
});

it("keeps typed details private, shows their background being written and reopens them for editing", async () => {
  results.set("scans:get", {
    ...missScan,
    confirmed: { source: "manual", fields: { title: "Pond at dusk", artist: "Unknown painter" }, confirmedAt: 5 },
    docentStatus: "writing",
  });
  await render(result());
  expect(await screen.findByText("Your details")).toBeOnTheScreen();
  expect(screen.getByText("Pond at dusk")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "About this work" })).toBeOnTheScreen();
  expect(screen.queryByText(SHARING_NOTICE)).toBeNull();
  expect(screen.getByRole("button", { name: "Save to collection" })).toBeEnabled();
  await openDetails();
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/enter-details/[scanId]", params: { scanId: SCAN_ID } });
});

it("shows a date typed without an artist on its own", async () => {
  results.set("scans:get", {
    ...missScan,
    confirmed: { source: "manual", fields: { title: "Pond at dusk", date: "1906" }, confirmedAt: 5 },
  });
  await render(result());
  expect(await screen.findByText("1906")).toBeOnTheScreen();
});

it("enters details by hand after rejecting a match", async () => {
  await render(result());
  await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Enter details manually" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/enter-details/[scanId]", params: { scanId: SCAN_ID } });
  expect(screen.queryByLabelText("Title")).toBeNull();
});

it("opens a label-only capture on its label until the owner confirms what it read", async () => {
  updatePhotoSession("device:test-installation", "photos/c1.jpg", { primaryKind: "label" });
  try {
    results.set("scans:get", missScan);
    const view = await render(result());
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: "/label/[scanId]", params: { scanId: SCAN_ID } }),
    );
    mockReplace.mockClear();
    results.set("scans:get", confirmedFromLabel);
    await view.rerender(result("other-scan"));
    await view.rerender(result());
    expect(await screen.findByText("From the label")).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText(SHARING_NOTICE)).toBeNull();
  } finally {
    updatePhotoSession("device:test-installation", "photos/c1.jpg", { primaryKind: undefined });
  }
});

const { probability: _probability, ...linkedLilies } = lilies;
const linkedFromLabel = {
  ...missScan,
  outcome: "confident",
  best: linkedLilies,
  runnerUps: [],
  labelFlow: labelReading,
  linked: { source: "label" },
  docent,
  docentStatus: "ready",
  factSheet,
} as const;

it("names the catalogue work picked from the label as a match and saves it as that work", async () => {
  results.set("scans:get", linkedFromLabel);
  await render(result());
  expect(await screen.findByLabelText("Match, from the label")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "About this work" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Not right?" })).toBeNull();
  expect(screen.queryByText(SHARING_NOTICE)).toBeNull();
  // Both the header link and Scan options reopen the label the work was picked from.
  for (const edit of screen.getAllByRole("button", { name: /^Edit details$/i })) await fireEvent.press(edit);
  expect(mockPush.mock.calls).toEqual([
    [{ pathname: "/label/[scanId]", params: { scanId: SCAN_ID } }],
    [{ pathname: "/label/[scanId]", params: { scanId: SCAN_ID } }],
  ]);
  await fireEvent.press(screen.getByRole("button", { name: "Save to collection" }));
  expect(await screen.findByText("Saved to collection")).toBeOnTheScreen();
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "Water Lilies",
    objectId: lilies.objectId,
    artworkId: lilies.artworkId,
  });
  await waitFor(() =>
    expect(mockSaveMutation).toHaveBeenCalledWith(
      "collections:saveToCollection",
      expect.objectContaining({ objectId: lilies.objectId, artworkId: lilies.artworkId }),
    ),
  );
});

it("stops sending a label-only capture back to its label once the owner picks its work", async () => {
  updatePhotoSession("device:test-installation", "photos/c1.jpg", { primaryKind: "label" });
  try {
    results.set("scans:get", linkedFromLabel);
    await render(result());
    expect(await screen.findByLabelText("Match, from the label")).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  } finally {
    updatePhotoSession("device:test-installation", "photos/c1.jpg", { primaryKind: undefined });
  }
});
