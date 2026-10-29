import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { AccessibilityInfo, AppState, DeviceEventEmitter } from "react-native";

import type { PendingScan } from "@/db/schema";
import { formStateFromFlow, setFieldValue, unlockField } from "@/lib/label/fields";
import { LabelFlowError, type LabelStage } from "@/lib/label/flow";
import { reportError } from "@/lib/observability";
import { playLightHaptic, playSuccessHaptic } from "@/lib/ui/haptics";

import type { Id } from "../../../convex/_generated/dataModel";
import type { LabelFlowDisplay } from "../../../convex/lib/validators";
import { LabelCaptureScreen, QR_FOUND, QUEUED_MESSAGE, QUEUED_ONLINE_MESSAGE } from "./label-capture-screen";
import { CONFIRM_BUTTON } from "./label/confirm-details-form";
import { STEP_LABELS } from "./label/progress-steps";

jest.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));
jest.mock("@/lib/observability", () => ({
  ...jest.requireActual("@/lib/observability"),
  reportError: jest.fn(),
}));

type CameraProps = {
  isActive: boolean;
  outputs: unknown[];
  onStarted: () => void;
  onError: (error: Error) => void;
};
type StageCallback = (stage: LabelStage) => void;

let mockReachable: boolean | undefined = true;
let mockCameraPermission = true;
let mockCameraProps: CameraProps;
let mockQr: { enabled: boolean; onCode: (url: string) => void };
const mockPhoto = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
const mockCaptureId = jest.fn();
const mockUseScan = jest.fn();
const mockFlush = jest.fn();
const mockRetryLabel = jest.fn();
const mockDiscardLabel = jest.fn();
const mockLoadDraft = jest.fn();
let mockCapture: PendingScan | undefined;
let mockScan:
  | {
      labelFlow?: LabelFlowDisplay;
      confirmed?: { source: "label" | "manual"; fields: { title: string; artist?: string; date?: string } };
      outcome?: "confident";
      scanId?: Id<"scans">;
    }
  | Error
  | undefined;
const mockSetLabelPhoto = jest.fn();
const mockSetQrUrl = jest.fn();
const mockPersistLabel = jest.fn();
const mockRun = jest.fn();
const mockMutation = jest.fn();
const mockRemove = jest.fn();
const mockPermission = jest.fn();
const mockPicker = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    navigate: mockPush,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    back: mockBack,
  }),
  usePreventRemove: () => () => {},
}));
jest.mock("@/lib/convex-client", () => ({
  convex: { mutation: (...args: unknown[]) => mockMutation(...args) },
}));
jest.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true }));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: mockReachable }),
}));
jest.mock("@/lib/ui/haptics");
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: () => mockPermission(),
  launchImageLibraryAsync: (options: unknown) => mockPicker(options),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 60, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("react-native-vision-camera", () => ({
  useCameraPermission: () => ({
    hasPermission: mockCameraPermission,
    canRequestPermission: false,
    requestPermission: jest.fn(),
  }),
  usePhotoOutput: () => ({ capturePhotoToFile: mockPhoto }),
  Camera: (props: CameraProps): ReactNode => {
    mockCameraProps = props;
    return null;
  },
}));
jest.mock("@/lib/capture/use-qr-scanner", () => ({
  useQrScanner: (enabled: boolean, onCode: (url: string) => void) => {
    mockQr = { enabled, onCode };
    return enabled ? { kind: "qr-output" } : undefined;
  },
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/db/repos/pending-scans", () => ({
  MAX_LABEL_ATTEMPTS: 5,
  setLabelPhoto: (...args: unknown[]) => mockSetLabelPhoto(...args),
  setQrUrl: (...args: unknown[]) => mockSetQrUrl(...args),
}));
jest.mock("@/lib/label/use-label-capture", () => ({
  useLabelCapture: (id: string) => {
    mockCaptureId(id);
    return mockCapture;
  },
}));
jest.mock("@/lib/result/use-corpus-matches", () => ({ useCorpusMatches: () => ({ matches: [] }) }));
jest.mock("@/lib/result/use-scan", () => ({
  useScan: (id: string | undefined) => {
    mockUseScan(id);
    return mockScan;
  },
}));
jest.mock("@/lib/queue/queue", () => ({
  flushQueue: () => mockFlush(),
  retryPendingLabel: (id: string) => mockRetryLabel(id),
  discardPendingLabel: (id: string) => mockDiscardLabel(id),
}));
jest.mock("@/lib/label/draft", () => ({
  loadLabelDraft: (id: string) => mockLoadDraft(id),
}));
jest.mock("@/lib/files/photos", () => ({
  persistLabelPhoto: (input: unknown) => mockPersistLabel(input),
}));
jest.mock("@/lib/label/label-deps", () => ({
  runLabelFlowForScan: (...args: unknown[]) => mockRun(...args),
}));
jest.mock("@/lib/label/crop", () => ({
  removeFile: (uri: string) => mockRemove(uri),
}));

