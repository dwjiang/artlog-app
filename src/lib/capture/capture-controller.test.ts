import { CaptureController } from "./capture-controller";
import { previewQuad, toCorners, type FrameSize } from "./rectangle";
import type { Quad } from "./stages";

const frame = { width: 768, height: 1024 };
const painting: Quad = [
  [0.15, 0.25],
  [0.85, 0.25],
  [0.85, 0.75],
  [0.15, 0.75],
];
const shifted = (dx: number, dy = 0) => painting.map(([x, y]) => [x + dx, y + dy]) as Quad;
function observe(controller: CaptureController, now: number, quads: Quad[] = [painting], preview: FrameSize = frame) {
  return controller.observe(
    {
      ...frame,
      observations: quads.map((quad) => ({
        confidence: 1,
        corners: toCorners(quad),
      })),
    },
    preview,
    now,
  );
}
function hold(controller: CaptureController, from = 0, quads = [painting], preview = frame) {
  for (let now = from; now < from + 800; now += 100) {
    expect(observe(controller, now, quads, preview)).toBeUndefined();
  }
  return observe(controller, from + 800, quads, preview);
}
function failed(attempt = (controller: CaptureController) => hold(controller)!) {
  const controller = new CaptureController();
  const started = attempt(controller);
  controller.fail(started, "Adjust the angle to reduce glare");
  controller.finish(started);
  return controller;
}

it("captures once after 800 ms of steady framing and blocks overlapping imports and detections", () => {
  const controller = new CaptureController();
  expect(hold(controller)).toMatchObject({ quad: painting, source: "camera" });
  expect(observe(controller, 900)).toBeUndefined();
  expect(controller.begin("library")).toBeUndefined();
  expect(controller.begin("camera")).toBeUndefined();
  expect(controller.getSnapshot().phase).toBe("capturing");
});

it("starts a shutter capture without live corners and blocks overlapping work", () => {
  const controller = new CaptureController();
  expect(controller.begin("camera")).toMatchObject({
    source: "camera",
    quad: null,
    valid: true,
  });
  expect(controller.begin("camera")).toBeUndefined();
  expect(observe(controller, 0)).toBeUndefined();
  expect(controller.getSnapshot().phase).toBe("capturing");
});

it("restarts stability after movement", () => {
  const controller = new CaptureController();
  for (let now = 0; now < 800; now += 100) observe(controller, now);
  expect(observe(controller, 800, [shifted(0.12, 0.12)])).toBeUndefined();
});

it("publishes preview-aligned corners and hold progress without rerendering the capture state", () => {
  const controller = new CaptureController();
  const preview = { width: 390, height: 700 };
  const stateChanged = jest.fn();
  const feedbackChanged = jest.fn();
  controller.subscribe(stateChanged);
  controller.subscribeFeedback(feedbackChanged);
  for (let now = 0; now <= 400; now += 100) {
    observe(controller, now, [painting], preview);
  }
  expect(controller.getFeedback()).toEqual({
    quad: previewQuad(painting, frame, preview),
    progress: 0.5,
  });
  expect(feedbackChanged).toHaveBeenCalled();
  expect(stateChanged).not.toHaveBeenCalled();
  observe(controller, 500, []);
  expect(controller.getFeedback()).toBeNull();
  observe(controller, 600);
  expect(controller.getFeedback()?.progress).toBe(0);
  controller.resetDetection();
  expect(controller.getFeedback()).toBeNull();
});

it("shows a visible but small painting without advancing capture progress", () => {
  const controller = new CaptureController();
  const small: Quad = [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
  ];
  expect(hold(controller, 0, [small])).toBeUndefined();
  expect(controller.getFeedback()).toEqual({
    quad: previewQuad(small, frame, frame),
    progress: 0,
  });
});

it("clears feedback when pausing or starting either capture path", () => {
  const controller = new CaptureController();
  observe(controller, 0);
  controller.setActive(false);
  expect(controller.getFeedback()).toBeNull();
  controller.setActive(true);
  observe(controller, 100);
  const attempt = controller.begin("camera")!;
  expect(controller.getFeedback()).toBeNull();
  controller.fail(attempt, "Try again");
  controller.finish(attempt);
  observe(controller, 200);
  expect(controller.getFeedback()).toBeNull();
  controller.reset();
  expect(hold(controller, 300)).toBeDefined();
  expect(controller.getFeedback()).toBeNull();
});

it.each([
  [
    [
      [0.02, 0.2],
      [0.72, 0.2],
      [0.72, 0.8],
      [0.02, 0.8],
    ],
    { width: 390, height: 844 },
  ],
  [
    [
      [0.05, 0.05],
      [0.95, 0.05],
      [0.95, 0.4],
      [0.05, 0.4],
    ],
    frame,
  ],
  [
    [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.7, 0.7],
      [0.3, 0.7],
    ],
    frame,
  ],
  [
    [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [0.1, 0.4],
    ],
    frame,
  ],
] as [Quad, FrameSize][])("rejects cropped, off-center, small, or skewed candidates", (quad, preview) => {
  expect(hold(new CaptureController(), 0, [quad], preview)).toBeUndefined();
});

