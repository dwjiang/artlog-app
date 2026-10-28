import { gridColumns } from "./grid-columns";

it("keeps the phone column count across every iPhone width in portrait", () => {
  for (const width of [375, 402, 440, 382]) expect(gridColumns(2, width, 1)).toBe(2);
  expect(gridColumns(3, 402, 1)).toBe(3);
});

it("repeats the phone grid side by side once there is room for another copy", () => {
  // iPhone 17 Pro in landscape beside the camera housing, and the open iPhone Duo beside its rail.
  expect(gridColumns(2, 750, 1)).toBe(4);
  expect(gridColumns(2, 867, 1)).toBe(4);
  expect(gridColumns(3, 669, 1)).toBe(6);
});

it("drops to one column at the largest text sizes whatever the width", () => {
  expect(gridColumns(2, 402, 1.5)).toBe(1);
  expect(gridColumns(3, 867, 1.5)).toBe(1);
});
