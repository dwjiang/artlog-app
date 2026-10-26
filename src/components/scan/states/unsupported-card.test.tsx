import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { APP_STORE_URL } from "@/lib/app-update";

import { UPDATE_BUTTON, UPDATE_LINE, UPDATE_TITLE, UnsupportedCard } from "./unsupported-card";

const handlers = { onSave: jest.fn(), onViewSaved: jest.fn() };
let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => openURL.mockRestore());

it("asks for the update, opens Artlog's store listing, and saves anyway with a title", async () => {
  await render(<UnsupportedCard saving={false} {...handlers} />);
  expect(screen.getByText(UPDATE_TITLE)).toBeOnTheScreen();
  expect(screen.getByText(UPDATE_LINE)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: UPDATE_BUTTON }));
  expect(openURL).toHaveBeenCalledWith(APP_STORE_URL);
  expect(
    screen.getByRole("button", {
      name: /^Save (to collection|photo for later)$/,
    }),
  ).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Add details (optional)" }));
  await fireEvent.changeText(screen.getByLabelText("Title"), "Blue room");
  await fireEvent.press(
    screen.getByRole("button", {
      name: /^Save (to collection|photo for later)$/,
    }),
  );
  expect(handlers.onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Blue room" }));
});

it("says so when the store cannot be opened", async () => {
  openURL.mockRejectedValue(new Error("No handler"));
  await render(<UnsupportedCard saving={false} {...handlers} />);
  await fireEvent.press(screen.getByRole("button", { name: UPDATE_BUTTON }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t open the App Store. Try again.");
});
