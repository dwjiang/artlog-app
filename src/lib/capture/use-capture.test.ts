import { act, renderHook } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { anonymousOwner, switchOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { useCapture } from "./use-capture";
import type {
  CaptureDependencies,
  CaptureInput,
  CapturePayload,
  CaptureResult,
  PreparedPainting,
  Quad,
} from "./stages";

const mockVisit = jest.fn();
jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock("@/db/repos/visits", () => ({
  getVisit: (...args: unknown[]) => mockVisit(...args),
}));
const mockIdentify = jest.fn();
const mockPush = jest.fn();
const mockPipeline = jest.fn();
const mockPermission = jest.fn();
const mockPicker = jest.fn();
const mockWarning = jest.fn();
const mockVenueIdAt = jest.fn();
const mockResolveVenue = jest.fn();
const mockImageLoad = jest.fn();
const mockShrinkLibraryPhoto = jest.fn();
const mockRelease = jest.fn();
const mockRemoveCameraTempFile = jest.fn();
let mockReachable: boolean | undefined = true;

jest.mock("@/lib/venue/visit-sync", () => ({ resolveScanVisit: jest.fn() }));
jest.mock("convex/react", () => ({ useAction: () => mockIdentify }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/files/local-image", () => ({
  loadLocalImage: (...args: unknown[]) => mockImageLoad(...args),
}));
jest.mock("@/lib/venue/use-venue", () => ({
  resolveVenueForScan: (...args: unknown[]) => mockResolveVenue(...args),
}));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: mockReachable }),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: (...args: unknown[]) => mockWarning(...args),
  ImpactFeedbackStyle: { Light: "light" },
}));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: () => mockPermission(),
  launchImageLibraryAsync: (...args: unknown[]) => mockPicker(...args),
}));
jest.mock("@/lib/files/kept-photos", () => ({
  shrinkLibraryPhoto: (...args: unknown[]) => mockShrinkLibraryPhoto(...args),
}));
jest.mock("@/lib/files/camera-temp", () => ({
  removeCameraTempFile: (...args: unknown[]) => mockRemoveCameraTempFile(...args),
}));
jest.mock("./pipeline", () => ({
  runCapture: (...args: unknown[]) => mockPipeline(...args),
}));
jest.mock("@/lib/venue/venue-db", () => ({
  venueIdAt: (...args: unknown[]) => mockVenueIdAt(...args),
}));
jest.mock("./default-stages", () => ({
  captureOptions: { inputSize: 512, modelVersion: "test" },
  defaultStages: {},
}));

const painting: PreparedPainting = {
  cropUri: "file:///crop.jpg",
  corners: [
    [0.1, 0.2],
    [0.9, 0.2],
    [0.9, 0.8],
    [0.1, 0.8],
  ],
  photoSize: { width: 1200, height: 1600 },
  contentBounds: { x: 0, y: 64, width: 512, height: 384 },
  cropSize: 512,
};
const input: CaptureInput = {
  photoUri: "file:///photo.jpg",
  quad: null,
  source: "camera",
  capturedAt: 123,
};

beforeEach(() => {
  jest.resetAllMocks();
  mockReachable = true;
  mockShrinkLibraryPhoto.mockImplementation(async (uri: string) => uri);
  mockWarning.mockResolvedValue(undefined);
  mockPermission.mockResolvedValue({
    granted: false,
    status: "denied",
    canAskAgain: false,
  });
  mockImageLoad.mockResolvedValue({
    width: 512,
    height: 512,
    release: mockRelease,
  });
  mockPipeline.mockImplementation(async (_input: CaptureInput, deps: CaptureDependencies) => {
    await deps.onPrepared?.(painting);
    return { kind: "sent", scanId: "scan-id", timings: { total: 12 } };
  });
});

it.each([
  [{ kind: "sent", scanId: "scan-id" }, "scan-id"],
  [{ kind: "queued", localId: "capture-uuid" }, "local-capture-uuid"],
])("opens the matching result after capture: %s", async (result, scanId) => {
  mockPipeline.mockImplementation(async (_input: CaptureInput, deps: CaptureDependencies) => {
    await deps.onPrepared?.(painting);
    return { ...result, timings: { total: 12 } };
  });
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  expect(mockPush).not.toHaveBeenCalled();
  await act(() => hook.result.current.completeReveal(hook.result.current.presentation!.attempt));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/result/[scanId]",
    params: { scanId, entrance: "capture" },
  });
  expect(hook.result.current.timings).toEqual({ total: 12 });
  const deps = mockPipeline.mock.calls[0][1] as CaptureDependencies;
  const payload = {
    owner: "device:test-installation",
    scope: "test-scope",
    cropUri: "file:///private.jpg",
    contentBounds: painting.contentBounds,
    photoUri: "file:///private-full.jpg",
    localId: "capture-uuid",
    visitLocalId: "local-visit",
  } as CapturePayload;
  await deps.identify(payload);
  expect(mockIdentify).toHaveBeenCalledWith({
    localId: "capture-uuid",
    scope: "test-scope",
  });
});

