import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo, AppState, DeviceEventEmitter, Linking, type AppStateStatus } from "react-native";

import { Spacing } from "@/constants/theme";
import type { CaptureFeedback, CaptureState } from "@/lib/capture/capture-controller";
import { WALK_REQUEST_POLL_MS, type DemoVideo } from "@/lib/capture/demo-viewfinder";
import type { CaptureTimings, Quad } from "@/lib/capture/stages";
import { reportError } from "@/lib/observability";
import { useToastLift } from "@/lib/ui/toast";
import type { VenueView } from "@/lib/venue/use-venue";

import { ScanScreen } from "./scan-screen";

// The camera start watchdog also listens to AppState; this suite drives only the screen's own listener.
jest.mock("@/lib/stall-report", () => ({ reportIfStalled: (task: Promise<unknown>) => task }));
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
let mockOnDetection: (detection: unknown, at?: number) => void;
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
const mockPhotoOutput: { capturePhotoToFile: typeof mockPhoto; outputOrientation?: string } = {
  capturePhotoToFile: mockPhoto,
};
let mockDeviceOrientation: string | undefined;
let mockInterfaceOrientation = "up";
let mockAccelerometer = true;
const mockStartOrientationUpdates = jest.fn();
const mockStopOrientationUpdates = jest.fn();
const mockCapture = jest.fn();
const mockCaptureAutomatically = jest.fn();
const mockImport = jest.fn();
const mockClearMessage = jest.fn();
const mockPush = jest.fn();
const mockObserve = jest.fn();
const mockResolveVenue = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { visitId?: string } = {};
let mockTabsListener: ((event: { data: { state: { index: number; routes: { name: string }[] } } }) => void) | undefined;
let mockVisitUnavailable: (() => void) | undefined;
const mockFrameOutput = { kind: "frame-output" };
const mockDetectorActive: boolean[] = [];
let mockDetectorOrientation: string | undefined;
const mockResetDetection = jest.fn();
let mockDemoVideo: DemoVideo | null | undefined;
const mockTakeWalkRequest = jest.fn<number | undefined, [number]>();
type DemoCameraProps = {
  source: string;
  active: boolean;
  onReady: () => void;
  onDetection: (event: { nativeEvent: unknown }) => void;
  onError: (event: { nativeEvent: { message: string } }) => void;
};
const mockDemoCameraRender = jest.fn<void, [DemoCameraProps]>();
const demoCameraProps = () => mockDemoCameraRender.mock.lastCall![0];
const mockDemoTakePhoto = jest.fn();
const mockDemoPlay = jest.fn();
const mockCopyForImport = jest.fn();
const mockCameraRender = jest.fn();

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
    createAnimatedComponent: (component: unknown) => component,
    cubicBezier: () => "ease-out",
    useSharedValue: (value: number) => useRef({ get: () => value, set: jest.fn() }).current,
    withTiming: (value: number) => value,
    withSequence: (...values: number[]) => values.at(-1),
    useAnimatedStyle: (style: () => object) => style(),
    cancelAnimation: jest.fn(),
    Easing: { linear: jest.fn(), bezier: () => jest.fn() },
    Keyframe: class {
      duration() {
        return this;
      }
      reduceMotion() {
        return this;
      }
    },
    ReduceMotion: { System: "system" },
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
jest.mock("@/lib/ui/haptics");
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 60, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("react-native-vision-camera", () => ({
  useCameraPermission: () => ({
    hasPermission: mockGranted,
    canRequestPermission: mockCanRequest,
    requestPermission: mockRequest,
  }),
  usePhotoOutput: () => mockPhotoOutput,
  useOrientation: (source: string) => (source === "interface" ? mockInterfaceOrientation : undefined),
  VisionCamera: {
    createOrientationManager: () => ({
      get currentOrientation() {
        return mockAccelerometer ? mockDeviceOrientation : undefined;
      },
      startOrientationUpdates: () => {
        if (!mockAccelerometer) throw new Error("Accelerometer is not available");
        mockStartOrientationUpdates();
      },
      stopOrientationUpdates: () => mockStopOrientationUpdates(),
    }),
  },
  Camera: (props: typeof mockCameraProps): ReactNode => {
    mockCameraRender();
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
  useRectDetector: (active: boolean, orientation: string, callback: (detection: unknown, at?: number) => void) => {
    mockOnDetection = callback;
    mockDetectorActive.push(active);
    mockDetectorOrientation = orientation;
    return mockFrameOutput;
  },
}));
let mockSetMotionReader: ((read: (() => unknown) | undefined) => void) | undefined;
jest.mock("@/lib/capture/device-motion", () => ({
  MotionSampler: ({ onReader }: { onReader: (read: (() => unknown) | undefined) => void }) => {
    mockSetMotionReader = onReader;
    return null;
  },
}));
jest.mock("@/lib/judges-demo", () => ({ isJudgesDemo: () => mockDemoVideo !== undefined }));
jest.mock("@/lib/capture/demo-viewfinder", () => ({
  WALK_REQUEST_POLL_MS: jest.requireActual("@/lib/capture/demo-viewfinder").WALK_REQUEST_POLL_MS,
  findDemoVideo: () => mockDemoVideo ?? undefined,
  takeWalkRequest: (walks: number) => mockTakeWalkRequest(walks),
}));
jest.mock("@/lib/capture/demo-photos", () => ({
  listDemoPhotos: () => ({ gallery: ["file:///documents/judges-demo/photos/roses.jpg"], uploads: [] }),
  copyForImport: (uri: string) => mockCopyForImport(uri),
}));
jest.mock("../../../modules/demo-camera/src", () => {
  const { useImperativeHandle } = jest.requireActual("react");
  return {
    DemoCamera: ({ ref, ...props }: DemoCameraProps & { ref: unknown }) => {
      mockDemoCameraRender(props);
      useImperativeHandle(ref, () => ({ takePhoto: mockDemoTakePhoto, play: mockDemoPlay }));
      return null;
    },
  };
});
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
    hydrated: true,
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
    promptChooser: jest.fn(),
    end: jest.fn(),
    discard: jest.fn(),
    startVisit: jest.fn(),
    move: jest.fn(),
  };
  mockDetectorActive.length = 0;
  mockDemoVideo = undefined;
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  mockPhoto.mockResolvedValue({ filePath: "/photo.jpg" });
  mockPhotoOutput.outputOrientation = undefined;
  mockDeviceOrientation = undefined;
  mockInterfaceOrientation = "up";
  mockAccelerometer = true;
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

