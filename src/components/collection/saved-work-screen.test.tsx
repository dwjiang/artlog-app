import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { AccessibilityInfo, DeviceEventEmitter, ScrollView, Text, type HostInstance } from "react-native";

import { Gallery } from "@/constants/theme";
import {
  addArtworkPhoto,
  editArtworkPhoto,
  editEncounter,
  linkArtworkVisit,
  selectArtworkPhotos,
} from "@/db/repos/artwork-album";
import { getNote, setNote } from "@/db/repos/notes";
import { editSavedWork, insertSavedWork } from "@/db/repos/saved-works";
import { upsertVisit } from "@/db/repos/visits";

import type { Id } from "../../../convex/_generated/dataModel";
import { SavedWorkScreen } from "./saved-work-screen";

jest.mock("@/lib/audio/use-listening");
jest.mock("@/lib/audio/use-cached-narration-duration", () => ({
  useCachedNarrationDuration: () => undefined,
}));

let mockWall: Partial<ReturnType<typeof import("@/lib/wall/use-collection-wall").useCollectionWall>> = {
  pieces: [],
  signedIn: false,
};
jest.mock("@/lib/wall/use-collection-wall", () => ({
  useCollectionWall: () => mockWall,
}));
jest.mock("@/lib/collection/pending-removals", () => ({
  scheduleRemoval: jest.fn(),
}));
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockSetOptions = jest.fn();
const mockAuth = { isAuthenticated: true };
let client: ConvexReactClient;
const results = new Map<string, unknown>();
const listeners = new Set<() => void>();

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock("expo-router/react-navigation", () => ({
  ...jest.requireActual("expo-router/react-navigation"),
  useHeaderHeight: () => 116,
}));
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useConvexAuth: () => mockAuth,
}));

const enrichment = {
  docent: [
    {
      sentence: "Monet painted this pond at Giverny in 1916.",
      factIds: ["f1"],
    },
  ],
  factSheet: [
    {
      id: "f1",
      sourceUrl: "https://www.wikidata.org/wiki/Q1",
      sourceLabel: "Wikidata",
    },
  ],
  rightsStatus: "public_domain",
};

beforeAll(async () => {
  await insertSavedWork({
    localId: "lilies",
    savedAt: new Date(2026, 8, 8, 14).getTime(),
    title: "Water Lilies",
    artist: "Claude Monet",
    date: "1916",
    medium: "Oil on canvas",
    institution: "Musée d'Orsay",
    venueName: "Metropolitan Museum of Art",
    gallery: "Gallery 819",
    artworkId: "artwork-1" as Id<"artworks">,
    photoPath: "photos/lilies.jpg",
    cropPath: "crops/lilies.jpg",
  });
  await insertSavedWork({
    localId: "plain",
    savedAt: new Date(2026, 8, 9).getTime(),
    title: "Untitled",
    artist: "Unknown",
    cropPath: "crops/plain.jpg",
  });
  await insertSavedWork({
    localId: "synced",
    savedAt: new Date(2026, 8, 10).getTime(),
    title: "Haystacks",
    artist: "Claude Monet",
    cropPath: "crops/synced.jpg",
    syncedAt: 1,
  });
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event, listener) => DeviceEventEmitter.addListener(event, listener));
  mockWall = { pieces: [], signedIn: false };
  mockAuth.isAuthenticated = true;
  results.clear();
  listeners.clear();
  results.set("devices:me", {
    deviceId: "device-1",
    attested: false,
    trustWeight: 1,
  });
  results.set("artworks:enrichment", enrichment);
  client = new ConvexReactClient("https://test.convex.cloud", {
    logger: false,
  });
  jest.spyOn(client, "watchQuery").mockImplementation((...[query]: Parameters<ConvexReactClient["watchQuery"]>) => ({
    localQueryResult: () => {
      const result = results.get(getFunctionName(query));
      if (result instanceof Error) throw result;
      return result;
    },
    onUpdate: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    localQueryLogs: () => undefined,
    journal: () => undefined,
  }));
});
afterEach(async () => {
  await client.close();
  jest.restoreAllMocks();
});