it("shows retake guidance without navigating", async () => {
  mockPipeline.mockResolvedValue({
    kind: "retake",
    reason: "blur",
    message: "Hold steady",
    timings: { total: 2 },
  });
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  expect(hook.result.current.state.message).toBe("Hold steady");
  expect(hook.result.current.state.phase).toBe("retry");
  expect(mockPush).not.toHaveBeenCalled();
  await act(() => hook.result.current.useCamera());
  expect(hook.result.current.state.message).toBeUndefined();
});

it("imports a kept-size copy despite denied library access, without requesting permission, and preserves EXIF capture time", async () => {
  mockShrinkLibraryPhoto.mockResolvedValue("file:///library-kept.jpg");
  mockPicker.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: "file:///library.jpg",
        exif: { DateTimeOriginal: "2020:01:02 03:04:05" },
      },
    ],
  });
  const hook = await renderHook(useCapture);
  expect(mockPermission).not.toHaveBeenCalled();
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockPicker).toHaveBeenCalledWith({
    mediaTypes: ["images"],
    exif: true,
    quality: 1,
  });
  expect(mockShrinkLibraryPhoto).toHaveBeenCalledWith("file:///library.jpg");
  expect(mockPipeline.mock.calls[0][0]).toEqual({
    photoUri: "file:///library-kept.jpg",
    quad: null,
    source: "library",
    capturedAt: new Date(2020, 0, 2, 3, 4, 5).getTime(),
  });
  expect(mockVenueIdAt).not.toHaveBeenCalled();
});

it.each([undefined, null, {}])(
  "imports without EXIF metadata (%s) using the current time and no venue",
  async (exif) => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1234);
    try {
      mockPicker.mockResolvedValue({
        canceled: false,
        assets: [{ uri: "file:///library.jpg", assetId: null, exif }],
      });
      const hook = await renderHook(useCapture);
      await act(async () => {
        await hook.result.current.importPhoto();
      });
      expect(mockPipeline.mock.calls[0][0]).toEqual({
        photoUri: "file:///library.jpg",
        quad: null,
        source: "library",
        capturedAt: 1234,
        venueId: undefined,
      });
      expect(mockVenueIdAt).not.toHaveBeenCalled();
      expect(mockResolveVenue).not.toHaveBeenCalled();
      expect(hook.result.current.state.message).toBeUndefined();
    } finally {
      now.mockRestore();
    }
  },
);

it("names the venue of an imported photo from its EXIF position without starting a visit", async () => {
  mockPicker.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: "file:///library.jpg",
        exif: {
          GPSLatitude: 40.7794,
          GPSLatitudeRef: "N",
          GPSLongitude: 73.9633,
          GPSLongitudeRef: "W",
        },
      },
    ],
  });
  mockVenueIdAt.mockResolvedValue("museum-met");
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(mockVenueIdAt).toHaveBeenCalledWith({ lat: 40.7794, lng: -73.9633 });
  expect(mockPipeline.mock.calls[0][0]).toMatchObject({
    source: "library",
    venueId: "museum-met",
  });
  expect(mockPipeline.mock.calls[0][0]).not.toHaveProperty("visitId");
});

it("imports without a venue when the local table cannot be read", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///library.jpg", exif: { GPSLatitude: 1, GPSLongitude: 2 } }],
  });
  mockVenueIdAt.mockRejectedValue(new Error("no table"));
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(mockPipeline.mock.calls[0][0]).toMatchObject({
    source: "library",
    venueId: undefined,
  });
  expect(hook.result.current.state.message).toBeUndefined();
});

it.each([
  { canceled: true, assets: null },
  { canceled: false, assets: [] },
])("leaves the screen unchanged when no photo is selected: %s", async (result) => {
  mockPicker.mockResolvedValue(result);
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(mockPipeline).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  expect(hook.result.current.state.occupied).toBe(false);
  expect(hook.result.current.state.message).toBeUndefined();
});