const scanId = "scan-1" as Id<"scans">;
const capture = {
  owner: "device:test-installation",
  localId: "cap-1",
  photoPath: "photos/c1.jpg",
  cropPath: "crops/c1.jpg",
  cropCorners: null,
  modelCropGeometry: null,
  savedPhotoLocalId: null,
  vector: [0.1],
  descriptors: new ArrayBuffer(4),
  keypoints: new ArrayBuffer(4),
  modelVersion: "m",
  attemptModelVersion: "m",
  venueId: "museum-1" as Id<"museums">,
  visitId: null,
  visitLocalId: null,
  capturedAt: 1,
  labelPhotoPath: null,
  qrUrl: null,
  status: "identified",
  attempts: 0,
  lastError: null,
  scanId,
  createdAt: 1,
} satisfies PendingScan;
const verified: LabelFlowDisplay = {
  stage: "verified",
  evidence: ["tavily+image", "wikidata"],
  warnings: ["date_outside_lifespan"],
  moderation: "clear",
  updatedAt: 1,
  sourceUrl: "https://museum.example/objects/1",
  fields: {
    title: { value: "Water Lilies", evidence: "tavily+image", locked: true },
    artist: { value: "Claude Monet", evidence: "wikidata", locked: true },
    date: { value: "1916", evidence: "ocr", locked: false },
  },
};

function deferFlow() {
  let finish!: (flow: LabelFlowDisplay) => void;
  let fail!: (error: unknown) => void;
  mockRun.mockImplementation(
    (_id: unknown, source: { qrUrl?: string }, onStage: StageCallback) =>
      new Promise<LabelFlowDisplay>((resolve, reject) => {
        onStage(source.qrUrl ? "qr" : "read");
        finish = resolve;
        fail = reject;
      }),
  );
  return {
    finish: (flow: LabelFlowDisplay) => act(async () => finish(flow)),
    fail: (error: unknown) => act(async () => fail(error)),
  };
}

async function start(props: Partial<Parameters<typeof LabelCaptureScreen>[0]> = {}) {
  const view = await render(<LabelCaptureScreen scanId={scanId} {...props} />);
  await act(async () => mockCameraProps?.onStarted());
  return view;
}

/** The details the screen confirmed, or undefined when nothing was confirmed. */
function confirmedFields() {
  const call = mockMutation.mock.calls.find(([fn]) => getFunctionName(fn) === "scans:confirm");
  return call?.[1] as { scanId: string; source: string; fields: Record<string, string> } | undefined;
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event, listener) => DeviceEventEmitter.addListener(event, listener));
  mockReachable = true;
  mockCameraPermission = true;
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() } as never);
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockCapture = capture;
  mockScan = {};
  mockFlush.mockResolvedValue(undefined);
  mockRetryLabel.mockResolvedValue(undefined);
  mockLoadDraft.mockResolvedValue(undefined);
  mockDiscardLabel.mockImplementation(async () => {
    mockCapture = capture;
  });
  mockPhoto.mockResolvedValue({ filePath: "/tmp/label.jpg" });
  mockPersistLabel.mockResolvedValue("labels/cap-1.jpg");
  mockRun.mockResolvedValue(verified);
  mockMutation.mockResolvedValue(null);
  mockPermission.mockResolvedValue({
    granted: false,
    status: "denied",
    canAskAgain: false,
  });
  mockPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///picked/label.jpg" }],
  });
});
afterEach(() => jest.restoreAllMocks());

