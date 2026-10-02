import * as NativeUI from "@expo/ui";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Dimensions, Text } from "react-native";

import * as notes from "@/db/repos/notes";
import { insertSavedWork } from "@/db/repos/saved-works";
import { reportError } from "@/lib/observability";
import { MAX_NOTE_LENGTH } from "@/shared/collection/collection-limits";

import { CaptureCompletion } from "./capture-completion";

jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const mockNavigate = jest.fn();
const mockDismissAll = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mockNavigate, dismissAll: mockDismissAll }),
}));

const completion = {
  savedId: "saved-artwork",
  title: "Water Lilies",
  artist: "Claude Monet",
  date: "1906",
  medium: "Oil on canvas",
  previewPath: null,
  visit: {
    localId: "visit-1",
    venueName: "The Met",
    startedAt: Date.UTC(2026, 8, 18, 17, 42),
    visitedOn: "2026-09-18",
    timeZone: "America/New_York",
    outcome: "joined" as const,
  },
};

beforeAll(async () => {
  await insertSavedWork({
    localId: completion.savedId,
    title: completion.title,
    artist: "Claude Monet",
    savedAt: 1,
    cropPath: null,
  });
});
beforeEach(async () => {
  jest.clearAllMocks();
  await notes.setNote(completion.savedId, "");
});
afterEach(() => jest.restoreAllMocks());
const originalWindow = Dimensions.get("window");
afterEach(() => Dimensions.set({ window: originalWindow }));

it("keeps the result visible until saving has completed", async () => {
  const view = await render(
    <CaptureCompletion>
      <Text>Artwork result</Text>
    </CaptureCompletion>,
  );
  expect(screen.getByText("Artwork result")).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: "Saved to collection" })).toBeNull();
  await view.rerender(
    <CaptureCompletion completion={completion}>
      <Text>Artwork result</Text>
    </CaptureCompletion>,
  );
  expect(screen.getByRole("header", { name: "Saved to collection" })).toBeOnTheScreen();
  expect(screen.queryByText("Artwork result")).toBeNull();
  expect(screen.getByText("Artwork result", { includeHiddenElements: true })).toBeOnTheScreen();
});

it("edits the private note inline and saves it before opening the artwork", async () => {
  await notes.setNote(completion.savedId, "Original note");
  await render(<CaptureCompletion completion={completion} />);
  expect(screen.getByRole("header", { name: "Saved to collection" })).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByText("Claude Monet · 1906")).toBeOnTheScreen();
  expect(screen.getByText("Oil on canvas")).toBeOnTheScreen();
  expect(await screen.findByText("Added to today’s visit")).toBeOnTheScreen();
  expect(await screen.findByText("The Met · 0 artworks · Since 18 Sep 2026")).toBeOnTheScreen();
  const input = await screen.findByDisplayValue("Original note");
  await fireEvent.changeText(input, "Blue reflections on the water.");
  expect(mockNavigate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "View artwork" }));
  expect(await notes.getNote(completion.savedId)).toMatchObject({ text: "Blue reflections on the water." });
  expect(mockNavigate).toHaveBeenCalledWith({
    pathname: "/saved/[savedId]",
    params: { savedId: completion.savedId },
  });
});

it("saves the native field's latest text even before its change event reaches JavaScript", async () => {
  const { TextInput } = NativeUI;
  jest.spyOn(NativeUI, "TextInput").mockImplementation((props) => TextInput({ ...props, onChangeText: () => {} }));
  await render(<CaptureCompletion completion={completion} />);
  await fireEvent.changeText(await screen.findByLabelText("Private note"), "Keep the final character.");
  await fireEvent.press(screen.getByRole("button", { name: "View artwork" }));
  expect(await notes.getNote(completion.savedId)).toMatchObject({ text: "Keep the final character." });
});

it.each([false, true])("saves a Unicode note at the storage limit (delayed change event: %s)", async (delayed) => {
  if (delayed) {
    const { TextInput } = NativeUI;
    jest.spyOn(NativeUI, "TextInput").mockImplementation((props) => TextInput({ ...props, onChangeText: () => {} }));
  }
  await render(<CaptureCompletion completion={completion} />);
  const text = "a".repeat(MAX_NOTE_LENGTH - 2) + "🎨";
  await fireEvent.changeText(await screen.findByLabelText("Private note"), text + "🎨");
  await fireEvent.press(screen.getByRole("button", { name: "View artwork" }));
  expect(await notes.getNote(completion.savedId)).toMatchObject({ text });
  expect(mockNavigate).toHaveBeenCalledWith({
    pathname: "/saved/[savedId]",
    params: { savedId: completion.savedId },
  });
  expect(reportError).not.toHaveBeenCalled();
});

