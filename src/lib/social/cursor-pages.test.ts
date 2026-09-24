import { ConvexError } from "convex/values";
import { readCursorPages, type CursorPage } from "./cursor-pages";

type Item = { id: string; title?: string };
const read = (
  cursors: (string | null)[],
  results: (CursorPage<Item> | Error | undefined)[],
) =>
  readCursorPages(
    cursors,
    results,
    (result) => result,
    (item) => item.id,
  );
const page = (ids: string[], cursor: string | null, isDone = false) => ({
  page: ids.map((id) => ({ id })),
  cursor,
  isDone,
});

it("keeps server ordering and deduplicates overlapping pages", () => {
  const state = read(
    [null, "next"],
    [page(["new", "same"], "next"), page(["same", "old"], null, true)],
  );
  expect(state.items.map((item) => item.id)).toEqual(["new", "same", "old"]);
  expect(state.done).toBe(true);
});

it("drops dependent pages immediately when an earlier cursor changes", () => {
  const state = read(
    [null, "old-cursor"],
    [page(["new"], "new-cursor"), page(["stale"], null, true)],
  );
  expect(state.items.map((item) => item.id)).toEqual(["new"]);
  expect(state.validLength).toBe(1);
  expect(state.done).toBe(false);
  expect(state.next).toBe("new-cursor");
});

it("distinguishes an empty page from completion and permits another page", () => {
  expect(read([null], [page([], "next")])).toMatchObject({
    items: [],
    done: false,
    canLoadMore: true,
  });
  expect(
    read([null, "next"], [page([], "next"), page(["found"], null, true)]).items,
  ).toEqual([{ id: "found" }]);
});

it("does not loop or claim completion when the server cannot advance a cursor", () => {
  expect(read([null], [page([], null)])).toMatchObject({
    done: false,
    canLoadMore: false,
  });
  expect(
    read([null, "next"], [page(["a"], "next"), page([], "next")]),
  ).toMatchObject({
    done: false,
    canLoadMore: false,
  });
});

it("clears all content on an access error in any loaded page", () => {
  expect(
    read([null, "next"], [page(["private"], "next"), new Error("not_found")]),
  ).toMatchObject({
    items: [],
    first: undefined,
    done: false,
    error: expect.any(Error),
  });
});

it("never exposes a downstream response before its preceding page loads", () => {
  expect(
    read([null, "next"], [undefined, page(["stale"], null, true)]),
  ).toMatchObject({
    items: [],
    first: undefined,
    loading: true,
    done: false,
  });
});

it("keeps already loaded rows when a later page fails because of the network", () => {
  for (const message of [
    "Network request failed",
    "Network request timed out",
  ]) {
    expect(
      read([null, "next"], [page(["loaded"], "next"), new TypeError(message)]),
    ).toMatchObject({
      items: [{ id: "loaded" }],
      first: page(["loaded"], "next"),
      done: false,
      error: expect.any(Error),
    });
  }
});

it("hides loaded rows when a later page is refused by the server", () => {
  expect(
    read(
      [null, "next"],
      [page(["loaded"], "next"), new ConvexError({ code: "not_found" })],
    ),
  ).toMatchObject({ items: [], first: undefined, error: expect.any(Error) });
});