it("prompts for the label over the camera with the QR scanner running", async () => {
  await start();
  expect(screen.getByText("Fill the frame with the museum label.")).toBeOnTheScreen();
  expect(mockCameraProps.isActive).toBe(true);
  expect(mockCameraProps.outputs).toContainEqual({ kind: "qr-output" });
  expect(mockQr.enabled).toBe(true);
  expect(screen.getByRole("button", { name: "Read label" })).toBeEnabled();
  expect(screen.getByText("Photos")).toBeOnTheScreen();
  expect(screen.getByText("Tap the shutter to read the text. QR codes scan automatically.")).toBeOnTheScreen();
  expect(mockCaptureId).toHaveBeenCalledWith(scanId);
});

it("disables capture until the camera starts and keeps both controls busy during a photo", async () => {
  let finish!: (photo: { filePath: string }) => void;
  mockPhoto.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  await render(<LabelCaptureScreen scanId={scanId} />);
  expect(screen.getByRole("button", { name: "Read label" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Import a label photo" })).toBeEnabled();
  await act(async () => mockCameraProps.onStarted());
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  expect(screen.getByRole("button", { name: "Read label" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Read label" }).props.accessibilityState).toMatchObject({ busy: true });
  expect(screen.getByRole("button", { name: "Import a label photo" })).toBeDisabled();
  expect(screen.getByText("Reading the label")).toBeOnTheScreen();
  expect(mockQr.enabled).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  expect(mockPhoto).toHaveBeenCalledTimes(1);
  await act(async () => finish({ filePath: "/tmp/label.jpg" }));
  expect(await screen.findByText("Confirm artwork details")).toBeOnTheScreen();
});

it("offers one photo import when camera permission is denied", async () => {
  mockCameraPermission = false;
  await render(<LabelCaptureScreen scanId={scanId} />);
  expect(screen.getByRole("button", { name: "Open Settings" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Read label" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Import a label photo" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Import a photo" }));
  expect(mockPicker).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Confirm artwork details")).toBeOnTheScreen();
});

it("disables denied-camera imports while keeping an offline label on this phone", async () => {
  mockCameraPermission = false;
  mockReachable = false;
  let finish!: (path: string) => void;
  mockPersistLabel.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  await render(<LabelCaptureScreen scanId={scanId} />);
  await fireEvent.press(screen.getByRole("button", { name: "Import a photo" }));
  expect(screen.getByRole("button", { name: "Import a photo" })).toBeDisabled();
  await act(async () => finish("labels/cap-1.jpg"));
  expect(screen.getByText(QUEUED_MESSAGE)).toBeOnTheScreen();
});

it("shows a recoverable camera error over the preview and keeps Photos available", async () => {
  await start();
  await act(async () => mockCameraProps.onError(new Error("Camera session failed")));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not start the camera. You can import a label photo.");
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "camera.start", { data: { screen: "label" } });
  expect(screen.getByRole("button", { name: "Read label" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Import a label photo" })).toBeEnabled();
  await act(async () => mockCameraProps.onStarted());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Read label" })).toBeEnabled();
});

it("reads a shot online, shows the stages, then locks the verified fields with their sources", async () => {
  const flow = deferFlow();
  await start();
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
  expect(mockRun).toHaveBeenCalledWith(
    scanId,
    { labelPhotoUri: "file:///tmp/label.jpg", qrUrl: undefined },
    expect.any(Function),
  );
  expect(screen.getByText("Reading the label")).toBeOnTheScreen();
  expect(screen.getByLabelText(STEP_LABELS.read).props.accessibilityState).toMatchObject({
    busy: true,
  });
  await flow.finish(verified);
  expect(screen.getByText("Confirm artwork details")).toBeOnTheScreen();
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("Water Lilies");
  expect(screen.getByLabelText("Title").props.editable).toBe(true);
  expect(screen.getByLabelText("Date").props.editable).toBe(true);
  expect(screen.getByText("The date is outside the artist’s lifespan — please check")).toBeOnTheScreen();
  expect(screen.getByRole("link", { name: "Museum page" })).toBeOnTheScreen();
  expect(mockRemove).toHaveBeenCalledWith("file:///tmp/label.jpg");
  expect(playSuccessHaptic).toHaveBeenCalledTimes(1);
});

it("confirms the read details and returns to the scan's result page, which now names the work", async () => {
  await start();
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  await fireEvent.changeText(await screen.findByLabelText("Date"), " 1917 ");
  await fireEvent.press(screen.getByRole("button", { name: CONFIRM_BUTTON }));
  expect(confirmedFields()).toEqual({
    scanId,
    source: "label",
    fields: { title: "Water Lilies", artist: "Claude Monet", date: "1917" },
  });
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: "/result/[scanId]", params: { scanId } });
});

it("keeps the details on screen when confirming fails, reporting only unexpected failures", async () => {
  await start();
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  mockMutation.mockRejectedValueOnce(new TypeError("Network request failed"));
  await fireEvent.press(await screen.findByRole("button", { name: CONFIRM_BUTTON }));
  expect(
    screen.getByText("Couldn’t reach Artlog. You can save these details privately or try confirming again."),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Save to collection" })).toBeEnabled();
  expect(reportError).not.toHaveBeenCalledWith(expect.anything(), "result.confirm_details");
  mockMutation.mockRejectedValueOnce(new ConvexError({ code: "invalid_scan" }));
  await fireEvent.press(screen.getByRole("button", { name: CONFIRM_BUTTON }));
  expect(screen.getByText("Couldn’t confirm these details. Try again.")).toBeOnTheScreen();
  expect(reportError).toHaveBeenCalledWith(expect.any(ConvexError), "result.confirm_details");
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Title")).toHaveProp("defaultValue", "Water Lilies");
});

it("reopens details confirmed from this label instead of the reading", async () => {
  mockScan = {
    labelFlow: verified,
    confirmed: { source: "label", fields: { title: "Water Lilies", artist: "Claude Monet", date: "1917" } },
  };
  await start();
  expect(await screen.findByLabelText("Date")).toHaveProp("defaultValue", "1917");
  expect(mockLoadDraft).not.toHaveBeenCalled();
});

it("enters details by hand after an unreadable label, keeping a still-queued scan on its own card", async () => {
  const flow = deferFlow();
  const view = await start();
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  await flow.fail(new LabelFlowError("nothing_read"));
  await fireEvent.press(screen.getByRole("button", { name: "Enter details myself" }));
  expect(mockReplace).toHaveBeenLastCalledWith({ pathname: "/enter-details/[scanId]", params: { scanId } });
  await view.unmount();
  mockCapture = undefined;
  await start({ scanId: "local-cap-1" });
  await fireEvent.press(screen.getByRole("button", { name: "Import a label photo" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Enter details myself" }));
  expect(mockReplace).toHaveBeenLastCalledWith({
    pathname: "/result/[scanId]",
    params: { scanId: "local-cap-1", edit: "1" },
  });
});

it.each([
  { canceled: true, assets: null },
  { canceled: false, assets: [] },
])("imports a label despite denied library access and ignores an empty selection: %s", async (result) => {
  await start();
  mockPicker.mockResolvedValueOnce(result);
  await fireEvent.press(screen.getByRole("button", { name: "Import a label photo" }));
  expect(mockRun).not.toHaveBeenCalled();
  expect(mockPersistLabel).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Read label" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Import a label photo" }));
  expect(mockPicker).toHaveBeenLastCalledWith({
    mediaTypes: ["images"],
    quality: 1,
  });
  expect(mockRun).toHaveBeenCalledWith(
    scanId,
    { labelPhotoUri: "file:///picked/label.jpg", qrUrl: undefined },
    expect.any(Function),
  );
  expect(await screen.findByLabelText("Title")).toBeOnTheScreen();
  expect(mockPhoto).not.toHaveBeenCalled();
  expect(mockPermission).not.toHaveBeenCalled();
});

it("runs the flow from a scanned QR code at once", async () => {
  const flow = deferFlow();
  await start();
  await act(async () => mockQr.onCode("https://museum.example/qr/1"));
  expect(mockRun).toHaveBeenCalledWith(
    scanId,
    { labelPhotoUri: undefined, qrUrl: "https://museum.example/qr/1" },
    expect.any(Function),
  );
  expect(screen.getByText(QR_FOUND)).toBeOnTheScreen();
  expect(screen.getByLabelText(STEP_LABELS.qr).props.accessibilityState).toMatchObject({
    busy: true,
  });
  expect(mockPhoto).not.toHaveBeenCalled();
  await flow.finish(verified);
  expect(screen.getByLabelText("Artist").props.defaultValue).toBe("Claude Monet");
  expect(mockRemove).not.toHaveBeenCalled();
});

it("keeps the label photo with the scan while offline and returns to the card", async () => {
  mockReachable = false;
  await start();
  expect(
    screen.getByText("No signal. We’ll keep the label with your scan and finish when you’re back online."),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  expect(await screen.findByText(QUEUED_MESSAGE)).toBeOnTheScreen();
  expect(mockPersistLabel).toHaveBeenCalledWith({
    localId: "cap-1",
    photoUri: "file:///tmp/label.jpg",
  });
  expect(mockSetLabelPhoto).toHaveBeenCalledWith("cap-1", "labels/cap-1.jpg", "device:test-installation");
  expect(mockRun).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Back to the scan" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("stores a QR code on a queued capture even with signal, since identify has not run yet", async () => {
  mockCapture = { ...capture, scanId: null, status: "queued" };
  await start({ scanId: "local-cap-1" });
  expect(mockCaptureId).toHaveBeenCalledWith("local-cap-1");
  expect(mockUseScan).toHaveBeenCalledWith(undefined);
  await act(async () => mockQr.onCode("https://museum.example/qr/1"));
  expect(await screen.findByText(QUEUED_ONLINE_MESSAGE)).toBeOnTheScreen();
  expect(mockSetQrUrl).toHaveBeenCalledWith("cap-1", "https://museum.example/qr/1", "device:test-installation");
  expect(mockRun).not.toHaveBeenCalled();
});

it.each(["read", "verify"] as const)(
  "queues the photo when signal is lost during %s and opens the completed label on reconnect",
  async (stage) => {
    const flow = deferFlow();
    const view = await start();
    await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
    await act(async () => mockRun.mock.calls[0][2](stage));
    mockReachable = false;
    await view.rerender(<LabelCaptureScreen scanId={scanId} />);
    await flow.fail(
      new LabelFlowError("network", {
        cause: new Error("Network request failed"),
      }),
    );

    expect(screen.getByText(QUEUED_MESSAGE)).toBeOnTheScreen();
    expect(mockPersistLabel).toHaveBeenCalledWith({
      localId: "cap-1",
      photoUri: "file:///tmp/label.jpg",
    });
    expect(mockSetLabelPhoto).toHaveBeenCalledWith("cap-1", "labels/cap-1.jpg", "device:test-installation");
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockFlush).toHaveBeenCalledTimes(1);

    mockReachable = true;
    mockScan = { labelFlow: verified };
    await view.rerender(<LabelCaptureScreen scanId={scanId} />);
    expect(await screen.findByLabelText("Title")).toHaveProp("defaultValue", "Water Lilies");
    expect(mockPhoto).toHaveBeenCalledTimes(1);
  },
);

it("queues a QR source when its request is rate limited", async () => {
  const flow = deferFlow();
  await start();
  const url = "https://museum.example/qr/1";
  await act(async () => mockQr.onCode(url));
  await flow.fail(
    new LabelFlowError("rate_limited", {
      cause: new ConvexError({ code: "rate_limited", retryAfter: 60_000 }),
    }),
  );
  expect(screen.getByText(QUEUED_ONLINE_MESSAGE)).toBeOnTheScreen();
  expect(mockSetQrUrl).toHaveBeenCalledWith("cap-1", url, "device:test-installation");
  expect(mockPersistLabel).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockFlush).toHaveBeenCalledTimes(1);
});

it("retains an interrupted label even after navigating away", async () => {
  const flow = deferFlow();
  const view = await start();
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  await view.unmount();
  await flow.fail(
    new LabelFlowError("network", {
      cause: new Error("Connection lost while action was in flight"),
    }),
  );
  expect(mockSetLabelPhoto).toHaveBeenCalledWith("cap-1", "labels/cap-1.jpg", "device:test-installation");
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockFlush).toHaveBeenCalledTimes(1);
});

it("explains a paused reader and offers a retake", async () => {
  const flow = deferFlow();
  await start();
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  await flow.fail(new LabelFlowError("feature_off"));
  expect(screen.getByText("Label reading is paused right now")).toBeOnTheScreen();
  expect(mockRemove).toHaveBeenCalledWith("file:///tmp/label.jpg");
  await fireEvent.press(screen.getByRole("button", { name: "Retake label" }));
  expect(screen.getByRole("button", { name: "Read label" })).toBeOnTheScreen();
});

it("opens a persisted verified label without taking or reading another photo", async () => {
  mockScan = { labelFlow: verified };
  await start();
  expect(await screen.findByLabelText("Title")).toHaveProp("defaultValue", "Water Lilies");
  expect(mockRun).not.toHaveBeenCalled();
  expect(mockPhoto).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: CONFIRM_BUTTON })).toBeEnabled();
});

it("opens the form when a queued local scan finishes and preserves edits across subscription updates", async () => {
  mockCapture = {
    ...capture,
    scanId: null,
    status: "queued",
    labelPhotoPath: "labels/queued.jpg",
  };
  const view = await start({ scanId: "local-cap-1" });
  expect(screen.getByText(QUEUED_ONLINE_MESSAGE)).toBeOnTheScreen();
  mockCapture = capture;
  mockScan = { labelFlow: verified };
  await view.rerender(<LabelCaptureScreen scanId="local-cap-1" />);
  expect(await screen.findByLabelText("Title")).toHaveProp("defaultValue", "Water Lilies");
  expect(mockUseScan).toHaveBeenLastCalledWith(scanId);
  await fireEvent.changeText(screen.getByLabelText("Date"), "1917");
  mockScan = { labelFlow: { ...verified, updatedAt: 2 } };
  await view.rerender(<LabelCaptureScreen scanId="local-cap-1" />);
  await fireEvent.press(screen.getByRole("button", { name: CONFIRM_BUTTON }));
  expect(confirmedFields()).toMatchObject({ scanId, fields: { date: "1917" } });
  expect(mockRun).not.toHaveBeenCalled();
});

it("offers a retry when the queued label exhausted its attempts", async () => {
  mockCapture = {
    ...capture,
    labelPhotoPath: "labels/failed.jpg",
    lastError: "model_error",
    attempts: 5,
  };
  await start();
  await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
  expect(mockRetryLabel).toHaveBeenCalledWith("cap-1");
});

it("explains a failed label retry while keeping the stored capture", async () => {
  mockCapture = {
    ...capture,
    labelPhotoPath: "labels/failed.jpg",
    lastError: "model_error",
    attempts: 5,
  };
  mockRetryLabel.mockRejectedValueOnce(new Error("Disk unavailable"));
  await start();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByText("Couldn’t retry this label. Your scan and label are still on this phone."),
  ).toBeOnTheScreen();
  expect(mockDiscardLabel).not.toHaveBeenCalled();
});

it("explains a failed restore and allows a new label capture", async () => {
  mockScan = new Error("Server unavailable");
  await render(<LabelCaptureScreen scanId={scanId} />);
  expect(screen.getByText("Couldn’t load this label")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Read label" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Capture label" }));
  expect(screen.getByRole("button", { name: "Import a label photo" })).toBeOnTheScreen();
});

it("opens the match when queued identification succeeds without needing the label", async () => {
  mockCapture = {
    ...capture,
    scanId: null,
    status: "queued",
    labelPhotoPath: "labels/queued.jpg",
  };
  const view = await start({ scanId: "local-cap-1" });
  mockCapture = capture;
  mockScan = { scanId, outcome: "confident" };
  await view.rerender(<LabelCaptureScreen scanId="local-cap-1" />);
  await fireEvent.press(screen.getByRole("button", { name: "View result" }));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/result/[scanId]",
    params: { scanId },
  });
});

