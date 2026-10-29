import { act, fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import { Alert, Text, type AlertButton } from "react-native";

import { getSavedWork, insertSavedWork } from "@/db/repos/saved-works";

import { IdentifyArtworkScreen } from "./identify-artwork-screen";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/convex-client", () => ({ convex: { mutation: jest.fn() } }));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
// The page's own Stack.Toolbar renders inline; the test layout keeps the real stack from expo-router/stack.
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
}));

const open = async () => {
  const view = await renderRouter(
    { _layout: () => <Stack />, index: () => <Text>Water Lilies</Text>, "identify-artwork": IdentifyArtworkScreen },
    { initialUrl: "/" },
  );
  await act(() => router.push({ pathname: "/identify-artwork", params: { savedId: "lilies" } }));
  await screen.findByLabelText("Title");
  return view;
};
const alertButton = (text: string) =>
  (alert.mock.lastCall as [string, undefined, AlertButton[]])[2].find((button) => button.text === text)!;

let alert: jest.SpyInstance;
beforeAll(async () => {
  await insertSavedWork({
    localId: "lilies",
    savedAt: 1,
    title: "Water Lilies",
    artist: "Claude Monet",
    photoPath: "photos/lilies.jpg",
  });
});
beforeEach(() => {
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("goes back without asking while the details are unchanged", async () => {
  const view = await open();
  await act(() => router.back());
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
});

it("asks before going back with typed details, and discarding keeps the saved ones", async () => {
  const view = await open();
  await fireEvent.changeText(screen.getByLabelText("Date"), "1906");
  await act(() => router.back());
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  await act(() => alertButton("Keep Editing").onPress?.());
  expect(view.getPathname()).toBe("/identify-artwork");
  expect(screen.getByLabelText("Date")).toHaveDisplayValue("1906");

  await act(() => router.back());
  await act(() => alertButton("Discard Edits").onPress?.());
  expect(view.getPathname()).toBe("/");
  expect((await getSavedWork("lilies"))?.date).toBeNull();
});

it("saves the details from the bar and goes back without asking", async () => {
  const view = await open();
  await fireEvent.changeText(screen.getByLabelText("Medium"), "Oil on canvas");
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
  expect((await getSavedWork("lilies"))?.medium).toBe("Oil on canvas");
});