function detail(savedId: string) {
  return (
    <ConvexProvider client={client}>
      <SavedWorkScreen savedId={savedId} />
    </ConvexProvider>
  );
}

it("opens in reading mode with explicit note editing", async () => {
  await render(detail("lilies"));
  expect(await screen.findByText(/Water Lilies/)).toBeOnTheScreen();
  for (const value of ["Claude Monet", "Oil on canvas"]) {
    expect(screen.getByText(new RegExp(value))).toBeOnTheScreen();
  }
  expect(screen.queryByDisplayValue("Water Lilies")).toBeNull();
  expect(screen.queryByDisplayValue("Claude Monet")).toBeNull();
  expect(screen.queryByLabelText("Notes")).toBeNull();
  expect(screen.getByRole("button", { name: "Add note" })).toBeOnTheScreen();
  expect(screen.getByLabelText("full photo 1 of Water Lilies").props.source).toEqual([
    { uri: "file:///documents/photos/lilies.jpg" },
  ]);
});

it("names the artwork in the bar only while its title is scrolled under the bar", async () => {
  // Native layout puts the title 400–440 pt down the scroll content.
  const nativeScroll = {} as HostInstance;
  jest.spyOn(ScrollView.prototype, "getNativeScrollRef").mockReturnValue(nativeScroll);
  jest.spyOn(Text.prototype, "measureLayout").mockImplementation((relativeTo, onSuccess) => {
    if (relativeTo === nativeScroll) onSuccess(20, 400, 362, 40);
  });
  await render(detail("lilies"));
  const title = await screen.findByRole("header", { name: "Water Lilies" });
  await fireEvent(title, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 362, height: 40 } } });
  const scrollTo = (y: number) => fireEvent.scroll(title, { nativeEvent: { contentOffset: { x: 0, y } } });
  await scrollTo(-116);
  await scrollTo(323);
  expect(mockSetOptions).toHaveBeenCalledWith({ title: "Water Lilies" });
  expect(mockSetOptions).not.toHaveBeenCalledWith({ headerTitleStyle: expect.anything() });
  await scrollTo(324);
  expect(mockSetOptions).toHaveBeenLastCalledWith({ headerTitleStyle: { color: Gallery.ink } });
  await scrollTo(-116);
  expect(mockSetOptions).toHaveBeenLastCalledWith({ headerTitleStyle: { color: "transparent" } });
  expect(mockSetOptions.mock.calls.filter(([options]) => options.headerTitleStyle)).toHaveLength(2);
});

it("keeps a full wall from taking another artwork", async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({
    placementId: `other-${index}`,
    saveLocalId: `other-${index}`,
    layout: {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      layer: index,
      frame: "gilt" as const,
    },
  }));
  const setLayoutDraft = jest.fn();
  mockWall = {
    signedIn: true,
    pieces: [],
    draft: { color: "#45524B", items },
    repository: { setLayoutDraft } as never,
    setError: jest.fn(),
  };
  await render(detail("synced"));
  const toggle = await screen.findByRole("switch", { name: "On your wall" });
  expect(toggle).toBeDisabled();
  expect(screen.getByText(/Your wall holds 100 artworks/)).toBeOnTheScreen();
  await fireEvent.press(toggle);
  expect(setLayoutDraft).not.toHaveBeenCalled();
});

it("hangs an available album photo after the original photo was removed", async () => {
  await insertSavedWork({
    localId: "replacement-work",
    title: "Study",
    artist: "",
    savedAt: 1,
    photoPath: "original.jpg",
    syncedAt: 1,
  });
  editArtworkPhoto("replacement-work", { deletedAt: 2 });
  addArtworkPhoto({
    localId: "replacement-photo",
    savedLocalId: "replacement-work",
    path: "replacement.jpg",
    kind: "full",
    capturedAt: 3,
  });
  const setLayoutDraft = jest.fn();
  const publishLayout = jest.fn().mockResolvedValue(undefined);
  mockWall = {
    signedIn: true,
    pieces: [],
    draft: { color: "#45524B", items: [] },
    repository: { setLayoutDraft, publishLayout } as never,
    setError: jest.fn(),
  };
  await render(detail("replacement-work"));
  await fireEvent.press(await screen.findByRole("switch", { name: "On your wall" }));
  expect(setLayoutDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      items: [
        expect.objectContaining({
          saveLocalId: "replacement-work",
          photoLocalId: "replacement-photo",
        }),
      ],
    }),
  );
  expect(publishLayout).toHaveBeenCalledTimes(1);
});

