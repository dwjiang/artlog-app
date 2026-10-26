import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { Linking, Text } from "react-native";

import { APP_STORE_URL } from "@/lib/app-update";
import { reportError } from "@/lib/observability";

import { AppUpdateGate } from "./app-update-gate";

let mockCompatibility = { loading: false, updateRequired: true };
jest.mock("@/lib/use-app-compatibility", () => ({ useAppCompatibility: () => mockCompatibility }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

const started = jest.fn();
const stopped = jest.fn();
function AppContent() {
  useEffect(() => {
    started();
    return stopped;
  }, []);
  return <Text>Collection</Text>;
}
const gate = () => (
  <AppUpdateGate>
    <AppContent />
  </AppUpdateGate>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockCompatibility = { loading: false, updateRequired: true };
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it("holds navigation and background work until startup is checked", async () => {
  mockCompatibility = { loading: true, updateRequired: false };
  await render(gate());
  expect(screen.getByRole("progressbar", { name: "Opening Artlog" })).toBeOnTheScreen();
  expect(started).not.toHaveBeenCalled();
  mockCompatibility = { loading: false, updateRequired: false };
  await screen.rerender(gate());
  expect(started).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Collection")).toBeOnTheScreen();
  mockCompatibility = { loading: false, updateRequired: true };
  await screen.rerender(gate());
  expect(stopped).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Collection")).toBeNull();
});

it("shows the approved screen with one action and opens the store", async () => {
  await render(gate());
  expect(screen.getByRole("header", { name: "Update the app to continue." })).toBeOnTheScreen();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Update Artlog" }));
  expect(Linking.openURL).toHaveBeenCalledWith(APP_STORE_URL);
  expect(started).not.toHaveBeenCalled();
});

it("prevents duplicate opening and provides a retry after failure", async () => {
  let reject!: (error: Error) => void;
  jest.mocked(Linking.openURL).mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      }),
  );
  await render(gate());
  await fireEvent.press(screen.getByRole("button", { name: "Update Artlog" }));
  await fireEvent.press(screen.getByRole("button", { name: "Update Artlog", disabled: true }));
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  await act(() => reject(new Error("No handler")));
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t open the App Store. Try again.");
  expect(reportError).toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Update Artlog", disabled: false }));
  expect(Linking.openURL).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});
