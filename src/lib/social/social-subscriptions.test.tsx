import { renderHook } from "@testing-library/react-native";
import { ConvexProvider, type ConvexReactClient } from "convex/react";

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