it("shows picker errors and releases the capture for another import", async () => {
  mockPicker.mockRejectedValueOnce(new Error("Picker unavailable"));
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(hook.result.current.state).toMatchObject({
    phase: "retry",
    occupied: false,
    message: "Picker unavailable",
  });
  expect(mockPipeline).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  mockPicker.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:///library.jpg" }],
  });
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(mockPipeline).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state.message).toBeUndefined();
});

it("reports a handled capture failure without including the photo", async () => {
  const error = new Error("Native image processing failed");
  mockPipeline.mockRejectedValue(error);
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  expect(reportError).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledWith(error, "capture.process");
  expect(hook.result.current.state.phase).toBe("retry");
});

it("does not report a cancelled photo selection", async () => {
  mockPicker.mockResolvedValue({ canceled: true, assets: null });
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(reportError).not.toHaveBeenCalled();
});

it("blocks a second capture until the first finishes, then exposes errors for retry", async () => {
  let reject!: (error: Error) => void;
  mockPipeline.mockReturnValue(
    new Promise<CaptureResult>((_, fail) => {
      reject = fail;
    }),
  );
  const hook = await renderHook(useCapture);
  const getInput = jest.fn(async () => input);
  let first!: Promise<void>;
  await act(async () => {
    first = hook.result.current.capture(getInput);
  });
  expect(hook.result.current.state.occupied).toBe(true);
  await act(async () => {
    await hook.result.current.capture(getInput);
  });
  expect(getInput).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error("Unable to correct the painting perspective"));
    await first;
  });
  expect(hook.result.current.state.occupied).toBe(false);
  expect(hook.result.current.state.message).toBe("Unable to correct the painting perspective");
});

it("checks current reachability after processing, not the value at shutter press", async () => {
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  const deps = mockPipeline.mock.calls[0][1] as CaptureDependencies;
  expect(deps.isOnline()).toBe(true);
  mockReachable = false;
  await hook.rerender(undefined);
  expect(deps.isOnline()).toBe(false);
});

it("does not navigate after the screen unmounts during processing", async () => {
  let complete!: (result: CaptureResult) => void;
  mockPipeline.mockReturnValue(
    new Promise<CaptureResult>((resolve) => {
      complete = resolve;
    }),
  );
  const hook = await renderHook(useCapture);
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.result.current.capture(async () => input);
  });
  await hook.unmount();
  await act(async () => {
    complete({ kind: "queued", localId: "id", timings: { total: 1 } });
    await pending;
  });
  expect(mockPush).not.toHaveBeenCalled();
});

it("publishes the captured photo before venue lookup finishes", async () => {
  let resolve!: (context: object) => void;
  mockResolveVenue.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const hook = await renderHook(useCapture);
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.result.current.captureManually(async () => ({
      filePath: "/photo.jpg",
    }));
  });
  expect(hook.result.current.presentation?.photoUri).toBe("file:///photo.jpg");
  expect(mockPipeline).not.toHaveBeenCalled();
  expect(mockWarning).toHaveBeenCalledWith("light");
  await act(async () => {
    resolve({});
    await pending;
  });
});

it("holds the revealed artwork during slow recognition and navigates exactly once when ready", async () => {
  let resolve!: (result: CaptureResult) => void;
  mockPipeline.mockImplementation(async (_input: CaptureInput, deps: CaptureDependencies) => {
    await deps.onPrepared?.(painting);
    return new Promise((done) => {
      resolve = done;
    });
  });
  const hook = await renderHook(useCapture);
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.result.current.capture(async () => input);
  });
  const attempt = hook.result.current.presentation!.attempt;
  await act(() => hook.result.current.completeReveal(attempt));
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockRelease).not.toHaveBeenCalled();
  await act(async () => {
    resolve({ kind: "queued", localId: "offline", timings: { total: 1 } });
    await pending;
  });
  await act(() => hook.result.current.completeReveal(attempt));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/result/[scanId]",
    params: { scanId: "local-offline", entrance: "capture" },
  });
  await hook.unmount();
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

it("continues to the result after failed presentation decoding with one recognition request", async () => {
  mockImageLoad.mockRejectedValue(new Error("Decode failed"));
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPipeline).toHaveBeenCalledTimes(1);
  expect(hook.result.current.presentation).toBeUndefined();
});

