import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { upsertVisit } from "@/db/repos/visits";
import * as SQLite from "expo-sqlite";
import { Alert, AppState } from "react-native";

import type { Id } from "../../../convex/_generated/dataModel";

import { LocalScanScreen, MISSING_TITLE } from "./local-scan-screen";
import { RETRY_BUTTON } from "./states/failed-card";
import {
  IDENTIFYING_TITLE,
  LABEL_NOW,
  WAITING_LINE,
  WAITING_TITLE,
} from "./states/waiting-for-signal-card";
import {
  enqueuePendingScan,
  markIdentified,
  markIdentifying,
  retryPendingScan,
} from "@/db/repos/pending-scans";
import * as resultSave from "@/lib/result/save";
import { getSavedWork } from "@/db/repos/saved-works";
import type { NewPendingScan } from "@/db/schema";
import { FAILED_TITLE } from "@/lib/result/failure-copy";
import { cacheOfflineResult } from "@/db/repos/offline-scan-results";
import { confidentScan } from "./result/__fixtures__/scan";
jest.mock("@/components/audio/listen-actions", () => ({ ListenActions: () => null }));
jest.mock("./capture-context-button", () => ({ CaptureContextButton: () => null }));
jest.mock("./capture-photos-button", () => ({
  CapturePhotosButton: () => null,
  useCapturePhotos: () => ({ label: "Add photos", open: jest.fn(), unavailable: false }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockDismissAll = jest.fn();
const mockRetry = jest.fn();
const mockMutation = jest.fn();
const mockHaptic = jest.fn();
let mockUuid = 0;
let mockFocused = true;
const databaseListeners = new Set<Parameters<typeof SQLite.addDatabaseChangeListener>[0]>();

jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/files/photos", () => ({
  ...jest.requireActual("@/lib/files/photos"),
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("@/lib/venue/venue-db", () => ({ venueNameById: async () => "Legion of Honor" }));
// A save at the museum starts its visit; the controller is out of scope here, so the visit row is written directly.
const mockVisitForSave = jest.fn();
jest.mock("@/lib/venue/use-venue", () => ({
  visitByDefault: () => true,
  visitForSave: (...args: unknown[]) => mockVisitForSave(...args),
}));
beforeEach(() => {
  mockVisitForSave.mockImplementation(async (venueId: never, capturedAt: number) => {
    const visit = {
      localId: "4d0e6a2f-8b3c-4d9e-af10-2b3c4d5e6f70",
      venueId,
      venueName: "Legion of Honor",
      startedAt: capturedAt,
      visitedOn: "1970-01-01",
      timeZone: "UTC",
    };
    await upsertVisit(visit);
    return visit;
  });
});
jest.mock("@/lib/queue/queue", () => ({
  retryPendingScan: (localId: string) => mockRetry(localId),
}));
jest.mock("@/lib/convex-client", () => ({
  convex: {
    mutation: (fn: unknown, args: unknown) =>
      mockMutation(jest.requireActual("convex/server").getFunctionName(fn), args),
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => `saved-${++mockUuid}` }));
jest.mock("expo-router/react-navigation", () => ({ useIsFocused: () => mockFocused }));
jest.mock("expo-router", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const Action = ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
      <Text>{children}</Text>
    </Pressable>
  );
  return {
    useRouter: () => ({
      push: mockPush,
      navigate: mockNavigate,
      replace: mockReplace,
      dismissAll: mockDismissAll,
    }),
    Stack: { Toolbar: Object.assign(View, { Menu: View, MenuAction: Action }) },
  };
});
jest.mock("expo-haptics", () => ({
  notificationAsync: (type: string) => mockHaptic(type),
  NotificationFeedbackType: { Success: "success" },
}));

function row(localId: string, fields: Partial<NewPendingScan>): NewPendingScan {
  return {
    localId,
    photoPath: `photos/${localId}.jpg`,
    cropPath: `crops/${localId}.jpg`,
    vector: [0.1],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    modelVersion: "m",
    attemptModelVersion: "m",
    venueId: "museum-legion" as Id<"museums">,
    capturedAt: 1,
    createdAt: 1,
    ...fields,
  };
}

beforeAll(async () => {
  await enqueuePendingScan(row("cap-queued", { status: "queued" }));
  await enqueuePendingScan(row("cap-flight", { status: "identifying" }));
  await enqueuePendingScan(
    row("cap-failed", { status: "failed", lastError: "bad_features", attempts: 5 }),
  );
  await enqueuePendingScan(
    row("cap-done", { status: "identified", scanId: "scan-9" as Id<"scans"> }),
  );
  await enqueuePendingScan(
    row("cap-old", {
      status: "failed",
      lastError: "Update the app to identify.",
      scanId: "scan-u" as Id<"scans">,
    }),
  );
});

beforeEach(() => {
  mockFocused = true;
  jest.clearAllMocks();
  AppState.currentState = "active";
  databaseListeners.clear();
  jest.spyOn(SQLite, "addDatabaseChangeListener").mockImplementation((listener) => {
    databaseListeners.add(listener);
    return {
      remove: () => {
        databaseListeners.delete(listener);
      },
    };
  });
  mockRetry.mockResolvedValue(undefined);
  mockMutation.mockResolvedValue({ collectionId: "col-1", updatedAt: 20, updatedBy: "device" });
  mockHaptic.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

async function complete(localId: string) {
  await act(async () => {
    await markIdentified(localId, `scan-${localId}` as Id<"scans">);
    for (const listener of databaseListeners) {
      listener({
        tableName: "pendingScans",
        databaseName: "artlog.db",
        databaseFilePath: "",
        rowId: 1,
      });
    }
  });
}

it("shows cached recognition and reading immediately, preserves it when reception returns, and saves normally", async () => {
  await enqueuePendingScan(row("offline-result", { status: "queued" }));
  await cacheOfflineResult("offline-result", confidentScan);
  await render(<LocalScanScreen localId="offline-result" />);
  expect(await screen.findByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByText(/Claude Monet/)).toBeOnTheScreen();
  expect(screen.getByText(/Monet painted this pond at Giverny in 1916/)).toBeOnTheScreen();
  expect(screen.queryByText(WAITING_TITLE)).toBeNull();
  await complete("offline-result");
  expect(mockReplace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Save to collection" }));
  expect(await screen.findByText("Saved to your collection")).toBeOnTheScreen();
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "Water Lilies",
    artist: "Claude Monet",
    objectId: confidentScan.best?.objectId,
  });
});

it("opens the server result once the queue identifies a capture that already shows a cached match", async () => {
  await enqueuePendingScan(row("offline-online", { status: "queued" }));
  await cacheOfflineResult("offline-online", confidentScan);
  await render(<LocalScanScreen localId="offline-online" />);
  expect(await screen.findByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "View the online result" })).toBeNull();
  await complete("offline-online");
  await fireEvent.press(await screen.findByRole("button", { name: "View the online result" }));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/result/[scanId]",
    params: { scanId: "scan-offline-online" },
  });
});

