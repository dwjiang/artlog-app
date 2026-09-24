import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { VenueRow } from "../venue/resolve";
import { useVenueMetadata } from "./use-venue-metadata";

let mockResolve: ((rows: VenueRow[]) => void) | undefined;
const mockRead = jest.fn(
  async (_ids: string[]) =>
    new Promise<VenueRow[]>((resolve) => {
      mockResolve = resolve;
    }),
);
jest.mock("../venue/venue-db", () => ({
  venueMetadataForIds: (ids: string[]) => mockRead(ids),
  onVenueMetadataChange: () => () => {},
}));
const row = (id: string) =>
  ({
    id,
    name: id,
    region: "paris",
    lat: 48.8,
    lng: 2.3,
  }) as unknown as VenueRow;

it("is not ready until the rows for the current museums have been read", async () => {
  const hook = await renderHook((ids: string[]) => useVenueMetadata(ids, "a"), {
    initialProps: ["met"],
  });
  expect(hook.result.current.ready).toBe(false);
  await act(() => mockResolve?.([row("met")]));
  expect(hook.result.current).toMatchObject({ ready: true });
  expect(hook.result.current.metadata.get("met")?.name).toBe("met");
  await hook.rerender(["met", "moma"]);
  expect(hook.result.current.ready).toBe(false);
  await act(() => mockResolve?.([row("met"), row("moma")]));
  expect(hook.result.current.ready).toBe(true);
  expect(hook.result.current.metadata.get("moma")).toBeDefined();
});

it("becomes ready without rows when the venue table cannot be read", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockRead.mockRejectedValueOnce(new Error("locked"));
  const hook = await renderHook(() => useVenueMetadata(["met"], "a"));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.metadata.size).toBe(0);
});

it("keeps known museum metadata ready when deleting an artwork shrinks the requested set", async () => {
  const hook = await renderHook((ids: string[]) => useVenueMetadata(ids, "a"), {
    initialProps: ["met", "moma"],
  });
  await act(() => mockResolve?.([row("met"), row("moma")]));
  await hook.rerender(["met"]);
  expect(hook.result.current.ready).toBe(true);
  expect([...hook.result.current.metadata.keys()]).toEqual(["met"]);
  await act(() => mockResolve?.([row("met")]));
  expect(hook.result.current.ready).toBe(true);
});

it("does not reuse another owner’s museum metadata", async () => {
  const hook = await renderHook(
    (owner: string) => useVenueMetadata(["met"], owner),
    {
      initialProps: "a",
    },
  );
  await act(() => mockResolve?.([row("met")]));
  await hook.rerender("b");
  expect(hook.result.current.ready).toBe(false);
  expect(hook.result.current.metadata.size).toBe(0);
});

it("retains the remaining museum details if their refresh fails after removal", async () => {
  const hook = await renderHook((ids: string[]) => useVenueMetadata(ids, "a"), {
    initialProps: ["met", "moma"],
  });
  await act(() => mockResolve?.([row("met"), row("moma")]));
  mockRead.mockRejectedValueOnce(new Error("locked"));
  await hook.rerender(["met"]);
  expect(hook.result.current.ready).toBe(true);
  expect(hook.result.current.metadata.get("met")?.name).toBe("met");
});

it("stays ready when Undo brings a museum back that was read earlier", async () => {
  const hook = await renderHook((ids: string[]) => useVenueMetadata(ids, "a"), {
    initialProps: ["met", "moma"],
  });
  await act(() => mockResolve?.([row("met"), row("moma")]));
  await hook.rerender(["met"]);
  await act(() => mockResolve?.([row("met")]));
  await hook.rerender(["met", "moma"]);
  expect(hook.result.current.ready).toBe(true);
  expect(hook.result.current.metadata.get("moma")?.name).toBe("moma");
  await act(() =>
    mockResolve?.([row("met"), { ...row("moma"), name: "MoMA" }]),
  );
  expect(hook.result.current.metadata.get("moma")?.name).toBe("MoMA");
});