it("retains a failed import when choosing another photo is canceled, and supports Use camera", async () => {
  mockPipeline.mockResolvedValue({
    kind: "retake",
    reason: "boundary",
    message: "Fit all corners",
    timings: { total: 1 },
  });
  mockPicker
    .mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///selected.jpg" }],
    })
    .mockResolvedValueOnce({ canceled: true });
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(hook.result.current.presentation?.photoUri).toBe("file:///selected.jpg");
  expect(hook.result.current.state.phase).toBe("retry");
  await act(async () => {
    await hook.result.current.importPhoto();
  });
  expect(hook.result.current.presentation?.photoUri).toBe("file:///selected.jpg");
  expect(hook.result.current.state).toMatchObject({
    phase: "retry",
    source: "library",
    message: "Fit all corners",
  });
  await act(() => hook.result.current.useCamera());
  expect(hook.result.current.presentation).toBeUndefined();
  expect(hook.result.current.state.phase).toBe("searching");
});

it("defers navigation while backgrounded and resumes exactly once on return", async () => {
  const hook = await renderHook((props: { active: boolean; focused: boolean }) => useCapture(props), {
    initialProps: { active: true, focused: true },
  });
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  const attempt = hook.result.current.presentation!.attempt;
  await hook.rerender({ active: false, focused: true });
  await act(() => hook.result.current.completeReveal(attempt));
  expect(mockPush).not.toHaveBeenCalled();
  await hook.rerender({ active: true, focused: true });
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it("drops presentation and old completion callbacks when a different screen takes focus", async () => {
  const hook = await renderHook((props: { active: boolean; focused: boolean }) => useCapture(props), {
    initialProps: { active: true, focused: true },
  });
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  const attempt = hook.result.current.presentation!.attempt;
  await hook.rerender({ active: false, focused: false });
  expect(mockRelease).toHaveBeenCalled();
  await hook.rerender({ active: true, focused: true });
  await act(() => hook.result.current.completeReveal(attempt));
  expect(mockPush).not.toHaveBeenCalled();
  expect(hook.result.current.state.phase).toBe("searching");
});

it("releases images and refuses old results after an owner change", async () => {
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  const attempt = hook.result.current.presentation!.attempt;
  await act(() => switchOwner("user:someone-else", "other-scope"));
  expect(mockRelease).toHaveBeenCalled();
  expect(hook.result.current.presentation).toBeUndefined();
  await act(() => hook.result.current.completeReveal(attempt));
  expect(mockPush).not.toHaveBeenCalled();
  await act(() => switchOwner(anonymousOwner(), "test-scope"));
});

it("publishes an imported photo before looking up its EXIF venue", async () => {
  let resolve!: (venueId: string) => void;
  mockPicker.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: "file:///selected.jpg",
        exif: { GPSLatitude: 1, GPSLongitude: 2 },
      },
    ],
  });
  mockVenueIdAt.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const hook = await renderHook(useCapture);
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = hook.result.current.importPhoto();
  });
  expect(hook.result.current.presentation?.photoUri).toBe("file:///selected.jpg");
  expect(mockPipeline).not.toHaveBeenCalled();
  await act(async () => {
    resolve("museum");
    await pending;
  });
});

it("keeps the artwork visible through the native result fade and releases it at transition end", async () => {
  const hook = await renderHook((props: { active: boolean; focused: boolean }) => useCapture(props), {
    initialProps: { active: true, focused: true },
  });
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  await act(() => hook.result.current.completeReveal(hook.result.current.presentation!.attempt));
  await hook.rerender({ active: false, focused: false });
  expect(mockRelease).not.toHaveBeenCalled();
  expect(hook.result.current.presentation?.crop).toBeDefined();
  await act(() => hook.result.current.endResultTransition());
  expect(mockRelease).toHaveBeenCalledTimes(1);
  expect(hook.result.current.presentation).toBeUndefined();
  await hook.rerender({ active: true, focused: true });
  expect(hook.result.current.state.phase).toBe("searching");
});

it("captures automatically with the detected corners and announces it", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  const quad: Quad = [
    [0.1, 0.2],
    [0.9, 0.2],
    [0.9, 0.8],
    [0.1, 0.8],
  ];
  const hook = await renderHook(useCapture);
  await act(async () => {
    const attempt = hook.result.current.controller.begin("camera", quad)!;
    await hook.result.current.captureAutomatically(attempt, async () => ({
      filePath: "/photo.jpg",
    }));
  });
  expect(mockPipeline.mock.calls[0][0]).toMatchObject({
    photoUri: "file:///photo.jpg",
    quad,
    source: "camera",
  });
  expect(announce).toHaveBeenCalledWith("Artwork captured automatically.");
  expect(mockWarning).toHaveBeenCalledWith("light");
});