it("selects the largest eligible candidate from several rectangles", () => {
  const detail: Quad = [
    [0.2, 0.3],
    [0.8, 0.3],
    [0.8, 0.7],
    [0.2, 0.7],
  ];
  expect(hold(new CaptureController(), 0, [detail, painting])?.quad).toEqual(painting);
});

it("requires a new full window after the candidate leaves the visible preview", () => {
  const controller = new CaptureController();
  for (let now = 0; now < 800; now += 100) observe(controller, now);
  observe(controller, 800, [], frame);
  expect(hold(controller, 900)).toBeDefined();
});

it("does not recapture an unchanged failure, even with another candidate present", () => {
  const controller = failed();
  for (let now = 900; now <= 5000; now += 100) {
    expect(observe(controller, now, [painting, shifted(0.14, 0.14)])).toBeUndefined();
  }
  expect(controller.getSnapshot()).toMatchObject({
    phase: "retry",
    rearm: "reframe",
  });
});

it("rearms after movement of 10% of the frame diagonal followed by fresh stability", () => {
  const controller = failed();
  expect(observe(controller, 900, [shifted(0.05)])).toBeUndefined();
  expect(controller.getSnapshot().phase).toBe("retry");
  expect(hold(controller, 1000, [shifted(0.13, 0.13)])).toBeDefined();
});

it("requires 700 ms of continuous absence before a fresh stable detection", () => {
  const controller = failed();
  observe(controller, 900, []);
  observe(controller, 1500, []);
  observe(controller, 1550);
  expect(controller.getSnapshot().phase).toBe("retry");
  observe(controller, 1600, []);
  observe(controller, 2300, []);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "searching",
    message: undefined,
    rearm: undefined,
  });
  expect(hold(controller, 2400)).toBeDefined();
});

it("keeps a shutter failure on screen until the artwork leaves the frame or the shutter is pressed again", () => {
  const controller = failed((c) => c.begin("camera")!);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "retry",
    message: "Adjust the angle to reduce glare",
    occupied: false,
    rearm: "shutter",
  });
  for (let now = 100; now <= 3000; now += 100) {
    expect(observe(controller, now, [shifted(0.1, 0.1)])).toBeUndefined();
  }
  expect(controller.getSnapshot().phase).toBe("retry");
  observe(controller, 3100, []);
  observe(controller, 3800, []);
  expect(hold(controller, 3900)).toBeDefined();
  const again = failed((c) => c.begin("camera")!);
  expect(again.begin("camera")).toBeDefined();
  expect(again.getSnapshot()).toMatchObject({
    phase: "capturing",
    message: undefined,
    rearm: undefined,
  });
});

it("pauses on focus loss or backgrounding and starts a fresh stability window", () => {
  const controller = new CaptureController();
  for (let now = 0; now < 800; now += 100) observe(controller, now);
  controller.setActive(false);
  expect(observe(controller, 800)).toBeUndefined();
  expect(controller.begin("camera")).toBeUndefined();
  controller.setActive(true);
  expect(hold(controller, 900)).toBeDefined();
});

it("cancels old ownership but retains the capture lock until pending work finishes", () => {
  const controller = new CaptureController();
  const attempt = hold(controller)!;
  controller.reset();
  expect(attempt.valid).toBe(false);
  expect(controller.begin("library")).toBeUndefined();
  expect(controller.result(attempt)).toBe(false);
  controller.finish(attempt);
  expect(hold(controller, 900)).toBeDefined();
});

it("blocks scanning on results and starts a fresh session on return", () => {
  const controller = new CaptureController();
  const attempt = hold(controller)!;
  controller.processing(attempt);
  controller.revealing(attempt);
  controller.finish(attempt);
  expect(controller.begin("library")).toBeUndefined();
  expect(controller.result(attempt)).toBe(true);
  expect(controller.result(attempt)).toBe(false);
  expect(hold(controller, 900)).toBeUndefined();
  expect(controller.begin("camera")).toBeUndefined();
  controller.reset();
  expect(hold(controller, 1800)).toBeDefined();
});

it("holds a failed import until the user chooses another photo or uses the camera", () => {
  const controller = new CaptureController();
  const attempt = controller.begin("library")!;
  controller.fail(attempt, "Fit all corners");
  controller.finish(attempt);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "retry",
    source: "library",
    rearm: undefined,
  });
  expect(hold(controller)).toBeUndefined();
  expect(controller.begin("library")).toBeDefined();
});

it("does not count an unexplained gap in camera frames as steady detection", () => {
  const controller = new CaptureController();
  observe(controller, 0);
  expect(observe(controller, 800)).toBeUndefined();
  expect(hold(controller, 800)).toBeDefined();
});
