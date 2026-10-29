import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { createRef } from "react";

import { DemoPhotoSheet, UPLOAD_REFRESH_MS, type DemoPhotoSheetHandle } from "./demo-photo-sheet";

let mockPhotos = { gallery: ["file:///g/roses.jpg", "file:///g/bedroom.jpg"], uploads: [] as string[] };
const mockCopyForImport = jest.fn();

jest.mock("@/lib/capture/demo-photos", () => ({
  listDemoPhotos: () => mockPhotos,
  copyForImport: (uri: string) => mockCopyForImport(uri),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  mockPhotos = { gallery: ["file:///g/roses.jpg", "file:///g/bedroom.jpg"], uploads: [] };
  mockCopyForImport.mockReset().mockImplementation(async (uri: string) => ({ uri: `${uri}.copy` }));
});
afterEach(() => jest.useRealTimers());

async function open() {
  const sheet = createRef<DemoPhotoSheetHandle>();
  await render(<DemoPhotoSheet ref={sheet} />);
  let picked: Promise<unknown> | undefined;
  await act(async () => {
    picked = sheet.current!.pick();
  });
  return { picked: picked! };
}

it("offers the gallery photos and says where uploads come from", async () => {
  await open();
  expect(screen.getByRole("button", { name: "Gallery photo 2" })).toBeOnTheScreen();
  expect(screen.getByText("Photos you upload on the demo page appear here.")).toBeOnTheScreen();
});

it("shows a photo uploaded while the sheet is open and imports a copy of it", async () => {
  const { picked } = await open();
  mockPhotos = { ...mockPhotos, uploads: ["file:///u/1761500000000-1.jpg"] };
  await act(() => jest.advanceTimersByTime(UPLOAD_REFRESH_MS));

  await fireEvent.press(screen.getByRole("button", { name: "Your photo 1" }));
  await expect(picked).resolves.toEqual({ uri: "file:///u/1761500000000-1.jpg.copy" });
  expect(screen.queryByText("Choose a photo")).toBeNull();
});

it("picks nothing when closed", async () => {
  const { picked } = await open();
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  await expect(picked).resolves.toBeNull();
  expect(mockCopyForImport).not.toHaveBeenCalled();
});
