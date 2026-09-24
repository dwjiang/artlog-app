import { fitPhoto, moveCropCorner, validCrop, wholePhoto } from "./crop-geometry";

it("fits portrait and landscape photos without distorting corner coordinates", () => {
  expect(fitPhoto({ width: 1200, height: 1600 }, { width: 300, height: 300 })).toEqual({
    width: 225,
    height: 300,
    left: 37.5,
    top: 0,
  });
  expect(fitPhoto({ width: 1600, height: 1200 }, { width: 300, height: 300 })).toEqual({
    width: 300,
    height: 225,
    left: 0,
    top: 37.5,
  });
});

it("allows perspective adjustments and clamps corners to the photo", () => {
  expect(moveCropCorner(wholePhoto, 0, 0.1, 0.2)[0]).toEqual([0.1, 0.2]);
  expect(moveCropCorner(wholePhoto, 0, -2, -1)[0]).toEqual([0, 0]);
});

it("refuses crossed, collapsed, and non-finite corners", () => {
  const quad = moveCropCorner(wholePhoto, 0, 0.8, 0.8);
  expect(quad).toEqual(wholePhoto);
  expect(moveCropCorner(wholePhoto, 0, 1, 0)).toEqual(wholePhoto);
  expect(moveCropCorner(wholePhoto, 0, NaN, 0)).toEqual(wholePhoto);
  expect(
    validCrop([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]),
  ).toBe(false);
});