it.each(["capturing", "processing", "revealing", "result"] as const)(
  "defers museum choices during %s until the camera is idle again",
  async (phase) => {
    mockState = { phase, occupied: true, source: "camera" };
    mockVenueView.status = "locating";
    const view = await render(<ScanScreen />);
    mockVenueView = { ...mockVenueView, status: "choose" };
    await view.rerender(<ScanScreen />);
    expect(mockVenueView.promptChooser).not.toHaveBeenCalled();
    mockState = { phase: "searching", occupied: false };
    await view.rerender(<ScanScreen />);
    expect(mockVenueView.promptChooser).toHaveBeenCalledTimes(1);
  },
);

it("prompts for late nearby options only while the camera is active and has no chosen visit", async () => {
  mockVenueView.status = "none";
  mockParams = { visitId: "chosen-visit" };
  const view = await render(<ScanScreen />);
  expect(mockVenueView.promptChooser).not.toHaveBeenCalled();
  mockParams = {};
  await act(() => appStateListener("background"));
  await view.rerender(<ScanScreen />);
  expect(mockVenueView.promptChooser).not.toHaveBeenCalled();
  await act(() => appStateListener("active"));
  (mockVenueView.promptChooser as jest.Mock).mockClear();
  mockVenueView = { ...mockVenueView, options: [mockVenueView.venue!] };
  await view.rerender(<ScanScreen />);
  expect(mockVenueView.promptChooser).toHaveBeenCalledTimes(1);
});

