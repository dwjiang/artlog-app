import { toastLayerBottom } from "./toast";

jest.mock("expo-router", () => ({ useSegments: () => [] }));

const resting = 54;

it("rests toasts at the bottom without a lift, and above a bottom bar that leaves no room under it", () => {
  expect(toastLayerBottom(resting, undefined, undefined)).toBe(resting);
  expect(toastLayerBottom(resting, { height: 96, room: 0 }, undefined)).toBe(104);
});

it("keeps toasts in the room under a raised bar once they are measured to fit, and lifts them above it otherwise", () => {
  const raised = { height: 300, room: 180 };
  expect(toastLayerBottom(resting, raised, undefined)).toBeUndefined();
  expect(toastLayerBottom(resting, raised, 118)).toBe(resting);
  expect(toastLayerBottom(resting, raised, 119)).toBe(308);
});