it("lets a failed queued QR be replaced with a label photo", async () => {
  mockCapture = {
    ...capture,
    qrUrl: "https://unrelated.example/",
    attempts: 5,
    lastError: "qr_host_not_allowed",
  };
  await start();
  await fireEvent.press(screen.getByRole("button", { name: "Retake label" }));
  expect(mockDiscardLabel).toHaveBeenCalledWith("cap-1");
  await fireEvent.press(screen.getByRole("button", { name: "Import a label photo" }));
  expect(mockRun).toHaveBeenCalledWith(
    scanId,
    { labelPhotoUri: "file:///picked/label.jpg", qrUrl: undefined },
    expect.any(Function),
  );
  expect(await screen.findByLabelText("Title")).toBeOnTheScreen();
});

it("shows a recoverable failure when a queued verification was moderated", async () => {
  mockCapture = { ...capture, qrUrl: "https://museum.example/work" };
  const view = await start();
  mockCapture = capture;
  mockScan = {
    labelFlow: {
      ...verified,
      moderation: "flagged",
      fields: {},
      evidence: [],
      warnings: [],
    },
  };
  await view.rerender(<LabelCaptureScreen scanId={scanId} />);
  expect(screen.queryByText(QUEUED_ONLINE_MESSAGE)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Retake label" }));
  expect(screen.getByRole("button", { name: "Import a label photo" })).toBeOnTheScreen();
});

it("locks the shutter and ignores QR callbacks while a native photo is being taken", async () => {
  let finish!: (result: { filePath: string }) => void;
  mockPhoto.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await start();
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  expect(screen.getByRole("button", { name: "Read label" })).toBeDisabled();
  expect(mockQr.enabled).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "Read label" }));
  await act(async () => mockQr.onCode("https://museum.example/work"));
  expect(mockPhoto).toHaveBeenCalledTimes(1);
  expect(playLightHaptic).toHaveBeenCalledTimes(1);
  expect(mockRun).not.toHaveBeenCalled();
  await act(async () => finish({ filePath: "/tmp/label.jpg" }));
  expect(mockRun).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText("Title")).toBeOnTheScreen();
});

