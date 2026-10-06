import { act, renderHook } from "@testing-library/react-native";

import { deleteAllLocalData } from "@/db/repos/local-data";
import * as settings from "@/db/repos/settings";
import { anonymousOwner, initializeOwner, switchOwner } from "@/lib/account/owner-store";

import { useRecentSearches } from "./recent-searches";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

beforeEach(() => {
  deleteAllLocalData();
  initializeOwner("original-installation");
});

afterEach(() => jest.restoreAllMocks());

it("forgets mounted history on erasure and never saves the erased entries again", async () => {
  const { result } = await renderHook(useRecentSearches);
  await act(() => result.current.remember({ kind: "tag", tag: "monet" }));
  const oldRemember = result.current.remember;
  await act(() => {
    deleteAllLocalData();
    initializeOwner("new-installation");
  });
  expect(result.current.recent).toEqual([]);
  await act(() => oldRemember({ kind: "tag", tag: "renoir" }));
  expect(await settings.getSetting("search.recent")).toBeUndefined();
  await act(() => result.current.remember({ kind: "tag", tag: "cassatt" }));
  expect(JSON.parse((await settings.getSetting("search.recent"))!)).toEqual([{ kind: "tag", tag: "cassatt" }]);
});

it("ignores a history read that finishes after the installation was erased", async () => {
  let finishRead!: (stored: string) => void;
  jest.spyOn(settings, "getSetting").mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finishRead = resolve;
      }),
  );
  const { result } = await renderHook(useRecentSearches);
  await act(() => {
    deleteAllLocalData();
    initializeOwner("new-installation");
  });
  await act(() => finishRead(JSON.stringify([{ kind: "tag", tag: "monet" }])));
  expect(result.current.recent).toEqual([]);
});

it("keeps this installation's history when signing in and out", async () => {
  const { result } = await renderHook(useRecentSearches);
  await act(() => result.current.remember({ kind: "tag", tag: "monet" }));
  await act(() => switchOwner("account:person"));
  expect(result.current.recent).toEqual([{ kind: "tag", tag: "monet" }]);
  await act(() => switchOwner(anonymousOwner()));
  expect(result.current.recent).toEqual([{ kind: "tag", tag: "monet" }]);
});

it("forgets one search and keeps the rest in order", async () => {
  const { result } = await renderHook(useRecentSearches);
  for (const tag of ["monet", "renoir", "cassatt"]) {
    await act(() => result.current.remember({ kind: "tag", tag }));
  }
  await act(() => result.current.forget({ kind: "tag", tag: "renoir" }));
  const remaining = [
    { kind: "tag", tag: "cassatt" },
    { kind: "tag", tag: "monet" },
  ];
  expect(result.current.recent).toEqual(remaining);
  expect(JSON.parse((await settings.getSetting("search.recent"))!)).toEqual(remaining);
});
