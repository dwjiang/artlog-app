import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";

import { GroupedList } from "@/components/grouped-list";
import * as settings from "@/db/repos/settings";
import { getMeasurementUnits } from "@/lib/settings/measurement-units";
import { dismissToast, useToast } from "@/lib/ui/toast";

import { GeneralPreference } from "./general-preference";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

let mockMeasurementSystem: "metric" | "us" = "metric";
jest.mock("expo-localization", () => ({
  getLocales: () => [{ measurementSystem: mockMeasurementSystem }],
}));

beforeEach(async () => {
  jest.restoreAllMocks();
  mockMeasurementSystem = "metric";
  dismissToast();
  await settings.removeSetting("measurement-units");
});

it("selects and remembers either measurement system when General is reopened", async () => {
  const view = await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  expect(await screen.findByRole("button", { name: "Metric", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Imperial" }));
  expect(screen.getByRole("button", { name: "Imperial", selected: true })).toBeOnTheScreen();
  expect(await getMeasurementUnits()).toBe("imperial");
  await view.unmount();
  await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  expect(await screen.findByRole("button", { name: "Imperial", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Metric" }));
  expect(screen.getByRole("button", { name: "Metric", selected: true })).toBeOnTheScreen();
  expect(await getMeasurementUnits()).toBe("metric");
});

it.each([
  ["metric", "us", "Metric", "metric"],
  ["us", "metric", "Imperial", "imperial"],
] as const)(
  "persists a tap on the %s device default across system changes",
  async (system, nextSystem, label, units) => {
    mockMeasurementSystem = system;
    const view = await render(
      <GroupedList>
        <GeneralPreference />
      </GroupedList>,
    );
    await fireEvent.press(await screen.findByRole("button", { name: label, selected: true }));
    await view.unmount();
    mockMeasurementSystem = nextSystem;
    expect(await getMeasurementUnits()).toBe(units);
    await render(
      <GroupedList>
        <GeneralPreference />
      </GroupedList>,
    );
    expect(await screen.findByRole("button", { name: label, selected: true })).toBeOnTheScreen();
  },
);

it.each(["Metric", "Imperial"])("keeps the selection on a failed write of %s and allows retry", async (label) => {
  const toast = await renderHook(useToast);
  await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  await screen.findByRole("button", { name: "Metric", selected: true });
  jest.spyOn(settings, "setSetting").mockRejectedValueOnce(new Error("Disk full"));
  await fireEvent.press(screen.getByRole("button", { name: label }));
  expect(toast.result.current).toMatchObject({
    message: "Couldn’t save measurement units.",
    action: { label: "Retry" },
  });
  expect(screen.getByRole("button", { name: "Metric", selected: true })).toBeOnTheScreen();
  expect(await getMeasurementUnits()).toBe("metric");
  await act(() => toast.result.current?.action?.onPress());
  await waitFor(async () => expect(await settings.getSetting("measurement-units")).toBe(label.toLowerCase()));
  expect(screen.getByRole("button", { name: label, selected: true })).toBeOnTheScreen();
});

it("allows choosing units after a failed read without claiming a saved selection", async () => {
  jest.spyOn(settings, "getSetting").mockRejectedValueOnce(new Error("Read failed"));
  await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  expect(await screen.findByText("The preference could not load. Choose your units to try again.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { selected: true })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Imperial" }));
  expect(screen.getByRole("button", { name: "Imperial", selected: true })).toBeOnTheScreen();
});

it("moves the checkmark on tap without a saving state and ignores taps until the write lands", async () => {
  await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  await screen.findByRole("button", { name: "Metric", selected: true });
  let finish!: () => void;
  const write = jest.spyOn(settings, "setSetting").mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Imperial" }));
  expect(screen.getByRole("button", { name: "Imperial", selected: true })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Metric" })).toBeEnabled();
  expect(screen.getByText("Used for nearby museum distances. Saved on this iPhone.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Metric" }));
  expect(write).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Imperial", selected: true })).toBeOnTheScreen();
  await act(() => finish());
  expect(screen.getByRole("button", { name: "Imperial", selected: true })).toBeOnTheScreen();
});
