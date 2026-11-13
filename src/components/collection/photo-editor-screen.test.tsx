import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import {
  Alert,
  DeviceEventEmitter,
  Keyboard,
  ScrollView,
  Text,
  View,
  type AlertButton,
  type HostInstance,
  type ViewInstance,
} from "react-native";

import { editArtworkPhoto, selectArtworkPhotos } from "@/db/repos/artwork-album";
import { insertSavedWork } from "@/db/repos/saved-works";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

import { PhotoEditorScreen } from "./photo-editor-screen";

jest.mock("@/db/repos/artwork-album", () => {
  const actual = jest.requireActual<typeof import("@/db/repos/artwork-album")>("@/db/repos/artwork-album");
  return { ...actual, editArtworkPhoto: jest.fn(actual.editArtworkPhoto) };
});
jest.mock("@/lib/observability", () => ({
  ...jest.requireActual("@/lib/observability"),
  reportError: jest.fn(),
}));
jest.mock("@/lib/ui/toast", () => ({
  ...jest.requireActual("@/lib/ui/toast"),
  showErrorToast: jest.fn(),
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
// The page's own Stack.Toolbar renders inline; the test layout keeps the real stack from expo-router/stack.
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
}));

const caption = () => selectArtworkPhotos("lilies").get()?.caption;
const open = async () => {
  const view = await renderRouter(
    { _layout: () => <Stack />, index: () => <Text>Water Lilies</Text>, "photo-details": PhotoEditorScreen },
    { initialUrl: "/" },
  );
  await act(() => router.push({ pathname: "/photo-details", params: { savedId: "lilies", photoId: "lilies" } }));
  await screen.findByLabelText("Photo caption");
  return view;
};

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

it("asks before going back with a typed caption, and discarding keeps the saved caption", async () => {
  const view = await open();
  await fireEvent.changeText(screen.getByLabelText("Photo caption"), "Seen at dusk");
  await act(() => router.back());
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  expect(view.getPathname()).toBe("/photo-details");
  const discard = (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.text === "Discard Edits");
  await act(() => discard?.onPress?.());
  expect(view.getPathname()).toBe("/");
  expect(caption()).toBeNull();
});

it("saves the caption from the bar and goes back without asking", async () => {
  const view = await open();
  await fireEvent.changeText(screen.getByLabelText("Photo caption"), "Seen at dusk");
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
  expect(caption()).toBe("Seen at dusk");
});

it("lets the caption finish editing with Done in the bar or a drag, and takes taps while the keyboard shows", async () => {
  const dismiss = jest.spyOn(Keyboard, "dismiss");
  await open();
  const [page] = screen.root!.queryAll((node) => node.type === "RCTScrollView");
  expect(page.props).toMatchObject({
    keyboardDismissMode: "interactive",
    keyboardShouldPersistTaps: "handled",
  });
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  await fireEvent(screen.getByLabelText("Photo caption"), "focus");
  // Done leads Save in the bar, so a caption grown past the screen never scrolls it out of reach.
  const done = screen.getByRole("button", { name: "Done" });
  expect(within(page).queryByRole("button", { name: "Done" })).toBeNull();
  expect(done.parent?.children.indexOf(done)).toBe(
    done.parent!.children.indexOf(screen.getByRole("button", { name: "Save" })) - 1,
  );
  await fireEvent.press(done);
  expect(dismiss).toHaveBeenCalled();
  await fireEvent(screen.getByLabelText("Photo caption"), "blur");
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  dismiss.mockRestore();
});

it("scrolls a caption dragged behind the keyboard back above it as the person types", async () => {
  // Native layout puts the caption's label and field 420–580 pt down the content; the keyboard's top is at 540.
  const nativeScroll = {} as HostInstance;
  jest.spyOn(ScrollView.prototype, "getNativeScrollRef").mockReturnValue(nativeScroll);
  const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
  jest.spyOn(View.prototype as ViewInstance, "measureLayout").mockImplementation((relativeTo, onSuccess) => {
    if (relativeTo === nativeScroll) onSuccess(20, 420, 362, 160);
  });
  await open();
  const field = screen.getByLabelText("Photo caption");
  await fireEvent(field, "focus");
  const keyboard = { screenX: 0, screenY: 540, width: 402, height: 334 };
  await act(() => DeviceEventEmitter.emit("keyboardDidShow", { endCoordinates: keyboard }));
  await fireEvent.scroll(field, { nativeEvent: { contentOffset: { x: 0, y: -168 } } });
  scrollTo.mockClear();
  await fireEvent(field, "change", { nativeEvent: { text: "Sunlit room", selection: { start: 11, end: 11 } } });
  expect(scrollTo).toHaveBeenCalledWith({ y: 52, animated: true });
  await act(() => DeviceEventEmitter.emit("keyboardDidHide", { endCoordinates: keyboard }));
});

it.each(["save", "delete"] as const)(
  "reports only the photo update action and retry state for %s failures",
  async (action) => {
    jest.mocked(reportError).mockClear();
    jest.mocked(showErrorToast).mockClear();
    const failure = new Error("Error code 14: unable to open database file");
    jest
      .mocked(editArtworkPhoto)
      .mockImplementationOnce(() => {
        throw failure;
      })
      .mockImplementationOnce(() => {
        throw failure;
      });
    const view = await open();

    if (action === "save") {
      await fireEvent.changeText(screen.getByLabelText("Photo caption"), "Private caption");
      await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    } else {
      await fireEvent.press(screen.getByRole("button", { name: "Delete photo" }));
      const confirm = (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.text === "Delete Photo");
      expect(confirm?.onPress).toBeDefined();
      await act(() => confirm?.onPress?.());
    }

    const retry = jest.mocked(showErrorToast).mock.calls[0]?.[1];
    expect(retry).toEqual(expect.any(Function));
    await act(() => retry?.());
    expect(view.getPathname()).toBe("/photo-details");
    expect(jest.mocked(reportError).mock.calls).toEqual([
      [failure, "collection.photo.update", { data: { action, retry: false } }],
      [failure, "collection.photo.update", { data: { action, retry: true } }],
    ]);
  },
);
