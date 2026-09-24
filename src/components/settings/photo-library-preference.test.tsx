import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { getPermissionsAsync } from "expo-media-library";

import * as settings from "@/db/repos/settings";
import { getSaveToPhotos } from "@/lib/settings/save-to-photos";
import { PhotoLibraryPreference } from "./photo-library-preference";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));

beforeEach(() => settings.removeSetting("save-originals-to-photos"));
afterEach(() => jest.restoreAllMocks());

it("saves originals to Photos by default and remembers turning it off", async () => {
  await render(<PhotoLibraryPreference />);
  const toggle = await screen.findByRole("switch", { name: "Save to Photos" });
  expect(toggle).toBeChecked();
  expect(screen.getByText(/full-size photos you took with Artlog go to your photo library/)).toBeOnTheScreen();

  await fireEvent.press(toggle);

  expect(screen.getByRole("switch", { name: "Save to Photos" })).not.toBeChecked();
  await waitFor(async () => expect(await getSaveToPhotos()).toBe(false));
});

it("explains where to allow Photos access after it was declined", async () => {
  jest.mocked(getPermissionsAsync).mockResolvedValueOnce({ status: "denied", granted: false } as never);

  await render(<PhotoLibraryPreference />);

  expect(await screen.findByText(/Allow it in the Settings app under Privacy & Security > Photos/)).toBeOnTheScreen();
});
