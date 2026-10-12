import { act, renderHook } from "@testing-library/react-native";

import type { Id } from "../../convex/_generated/dataModel";
import type { ArtworkEnrichment } from "./use-artwork-enrichment";
import { useArtworkResearch } from "./use-artwork-research";

const mockStart = jest.fn();
const mockReportError = jest.fn();
let mockEnrichment: Partial<NonNullable<ArtworkEnrichment>> | Error | undefined;

jest.mock("convex/react", () => ({ useMutation: () => mockStart }));
jest.mock("./use-artwork-enrichment", () => ({ useArtworkEnrichment: () => mockEnrichment }));
jest.mock("./observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));

const artworkId = "artwork-1" as Id<"artworks">;
const story = (patch: Partial<NonNullable<ArtworkEnrichment>>) => ({
  docentWriting: false,
  docentStatus: "writing" as const,
  docentGeneration: 3,
  narrationAvailable: true,
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStart.mockResolvedValue(true);
  mockEnrichment = story({});
});

it("asks once for a work's missing story and shows it as writing until the run is claimed", async () => {
  const { result, rerender } = await renderHook(() => useArtworkResearch(artworkId));
  expect(mockStart).toHaveBeenCalledWith({ artworkId });
  expect(result.current.status).toBe("writing");
  mockEnrichment = story({ docentWriting: true, docentGeneration: 4 });
  await rerender({});
  expect(result.current.status).toBe("writing");
  mockEnrichment = story({ docent: [{ sentence: "Monet painted this pond.", factIds: ["f1"] }], docentGeneration: 4 });
  await rerender({});
  expect(result.current.status).toBeUndefined();
  expect(mockStart).toHaveBeenCalledTimes(1);
});

it("offers a retry once a run ends without a story, and asks again only when it is tapped", async () => {
  const { result, rerender } = await renderHook(() => useArtworkResearch(artworkId));
  mockEnrichment = story({ docentWriting: true, docentGeneration: 4 });
  await rerender({});
  // The backend released an expired or failed claim without writing anything.
  mockEnrichment = story({ docentGeneration: 4, docentStatus: "failed" });
  await rerender({});
  expect(result.current.status).toBe("failed");
  expect(mockStart).toHaveBeenCalledTimes(1);

  await act(() => result.current.retry());
  expect(mockStart).toHaveBeenCalledTimes(2);
  expect(mockStart).toHaveBeenLastCalledWith({ artworkId, retry: true });
  expect(result.current.status).toBe("writing");
  mockEnrichment = story({ docentWriting: true, docentGeneration: 5 });
  await rerender({});
  expect(result.current.status).toBe("writing");
});

it("offers a retry after a run the page found already writing, such as a scan's", async () => {
  mockEnrichment = story({ docentWriting: true });
  const { result, rerender } = await renderHook(() => useArtworkResearch(artworkId));
  expect(mockStart).not.toHaveBeenCalled();
  mockEnrichment = story({ docentStatus: "failed" });
  await rerender({});
  expect(result.current.status).toBe("failed");
  expect(mockStart).not.toHaveBeenCalled();
});

it("does not call a run that found no sources failed", async () => {
  const { result, rerender } = await renderHook(() => useArtworkResearch(artworkId));
  mockEnrichment = story({ docentWriting: true, docentGeneration: 4 });
  await rerender({});
  mockEnrichment = story({ docentGeneration: 4, docentStatus: "unavailable", narrationAvailable: false });
  await rerender({});
  expect(result.current.status).toBeUndefined();
});

it("offers a retry for a work whose story failed even though its audio guide is unavailable", async () => {
  const { result, rerender } = await renderHook(() => useArtworkResearch(artworkId));
  mockEnrichment = story({ docentGeneration: 4, docentStatus: "failed", narrationAvailable: false });
  await rerender({});
  expect(result.current.status).toBe("failed");
});

it("settles on no story when the backend declines to research the work again", async () => {
  mockStart.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const { result, rerender } = await renderHook(() => useArtworkResearch(artworkId));
  mockEnrichment = story({ docentGeneration: 4, docentStatus: "failed" });
  await rerender({});
  expect(result.current.status).toBe("failed");
  await act(() => result.current.retry());
  expect(result.current.status).toBeUndefined();
});

it("does not call a work failed when nothing was asked or written for it", async () => {
  mockStart.mockResolvedValue(false);
  const { result } = await renderHook(() => useArtworkResearch(artworkId));
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBeUndefined();
});

it("leaves a retry that cannot reach the server to the caller, without reporting it", async () => {
  mockStart.mockRejectedValueOnce(new Error("Network request failed"));
  const { result } = await renderHook(() => useArtworkResearch(artworkId));
  expect(mockReportError).not.toHaveBeenCalled();
  expect(result.current.status).toBeUndefined();
  const offline = new Error("Network request failed");
  mockStart.mockRejectedValueOnce(offline);
  await expect(result.current.retry()).rejects.toBe(offline);
});

it("offers Try again on opening a work whose last run failed recently, though the open itself is declined", async () => {
  mockStart.mockResolvedValue(false);
  mockEnrichment = story({ docentStatus: "failed" });
  const { result } = await renderHook(() => useArtworkResearch(artworkId));
  expect(mockStart).toHaveBeenCalledWith({ artworkId });
  expect(result.current.status).toBe("failed");
  mockStart.mockResolvedValueOnce(true);
  await act(() => result.current.retry());
  expect(mockStart).toHaveBeenLastCalledWith({ artworkId, retry: true });
  expect(result.current.status).toBe("writing");
});

it("reports an unexpected failure to start the first run", async () => {
  const failure = new Error("Unexpected");
  mockStart.mockRejectedValueOnce(failure);
  await renderHook(() => useArtworkResearch(artworkId));
  expect(mockReportError).toHaveBeenCalledWith(failure, "artwork.research");
});