it("drops a picked runner-up from the other possibilities of a cached recognition", async () => {
  await enqueuePendingScan(row("offline-pick", { status: "queued" }));
  await cacheOfflineResult("offline-pick", confidentScan);
  await render(<LocalScanScreen localId="offline-pick" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Not right?" }));
  await fireEvent.press(
    screen.getByRole("button", { name: /^The Japanese Footbridge, Claude Monet/ }),
  );
  expect(screen.getByText("Could this be The Japanese Footbridge?")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: /^The Japanese Footbridge, Claude Monet/ }),
  ).toBeNull();
});

it("keeps a manual draft on completion, then saves it before opening the result", async () => {
  await enqueuePendingScan(row("draft-completion", { status: "queued" }));
  const alert = jest.spyOn(Alert, "alert");
  await render(<LocalScanScreen localId="draft-completion" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add details (optional)" }));
  await fireEvent.changeText(await screen.findByLabelText("Title"), "Pond at dusk");
  await fireEvent.changeText(screen.getByLabelText("Artist"), "My artist");
  await complete("draft-completion");
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("Pond at dusk");
  expect(screen.getByLabelText("Artist").props.defaultValue).toBe("My artist");
  await fireEvent.press(screen.getByRole("button", { name: "View result" }));
  expect(alert).toHaveBeenCalledWith("Discard your edits?", expect.any(String), expect.any(Array));
  expect(mockReplace).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole("button", { name: /^Save (to collection|photo for later)$/ }),
  );
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "Pond at dusk",
    artist: "My artist",
  });
  await fireEvent.press(screen.getByRole("button", { name: "View result" }));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/result/[scanId]",
    params: { scanId: "scan-draft-completion" },
  });
});

