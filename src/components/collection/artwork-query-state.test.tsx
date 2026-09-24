import { fireEvent, render, screen } from "@testing-library/react-native";
import { SavedWorkScreen } from "./saved-work-screen";
import { PhotoEditorScreen } from "./photo-editor-screen";
import { IdentifyArtworkScreen } from "./identify-artwork-screen";
import { editSavedWork } from "@/db/repos/saved-works";

let mockQuery: { data: unknown[]; updatedAt?: Date; error?: Error };
let mockOwner = "device:guest";
const mockBack = jest.fn();
jest.mock("@/lib/audio/use-cached-narration-duration", () => ({
  useCachedNarrationDuration: () => undefined,
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
  router: { back: mockBack },
  useLocalSearchParams: () => ({ savedId: "artwork", photoId: "photo" }),
}));
jest.mock("drizzle-orm/expo-sqlite", () => ({ useLiveQuery: () => mockQuery }));
jest.mock("@/lib/account/owner-store", () => ({
  useLocalOwner: () => mockOwner,
  captureOwner: jest.fn(),
}));
jest.mock("@/db/repos/saved-works", () => ({
  selectSavedWork: jest.fn(),
  listSavedWorks: jest.fn(),
  editSavedWork: jest.fn(),
}));
jest.mock("@/db/repos/artwork-album", () => ({
  selectArtworkPhotos: jest.fn(),
  editArtworkPhoto: jest.fn(),
}));
jest.mock("@/db/repos/visits", () => ({ listVisits: jest.fn() }));
jest.mock("@/lib/wall/use-collection-wall", () => ({
  useCollectionWall: jest.fn(),
}));
jest.mock("@/lib/account/collection-sync", () => ({
  flushCollectionMedia: jest.fn(),
}));
jest.mock("@/lib/collection/pending-removals", () => ({
  scheduleRemoval: jest.fn(),
}));
jest.mock("./note-editor", () => ({ NoteEditor: () => null }));
jest.mock("./artwork-album", () => ({ ArtworkAlbum: () => null }));
jest.mock("./artwork-enrichment", () => ({ ArtworkEnrichment: () => null }));
jest.mock("./artwork-encounters", () => ({
  ArtworkEncounterList: () => null,
  ArtworkVisitNote: () => null,
  useArtworkEncounters: () => ({ encounters: [], loading: false }),
}));

beforeEach(() => {
  mockQuery = { data: [] };
  mockOwner = "device:guest";
  mockBack.mockClear();
});

it.each([
  ["saved artwork", () => <SavedWorkScreen savedId="artwork" />, "Artwork"],
  ["photo details", () => <PhotoEditorScreen />, "Photo"],
  ["identify artwork", () => <IdentifyArtworkScreen />, "Artwork"],
] as const)(
  "%s distinguishes an unfinished read, a missing item and a recoverable read failure",
  async (_name, content, item) => {
    const view = await render(content());
    expect(screen.getByLabelText(`Opening ${item.toLowerCase()}…`)).toBeOnTheScreen();
    expect(screen.queryByText(`${item} unavailable.`)).toBeNull();
    mockQuery = { data: [], updatedAt: new Date() };
    await view.rerender(content());
    expect(screen.getByText(`${item} unavailable.`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    mockQuery = { data: [], error: new Error("Read failed") };
    await view.rerender(content());
    expect(screen.getByText(`Couldn’t load this ${item.toLowerCase()}.`)).toBeOnTheScreen();
    mockQuery = { data: [] };
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByLabelText(`Opening ${item.toLowerCase()}…`)).toBeOnTheScreen();
  },
);

it("does not show a photo from a stale account or a different artwork", async () => {
  mockQuery = {
    data: [
      {
        localId: "photo",
        savedLocalId: "different-artwork",
        owner: "account:previous",
        deletedAt: null,
      },
    ],
    updatedAt: new Date(),
  };
  mockOwner = "account:current";
  await render(<PhotoEditorScreen />);
  expect(screen.getByText("Photo unavailable.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Save photo details" })).toBeNull();
});

it("keeps manual identification edits when saving fails", async () => {
  mockQuery = {
    data: [
      {
        localId: "artwork",
        owner: "device:guest",
        deletedAt: null,
        title: "Unidentified artwork",
        artist: "",
        date: null,
        medium: null,
      },
    ],
    updatedAt: new Date(),
  };
  jest.mocked(editSavedWork).mockImplementationOnce(() => {
    throw new Error("Disk write failed");
  });
  await render(<IdentifyArtworkScreen />);
  await fireEvent.changeText(screen.getByLabelText("Title"), "Water Lilies");
  await fireEvent.press(screen.getByRole("button", { name: "Save details" }));
  expect(screen.getByDisplayValue("Water Lilies")).toBeOnTheScreen();
  expect(
    screen.getByText("Your artwork details could not be saved. Your edits are still here. Try again."),
  ).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
});
