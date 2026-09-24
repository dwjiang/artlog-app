import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useCachedNarrationDuration } from "./use-cached-narration-duration";

const mockCachedUri = jest.fn();
const mockPlay = jest.fn();
const mockSources: (string | null)[] = [];
let mockStaleStatus = false;
jest.mock("./narration-renderer", () => ({
  cachedNarrationUri: (research: string) => mockCachedUri(research),
}));
jest.mock("expo-audio", () => ({
  useAudioPlayer: (source: string | null) => {
    mockSources.push(source);
    return { source, id: source ?? "empty", duration: 0, play: mockPlay };
  },
  useAudioPlayerStatus: (player: { source: string | null; id: string }) => ({
    id: mockStaleStatus ? "previous-player" : player.id,
    isLoaded: !!player.source,
    duration: player.source ? 79.8 : 0,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSources.length = 0;
  mockStaleStatus = false;
  mockCachedUri.mockResolvedValue(undefined);
});

it("reads a cached file’s duration without starting playback", async () => {
  mockCachedUri.mockResolvedValue("file:///cache/narration/guide.mp3");
  const { result } = await renderHook(() =>
    useCachedNarrationDuration("current research"),
  );
  await waitFor(() => expect(result.current).toBe(79.8));
  expect(mockSources).toContain("file:///cache/narration/guide.mp3");
  expect(mockPlay).not.toHaveBeenCalled();
});

it("leaves the duration unknown when the cache is missing or cannot be read", async () => {
  const { result, rerender } = await renderHook(
    ({ research }: { research: string }) =>
      useCachedNarrationDuration(research),
    { initialProps: { research: "missing" } },
  );
  expect(result.current).toBeUndefined();
  mockCachedUri.mockRejectedValue(new Error("Cache unavailable"));
  await rerender({ research: "unreadable" });
  expect(result.current).toBeUndefined();
  expect(mockSources.every((source) => source === null)).toBe(true);
});

it("does not show a previous player’s duration while the new cached file is loading", async () => {
  mockStaleStatus = true;
  mockCachedUri.mockResolvedValue("file:///cache/narration/current.mp3");
  const { result } = await renderHook(() =>
    useCachedNarrationDuration("current"),
  );
  await waitFor(() =>
    expect(mockSources).toContain("file:///cache/narration/current.mp3"),
  );
  expect(result.current).toBeUndefined();
});

it("clears the previous duration when the artwork or its research changes", async () => {
  mockCachedUri.mockResolvedValueOnce("file:///cache/narration/first.mp3");
  const { result, rerender } = await renderHook(
    ({ research }: { research: string }) =>
      useCachedNarrationDuration(research),
    { initialProps: { research: "first" } },
  );
  await waitFor(() => expect(result.current).toBe(79.8));
  await rerender({ research: "second" });
  expect(result.current).toBeUndefined();
});

it("ignores a late cache lookup for a previous artwork", async () => {
  let resolve!: (uri: string) => void;
  mockCachedUri.mockReturnValueOnce(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const { result, rerender } = await renderHook(
    ({ research }: { research: string }) =>
      useCachedNarrationDuration(research),
    { initialProps: { research: "first" } },
  );
  await rerender({ research: "second" });
  await act(() => resolve("file:///cache/narration/first.mp3"));
  expect(result.current).toBeUndefined();
  expect(mockSources).not.toContain("file:///cache/narration/first.mp3");
});
