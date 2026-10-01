import { framePatches, type FrameSource } from "./frame-patches";

const source = { width: 512, height: 512, top: 80, right: 80, bottom: 80, left: 80 };

it.each([
  [38, 28, 3],
  [166, 220, 10],
  [350, 110, 14],
  [70, 320, 4],
])("covers only the frame border at %s × %s without covering the artwork", (width, height, inset) => {
  const patches = framePatches(source, width, height, inset);
  const area = patches.reduce((sum, { dest }) => sum + dest.width * dest.height, 0);
  expect(area).toBeCloseTo(width * height - (width - inset * 2) * (height - inset * 2));
  for (const { src, dest } of patches) {
    expect(src.x).toBeGreaterThanOrEqual(0);
    expect(src.y).toBeGreaterThanOrEqual(0);
    expect(src.x + src.width).toBeLessThanOrEqual(source.width + 0.001);
    expect(src.y + src.height).toBeLessThanOrEqual(source.height + 0.001);
    expect(dest.width).toBeGreaterThan(0);
    expect(dest.height).toBeGreaterThan(0);
    expect(dest.x + dest.width).toBeLessThanOrEqual(width + 0.001);
    expect(dest.y + dest.height).toBeLessThanOrEqual(height + 0.001);
    expect(
      dest.x + dest.width <= inset + 0.001
        || dest.y + dest.height <= inset + 0.001
        || dest.x >= width - inset - 0.001
        || dest.y >= height - inset - 0.001,
    ).toBe(true);
  }
});

it("keeps ornament proportions as a frame becomes wider or taller", () => {
  for (const [width, height] of [
    [140, 300],
    [350, 90],
  ]) {
    for (const { src, dest } of framePatches(source, width, height, 10)) {
      expect(dest.width / dest.height).toBeCloseTo(src.width / src.height);
    }
  }
});

it.each([
  [350, 110],
  [70, 320],
])("renders plain rails continuously at %s × %s without changing the corner profiles", (width, height) => {
  const plain: FrameSource = { ...source, railMode: "stretch" };
  const inset = 10;
  const patches = framePatches(plain, width, height, inset);
  expect(patches.slice(0, 4)).toEqual(framePatches(source, width, height, inset).slice(0, 4));
  expect(patches.slice(4).map(({ dest }) => dest)).toEqual([
    { x: inset, y: 0, width: width - inset * 2, height: inset },
    { x: inset, y: height - inset, width: width - inset * 2, height: inset },
    { x: 0, y: inset, width: inset, height: height - inset * 2 },
    { x: width - inset, y: inset, width: inset, height: height - inset * 2 },
  ]);
  expect(patches.slice(4).map(({ src }) => src)).toEqual([
    { x: 80, y: 0, width: 352, height: 80 },
    { x: 80, y: 432, width: 352, height: 80 },
    { x: 0, y: 80, width: 80, height: 352 },
    { x: 432, y: 80, width: 80, height: 352 },
  ]);
});

it("handles asymmetric source rails and skips a frame before it has a measured size", () => {
  expect(framePatches(source, 166, 0, 10)).toEqual([]);
  const asymmetric = { ...source, top: 70, right: 90, bottom: 85, left: 75 };
  const patches = framePatches(asymmetric, 166, 220, 10);
  expect(patches.reduce((sum, { dest }) => sum + dest.width * dest.height, 0)).toBeCloseTo(166 * 220 - 146 * 200);
});

const carved: FrameSource = {
  ...source,
  ornaments: { horizontal: { corner: 160, center: 100 }, vertical: { corner: 160, center: 100 } },
};

it.each([
  [166, 220, 24],
  [350, 110, 24],
  [70, 320, 10],
  [38, 28, 5],
  [166, 49, 24],
])("keeps one centered crest per rail and a clear artwork opening at %s × %s", (width, height, inset) => {
  const patches = framePatches(carved, width, height, inset);
  expect(patches.reduce((area, { dest }) => area + dest.width * dest.height, 0)).toBeCloseTo(
    width * height - (width - 2 * inset) * (height - 2 * inset),
  );
  const horizontal = patches.filter(({ src }) => src.x === 206 && src.width === 100);
  const vertical = patches.filter(({ src }) => src.y === 206 && src.height === 100);
  expect(horizontal).toHaveLength(2);
  expect(vertical).toHaveLength(2);
  for (const { dest } of horizontal) expect(dest.x + dest.width / 2).toBeCloseTo(width / 2);
  for (const { dest } of vertical) expect(dest.y + dest.height / 2).toBeCloseTo(height / 2);
  for (const { src, dest } of patches) {
    expect(src.width).toBeGreaterThan(0);
    expect(src.height).toBeGreaterThan(0);
    expect(dest.width).toBeGreaterThan(0);
    expect(dest.height).toBeGreaterThan(0);
    expect(dest.x).toBeGreaterThanOrEqual(0);
    expect(dest.y).toBeGreaterThanOrEqual(0);
    expect(dest.x + dest.width).toBeLessThanOrEqual(width + 0.001);
    expect(dest.y + dest.height).toBeLessThanOrEqual(height + 0.001);
    expect(
      dest.x + dest.width <= inset + 0.001
        || dest.y + dest.height <= inset + 0.001
        || dest.x >= width - inset - 0.001
        || dest.y >= height - inset - 0.001,
    ).toBe(true);
  }
});

it("preserves crest and corner-leaf proportions while stretching the plain spaces between them", () => {
  const inset = 12;
  const ornaments = framePatches(carved, 250, 180, inset).filter(
    ({ src }) => src.width === 100 || src.height === 100 || (src.width === 80 && src.height === 80),
  );
  for (const { src, dest } of ornaments) {
    expect(dest.width / src.width).toBeCloseTo(inset / 80);
    expect(dest.height / src.height).toBeCloseTo(inset / 80);
  }
});
