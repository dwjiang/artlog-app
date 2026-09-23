import { interpolateCorners, perspectiveMatrix, revealGeometry } from "./reveal-geometry";
import type { PreparedPainting, Quad } from "./stages";

const painting: PreparedPainting = {
  cropUri: "file:///crop.jpg",
  cropSize: 512,
  photoSize: { width: 1000, height: 1500 },
  contentBounds: { x: 0, y: 85, width: 512, height: 341 },
  corners: [
    [0.2, 0.2],
    [0.8, 0.3],
    [0.75, 0.7],
    [0.25, 0.8],
  ],
};
function project(m: number[], [x, y]: [number, number]) {
  const w = m[3] * x + m[7] * y + m[15];
  return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
}

it("maps all four crop corners exactly onto the frozen photograph and the final flat rectangle", () => {
  const geometry = revealGeometry(painting, { width: 390, height: 844 }, "cover")!;
  const rect: Quad = [
    [0, 0],
    [geometry.width, 0],
    [geometry.width, geometry.height],
    [0, geometry.height],
  ];
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const target = interpolateCorners(geometry.from, geometry.to, progress);
    const matrix = perspectiveMatrix(geometry.width, geometry.height, target)!;
    rect.forEach((point, i) => {
      const projected = project(matrix, point);
      expect(projected[0]).toBeCloseTo(target[i][0], 6);
      expect(projected[1]).toBeCloseTo(target[i][1], 6);
    });
  }
  expect(geometry.to[1][1]).toBe(geometry.to[0][1]);
  expect(geometry.to[3][0]).toBe(geometry.to[0][0]);
});

it("shows the entire unpadded artwork and accounts for odd asymmetric padding", () => {
  const geometry = revealGeometry(painting, { width: 390, height: 844 }, "contain")!;
  const scale = geometry.width / painting.contentBounds.width;
  expect(geometry.imageTop).toBe(-85 * scale);
  expect(geometry.height).toBe(341 * scale);
  expect(geometry.imageSize).toBe(512 * scale);
  expect(geometry.width / geometry.height).toBeCloseTo(512 / 341);
});

it("maps imports with contain and camera photos with cover in upright coordinates", () => {
  const view = { width: 300, height: 900 };
  expect(revealGeometry(painting, view, "contain")!.from[0]).toEqual([60, 315]);
  expect(revealGeometry(painting, view, "cover")!.from[0]).toEqual([-30, 180]);
});

it("declines degenerate transforms and invalid content bounds", () => {
  expect(
    perspectiveMatrix(100, 100, [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]),
  ).toBeNull();
  expect(
    revealGeometry(
      { ...painting, contentBounds: { x: 0, y: 0, width: 0, height: 512 } },
      { width: 390, height: 844 },
      "cover",
    ),
  ).toBeNull();
  expect(
    revealGeometry(
      { ...painting, contentBounds: { x: 1, y: 0, width: 512, height: 512 } },
      { width: 390, height: 844 },
      "cover",
    ),
  ).toBeNull();
});

it("keeps a tall canvas entirely between the measured camera controls", () => {
  const portrait = { ...painting, contentBounds: { x: 85, y: 0, width: 341, height: 512 } };
  const geometry = revealGeometry(portrait, { width: 390, height: 844 }, "cover", {
    top: 120,
    bottom: 260,
  })!;
  expect(geometry.to[0][1]).toBeGreaterThanOrEqual(120);
  expect(geometry.to[2][1]).toBeLessThanOrEqual(844 - 260);
  expect(geometry.width / geometry.height).toBeCloseTo(341 / 512);
});
