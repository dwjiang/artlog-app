import {
  getMeasurementUnits,
  setMeasurementUnits,
  subscribeMeasurementUnits,
} from "./measurement-units";
import { removeSetting, setSetting } from "@/db/repos/settings";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));

beforeEach(async () => {
  await removeSetting("measurement-units");
});

it("defaults to metric and persists the selected units across fresh reads", async () => {
  expect(await getMeasurementUnits()).toBe("metric");
  await setMeasurementUnits("imperial");
  await jest.isolateModulesAsync(async () => {
    const settings =
      jest.requireActual<typeof import("./measurement-units")>("./measurement-units");
    expect(await settings.getMeasurementUnits()).toBe("imperial");
  });
  await setMeasurementUnits("metric");
  expect(await getMeasurementUnits()).toBe("metric");
});

it("uses metric when a saved value is unrecognized", async () => {
  await setSetting("measurement-units", "unknown");
  expect(await getMeasurementUnits()).toBe("metric");
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
