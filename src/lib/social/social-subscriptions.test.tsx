import { renderHook } from "@testing-library/react-native";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";

import { api } from "../../../convex/_generated/api";
import type { SharedVisit } from "./types";
import { useCursorPages, useSocialQuery } from "./use-social-query";

jest.mock("./use-query-refresh", () => ({
  useQueryRefresh: () => ({ refreshing: false, refresh: jest.fn() }),
  useQueryBatchRefresh: () => ({ refreshing: false, refresh: jest.fn() }),
}));
const client = {
  watchQuery: () => ({
    onUpdate: () => () => {},
    localQueryResult: () => undefined,
    journal: () => undefined,
  }),
} as unknown as ConvexReactClient;

it("keeps live Convex subscriptions stable across renders with equivalent argument objects", async () => {
  const select = (value: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => value;
  const identify = (value: SharedVisit) => value.postId;
  const view = await renderHook(
    () => ({
      query: useSocialQuery(api.walls.getMine, {}, "account"),
      feed: useCursorPages(api.sharedVisits.listFeed, {}, "account", select, identify),
    }),
    {
      wrapper: ({ children }) => <ConvexProvider client={client}>{children}</ConvexProvider>,
    },
  );
  await view.rerender({});
  expect(view.result.current.query.loading).toBe(true);
  expect(view.result.current.feed.loading).toBe(true);
});

it("keeps a feed started while the session loads subscribed, with its answer, when the session key gains a scope", async () => {
  const subscribers = new Map<string, number>();
  const added: string[] = [];
  const removed: string[] = [];
  const answer = { page: [{ postId: "post-a" }], cursor: null, isDone: true };
  // Like the Convex client, one server subscription serves every watch of the same query and arguments.
  const counting = {
    watchQuery: (query: FunctionReference<"query">, args: object) => {
      const token = `${getFunctionName(query)}:${JSON.stringify(args)}`;
      return {
        onUpdate: () => {
          if (!subscribers.get(token)) added.push(token);
          subscribers.set(token, (subscribers.get(token) ?? 0) + 1);
          return () => {
            subscribers.set(token, subscribers.get(token)! - 1);
            if (!subscribers.get(token)) removed.push(token);
          };
        },
        localQueryResult: () => (subscribers.get(token) ? answer : undefined),
        journal: () => undefined,
      };
    },
  } as unknown as ConvexReactClient;
  const view = await renderHook(
    ({ scope }: { scope: string }) =>
      useCursorPages(
        api.sharedVisits.listFeed,
        {},
        scope,
        (value) => value,
        (value) => value.postId,
      ),
    {
      initialProps: { scope: "1:online:true:" },
      wrapper: ({ children }) => <ConvexProvider client={counting}>{children}</ConvexProvider>,
    },
  );
  await view.rerender({ scope: "1:online:true:account:a:0" });
  expect(view.result.current.items.map((visit) => visit.postId)).toEqual(["post-a"]);
  expect(added).toEqual(['sharedVisits:listFeed:{"cursor":null,"limit":10}']);
  expect(removed).toEqual([]);
});
