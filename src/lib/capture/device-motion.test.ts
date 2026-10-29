import { readMotion } from "./device-motion";

const still = { x: 0.01, y: -0.02, z: 0.02, interfaceOrientation: 0 };

it("reads an upright phone aimed at a wall, including one tilted up toward a high painting", () => {
  expect(readMotion(still, { x: 0, y: -9.81, z: 0, interfaceOrientation: 0 })).toEqual({
    rotationRate: Math.hypot(0.01, -0.02, 0.02),
    upright: true,
  });
  expect(readMotion(still, { x: 0, y: -7.3, z: -6.5, interfaceOrientation: 0 })?.upright).toBe(true);
  expect(readMotion(still, { x: -9.81, y: 0, z: 0, interfaceOrientation: 0 })?.upright).toBe(true);
});

it("reads a phone lying flat as not upright", () => {
  expect(readMotion(still, { x: 0, y: -1, z: -9.7, interfaceOrientation: 0 })?.upright).toBe(false);
  expect(readMotion(still, { x: 0.2, y: 0, z: 9.8, interfaceOrientation: 0 })?.upright).toBe(false);
});

it("reads nothing before the sensors report, as on the iOS Simulator", () => {
  const zero = { x: 0, y: 0, z: 0, interfaceOrientation: 0 };
  expect(readMotion(zero, zero)).toBeUndefined();
});
