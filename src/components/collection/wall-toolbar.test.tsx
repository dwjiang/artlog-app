import { fireEvent, render, screen } from "@testing-library/react-native";

import { CompactBarMaxTextScale } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";

import { WallToolbar } from "./wall-toolbar";

jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));

const work = (localId: string, cropPath: string | null) => ({ localId, cropPath, title: localId }) as SavedWork;
const works = [work("a", "crops/a.jpg"), work("b", null), work("c", "crops/c.jpg"), work("d", "crops/d.jpg")];

it("names All Artworks with the saved count and opens it", async () => {
  const onAllArtworks = jest.fn();
  await render(
    <WallToolbar works={works} onEdit={jest.fn()} onAllArtworks={onAllArtworks} disabled={false} refreshing={false} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "All Artworks, 4 artworks" }));
  expect(onAllArtworks).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Edit Wall" })).toBeEnabled();
});

it("hides Edit Wall until the wall loads and counts a single artwork", async () => {
  await render(<WallToolbar works={[work("a", null)]} onAllArtworks={jest.fn()} disabled={false} refreshing={false} />);
  expect(screen.queryByRole("button", { name: "Edit Wall" })).toBeNull();
  expect(screen.getByRole("button", { name: "All Artworks, 1 artwork" })).toBeOnTheScreen();
});

it("blocks both buttons while the wall is busy and announces a refresh", async () => {
  const onEdit = jest.fn();
  const onAllArtworks = jest.fn();
  await render(<WallToolbar works={works} onEdit={onEdit} onAllArtworks={onAllArtworks} disabled refreshing />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit Wall", disabled: true }));
  await fireEvent.press(screen.getByRole("button", { name: "All Artworks, 4 artworks", disabled: true }));
  expect(onEdit).not.toHaveBeenCalled();
  expect(onAllArtworks).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Refreshing wall")).toBeOnTheScreen();
});

it("stops its labels growing at accessibility sizes, like a toolbar's, so a word never breaks across lines", async () => {
  await render(
    <WallToolbar works={works} onEdit={jest.fn()} onAllArtworks={jest.fn()} disabled={false} refreshing={false} />,
  );
  for (const label of ["Edit Wall", "All Artworks", "4"]) {
    expect(screen.getByText(label).props.maxFontSizeMultiplier).toBe(CompactBarMaxTextScale);
  }
});
