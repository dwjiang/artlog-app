import { snapToReference } from "./snap-crop";
import type { Quad } from "./stages";

const SIZE = 512;
const wholePhoto: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const fullContent = { x: 0, y: 0, width: SIZE, height: SIZE };
const square = (left: number, top: number, side: number) => [
  [left, top],
  [left + side, top],
  [left + side, top + side],
  [left, top + side],
];

// Four decimals is well under a pixel of any photo; `+ 0` turns -0 into 0.
const rounded = (quad: Quad | null) => quad?.map((corner) => corner.map((value) => Math.round(value * 1e4) / 1e4 + 0));

describe("snapToReference", () => {
  it("drops the reference's letterbox padding, keeping only the painting", () => {
    // A 3:4 portrait fills its square's height and 384 of its 512 px width.
    const snapped = snapToReference({
      referenceCorners: square(128, 128, 256),
      referenceSize: { width: 300, height: 400 },
      cropCorners: wholePhoto,
      contentBounds: fullContent,
      inputSize: SIZE,
    });
    expect(rounded(snapped)).toEqual([
      [0.3125, 0.25],
      [0.6875, 0.25],
      [0.6875, 0.75],
      [0.3125, 0.75],
    ]);
  });

  it("tightens a crop that kept the frame to the canvas inside it", () => {
    const snapped = snapToReference({
      referenceCorners: [
        [64, 160],
        [448, 160],
        [448, 352],
        [64, 352],
      ],
      referenceSize: { width: 1000, height: 1000 },
      cropCorners: [
        [0.1, 0.2],
        [0.9, 0.2],
        [0.9, 0.6],
        [0.1, 0.6],
      ],
      contentBounds: { x: 0, y: 128, width: 512, height: 256 },
      inputSize: SIZE,
    });
    // The frame crop's content spans y 128–384 of its square; the canvas covers the middle three quarters both ways.
    expect(rounded(snapped)).toEqual([
      [0.2, 0.25],
      [0.8, 0.25],
      [0.8, 0.55],
      [0.2, 0.55],
    ]);
  });

  it("widens a crop that cut into the painting", () => {
    const snapped = snapToReference({
      referenceCorners: square(-256, -256, 1024),
      referenceSize: { width: 800, height: 800 },
      cropCorners: [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.6, 0.6],
        [0.4, 0.6],
      ],
      contentBounds: fullContent,
      inputSize: SIZE,
    });
    expect(rounded(snapped)).toEqual([
      [0.3, 0.3],
      [0.7, 0.3],
      [0.7, 0.7],
      [0.3, 0.7],
    ]);
  });

  it("clamps corners that overshoot the photo edge by a hair", () => {
    const snapped = snapToReference({
      referenceCorners: square(-2, 0, 514),
      referenceSize: { width: 500, height: 500 },
      cropCorners: wholePhoto,
      contentBounds: fullContent,
      inputSize: SIZE,
    });
    expect(snapped?.[0][0]).toBe(0);
    expect(snapped?.[1][0]).toBe(1);
  });

  it("keeps the crop when the painting runs off the photo", () => {
    const snapped = snapToReference({
      referenceCorners: square(-60, 0, 512),
      referenceSize: { width: 500, height: 500 },
      cropCorners: wholePhoto,
      contentBounds: fullContent,
      inputSize: SIZE,
    });
    expect(snapped).toBeNull();
  });

  it("keeps the crop when the projected corners cross", () => {
    const snapped = snapToReference({
      referenceCorners: [
        [100, 100],
        [400, 400],
        [400, 100],
        [100, 400],
      ],
      referenceSize: { width: 500, height: 500 },
      cropCorners: wholePhoto,
      contentBounds: fullContent,
      inputSize: SIZE,
    });
    expect(snapped).toBeNull();
  });
});
