import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo, AppState, DeviceEventEmitter, Linking, type AppStateStatus } from "react-native";

import type { CaptureFeedback, CaptureState } from "@/lib/capture/capture-controller";
import type { CaptureTimings } from "@/lib/capture/stages";
import { reportError } from "@/lib/observability";
import type { VenueView } from "@/lib/venue/use-venue";

import { ScanScreen } from "./scan-screen";

jest.mock("@/lib/audio/use-listening");

jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

let mockFocused = true;
let mockGranted = true;
let mockCanRequest = false;
let mockState: CaptureState = { phase: "searching", occupied: false };
let mockFeedback: CaptureFeedback = null;
let mockOnDetection: (detection: unknown) => void;
let mockTimings: CaptureTimings | undefined;
let mockMessage: string | undefined;
let mockPresentation: { attempt: { id: string } } | undefined;
let mockPending = 0;
let mockVenueView: VenueView;
let mockCameraProps: {
  isActive: boolean;
  outputs: unknown[];
  orientationSource?: string;
  allowHapticsAndSystemSoundsPlayback?: boolean;
  onStarted: () => void;
  onStopped: () => void;
  onError: (error: Error) => void;
};
let appStateListener: (state: AppStateStatus) => void;
const mockRequest = jest.fn();
const mockPhoto = jest.fn();
const mockCapture = jest.fn();
const mockCaptureAutomatically = jest.fn();
const mockImport = jest.fn();
const mockClearMessage = jest.fn();
const mockPush = jest.fn();
const mockSelectionHaptic = jest.fn();
const mockImpactHaptic = jest.fn();
const mockObserve = jest.fn();
const mockResolveVenue = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { visitId?: string } = {};
let mockTabsListener: ((event: { data: { state: { index: number; routes: { name: string }[] } } }) => void) | undefined;
let mockVisitUnavailable: (() => void) | undefined;
const mockFrameOutput = { kind: "frame-output" };
const mockDetectorActive: boolean[] = [];
const mockResetDetection = jest.fn();

jest.mock("@shopify/react-native-skia", () => {
  const { View } = jest.requireActual("react-native");
  return { Canvas: View, Path: View };
});
jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual("react-native");
  const { useRef } = jest.requireActual("react");
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: number) => useRef({ get: () => value, set: jest.fn() }).current,
    withTiming: (value: number) => value,
    cancelAnimation: jest.fn(),
    Easing: { linear: jest.fn() },
  };
});