it("locks input until the picker is dismissed and releases it after cancellation or failure", async () => {
  let dismiss!: (result: { canceled: true; assets: null }) => void;
  mockPicker.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        dismiss = resolve;
      }),
  );
  await start();
  await fireEvent.press(screen.getByRole("button", { name: "Import a label photo" }));
  expect(screen.getByRole("button", { name: "Import a label photo" })).toBeDisabled();
  await act(async () => mockQr.onCode("https://museum.example/work"));
  expect(mockRun).not.toHaveBeenCalled();
  await act(async () => dismiss({ canceled: true, assets: null }));
  expect(screen.getByRole("button", { name: "Import a label photo" })).toBeEnabled();
  mockPicker.mockRejectedValueOnce(new Error("Picker unavailable"));
  await fireEvent.press(screen.getByRole("button", { name: "Import a label photo" }));
  expect(await screen.findByText("Picker unavailable")).toBeOnTheScreen();
  expect(mockRun).not.toHaveBeenCalled();
  expect(mockPersistLabel).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Retake label" }));
  expect(screen.getByRole("button", { name: "Import a label photo" })).toBeEnabled();
});

it("confirms a title-only label and needs a title to continue", async () => {
  mockScan = {
    labelFlow: { ...verified, fields: { title: verified.fields.title } },
  };
  await start();
  await fireEvent.changeText(await screen.findByLabelText("Title"), " ");
  expect(screen.getByRole("button", { name: CONFIRM_BUTTON })).toBeDisabled();
  expect(screen.getByText("Add a title to continue.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Title"), "Water Lilies");
  await fireEvent.press(screen.getByRole("button", { name: CONFIRM_BUTTON }));
  expect(confirmedFields()?.fields).toEqual({ title: "Water Lilies" });
});