it("keeps the sheet and draft open when saving fails, then retries before scanning again", async () => {
  await render(<CaptureCompletion completion={completion} />);
  await fireEvent.changeText(await screen.findByLabelText("Private note"), "Keep this note");
  jest.spyOn(notes, "setNote").mockRejectedValueOnce(new Error("SQLITE_BUSY"));
  await fireEvent.press(screen.getByRole("button", { name: "Scan next artwork" }));
  expect(await screen.findByText("Couldn’t save. Your draft is still here.")).toBeOnTheScreen();
  expect(screen.getByDisplayValue("Keep this note")).toBeOnTheScreen();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "SQLITE_BUSY" }), "collection.note.save");
  await fireEvent.press(screen.getByRole("button", { name: "Scan next artwork" }));
  expect(await notes.getNote(completion.savedId)).toMatchObject({ text: "Keep this note" });
  expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/(scan)/scan");
});

it("waits for pending writes and preserves the latest note when closing", async () => {
  await render(<CaptureCompletion completion={completion} />);
  const input = await screen.findByLabelText("Private note");
  const write = notes.setNote;
  let finishWrite!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  jest.spyOn(notes, "setNote").mockImplementationOnce(async (...args) => {
    await pending;
    await write(...args);
  });
  await fireEvent.changeText(input, "First edit");
  await fireEvent(input, "blur");
  await fireEvent.changeText(input, "Latest edit");
  await fireEvent.press(screen.getByRole("button", { name: "Close confirmation" }));
  expect(screen.getByRole("header", { name: "Saved to collection" })).toBeOnTheScreen();
  await act(async () => finishWrite());
  await waitFor(() => expect(screen.queryByRole("header", { name: "Saved to collection" })).toBeNull());
  expect(await notes.getNote(completion.savedId)).toMatchObject({ text: "Latest edit" });
});

it("returns to the camera with the completed flow dismissed", async () => {
  await render(<CaptureCompletion completion={{ ...completion, visit: undefined }} />);
  expect(screen.getByText("Claude Monet · 1906")).toBeOnTheScreen();
  expect(screen.queryByText("Collection only")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Scan next artwork" }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/(scan)/scan");
});

it("keeps queued recognition available after saving a photo", async () => {
  const onViewResult = jest.fn();
  await render(<CaptureCompletion completion={completion} onViewResult={onViewResult} />);
  await fireEvent.press(screen.getByRole("button", { name: "View result" }));
  expect(onViewResult).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each([
  { action: "View artwork", calls: [[{ pathname: "/saved/[savedId]", params: { savedId: "saved-artwork" } }]] },
  { action: "Close confirmation", calls: [] },
])("finishes $action without reopening the confirmation on return", async ({ action, calls }) => {
  const content = (
    <CaptureCompletion completion={completion}>
      <Text>Artwork result</Text>
    </CaptureCompletion>
  );
  const view = await render(content);
  await fireEvent.press(screen.getByRole("button", { name: action }));
  expect(mockNavigate.mock.calls).toEqual(calls);
  expect(screen.queryByRole("header", { name: "Saved to collection" })).toBeNull();
  expect(screen.getByText("Artwork result")).toBeOnTheScreen();
  await view.rerender(content);
  expect(mockNavigate.mock.calls).toEqual(calls);
  expect(screen.queryByRole("header", { name: "Saved to collection" })).toBeNull();
});

it("scrolls every action with the confirmation at accessibility text sizes", async () => {
  Dimensions.set({ window: { ...originalWindow, fontScale: 1 } });
  await render(<CaptureCompletion completion={completion} />);
  const content = () => within(screen.getByLabelText("Saved to collection"));
  expect(content().queryByRole("button", { name: "Scan next artwork" })).toBeNull();
  await act(() => Dimensions.set({ window: { ...originalWindow, fontScale: 3.12 } }));
  expect(content().getByLabelText("Private note")).toBeOnTheScreen();
  for (const name of ["Scan next artwork", "View artwork", "Close confirmation"]) {
    expect(content().getByRole("button", { name })).toBeOnTheScreen();
  }
});
