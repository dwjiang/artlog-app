import { fireEvent, render, screen } from "@testing-library/react-native";

import type { SavedWork } from "@/db/schema";

import { WallToolbar } from "./wall-toolbar";

jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));

const work = (localId: string, cropPath: string | null) => ({ localId, cropPath, title: localId }) as SavedWork;
const works = [work("a", "crops/a.jpg"), work("b", null), work("c", "crops/c.jpg"), work("d", "crops/d.jpg")];

it("names All artworks with the saved count and opens it", async () => {
  const onAllArtworks = jest.fn();
  await render(
    <WallToolbar works={works} onEdit={jest.fn()} onAllArtworks={onAllArtworks} disabled={false} refreshing={false} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "All artworks, 4 artworks" }));
  expect(onAllArtworks).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Edit wall" })).toBeEnabled();
});

it("hides Edit wall until the wall loads and counts a single artwork", async () => {
  await render(<WallToolbar works={[work("a", null)]} onAllArtworks={jest.fn()} disabled={false} refreshing={false} />);
  expect(screen.queryByRole("button", { name: "Edit wall" })).toBeNull();
  expect(screen.getByRole("button", { name: "All artworks, 1 artwork" })).toBeOnTheScreen();
});

it("blocks both buttons while the wall is busy and announces a refresh", async () => {
  const onEdit = jest.fn();
  const onAllArtworks = jest.fn();
  await render(<WallToolbar works={works} onEdit={onEdit} onAllArtworks={onAllArtworks} disabled refreshing />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall", disabled: true }));
  await fireEvent.press(screen.getByRole("button", { name: "All artworks, 4 artworks", disabled: true }));
  expect(onEdit).not.toHaveBeenCalled();
  expect(onAllArtworks).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Refreshing wall")).toBeOnTheScreen();
});
