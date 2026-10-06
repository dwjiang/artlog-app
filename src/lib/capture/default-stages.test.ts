import { warper } from "./default-stages";
import { toQuad } from "./rectangle";
import type { Quad } from "./stages";

const mockStill = jest.fn();
const mockWarp = jest.fn();
jest.mock("../../../modules/vision-rect/src", () => ({
  getVisionRect: () => ({ detectStill: mockStill, warpAndLetterbox: mockWarp }),
}));
jest.mock("@/lib/embed/embedder", () => ({ embedder: {} }));
jest.mock("@/lib/queue/queue", () => ({ captureStore: {} }));
jest.mock("./features", () => ({ orb: {} }));
jest.mock("./triage", () => ({ triage: {} }));
const mockReportError = jest.fn();
jest.mock("@/lib/observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));
const corners = [
  { x: 0.1, y: 0.2 },
  { x: 0.9, y: 0.2 },
  { x: 0.9, y: 0.8 },
  { x: 0.1, y: 0.8 },
];
const quad = corners.map(({ x, y }) => [x, y]) as Quad;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

it("requires still-image evidence even when preview corners exist", async () => {
  mockStill.mockResolvedValue({
    width: 1200,
    height: 1600,
    rectangles: [],
    subjects: [],
  });
  expect(await warper.warpCandidates("file:///photo.jpg", quad, 512, true)).toEqual([]);
  expect(mockWarp).not.toHaveBeenCalled();
});

it("warps the whole photo when an import has no boundary", async () => {
  const whole = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  mockStill.mockResolvedValue({ width: 1200, height: 1600, rectangles: [], subjects: [] });
  mockWarp.mockResolvedValue({ cropPath: "/crop.jpg", usedQuad: whole });
  expect(await warper.warpCandidates("file:///photo.jpg", null, 512, true)).toMatchObject([
    { cropUri: "file:///crop.jpg" },
  ]);
  expect(mockWarp).toHaveBeenCalledWith("/photo.jpg", whole, 512);
});

it("warps the part of a turned shutter photo that the preview showed when no boundary was found", async () => {
  mockStill.mockResolvedValue({ width: 3024, height: 4032, rectangles: [], subjects: [] });
  mockWarp.mockImplementation(async (_path: string, usedQuad: typeof corners) => ({ cropPath: "/crop.jpg", usedQuad }));
  await warper.warpCandidates("file:///shutter.jpg", null, 512, false, 1, { width: 402, height: 874 });
  // The visible strip of the portrait preview becomes a band across the landscape photo.
  const [band] = mockWarp.mock.calls.map(([, used]: [string, typeof corners]) =>
    used.map(({ x, y }) => [Number(x.toFixed(3)), Number(y.toFixed(3))]),
  );
  expect(band).toEqual([
    [0, 0.193],
    [1, 0.193],
    [1, 0.807],
    [0, 0.807],
  ]);
});

it("retains the exact model crop and exposes upright dimensions and native content bounds", async () => {
  const bounds = { x: 0, y: 85, width: 512, height: 341 };
  mockStill.mockResolvedValue({
    width: 1600,
    height: 1200,
    rectangles: [{ corners, confidence: 1 }],
    subjects: [],
  });
  mockWarp.mockResolvedValue({
    cropPath: "/crop.jpg",
    usedQuad: corners,
    contentBounds: bounds,
  });
  expect(await warper.warpCandidates("file:///rotated.jpg", null, 512, true)).toEqual([
    {
      cropUri: "file:///crop.jpg",
      corners: quad,
      photoSize: { width: 1600, height: 1200 },
      contentBounds: bounds,
      cropSize: 512,
    },
  ]);
  expect(mockWarp).toHaveBeenCalledWith("/rotated.jpg", corners, 512);
  expect(mockWarp).toHaveBeenCalledTimes(1);
});

it("warps the boundary a shutter photo showed whole on the preview, not a larger one running off screen", async () => {
  const offScreen = [
    { x: 0.016, y: 0.073 },
    { x: 0.812, y: 0.065 },
    { x: 0.744, y: 0.868 },
    { x: 0.016, y: 0.913 },
  ];
  const onScreen = [
    { x: 0.273, y: 0.26 },
    { x: 0.801, y: 0.321 },
    { x: 0.793, y: 0.639 },
    { x: 0.283, y: 0.626 },
  ];
  mockStill.mockResolvedValue({
    width: 3024,
    height: 4032,
    rectangles: [
      { corners: offScreen, confidence: 1 },
      { corners: onScreen, confidence: 1 },
    ],
    subjects: [],
  });
  mockWarp.mockResolvedValue({ cropPath: "/crop.jpg", usedQuad: onScreen });
  await warper.warpCandidates("file:///shutter.jpg", null, 512, true, 0, { width: 402, height: 874 });
  // It covers under a third of what the preview showed, so the whole visible frame is tried first.
  expect(mockWarp).toHaveBeenLastCalledWith("/shutter.jpg", onScreen, 512);
  expect(mockWarp).not.toHaveBeenCalledWith("/shutter.jpg", offScreen, 512);
});

it("does not treat a prominent internal portrait subject as the canvas boundary", async () => {
  mockStill.mockResolvedValue({
    width: 1200,
    height: 1600,
    rectangles: [],
    subjects: [{ quad: corners, quadFill: 0.94, area: 0.4 }],
  });
  expect(await warper.warpCandidates("file:///portrait.jpg", quad, 512, true)).toEqual([]);
});

it("warps the confirmed preview boundary when subject lifting selects an interior detail", async () => {
  mockStill.mockResolvedValue({
    width: 1200,
    height: 1600,
    rectangles: [{ corners, confidence: 1 }],
    subjects: [
      {
        quad: [
          { x: 0.25, y: 0.25 },
          { x: 0.75, y: 0.25 },
          { x: 0.75, y: 0.75 },
          { x: 0.25, y: 0.75 },
        ],
        quadFill: 1.004,
        area: 0.25,
      },
    ],
  });
  mockWarp.mockResolvedValue({ cropPath: "/crop.jpg", usedQuad: corners });

  await warper.warpCandidates("file:///painting.jpg", quad, 512, false);

  expect(mockWarp).toHaveBeenCalledWith("/painting.jpg", corners, 512);
});

it.each([false, true])(
  "warps a turned photo upright, including nested boundaries when requested: %s",
  async (nested) => {
    // Held turned left: the preview saw a wide painting on its side; the photo is upright and landscape.
    const onItsSide = [
      { x: 0.25, y: 0.125 },
      { x: 0.625, y: 0.125 },
      { x: 0.625, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ];
    const upright = [
      { x: 0.125, y: 0.375 },
      { x: 0.75, y: 0.375 },
      { x: 0.75, y: 0.75 },
      { x: 0.125, y: 0.75 },
    ];
    const innerOnItsSide = [
      { x: 0.3125, y: 0.25 },
      { x: 0.5625, y: 0.25 },
      { x: 0.5625, y: 0.625 },
      { x: 0.3125, y: 0.625 },
    ];
    const innerUpright = [
      { x: 0.25, y: 0.4375 },
      { x: 0.625, y: 0.4375 },
      { x: 0.625, y: 0.6875 },
      { x: 0.25, y: 0.6875 },
    ];
    mockStill.mockResolvedValue({
      width: 1200,
      height: 1600,
      rectangles: [
        { corners: onItsSide, confidence: 1 },
        { corners: innerOnItsSide, confidence: 1 },
      ],
      subjects: [],
    });
    mockWarp.mockImplementation(async (_path: string, usedQuad: typeof corners) => ({
      cropPath: "/crop.jpg",
      usedQuad,
      contentBounds: { x: 0, y: 0, width: 1, height: 1 },
    }));

    const prepared = await warper.warpCandidates("file:///turned.jpg", toQuad(onItsSide), 512, nested, 3);
    const expected = nested ? [upright, innerUpright] : [upright];

    expect(mockStill).toHaveBeenCalledWith("/turned.jpg", 3);
    expect(mockWarp.mock.calls).toEqual(expected.map((corners) => ["/turned.jpg", corners, 512]));
    expect(prepared).toMatchObject(
      expected.map((corners) => ({ corners: toQuad(corners), photoSize: { width: 1600, height: 1200 } })),
    );
  },
);

describe("a painting shown on a phone", () => {
  const painting = [
    { x: 0.2, y: 0.4 },
    { x: 0.8, y: 0.4 },
    { x: 0.8, y: 0.6 },
    { x: 0.2, y: 0.6 },
  ];
  beforeEach(() => {
    mockStill.mockResolvedValue({
      width: 1200,
      height: 1600,
      rectangles: [
        { corners, confidence: 1 },
        { corners: painting, confidence: 1 },
      ],
      subjects: [],
    });
    mockWarp.mockImplementation(async (_path: string, used: typeof corners) => ({
      cropPath: used[0].x === corners[0].x ? "/phone.jpg" : "/painting.jpg",
      usedQuad: used,
    }));
  });

  it("warps the painting inside the phone after the phone itself", async () => {
    const candidates = await warper.warpCandidates("file:///phone.jpg", null, 512, true);
    expect(candidates.map((candidate) => candidate.cropUri)).toEqual(["file:///phone.jpg", "file:///painting.jpg"]);
  });

  it("warps only the phone when nested crops are not wanted", async () => {
    const candidates = await warper.warpCandidates("file:///phone.jpg", null, 512, false);
    expect(candidates.map((candidate) => candidate.cropUri)).toEqual(["file:///phone.jpg"]);
    expect(mockWarp).toHaveBeenCalledTimes(1);
  });

  it("keeps the phone crop and reports the failure when the nested warp fails", async () => {
    const failure = new Error("warp failed");
    mockWarp.mockResolvedValueOnce({ cropPath: "/phone.jpg", usedQuad: corners }).mockRejectedValueOnce(failure);
    const candidates = await warper.warpCandidates("file:///phone.jpg", null, 512, true);
    expect(candidates.map((candidate) => candidate.cropUri)).toEqual(["file:///phone.jpg"]);
    expect(mockReportError).toHaveBeenCalledWith(failure, "capture.warp_alternative", { level: "warning" });
  });
});
