import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { GroupedList } from "@/components/grouped-list";
import * as settings from "@/db/repos/settings";
import { getMeasurementUnits } from "@/lib/settings/measurement-units";
import { GeneralPreference } from "./general-preference";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));

beforeEach(async () => {
  jest.restoreAllMocks();
  await settings.removeSetting("measurement-units");
});

it("selects and remembers either measurement system when General is reopened", async () => {
  const view = await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  expect(
    await screen.findByRole("button", { name: "Metric", selected: true }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Imperial" }));
  expect(
    screen.getByRole("button", { name: "Imperial", selected: true }),
  ).toBeOnTheScreen();
  expect(await getMeasurementUnits()).toBe("imperial");
  await view.unmount();
  await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  expect(
    await screen.findByRole("button", { name: "Imperial", selected: true }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Metric" }));
  expect(
    screen.getByRole("button", { name: "Metric", selected: true }),
  ).toBeOnTheScreen();
  expect(await getMeasurementUnits()).toBe("metric");
});

it("keeps the saved selection on a failed write and allows retry", async () => {
  await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  await screen.findByRole("button", { name: "Metric", selected: true });
  jest
    .spyOn(settings, "setSetting")
    .mockRejectedValueOnce(new Error("Disk full"));
  await fireEvent.press(screen.getByRole("button", { name: "Imperial" }));
  expect(
    screen.getByText("The preference could not be saved. Try again."),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Metric", selected: true }),
  ).toBeOnTheScreen();
  expect(await getMeasurementUnits()).toBe("metric");
  await fireEvent.press(screen.getByRole("button", { name: "Imperial" }));
  expect(
    screen.getByRole("button", { name: "Imperial", selected: true }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByText("The preference could not be saved. Try again."),
  ).toBeNull();
});

it("allows choosing units after a failed read without claiming a saved selection", async () => {
  jest
    .spyOn(settings, "getSetting")
    .mockRejectedValueOnce(new Error("Read failed"));
  await render(
    <GroupedList>
      <GeneralPreference />
    </GroupedList>,
  );
  expect(
    await screen.findByText(
      "The preference could not load. Choose your units to try again.",
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("button", { selected: true })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Imperial" }));
  expect(
    screen.getByRole("button", { name: "Imperial", selected: true }),
  ).toBeOnTheScreen();
});

it("blocks duplicate changes while a save is pending", async () => {
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
  expect(screen.getByText("Saving measurement units…")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Metric" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Imperial" }));
  expect(write).toHaveBeenCalledTimes(1);
  await act(() => finish());
  expect(screen.getByRole("button", { name: "Imperial" })).toBeEnabled();
});