it("finishes an in-flight save when identification completes and keeps the saved link", async () => {
  await enqueuePendingScan(row("saving-completion", { status: "queued" }));
  let finishWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const save = resultSave.saveResult;
  jest.spyOn(resultSave, "saveResult").mockImplementationOnce(async (input) => {
    await pendingWrite;
    return save(input);
  });
  await render(<LocalScanScreen localId="saving-completion" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add details (optional)" }));
  await fireEvent.changeText(await screen.findByLabelText("Title"), "My saved title");
  await fireEvent.press(
    screen.getByRole("button", { name: /^Save (to collection|photo for later)$/ }),
  );
  await screen.findByRole("button", {
    name: /^Save (to collection|photo for later)$/,
    value: { text: "Saving…" },
  });
  await complete("saving-completion");
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "View result" })).toBeDisabled();
  await act(() => {
    finishWrite();
  });
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: "My saved title" });
  expect(screen.getByRole("button", { name: "View result" })).toBeEnabled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it("opens a ready result after the user explicitly discards the draft", async () => {
  await enqueuePendingScan(row("discard-completion", { status: "queued" }));
  const alert = jest.spyOn(Alert, "alert");
  await render(<LocalScanScreen localId="discard-completion" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add details (optional)" }));
  await fireEvent.changeText(await screen.findByLabelText("Title"), "Unsaved title");
  await complete("discard-completion");
  await fireEvent.press(screen.getByRole("button", { name: "View result" }));
  expect(mockReplace).not.toHaveBeenCalled();
  const discard = alert.mock.calls[0][2]?.find((button) => button.text === "Discard edits");
  expect(discard).toBeDefined();
  await act(() => discard?.onPress?.());
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/result/[scanId]",
    params: { scanId: "scan-discard-completion" },
  });
});

it("asks before the photo's crop control discards an unsaved draft", async () => {
  await enqueuePendingScan(row("crop-draft", { status: "queued" }));
  const alert = jest.spyOn(Alert, "alert");
  await render(<LocalScanScreen localId="crop-draft" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add details (optional)" }));
  await fireEvent.changeText(await screen.findByLabelText("Title"), "Unsaved title");
  await fireEvent.press(screen.getByRole("button", { name: "Adjust crop" }));
  expect(alert).toHaveBeenCalledWith("Adjust this crop?", expect.any(String), expect.any(Array));
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("Unsaved title");
});

it("saves a queued photo without asking for details", async () => {
  await enqueuePendingScan(row("photo-only", { status: "queued" }));
  await render(<LocalScanScreen localId="photo-only" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Save photo for later" }));
  expect(await screen.findByText("Saved to your collection")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({
    title: "Unidentified artwork",
    photoPath: "photos/photo-only.jpg",
  });
});

it("opens the detail fields at once when the person chose to enter details, even for a label capture", async () => {
  await enqueuePendingScan(
    row("cap-manual", { status: "queued", labelPhotoPath: "labels/cap-manual.jpg" }),
  );
  await render(<LocalScanScreen localId="cap-manual" manual />);
  expect(await screen.findByLabelText("Title")).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("Title"), "My own entry");
  await fireEvent.press(screen.getByRole("button", { name: "Save to collection" }));
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: "My own entry" });
});

it("shows the queued capture as waiting for signal, sends the label offline and saves with optional details", async () => {
  await render(<LocalScanScreen localId="cap-queued" />);
  expect(await screen.findByText(WAITING_TITLE)).toBeOnTheScreen();
  expect(screen.getByText(WAITING_LINE)).toBeOnTheScreen();
  expect(screen.getByLabelText("Your photo of this painting").props.source).toEqual([
    { uri: "file:///documents/crops/cap-queued.preview.jpg" },
  ]);
  await fireEvent.press(screen.getByRole("button", { name: LABEL_NOW }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/label/[scanId]",
    params: { scanId: "local-cap-queued", offline: "1" },
  });
  expect(
    screen.getByRole("button", { name: /^Save (to collection|photo for later)$/ }),
  ).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Add details (optional)" }));
  await fireEvent.changeText(screen.getByLabelText("Title"), "Pond at dusk");
  await fireEvent.press(
    screen.getByRole("button", { name: /^Save (to collection|photo for later)$/ }),
  );
  const link = await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  const savedId = `saved-${mockUuid}`;
  expect(await getSavedWork(savedId)).toMatchObject({
    title: "Pond at dusk",
    artist: "",
    cropPath: "crops/cap-queued.preview.jpg",
    photoPath: "photos/cap-queued.jpg",
    scanId: null,
    venueId: "museum-legion",
    venueName: "Legion of Honor",
    visitLocalId: "4d0e6a2f-8b3c-4d9e-af10-2b3c4d5e6f70",
  });
  await waitFor(() =>
    expect(mockMutation).toHaveBeenCalledWith(
      "collections:saveToCollection",
      expect.objectContaining({ localId: savedId, suggested: null }),
    ),
  );
  expect(mockMutation.mock.calls[0][1].scanId).toBeUndefined();
  expect(mockHaptic).toHaveBeenCalledWith("success");
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(screen.getByText("Pond at dusk")).toBeOnTheScreen();
  await fireEvent.press(link);
  expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/saved/[savedId]", params: { savedId } });
  expect(mockReplace).not.toHaveBeenCalled();
});

