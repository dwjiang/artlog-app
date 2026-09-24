import { warper } from "./default-stages";
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

it.each([null, quad])("requires still-image evidence even when preview corners exist: %s", async (preview) => {
  mockStill.mockResolvedValue({
    width: 1200,
    height: 1600,
    rectangles: [],
    subjects: [],
  });
  expect(await warper.warpAndLetterbox("file:///photo.jpg", preview, 512)).toBeNull();
  expect(mockWarp).not.toHaveBeenCalled();
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
  expect(await warper.warpAndLetterbox("file:///rotated.jpg", null, 512)).toEqual({
    cropUri: "file:///crop.jpg",
    corners: quad,
    photoSize: { width: 1600, height: 1200 },
    contentBounds: bounds,
    cropSize: 512,
  });
  expect(mockWarp).toHaveBeenCalledWith("/rotated.jpg", corners, 512);
  expect(mockWarp).toHaveBeenCalledTimes(1);
});

it("does not treat a prominent internal portrait subject as the canvas boundary", async () => {
  mockStill.mockResolvedValue({
    width: 1200,
    height: 1600,
    rectangles: [],
    subjects: [{ quad: corners, quadFill: 0.94, area: 0.4 }],
  });
  expect(await warper.warpAndLetterbox("file:///portrait.jpg", quad, 512)).toBeNull();
});