jest.mock("./capture-context-button", () => ({
  CaptureContextButton: () => null,
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({
    addListener: () => () => {},
    setParams: (...args: unknown[]) => mockSetParams(...args),
    getParent: () => ({
      addListener: (_event: string, listener: typeof mockTabsListener) => {
        mockTabsListener = listener;
        return () => {
          mockTabsListener = undefined;
        };
      },
    }),
  }),
}));
jest.mock("./capture-visit-pill", () => ({
  CaptureVisitPill: ({ visitId }: { visitId: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>Adding to {visitId}</Text>;
  },
}));
jest.mock("expo-router/react-navigation", () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("expo-haptics", () => ({
  selectionAsync: () => mockSelectionHaptic(),
  impactAsync: (style: string) => mockImpactHaptic(style),
  ImpactFeedbackStyle: { Light: "light" },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 60, bottom: 34 }),
}));
jest.mock("react-native-vision-camera", () => ({
  useCameraPermission: () => ({
    hasPermission: mockGranted,
    canRequestPermission: mockCanRequest,
    requestPermission: mockRequest,
  }),
  usePhotoOutput: () => ({ capturePhotoToFile: mockPhoto }),
  Camera: (props: typeof mockCameraProps): ReactNode => {
    mockCameraProps = props;
    return null;
  },
}));
jest.mock("@/lib/capture/use-capture", () => ({
  useCapture: (options: { onVisitUnavailable?: () => void }) => {
    mockVisitUnavailable = options.onVisitUnavailable;
    return {
      state: { ...mockState, message: mockMessage },
      controller: {
        observe: mockObserve,
        getFeedback: () => mockFeedback,
        subscribeFeedback: () => () => {},
        resetDetection: mockResetDetection,
      },
      presentation: mockPresentation,
      completeReveal: jest.fn(),
      captureManually: mockCapture,
      captureAutomatically: mockCaptureAutomatically,
      importPhoto: mockImport,
      timings: mockTimings,
      useCamera: mockClearMessage,
    };
  },
}));
jest.mock("@/lib/venue/use-venue", () => ({
  resolveVenueForScan: () => mockResolveVenue(),
  useVenue: () => mockVenueView,
}));
jest.mock("@/lib/queue/use-queue", () => ({
  useQueue: () => ({
    pending: mockPending,
    items: Array.from({ length: mockPending }, () => ({ status: "queued" })),
  }),
}));
jest.mock("@/lib/capture/use-rect-detector", () => ({
  useRectDetector: (active: boolean, callback: (detection: unknown) => void) => {
    mockOnDetection = callback;
    mockDetectorActive.push(active);
    return mockFrameOutput;
  },
}));
jest.mock("./capture-reveal", () => ({
  CaptureReveal: () => {
    const { View } = jest.requireActual("react-native");
    return <View accessibilityLabel="Capture reveal" />;
  },
}));

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event, listener) => DeviceEventEmitter.addListener(event, listener));
  mockFocused = true;
  mockParams = {};
  mockTabsListener = undefined;
  mockGranted = true;
  mockCanRequest = false;
  mockState = { phase: "searching", occupied: false };
  mockFeedback = null;
  mockTimings = undefined;
  mockMessage = undefined;
  mockPresentation = undefined;
  mockPending = 0;
  mockVenueView = {
    status: "resolved",
    venue: {
      kind: "seeded",
      venueId: "museum-1" as never,
      name: "Legion of Honor",
    },
    options: [],
    resolve: jest.fn(),
    confirm: jest.fn(),
    dismiss: jest.fn(),
    declinePrompt: jest.fn(),
    end: jest.fn(),
    move: jest.fn(),
  };
  mockDetectorActive.length = 0;
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  mockPhoto.mockResolvedValue({ filePath: "/photo.jpg" });
  mockSelectionHaptic.mockResolvedValue(undefined);
  mockImpactHaptic.mockResolvedValue(undefined);
  mockRequest.mockResolvedValue(true);
  mockImport.mockResolvedValue(undefined);
  mockObserve.mockReturnValue(undefined);
  mockResolveVenue.mockResolvedValue({
    venueId: "museum-1",
    visitId: "visit-1",
    visitLocalId: "local-visit",
  });
  mockCapture.mockImplementation(async (takePhoto: () => Promise<unknown>) => takePhoto());
  mockCaptureAutomatically.mockImplementation(async (_attempt: unknown, takePhoto: () => Promise<unknown>) =>
    takePhoto(),
  );
});
afterEach(() => jest.restoreAllMocks());

