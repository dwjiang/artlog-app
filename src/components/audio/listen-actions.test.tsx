import { fireEvent, render, screen } from "@testing-library/react-native";

import type { ListeningState } from "@/lib/audio/listening-controller";
import type { ListeningTrack } from "@/lib/audio/narration";

import type { Id } from "../../../convex/_generated/dataModel";
import { ListenActions } from "./listen-actions";

const artworkId = "artwork-1" as Id<"artworks">;
const facts = [{ id: "f1", sourceUrl: "https://museum.example/work", sourceLabel: "Museum" }];
const opening = "This is Water Lilies by Claude Monet.";
const track: ListeningTrack = {
  work: {
    artworkId,
    title: "Water Lilies",
    artist: "Claude Monet",
    facts,
    opening,
  },
};
const mockController = {
  play: jest.fn(),
  toggle: jest.fn(),
  enqueue: jest.fn(),
  progressFor: jest.fn(),
};
const mockOpenPlayer = jest.fn();
let mockAudio: ListeningState;
let mockFacts = facts;
let mockCachedDuration: number | undefined;

jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("convex/react", () => ({
  useQueries: () => ({
    enrichment: { narrationFacts: mockFacts, narrationOpening: opening },
  }),
}));
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => ({ ...mockAudio, controller: mockController }),
}));
jest.mock("./mini-player", () => ({ openPlayer: () => mockOpenPlayer() }));
jest.mock("@/lib/audio/use-cached-narration-duration", () => ({
  useCachedNarrationDuration: () => mockCachedDuration,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockController.progressFor.mockReturnValue(undefined);
  mockFacts = facts;
  mockCachedDuration = undefined;
  mockAudio = {
    queue: [],
    history: [],
    phase: "idle",
    playing: false,
    position: 0,
    duration: 0,
    availableDuration: 0,
    waiting: false,
    rate: 1,
    revision: 0,
  };
});

async function renderActions() {
  await render(<ListenActions artworkId={artworkId} title="Water Lilies" artist="Claude Monet" scanId="scan-1" />);
}

it("starts the artwork guide and opens its player from the listen row", async () => {
  await renderActions();
  expect(screen.getByText(/AI-generated voice/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Play audio guide" }));
  expect(mockController.play).toHaveBeenCalledWith({
    work: expect.objectContaining({
      artworkId,
      scanId: "scan-1",
      facts,
      opening,
    }),
  });
  expect(mockOpenPlayer).toHaveBeenCalledTimes(1);
});

it("omits the time instead of estimating when audio has not been cached", async () => {
  await renderActions();
  expect(screen.getByText("AI-generated voice")).toBeOnTheScreen();
  expect(screen.queryByText(/~|1:30/)).toBeNull();
});

it("shows the exact cached duration before anything has played this session", async () => {
  mockCachedDuration = 79.8;
  await renderActions();
  expect(screen.getByText("1:19 · AI-generated voice")).toBeOnTheScreen();
  expect(mockController.play).not.toHaveBeenCalled();
});

it("resumes the current guide and shows its remaining time", async () => {
  mockAudio = {
    ...mockAudio,
    current: track,
    phase: "ready",
    position: 40,
    duration: 120,
  };
  await renderActions();
  expect(screen.getByText("1:20 left · AI-generated voice")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Resume audio guide" }));
  expect(mockController.toggle).toHaveBeenCalledTimes(1);
  expect(mockController.play).not.toHaveBeenCalled();
  expect(mockOpenPlayer).toHaveBeenCalledTimes(1);
});

it("opens a playing guide without interrupting it", async () => {
  mockAudio = {
    ...mockAudio,
    current: track,
    phase: "ready",
    playing: true,
    duration: 120,
  };
  await renderActions();
  expect(screen.getByRole("button", { name: "Already in player" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Now playing" }));
  expect(mockController.toggle).not.toHaveBeenCalled();
  expect(mockOpenPlayer).toHaveBeenCalledTimes(1);
});

it("reopens generation progress without duplicating or pausing the request", async () => {
  mockAudio = { ...mockAudio, current: track, phase: "loading", preparationStage: "generating" };
  await renderActions();
  const preparing = screen.getByRole("button", {
    name: "Generating narration…",
  });
  expect(preparing).toBeEnabled();
  expect(preparing).toBeBusy();
  expect(screen.getByText("Tap to view progress")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Already in player" })).toBeNull();
  await fireEvent.press(preparing);
  expect(mockController.toggle).not.toHaveBeenCalled();
  expect(mockController.play).not.toHaveBeenCalled();
  expect(mockOpenPlayer).toHaveBeenCalledTimes(1);
});

it("offers retry when the current narration fails", async () => {
  mockAudio = { ...mockAudio, current: track, phase: "error" };
  await renderActions();
  await fireEvent.press(screen.getByRole("button", { name: "Retry audio guide" }));
  expect(mockController.toggle).toHaveBeenCalledTimes(1);
  expect(mockOpenPlayer).toHaveBeenCalledTimes(1);
});

it("queues a newly recognized artwork while another guide continues playing", async () => {
  mockAudio = {
    ...mockAudio,
    current: {
      work: { ...track.work, artworkId: "artwork-2" as Id<"artworks"> },
    },
    phase: "ready",
    playing: true,
  };
  await renderActions();
  await fireEvent.press(screen.getByRole("button", { name: "Add to queue" }));
  expect(mockController.enqueue).toHaveBeenCalledWith({
    work: expect.objectContaining({ artworkId }),
  });
  expect(mockController.play).not.toHaveBeenCalled();
  expect(mockOpenPlayer).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Listen now" }));
  expect(mockController.play).toHaveBeenCalledTimes(1);
  expect(mockOpenPlayer).toHaveBeenCalledTimes(1);
});

it("marks queued artworks as added and prevents duplicate additions", async () => {
  mockAudio = {
    ...mockAudio,
    current: {
      work: { ...track.work, artworkId: "artwork-2" as Id<"artworks"> },
    },
    queue: [track],
    phase: "ready",
  };
  await renderActions();
  expect(screen.getByRole("button", { name: "Added to queue" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Listen now" })).toBeEnabled();
});

it("prepares the first queued guide without starting playback", async () => {
  await renderActions();
  await fireEvent.press(screen.getByRole("button", { name: "Add to queue" }));
  expect(mockController.play).toHaveBeenCalledWith({ work: expect.objectContaining({ artworkId }) }, false, true);
  expect(mockOpenPlayer).not.toHaveBeenCalled();
});

it("does not offer to queue the current artwork again when its research changes", async () => {
  mockAudio = {
    ...mockAudio,
    current: { work: { ...track.work, opening: "An earlier opening." } },
    phase: "ready",
  };
  await renderActions();
  expect(screen.getByRole("button", { name: "Already in player" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Play audio guide" }));
  expect(mockController.play).toHaveBeenCalledTimes(1);
});

it("omits the listen row when no narration research is available", async () => {
  mockFacts = [];
  await renderActions();
  expect(screen.queryByRole("button", { name: "Play audio guide" })).toBeNull();
});