it("lets a signed-out owner hang an artwork before it syncs", async () => {
  await insertSavedWork({ localId: "unsynced-work", title: "Sketch", artist: "", savedAt: 1 });
  const setLayoutDraft = jest.fn();
  const publishLayout = jest.fn().mockResolvedValue(undefined);
  mockWall = {
    signedIn: false,
    pieces: [],
    draft: { color: "#45524B", items: [] },
    repository: { setLayoutDraft, publishLayout } as never,
    setError: jest.fn(),
  };
  await render(detail("unsynced-work"));
  const toggle = await screen.findByRole("switch", { name: "On your wall" });
  expect(toggle).toBeEnabled();
  expect(screen.queryByText(/Waiting to sync/)).toBeNull();
  await fireEvent.press(toggle);
  expect(setLayoutDraft).toHaveBeenCalledWith(
    expect.objectContaining({ items: [expect.objectContaining({ saveLocalId: "unsynced-work" })] }),
  );
  expect(publishLayout).toHaveBeenCalledTimes(1);
});

it("shows the photo on this device for a hung work rather than its published media", async () => {
  mockWall = {
    signedIn: true,
    pieces: [
      {
        localId: "lilies",
        layout: { x: 0.1, y: 0.2, width: 0.4, layer: 0, frame: "gilt" },
        artwork: {
          title: "Water Lilies",
          artist: "Claude Monet",
          media: {
            kind: "catalog",
            url: "https://cdn.example/lilies.jpg",
            sourceUrl: "https://cdn.example",
            rights: "public_domain",
            width: 4,
            height: 3,
          },
        },
      },
    ],
  };
  await render(detail("lilies"));
  expect((await screen.findByLabelText("full photo 1 of Water Lilies")).props.source).toEqual([
    { uri: "file:///documents/photos/lilies.jpg" },
  ]);
});

it("saves the note on blur", async () => {
  await render(detail("lilies"));
  await fireEvent.press(await screen.findByRole("button", { name: /(Add|Edit) note/ }));
  const input = await screen.findByLabelText("Notes");
  await waitFor(() => expect(input).toBeEnabled());
  await fireEvent.changeText(input, "Seen with Sam");
  await fireEvent(input, "blur");
  expect(await getNote("lilies")).toMatchObject({ text: "Seen with Sam" });
});

it("shows the saved note when the work is opened again", async () => {
  await setNote("lilies", "Seen with Sam and Ana");
  await render(detail("lilies"));
  expect(await screen.findByText("Seen with Sam and Ana")).toBeOnTheScreen();
});

it("renders the artwork enrichment when the backend has it", async () => {
  await render(detail("lilies"));
  expect(await screen.findByText("About this work")).toBeOnTheScreen();
  expect(screen.getByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  expect(screen.getByRole("link", { name: "Wikidata" })).toBeOnTheScreen();
  expect(client.watchQuery).toHaveBeenCalledWith(expect.anything(), { artworkId: "artwork-1" }, {});
  expect(screen.queryByText("Audio guide transcript")).toBeNull();
});

it("shows the audio guide transcript and its sources once the narration exists", async () => {
  results.set("artworks:enrichment", {
    rightsStatus: "public_domain",
    narrationFacts: [{ id: "f2", sourceUrl: "https://museum.example/lilies", sourceLabel: "Test Museum" }],
    narration: [
      { sentence: "Step back and let the pond fill your view.", factIds: [] },
      { sentence: "Monet grew these lilies in his garden at Giverny.", factIds: ["f2"] },
    ],
  });
  await render(detail("lilies"));
  expect(await screen.findByText("Audio guide transcript")).toBeOnTheScreen();
  expect(screen.getByText("Monet grew these lilies in his garden at Giverny.")).toBeOnTheScreen();
  expect(screen.getByRole("link", { name: "Test Museum" })).toBeOnTheScreen();
  expect(screen.queryByText("About this work")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Report transcript" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/report",
    params: { kind: "transcript", id: "artwork-1" },
  });
});