it("asks for camera access only after tapping Allow camera on the active screen", async () => {
  mockFocused = false;
  mockGranted = false;
  mockCanRequest = true;
  const view = await render(<ScanScreen />);
  expect(mockRequest).not.toHaveBeenCalled();
  mockFocused = true;
  await view.rerender(<ScanScreen />);
  expect(mockRequest).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Allow camera" }));
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

it("streams frames to the detector without idle captions or an autoscan chip", async () => {
  await render(<ScanScreen />);
  expect(mockCameraProps.outputs).toContain(mockFrameOutput);
  await act(() => mockCameraProps.onStarted());
  expect(screen.queryByText("Point at an artwork. Hold steady to scan.")).toBeNull();
  expect(screen.queryByText("Hold steady")).toBeNull();
  expect(screen.queryByText(/auto scan/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Scan label" })).toBeNull();
  expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  expect(mockCameraProps.orientationSource).toBe("interface");
  expect(mockCameraProps.allowHapticsAndSystemSoundsPlayback).toBe(true);
});

it("shows Hold steady only while the detected painting is accumulating hold time", async () => {
  const view = await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  mockFeedback = {
    quad: [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ],
    progress: 0.5,
    guidance: "hold-still",
  };
  await view.rerender(<ScanScreen />);
  expect(screen.getByText("Hold steady")).toBeOnTheScreen();
  mockFeedback = null;
  await view.rerender(<ScanScreen />);
  expect(screen.queryByText("Hold steady")).toBeNull();
});

it("takes a still only when the controller accepts a detection", async () => {
  const attempt = {
    source: "camera",
    quad: [
      [0.1, 0.2],
      [0.9, 0.2],
      [0.9, 0.8],
      [0.1, 0.8],
    ],
    valid: true,
  };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  const detection = { width: 1080, height: 1440, observations: [] };
  await act(() => mockOnDetection(detection));
  expect(mockPhoto).not.toHaveBeenCalled();
  mockObserve.mockReturnValue(attempt);
  await act(() => mockOnDetection(detection));
  expect(mockCaptureAutomatically).toHaveBeenCalledWith(attempt, expect.any(Function));
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
  expect(mockCapture).not.toHaveBeenCalled();
});

it("announces camera startup errors, keeps import available, and clears the error on recovery", async () => {
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onError(new Error("Camera session failed")));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not start the camera. You can import a photo.");
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "camera.start", {
    data: { screen: "scan" },
  });
  expect(screen.getByRole("button", { name: "Scan artwork" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Import" }));
  expect(mockImport).toHaveBeenCalledTimes(1);

  await act(() => mockCameraProps.onStarted());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Point at an artwork. Hold steady to scan.")).toBeNull();
  expect(screen.getByRole("button", { name: "Scan artwork" })).toBeEnabled();
});

it("hides camera startup errors while an imported photo is processing or needs a retry", async () => {
  const view = await render(<ScanScreen />);
  await act(() => mockCameraProps.onError(new Error("Camera session failed")));

  mockState = { phase: "processing", occupied: true, source: "library" };
  await view.rerender(<ScanScreen />);
  expect(screen.queryByText("Could not start the camera. You can import a photo.")).toBeNull();
  expect(screen.getByText("Identifying artwork")).toBeOnTheScreen();

  mockState = { phase: "retry", occupied: false, source: "library" };
  mockMessage = "Fit all corners";
  await view.rerender(<ScanScreen />);
  expect(screen.queryByText("Could not start the camera. You can import a photo.")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("Fit all corners");
  expect(screen.getByRole("button", { name: "Choose another photo" })).toBeEnabled();
});

it("shows camera startup progress only while the camera is meant to run", async () => {
  const view = await render(<ScanScreen />);
  expect(mockCameraProps.isActive).toBe(true);
  expect(screen.getByLabelText("Starting camera…")).toBeOnTheScreen();
  await act(() => mockCameraProps.onStarted());
  expect(screen.queryByLabelText("Starting camera…")).toBeNull();

  mockState = { phase: "processing", occupied: true, source: "library" };
  await view.rerender(<ScanScreen />);
  await act(() => mockCameraProps.onStopped());
  mockState = { phase: "retry", occupied: false, source: "library" };
  await view.rerender(<ScanScreen />);
  expect(mockCameraProps.isActive).toBe(false);
  expect(screen.queryByLabelText("Starting camera…")).toBeNull();
  expect(screen.getByRole("button", { name: "Choose another photo" })).toBeEnabled();
});

it("keeps the shutter as a manual fallback once the camera is ready", async () => {
  await render(<ScanScreen />);
  expect(screen.getByRole("button", { name: "Scan artwork" })).toBeDisabled();
  await act(() => mockCameraProps.onStarted());
  await fireEvent.press(screen.getByRole("button", { name: "Scan artwork" }));
  expect(mockCapture).toHaveBeenCalledWith(expect.any(Function));
  expect(mockPhoto).toHaveBeenCalledTimes(1);
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
});

it("pauses the camera and detector when another screen is focused or the app backgrounds", async () => {
  const view = await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(mockCameraProps.isActive).toBe(true);
  expect(mockDetectorActive.at(-1)).toBe(true);
  mockFocused = false;
  await view.rerender(<ScanScreen />);
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
  mockFocused = true;
  await view.rerender(<ScanScreen />);
  await act(() => appStateListener("background"));
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
});

it.each(["processing", "revealing", "result"] as const)("pauses scanning and imports during %s", async (phase) => {
  mockState = { phase, occupied: phase !== "result", source: "camera" };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Scan artwork" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Camera tips" })).toBeDisabled();
  expect(screen.getByText("Identifying artwork")).toBeOnTheScreen();
});

it("keeps import available after camera permission denial", async () => {
  mockGranted = false;
  mockCanRequest = true;
  const view = await render(<ScanScreen />);
  expect(mockRequest).not.toHaveBeenCalled();
  mockCanRequest = false;
  await view.rerender(<ScanScreen />);
  const open = jest.spyOn(Linking, "openSettings").mockResolvedValue();
  await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
  expect(open).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Import a photo" }));
  expect(mockImport).toHaveBeenCalledTimes(1);
});

it("reveals an imported photo and reports its failure while camera access is denied", async () => {
  mockGranted = false;
  mockCanRequest = false;
  mockPresentation = { attempt: { id: "import-1" } };
  mockState = {
    phase: "retry",
    occupied: false,
    source: "library",
  } as CaptureState;
  mockMessage = "Picker unavailable";
  await render(<ScanScreen />);
  expect(screen.getByLabelText("Capture reveal")).toBeOnTheScreen();
  expect(screen.getByRole("alert")).toHaveTextContent(mockMessage);
  expect(screen.getByRole("button", { name: "Import a photo" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Scan artwork" })).toBeNull();
});

it("keeps the venue and queue controls", async () => {
  mockPending = 2;
  await render(<ScanScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith("/venue-picker");
  expect(screen.getByLabelText("Recent scans, 2 scans")).toBeOnTheScreen();
});

it("keeps the venue and queue entry points reachable without camera access", async () => {
  mockGranted = false;
  mockCanRequest = false;
  mockPending = 1;
  await render(<ScanScreen />);
  expect(screen.getByRole("button", { name: "Open Settings" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith("/venue-picker");
  expect(screen.getByLabelText("Recent scans, 1 scan")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Scan artwork" })).toBeNull();
});

it("shows corrective guidance and keeps detecting after a camera failure", async () => {
  mockMessage = "Adjust the angle to reduce glare";
  mockState = {
    phase: "retry",
    source: "camera",
    occupied: false,
    rearm: "reframe",
  };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(screen.getByRole("alert")).toHaveTextContent(/Adjust the angle to reduce glare/);
  expect(screen.getByText("Move the camera to reframe, then hold steady.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Retake" })).toBeNull();
  expect(screen.getByRole("button", { name: "Scan artwork" })).toBeEnabled();
  expect(mockDetectorActive.at(-1)).toBe(true);
});

it("asks for another shutter press after a shutter failure, which holding steady cannot rescan", async () => {
  mockMessage = "Adjust the angle to reduce glare";
  mockState = {
    phase: "retry",
    source: "camera",
    occupied: false,
    rearm: "shutter",
  };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(screen.getByRole("alert")).toHaveTextContent(/Adjust the angle to reduce glare/);
  expect(screen.getByText("Reframe the artwork and tap the shutter.")).toBeOnTheScreen();
  expect(screen.queryByText("Move the camera to reframe, then hold steady.")).toBeNull();
});

it("offers both explicit actions after a failed import and keeps scanning paused", async () => {
  mockMessage = "Fit all corners";
  mockState = { phase: "retry", source: "library", occupied: false };
  await render(<ScanScreen />);
  expect(mockDetectorActive.at(-1)).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "Choose another photo" }));
  expect(mockImport).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Use camera" }));
  expect(mockClearMessage).toHaveBeenCalledTimes(1);
});

it("shows the stage breakdown of the last capture in development", async () => {
  mockTimings = {
    warp: 273.4,
    triage: 8.6,
    embed: 480.2,
    orb: 11.7,
    identify: 38.1,
    total: 812.0,
  };
  await render(<ScanScreen />);
  expect(screen.getByText("Capture 812 ms · warp 273 · triage 9 · embed 480 · orb 12 · identify 38")).toBeOnTheScreen();
});

it("keeps a chosen visit through sheets above the tab and drops it at the result or on a tab change", async () => {
  mockParams = { visitId: "paris" };
  const view = await render(<ScanScreen />);
  expect(screen.getByText("Adding to paris")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Legion of Honor" })).toBeNull();
  mockFocused = false;
  await view.rerender(<ScanScreen />);
  expect(mockSetParams).not.toHaveBeenCalled();
  await act(async () =>
    mockTabsListener?.({
      data: {
        state: {
          index: 1,
          routes: [{ name: "(home)" }, { name: "(scan)" }, { name: "(collection)" }],
        },
      },
    }),
  );
  expect(mockSetParams).not.toHaveBeenCalled();
  await act(async () =>
    mockTabsListener?.({
      data: {
        state: {
          index: 2,
          routes: [{ name: "(home)" }, { name: "(scan)" }, { name: "(collection)" }],
        },
      },
    }),
  );
  expect(mockSetParams).toHaveBeenCalledWith({ visitId: undefined });
  mockSetParams.mockClear();
  mockFocused = true;
  mockState = { phase: "result", occupied: true };
  await view.rerender(<ScanScreen />);
  expect(mockSetParams).toHaveBeenCalledWith({ visitId: undefined });
  mockSetParams.mockClear();
  mockVisitUnavailable?.();
  expect(mockSetParams).toHaveBeenCalledWith({ visitId: undefined });
});

it("pauses the camera and detection while reading tips and resumes on Ready to scan", async () => {
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  await fireEvent.press(screen.getByRole("button", { name: "Camera tips" }));
  expect(screen.getByLabelText("Example of an artwork framed straight on")).toBeOnTheScreen();
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "Ready to scan" }));
  expect(screen.queryByRole("button", { name: "Ready to scan" })).toBeNull();
  expect(mockCameraProps.isActive).toBe(true);
  expect(mockDetectorActive.at(-1)).toBe(true);
});

it("closes camera tips before opening the photo library", async () => {
  await render(<ScanScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Camera tips" }));
  mockImport.mockImplementationOnce(async () => {
    expect(screen.queryByRole("button", { name: "Ready to scan" })).toBeNull();
  });
  await fireEvent.press(screen.getByRole("button", { name: "Import a photo instead" }));
  expect(mockImport).toHaveBeenCalledTimes(1);
});