it("ignores the shutter while a capture is already running", async () => {
  let complete!: (result: CaptureResult) => void;
  mockPipeline.mockReturnValue(
    new Promise<CaptureResult>((resolve) => {
      complete = resolve;
    }),
  );
  const hook = await renderHook(useCapture);
  const takePhoto = jest.fn(async () => ({ filePath: "/photo.jpg" }));
  let pending!: Promise<void> | undefined;
  await act(async () => {
    pending = hook.result.current.captureManually(takePhoto);
  });
  await act(async () => {
    await hook.result.current.captureManually(takePhoto);
  });
  expect(takePhoto).toHaveBeenCalledTimes(1);
  expect(mockWarning).toHaveBeenCalledTimes(1);
  await act(async () => {
    complete({ kind: "queued", localId: "id", timings: { total: 1 } });
    await pending;
  });
});

it.each(["camera", "library"] as const)(
  "keeps the explicitly selected visit when capturing from %s",
  async (source) => {
    mockVisit.mockResolvedValue({
      localId: "chosen-visit",
      venueId: "chosen-museum",
      remoteVisitId: "remote-visit",
    });
    mockResolveVenue.mockResolvedValue({
      visitLocalId: "another-visit",
      venueId: "another-museum",
    });
    mockPicker.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///library.jpg" }],
    });
    const hook = await renderHook(() => useCapture({ visitLocalId: "chosen-visit" }));
    await act(async () => {
      if (source === "library") await hook.result.current.importPhoto();
      else {
        await hook.result.current.captureManually(async () => ({
          filePath: "/photo.jpg",
        }));
      }
    });
    expect(mockPipeline.mock.calls[0][0]).toMatchObject({
      visitLocalId: "chosen-visit",
      venueId: "chosen-museum",
      visitId: "remote-visit",
      source,
    });
    expect(mockResolveVenue).not.toHaveBeenCalled();
  },
);

it("reports an unavailable visit before taking the photo instead of assigning the scan elsewhere", async () => {
  mockVisit.mockResolvedValue(undefined);
  const onVisitUnavailable = jest.fn(),
    takePhoto = jest.fn(async () => ({ filePath: "/photo.jpg" }));
  const hook = await renderHook(() => useCapture({ visitLocalId: "missing-visit", onVisitUnavailable }));
  await act(async () => {
    await hook.result.current.captureManually(takePhoto);
  });
  expect(takePhoto).not.toHaveBeenCalled();
  expect(mockPipeline).not.toHaveBeenCalled();
  expect(onVisitUnavailable).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state.message).toContain("This visit is no longer available.");
  expect(hook.result.current.state.rearm).toBe("shutter");
});

it.each(["retake", "error", "queued", "sent"])("releases the camera temporary file after %s", async (outcome) => {
  mockPipeline.mockImplementation(async () => {
    if (outcome === "error") throw new Error("Processing failed");
    return { kind: outcome, timings: { total: 1 } };
  });
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.capture(async () => input);
  });
  expect(mockRemoveCameraTempFile).toHaveBeenCalledWith(input.photoUri);
});

it("cleans a photo delivered after leaving the screen without starting processing", async () => {
  let finish!: (input: CaptureInput) => void;
  const photo = new Promise<CaptureInput>((resolve) => {
    finish = resolve;
  });
  const hook = await renderHook(useCapture);
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = hook.result.current.capture(() => photo);
  });
  await hook.unmount();
  await act(async () => {
    finish(input);
    await pending;
  });
  expect(mockPipeline).not.toHaveBeenCalled();
  expect(mockRemoveCameraTempFile).toHaveBeenCalledWith(input.photoUri);
});

it("waits for processing to settle before cleaning an abandoned capture", async () => {
  let finish!: (result: CaptureResult) => void;
  mockPipeline.mockReturnValue(
    new Promise<CaptureResult>((resolve) => {
      finish = resolve;
    }),
  );
  const hook = await renderHook(useCapture);
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = hook.result.current.capture(async () => input);
  });
  await hook.unmount();
  expect(mockRemoveCameraTempFile).not.toHaveBeenCalled();
  await act(async () => {
    finish({ kind: "queued", localId: "id", timings: { total: 1 } });
    await pending;
  });
  expect(mockRemoveCameraTempFile).toHaveBeenCalledWith(input.photoUri);
});

it("keeps a rejected library image available for its retry preview", async () => {
  mockPipeline.mockResolvedValue({ kind: "retake", message: "Retry", timings: { total: 1 } });
  const hook = await renderHook(useCapture);
  await act(async () => {
    await hook.result.current.capture(async () => ({ ...input, source: "library" }));
  });
  expect(mockRemoveCameraTempFile).not.toHaveBeenCalled();
  expect(hook.result.current.presentation?.photoUri).toBe(input.photoUri);
});