it("reports the description, and keeps each section and its heading while a new version is written", async () => {
  await render(detail("lilies"));
  await fireEvent.press(await screen.findByRole("button", { name: "Report description" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/report", params: { kind: "docent", id: "artwork-1" } });
  results.set("artworks:enrichment", {
    rightsStatus: "public_domain",
    docentWriting: true,
    narrationWriting: true,
  });
  await render(detail("lilies"));
  expect(await screen.findByText("About this work")).toBeOnTheScreen();
  expect(screen.getByText("Audio guide transcript")).toBeOnTheScreen();
  expect(screen.getByLabelText("Writing the transcript…")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /^Report/ })).toBeNull();
});

it("skips the enrichment query for a work saved without an artwork", async () => {
  await render(detail("plain"));
  expect(await screen.findByText("Untitled")).toBeOnTheScreen();
  expect(screen.getByText("No linked visits.")).toBeOnTheScreen();
  expect(screen.queryByText("About this work")).toBeNull();
  expect(client.watchQuery).not.toHaveBeenCalled();
});

it("shows the private description written for a work saved from confirmed details", async () => {
  await insertSavedWork({
    localId: "confirmed",
    savedAt: new Date(2026, 8, 10).getTime(),
    title: "Water Lilies",
    artist: "Claude Monet",
    scanId: "scan-7" as Id<"scans">,
  });
  results.set("scans:get", {
    confirmed: { source: "manual", fields: { title: "Water Lilies", artist: "Claude Monet" }, confirmedAt: 1 },
    docent: enrichment.docent,
    docentStatus: "ready",
    factSheet: enrichment.factSheet,
  });
  await render(detail("confirmed"));
  expect(await screen.findByText("About this work")).toBeOnTheScreen();
  expect(screen.getByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  expect(client.watchQuery).toHaveBeenCalledWith(expect.anything(), { scanId: "scan-7" }, {});
  await fireEvent.press(screen.getByRole("button", { name: "Report description" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/report", params: { kind: "scanDocent", id: "scan-7" } });
});

it.each([
  ["title", "The Starry Night"],
  ["artist", "Vincent van Gogh"],
  ["date", "1889"],
] as const)("hides the scan description after editing the saved %s", async (field, value) => {
  const localId = `edited-confirmed-${field}`;
  const fields = { title: "Water Lilies", artist: "Claude Monet", date: "1916", medium: "Oil on canvas" };
  await insertSavedWork({ localId, savedAt: 1, scanId: "scan-7" as Id<"scans">, ...fields });
  results.set("scans:get", {
    confirmed: { source: "manual", fields, confirmedAt: 1 },
    docent: enrichment.docent,
    docentStatus: "ready",
    factSheet: enrichment.factSheet,
  });
  const view = await render(detail(localId));
  expect(await screen.findByText(enrichment.docent[0].sentence)).toBeOnTheScreen();

  editSavedWork(localId, { ...fields, [field]: value });
  await view.unmount();
  await render(detail(localId));
  expect(await screen.findByText(new RegExp(value))).toBeOnTheScreen();
  expect(screen.queryByText(enrichment.docent[0].sentence)).toBeNull();
  expect(screen.queryByText("About this work")).toBeNull();
});

it("waits for authentication and device registration while showing the local snapshot", async () => {
  mockAuth.isAuthenticated = false;
  results.set("devices:me", null);
  const view = await render(detail("lilies"));
  expect(await screen.findByText(/Water Lilies/)).toBeOnTheScreen();
  expect(client.watchQuery).not.toHaveBeenCalled();

  mockAuth.isAuthenticated = true;
  await view.rerender(detail("lilies"));
  expect(screen.queryByText("About this work")).toBeNull();
  expect(jest.mocked(client.watchQuery).mock.calls.every(([query]) => getFunctionName(query) === "devices:me")).toBe(
    true,
  );

  await act(() => {
    results.set("devices:me", {
      deviceId: "device-1",
      attested: false,
      trustWeight: 1,
    });
    for (const listener of listeners) listener();
  });
  expect(await screen.findByText("About this work")).toBeOnTheScreen();
  mockAuth.isAuthenticated = false;
  await view.rerender(detail("lilies"));
  expect(screen.queryByText("About this work")).toBeNull();
  expect(screen.getByText(/Water Lilies/)).toBeOnTheScreen();
});

it.each(["devices:me", "artworks:enrichment"])(
  "keeps local detail usable and recovers after %s fails",
  async (query) => {
    const success = results.get(query);
    results.set(query, new ConvexError({ code: "unauthenticated" }));
    await render(detail("lilies"));
    expect(await screen.findByText(/Water Lilies/)).toBeOnTheScreen();
    expect(screen.getByLabelText("full photo 1 of Water Lilies")).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole("button", { name: /(Add|Edit) note/ }));
    const input = screen.getByLabelText("Notes");
    await waitFor(() => expect(input).toBeEnabled());
    await fireEvent.changeText(input, "Still editable without enrichment");
    await fireEvent(input, "blur");
    expect(await getNote("lilies")).toMatchObject({
      text: "Still editable without enrichment",
    });
    expect(screen.getByRole("button", { name: "Done editing note" })).toBeOnTheScreen();

    await act(() => {
      results.set(query, success);
      for (const listener of listeners) listener();
    });
    expect(await screen.findByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  },
);

it("keeps encounter photos and notes specific to the selected visit and opens other encounters on the same artwork", async () => {
  const first = "00000000-0000-4000-8000-000000000071";
  const second = "00000000-0000-4000-8000-000000000072";
  for (const [localId, venueName] of [
    [first, "Orsay"],
    [second, "Met"],
  ]) {
    await upsertVisit({
      localId,
      venueId: localId as Id<"museums">,
      venueName,
      visitedOn: "2026-09-01",
      timeZone: "UTC",
    });
    linkArtworkVisit("lilies", localId);
  }
  editEncounter("lilies", first, { note: "First encounter thought" });
  editEncounter("lilies", second, { note: "Second encounter thought" });
  addArtworkPhoto({
    localId: "visit-one-photo",
    savedLocalId: "lilies",
    visitLocalId: first,
    kind: "full",
    capturedAt: 1,
    path: "first-visit.jpg",
  });
  const view = await render(
    <ConvexProvider client={client}>
      <SavedWorkScreen savedId="lilies" visitId={first} />
    </ConvexProvider>,
  );
  expect(await screen.findByText("First encounter thought")).toBeOnTheScreen();
  expect(screen.queryByText("Second encounter thought")).toBeNull();
  expect(screen.getByRole("button", { name: /View Water Lilies at Orsay/ })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: /View Water Lilies at Met/ }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: second },
  });
  await view.rerender(
    <ConvexProvider client={client}>
      <SavedWorkScreen savedId="lilies" visitId={second} />
    </ConvexProvider>,
  );
  expect(await screen.findByText("Second encounter thought")).toBeOnTheScreen();
  expect(screen.queryByText("First encounter thought")).toBeNull();
});

it("opens crop adjustment from the saved artwork while keeping its album photo available", async () => {
  await render(detail("lilies"));
  await fireEvent.press(await screen.findByRole("button", { name: "Adjust crop for full photo 1" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/adjust-crop",
    params: { savedId: "lilies", photoId: selectArtworkPhotos("lilies").all()[0].localId },
  });
  expect(screen.getByLabelText("full photo 1 of Water Lilies")).toBeOnTheScreen();
});

it("offers visit linking from its section without a large empty-state card", async () => {
  await render(detail("plain"));
  expect(await screen.findByRole("header", { name: "Visits" })).toBeOnTheScreen();
  expect(screen.getByText("No linked visits.")).toBeOnTheScreen();
  expect(
    screen.queryByText("This artwork was saved without a visit. Link one to remember where you saw it."),
  ).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Link visit" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/link-artwork", params: { savedId: "plain" } });
});
