import { removeSetting, setSetting } from "@/db/repos/settings";

import { getMeasurementUnits, setMeasurementUnits, subscribeMeasurementUnits } from "./measurement-units";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

let mockMeasurementSystem: "metric" | "us" | "uk" | null = "metric";
jest.mock("expo-localization", () => ({
  getLocales: () => [{ measurementSystem: mockMeasurementSystem }],
}));

beforeEach(async () => {
  mockMeasurementSystem = "metric";
  await removeSetting("measurement-units");
});

it.each([
  ["metric", "metric"],
  ["us", "imperial"],
  ["uk", "imperial"],
  [null, "metric"],
] as const)("follows an iPhone measurement system of %s until units are chosen", async (system, units) => {
  mockMeasurementSystem = system;
  expect(await getMeasurementUnits()).toBe(units);
});

it("keeps chosen units when the iPhone's measurement system differs", async () => {
  mockMeasurementSystem = "us";
  await setMeasurementUnits("metric");
  expect(await getMeasurementUnits()).toBe("metric");
});

it("persists the selected units across fresh reads", async () => {
  await setMeasurementUnits("imperial");
  await jest.isolateModulesAsync(async () => {
    const settings = jest.requireActual<typeof import("./measurement-units")>("./measurement-units");
    expect(await settings.getMeasurementUnits()).toBe("imperial");
  });
  await setMeasurementUnits("metric");
  expect(await getMeasurementUnits()).toBe("metric");
});

it("follows the iPhone when a saved value is unrecognized", async () => {
  mockMeasurementSystem = "us";
  await setSetting("measurement-units", "unknown");
  expect(await getMeasurementUnits()).toBe("imperial");
});

it("notifies active screens after saving and stops notifying after unsubscribe", async () => {
  const changed = jest.fn();
  const unsubscribe = subscribeMeasurementUnits(changed);
  await setMeasurementUnits("imperial");
  expect(changed).toHaveBeenCalledWith("imperial");
  unsubscribe();
  await setMeasurementUnits("metric");
  expect(changed).toHaveBeenCalledTimes(1);
});