it("reads as identifying while the flusher has the capture in flight", async () => {
  await render(<LocalScanScreen localId="cap-flight" />);
  expect(await screen.findByLabelText(IDENTIFYING_TITLE)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: LABEL_NOW })).toBeOnTheScreen();
});

it.each([
  ["queued", WAITING_TITLE],
  ["identifying", IDENTIFYING_TITLE],
] as const)(
  "keeps an unsupported retry local while %s, then opens the completed result",
  async (status, title) => {
    const localId = `unsupported-retry-${status}`;
    const scanId = `scan-${localId}` as Id<"scans">;
    await enqueuePendingScan(
      row(localId, { status: "failed", scanId, lastError: "Update the app to identify." }),
    );
    await retryPendingScan(localId);
    if (status === "identifying") await markIdentifying(localId);

    await render(<LocalScanScreen localId={localId} />);
    expect(
      await (status === "identifying" ? screen.findByLabelText(title) : screen.findByText(title)),
    ).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText("Your result is ready")).toBeNull();
    expect(screen.queryByRole("button", { name: "View result" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Save (to collection|photo for later)$/ }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: LABEL_NOW }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/label/[scanId]",
      params: { scanId: `local-${localId}`, offline: "1" },
    });

    await complete(localId);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/result/[scanId]",
        params: { scanId },
      }),
    );
  },
);

it("saves a manual entry during an unsupported retry without presenting the old result as ready", async () => {
  const localId = "unsupported-retry-save";
  const scanId = `scan-${localId}` as Id<"scans">;
  await enqueuePendingScan(
    row(localId, { status: "failed", scanId, lastError: "Update the app to identify." }),
  );
  await retryPendingScan(localId);

  await render(<LocalScanScreen localId={localId} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add details (optional)" }));
  await fireEvent.changeText(await screen.findByLabelText("Title"), "My painting");
  expect(screen.getByText(WAITING_TITLE)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "View result" })).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: /^Save (to collection|photo for later)$/ }),
  );
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: "My painting", scanId });
  expect(mockReplace).not.toHaveBeenCalled();

  await complete(localId);
  expect(await screen.findByRole("button", { name: "View result" })).toBeEnabled();
  expect(screen.getByText(/^(View artwork|Saved · View in collection)$/)).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "View result" }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/result/[scanId]", params: { scanId } });
});

it("explains a failed capture and retries it through the queue", async () => {
  await render(<LocalScanScreen localId="cap-failed" />);
  expect(await screen.findByText(FAILED_TITLE)).toBeOnTheScreen();
  expect(
    screen.getByText("The photo couldn’t be read. Try scanning the painting again."),
  ).toBeOnTheScreen();
  expect(screen.queryByText(WAITING_TITLE)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: RETRY_BUTTON }));
  expect(mockRetry).toHaveBeenCalledWith("cap-failed");
});

it.each([
  ["identified", "cap-done", "scan-9"],
  ["answered as unsupported", "cap-old", "scan-u"],
])("hands an %s capture over to its server card", async (_state, localId, scanId) => {
  await render(<LocalScanScreen localId={localId} />);
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/result/[scanId]", params: { scanId } }),
  );
  expect(screen.queryByText(WAITING_TITLE)).toBeNull();
  expect(screen.queryByText(FAILED_TITLE)).toBeNull();
});

it("says when the capture is no longer on this phone", async () => {
  await render(<LocalScanScreen localId="cap-gone" />);
  expect(await screen.findByText(MISSING_TITLE)).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Scan another artwork" }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/(scan)/scan");
  expect(mockPush).not.toHaveBeenCalled();
});

it("keeps a failed scan and explains a failed retry", async () => {
  mockRetry.mockRejectedValueOnce(new Error("Unavailable"));
  await render(<LocalScanScreen localId="cap-failed" />);
  await fireEvent.press(await screen.findByRole("button", { name: RETRY_BUTTON }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /Couldn’t retry this scan\. Your photo is still here\./,
  );
  expect(screen.getByRole("button", { name: RETRY_BUTTON })).toBeEnabled();
});