it("restores the original values and unlocks from a persisted sharing draft", async () => {
  mockScan = {
    labelFlow: {
      ...verified,
      fields: {
        ...verified.fields,
        date: { ...verified.fields.date!, value: "1917" },
      },
    },
  };
  const draft = setFieldValue(unlockField(formStateFromFlow(verified), "title"), "date", "1917");
  mockLoadDraft.mockResolvedValue(draft);
  await start();
  expect(await screen.findByLabelText("Date")).toHaveProp("defaultValue", "1917");
  expect(screen.getByLabelText("Title")).toHaveProp("editable", true);
  await fireEvent.press(screen.getByRole("button", { name: CONFIRM_BUTTON }));
  expect(confirmedFields()?.fields).toMatchObject({ date: "1917" });
});

it("waits for persisted edits and offers a retry if they cannot be loaded", async () => {
  mockScan = { labelFlow: verified };
  mockLoadDraft.mockRejectedValueOnce(new Error("Database unavailable"));
  await start();
  expect(await screen.findByText("Couldn’t load your label edits. Try again.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: CONFIRM_BUTTON })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: CONFIRM_BUTTON })).toBeEnabled();
});

it("resumes a pending label before starting another capture", async () => {
  mockScan = { labelFlow: verified };
  mockCapture = { ...capture, labelPhotoPath: "labels/pending.jpg" };
  const view = await start();
  expect(screen.getByText(QUEUED_ONLINE_MESSAGE)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Import a label photo" })).toBeNull();
  mockCapture = capture;
  mockScan = { labelFlow: { ...verified, updatedAt: 2 } };
  await view.rerender(<LabelCaptureScreen scanId={scanId} />);
  expect(await screen.findByLabelText("Title")).toHaveProp("defaultValue", "Water Lilies");
});