it("asks for camera access only after tapping Continue on the active screen", async () => {
  mockFocused = false;
  mockGranted = false;
  mockCanRequest = true;
  const view = await render(<ScanScreen />);
  expect(mockRequest).not.toHaveBeenCalled();
  mockFocused = true;
  await view.rerender(<ScanScreen />);
  expect(mockRequest).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

it("streams frames to the detector without idle captions or an autoscan chip", async () => {
  await render(<ScanScreen />);
  expect(mockCameraProps.outputs).toContain(mockFrameOutput);
  await act(() => mockCameraProps.onStarted());
  expect(screen.queryByText("Point at an artwork")).toBeNull();
  expect(screen.queryByText("Hold steady to scan automatically")).toBeNull();
  expect(screen.queryByText(/auto scan/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Scan label" })).toBeNull();
  expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  expect(mockCameraProps.allowHapticsAndSystemSoundsPlayback).toBe(true);
});

it.each([
  ["up", undefined, true, "up", 0],
  ["up", "left", true, "left", 3],
  ["up", "right", true, "right", 1],
  ["up", "left", false, "up", 0],
  ["right", "right", true, "right", 0],
  ["right", "up", true, "up", 3],
  ["left", "left", true, "left", 0],
  ["left", undefined, false, "left", 0],
])(
  "takes the photo upright to how the phone is held, turned from a %s preview: %s, accelerometer %s",
  async (preview, device, accelerometer, orientation, turns) => {
    mockInterfaceOrientation = preview;
    mockDeviceOrientation = device;
    mockAccelerometer = accelerometer;
    await render(<ScanScreen />);
    // Any Camera-managed source would re-apply one orientation to the photo output whenever the outputs change.
    expect(mockCameraProps.orientationSource).toBe("custom");
    // Frames are analyzed the way the preview shows them, so the outline lands on the painting.
    expect(mockDetectorOrientation).toBe(preview);
    await act(() => mockCameraProps.onStarted());
    await fireEvent.press(screen.getByRole("button", { name: "Scan artwork" }));
    expect(mockPhotoOutput.outputOrientation).toBe(orientation);
    await expect(mockCapture.mock.results[0].value).resolves.toEqual({ filePath: "/photo.jpg", turns });
  },
);

it("captions a framing problem but not a painting that is holding steady", async () => {
  jest.useFakeTimers();
  const view = await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  const quad: Quad = [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ];
  mockFeedback = { quad, progress: 0, guidance: "move-closer" };
  await view.rerender(<ScanScreen />);
  await act(() => jest.advanceTimersByTime(600));
  expect(screen.getByText("Move closer")).toBeOnTheScreen();
  mockFeedback = { quad, progress: 0.5, guidance: "hold-still" };
  await view.rerender(<ScanScreen />);
  await act(() => jest.advanceTimersByTime(600));
  expect(screen.queryByText("Move closer")).toBeNull();
  expect(screen.queryByText("Hold steady")).toBeNull();
  jest.useRealTimers();
});

it("waits for a framing problem to settle after a retry message clears", async () => {
  jest.useFakeTimers();
  try {
    mockState = { phase: "retry", occupied: false, source: "camera", rearm: "reframe" };
    mockMessage = "Reframe and try again";
    const view = await render(<ScanScreen />);
    await act(() => mockCameraProps.onStarted());
    expect(screen.getByText("Reframe and try again")).toBeOnTheScreen();
    mockState = { phase: "searching", occupied: false };
    mockMessage = undefined;
    mockFeedback = {
      quad: [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.6, 0.6],
        [0.4, 0.6],
      ],
      progress: 0,
      guidance: "move-closer",
    };
    await view.rerender(<ScanScreen />);
    expect(screen.queryByText("Move closer")).toBeNull();
    await act(() => jest.advanceTimersByTime(599));
    expect(screen.queryByText("Move closer")).toBeNull();
    await act(() => jest.advanceTimersByTime(1));
    expect(screen.getByText("Move closer")).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
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

it("times live detections by their camera frame and passes the phone's motion once the camera runs", async () => {
  mockSetMotionReader = undefined;
  await render(<ScanScreen />);
  expect(mockSetMotionReader).toBeUndefined();
  await act(() => mockCameraProps.onStarted());
  const motion = { rotationRate: 0.05, upright: true };
  await act(() => mockSetMotionReader!(() => motion));
  const detection = { width: 1080, height: 1440, observations: [] };
  await act(() => mockOnDetection(detection, 1234.5));
  expect(mockObserve).toHaveBeenLastCalledWith(detection, expect.any(Object), 1234.5, motion);
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

it("floats toasts above the camera controls and hints only while the scan tab is focused", async () => {
  const lift = await renderHook(useToastLift);
  const view = await render(<ScanScreen />);
  await fireEvent(screen.getByRole("button", { name: "Import" }), "layout", {
    nativeEvent: { layout: { height: 140 } },
  });
  expect(lift.result.current).toEqual(expect.objectContaining({ height: 34 + Spacing.three + 140 }));
  mockFocused = false;
  await view.rerender(<ScanScreen />);
  expect(lift.result.current).toBeUndefined();
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

describe("demo build", () => {
  const video: DemoVideo = {
    uri: "file:///documents/judges-demo/viewfinder.mp4",
    idle: { start: 0, end: 8 },
    walks: [
      { start: 8, end: 15 },
      { start: 15, end: 22 },
    ],
  };
  const detection = { width: 1080, height: 1440, observations: [] };
  const attempt = { source: "camera", quad: null, valid: true };
  // A painting picked on the demo page reaches the phone as a request the viewfinder checks for.
  const pickOnPage = async (painting: number) => {
    mockTakeWalkRequest.mockReturnValueOnce(painting);
    await act(() => jest.advanceTimersByTime(WALK_REQUEST_POLL_MS));
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockTakeWalkRequest.mockReset();
    mockDemoVideo = video;
    mockDemoTakePhoto.mockResolvedValue("/tmp/frame.jpg");
    mockDemoPlay.mockResolvedValue(undefined);
    mockCopyForImport.mockResolvedValue({ uri: "file:///cache/copy.jpg" });
  });
  afterEach(() => jest.useRealTimers());

  it("stands back from the wall until the demo page picks a painting, then walks up and scans it automatically", async () => {
    await render(<ScanScreen />);
    expect(mockCameraRender).not.toHaveBeenCalled();
    expect(demoCameraProps()).toMatchObject({ source: video.uri, active: true });
    await act(() => demoCameraProps().onReady());
    expect(mockDemoPlay).toHaveBeenLastCalledWith(0, 8, true);

    // Standing back, the wall's paintings are too far away to scan.
    await act(() => demoCameraProps().onDetection({ nativeEvent: detection }));
    expect(mockObserve).not.toHaveBeenCalled();

    await pickOnPage(1);
    expect(mockTakeWalkRequest).toHaveBeenLastCalledWith(2);
    expect(mockDemoPlay).toHaveBeenLastCalledWith(15, 22, false);

    mockObserve.mockReturnValue(attempt);
    await act(() => demoCameraProps().onDetection({ nativeEvent: detection }));
    expect(mockObserve.mock.calls[0][0]).toEqual(detection);
    expect(mockCaptureAutomatically).toHaveBeenCalledWith(attempt, expect.any(Function));
    await expect(mockCaptureAutomatically.mock.results[0].value).resolves.toEqual({
      filePath: "/tmp/frame.jpg",
      turns: 0,
    });
    expect(mockPhoto).not.toHaveBeenCalled();
  });

  it("keeps the shutter off until the demo page picks a painting, then takes the frame on screen", async () => {
    await render(<ScanScreen />);
    await act(() => demoCameraProps().onReady());
    expect(screen.getByRole("button", { name: "Scan artwork" })).toBeDisabled();
    await pickOnPage(0);
    await fireEvent.press(screen.getByRole("button", { name: "Scan artwork" }));
    expect(mockDemoTakePhoto).toHaveBeenCalledTimes(1);
    expect(mockPhoto).not.toHaveBeenCalled();
  });

  it("steps back once its scan finishes, then walks up to a painting picked during the scan", async () => {
    const view = await render(<ScanScreen />);
    await act(() => demoCameraProps().onReady());
    await pickOnPage(0);
    expect(mockDemoPlay).toHaveBeenLastCalledWith(8, 15, false);
    await fireEvent.press(screen.getByRole("button", { name: "Scan artwork" }));

    mockState = { phase: "processing", occupied: true, source: "camera" };
    await view.rerender(<ScanScreen />);
    expect(demoCameraProps().active).toBe(false);
    await pickOnPage(1);
    expect(mockDemoPlay).toHaveBeenLastCalledWith(8, 15, false);

    mockState = { phase: "searching", occupied: false };
    await view.rerender(<ScanScreen />);
    expect(demoCameraProps().active).toBe(true);
    expect(mockDemoPlay).toHaveBeenLastCalledWith(0, 8, true);
    expect(screen.getByRole("button", { name: "Scan artwork" })).toBeDisabled();
    await act(() => jest.advanceTimersByTime(WALK_REQUEST_POLL_MS));
    expect(mockDemoPlay).toHaveBeenLastCalledWith(15, 22, false);
    expect(screen.getByRole("button", { name: "Scan artwork" })).toBeEnabled();
  });

  it("imports from the demo's own photos instead of the phone's library", async () => {
    await render(<ScanScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Import" }));
    const [pick] = mockImport.mock.lastCall as [() => Promise<unknown>];
    let picked: Promise<unknown> | undefined;
    await act(async () => {
      picked = pick();
    });
    await fireEvent.press(screen.getByRole("button", { name: "Gallery photo 1" }));
    await expect(picked).resolves.toEqual({ uri: "file:///cache/copy.jpg" });
    expect(mockCopyForImport).toHaveBeenCalledWith("file:///documents/judges-demo/photos/roses.jpg");
  });

  it("leaves the museum to the venue pill instead of opening the chooser", async () => {
    mockVenueView = { ...mockVenueView, status: "choose", options: [mockVenueView.venue!] };
    await render(<ScanScreen />);
    expect(mockVenueView.promptChooser).not.toHaveBeenCalled();
  });

  it("points to import when the sample video is missing or cannot play", async () => {
    mockDemoVideo = null;
    const view = await render(<ScanScreen />);
    expect(screen.getByText("No sample video is loaded. You can import a photo.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Scan artwork" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();

    mockDemoVideo = video;
    await view.unmount();
    await render(<ScanScreen />);
    await act(() => demoCameraProps().onError({ nativeEvent: { message: "Cannot decode" } }));
    expect(screen.getByText("Could not play the sample video. You can import a photo.")).toBeOnTheScreen();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), "camera.start", expect.anything());
  });
});

it("imports from the phone's photo library outside the demo build", async () => {
  await render(<ScanScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Import" }));
  expect(mockImport).toHaveBeenLastCalledWith(undefined);
});

it("pauses and resumes the camera, detector, and orientation updates with screen and app activity", async () => {
  const view = await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(mockCameraProps.isActive).toBe(true);
  expect(mockDetectorActive.at(-1)).toBe(true);
  expect(mockStartOrientationUpdates).toHaveBeenCalledTimes(1);
  expect(mockStopOrientationUpdates).not.toHaveBeenCalled();
  mockFocused = false;
  await view.rerender(<ScanScreen />);
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
  expect(mockStopOrientationUpdates).toHaveBeenCalledTimes(1);
  mockFocused = true;
  await view.rerender(<ScanScreen />);
  expect(mockStartOrientationUpdates).toHaveBeenCalledTimes(2);
  await act(() => appStateListener("background"));
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
  expect(mockStopOrientationUpdates).toHaveBeenCalledTimes(2);
  await act(() => appStateListener("active"));
  expect(mockCameraProps.isActive).toBe(true);
  expect(mockDetectorActive.at(-1)).toBe(true);
  expect(mockStartOrientationUpdates).toHaveBeenCalledTimes(3);
  await view.unmount();
  expect(mockStopOrientationUpdates).toHaveBeenCalledTimes(3);
});

it("does not start orientation updates until an initially unfocused Scan becomes active", async () => {
  mockFocused = false;
  const view = await render(<ScanScreen />);
  expect(mockStartOrientationUpdates).not.toHaveBeenCalled();
  mockFocused = true;
  await view.rerender(<ScanScreen />);
  expect(mockStartOrientationUpdates).toHaveBeenCalledTimes(1);
});

it.each(["processing", "revealing", "result"] as const)("pauses scanning and imports during %s", async (phase) => {
  mockState = { phase, occupied: phase !== "result", source: "camera" };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Scan artwork" })).toBeDisabled();
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
  await fireEvent.press(screen.getByRole("button", { name: "Choose another photo" }));
  expect(mockImport).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Use camera" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Scan artwork" })).toBeNull();
});

it("keeps denied-camera imports visibly busy until identification finishes", async () => {
  mockGranted = false;
  mockCanRequest = false;
  mockState = { phase: "processing", occupied: true, source: "library" };
  await render(<ScanScreen />);
  expect(screen.getByText("Identifying artwork")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Import a photo" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Scan artwork" })).toBeNull();
});

it("keeps the venue and queue controls", async () => {
  mockPending = 2;
  await render(<ScanScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith("/venue-picker");
  expect(screen.getByLabelText("Recent Scans, 2 scans")).toBeOnTheScreen();
});

it("keeps the venue and queue entry points reachable without camera access", async () => {
  mockGranted = false;
  mockCanRequest = false;
  mockPending = 1;
  await render(<ScanScreen />);
  expect(screen.getByRole("button", { name: "Open Settings" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith("/venue-picker");
  expect(screen.getByLabelText("Recent Scans, 1 scan")).toBeOnTheScreen();
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
