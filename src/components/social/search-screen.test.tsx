import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { SearchScreen } from "./search-screen";

const mockPush = jest.fn();
const mockArgs = jest.fn();
const mockRefresh = jest.fn();
const mockSettings = new Map<string, string>();
let mockOffline = false;
let mockResults: Record<string, unknown>;
jest.mock("expo-router", () => ({
  Stack: {
    SearchBar: ({ placeholder, onChangeText }: { placeholder: string; onChangeText: (event: unknown) => void }) => {
      const { TextInput } = jest.requireActual("react-native");
      return (
        <TextInput
          accessibilityLabel={placeholder}
          onChangeText={(text: string) => onChangeText({ nativeEvent: { text } })}
        />
      );
    },
  },
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/db/repos/settings", () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => void mockSettings.set(key, value),
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ status: "signed-out", key: "guest", offline: mockOffline }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: never, args: unknown) => {
    const name = jest.requireActual("convex/server").getFunctionName(query);
    if (args === "skip") return { data: undefined, loading: false, refresh: jest.fn() };
    mockArgs(name, args);
    const result = mockResults[name];
    return {
      data: result instanceof Error ? undefined : result,
      error: result instanceof Error ? result : undefined,
      loading: false,
      refresh: () => mockRefresh(name),
    };
  },
}));

const monica = {
  profileId: "monica",
  username: "monireyes",
  name: "Monica Reyes",
  avatar: "klee",
  publishedWallCount: 0,
  relationship: { state: "none" },
};

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockClear();
  mockArgs.mockClear();
  mockRefresh.mockClear();
  mockSettings.clear();
  mockOffline = false;
  mockResults = {
    "tags:popular": [
      { tag: "impressionism", postCount: 214 },
      { tag: "monet", postCount: 312 },
    ],
    "tags:search": [
      { tag: "monet", postCount: 312 },
      { tag: "mondrian", postCount: 1 },
    ],
    "profiles:search": { page: [monica], cursor: null, isDone: true },
  };
});

afterEach(() => jest.useRealTimers());

async function type(text: string) {
  await fireEvent.changeText(screen.getByLabelText("People and tags"), text);
  await act(() => jest.advanceTimersByTime(250));
}

it("offers this week's popular tags and remembers the one opened", async () => {
  await render(<SearchScreen />);
  await act(() => jest.advanceTimersByTime(0));
  expect(screen.getByRole("header", { name: "Popular this week" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "#impressionism, 214 posts" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag/[tag]", params: { tag: "impressionism" } });
  expect(screen.getByRole("header", { name: "Recent" })).toBeOnTheScreen();
  expect(JSON.parse(mockSettings.get("search.recent")!)).toEqual([{ kind: "tag", tag: "impressionism" }]);
});

it("advances the popular-tag window while Search stays mounted", async () => {
  jest.setSystemTime(new Date("2026-09-09T12:00:15Z"));
  await render(<SearchScreen />);
  expect(mockArgs).toHaveBeenCalledWith("tags:popular", { asOf: Date.parse("2026-09-09T12:00:00Z") });
  await act(() => jest.advanceTimersByTime(60_000));
  expect(mockArgs).toHaveBeenCalledWith("tags:popular", { asOf: Date.parse("2026-09-09T12:01:00Z") });
});

it("keeps popular tags visible while the next time window loads, then accepts an empty result", async () => {
  const view = await render(<SearchScreen />);
  mockResults["tags:popular"] = undefined;
  await act(() => jest.advanceTimersByTime(60_000));
  expect(screen.getByRole("button", { name: "#monet, 312 posts" })).toBeOnTheScreen();
  mockResults["tags:popular"] = [];
  await view.rerender(<SearchScreen />);
  expect(screen.queryByRole("header", { name: "Popular this week" })).toBeNull();
});

it("lists recent tags and people from earlier searches", async () => {
  mockSettings.set(
    "search.recent",
    JSON.stringify([
      { kind: "tag", tag: "sketchsunday" },
      { kind: "person", profile: { ...monica, relationship: undefined } },
    ]),
  );
  await render(<SearchScreen />);
  expect(await screen.findByRole("button", { name: "#sketchsunday" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View Monica Reyes’s profile" })).toBeOnTheScreen();
});

it("finds tags and people as you type and keeps the person opened", async () => {
  await render(<SearchScreen />);
  await type("mon");
  expect(mockArgs).toHaveBeenCalledWith("tags:search", { prefix: "mon" });
  expect(mockArgs).toHaveBeenCalledWith("profiles:search", { query: "mon", limit: 5 });
  expect(screen.getByRole("header", { name: "Tags" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "#mondrian, 1 post" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "View Monica Reyes’s profile" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "monica" } });
  const [stored] = JSON.parse(mockSettings.get("search.recent")!);
  expect(stored).toEqual({ kind: "person", profile: expect.not.objectContaining({ relationship: expect.anything() }) });
});

it("searches only tags when the text starts with #", async () => {
  await render(<SearchScreen />);
  await type("#mon");
  expect(mockArgs).toHaveBeenCalledWith("tags:search", { prefix: "mon" });
  expect(mockArgs).not.toHaveBeenCalledWith("profiles:search", expect.anything());
  expect(screen.queryByRole("header", { name: "People" })).toBeNull();
});

it("says when nothing matches and when the phone is offline", async () => {
  mockResults = { "tags:search": [], "profiles:search": { page: [], cursor: null, isDone: true } };
  const view = await render(<SearchScreen />);
  await type("zzz");
  expect(screen.getByText("No results found.")).toBeOnTheScreen();
  mockOffline = true;
  await view.rerender(<SearchScreen />);
  expect(screen.getByText("You’re offline.")).toBeOnTheScreen();
});

it("offers a retry when both searches fail instead of claiming there are no matches", async () => {
  mockResults["tags:search"] = new Error("Server unavailable");
  mockResults["profiles:search"] = new Error("Server unavailable");
  await render(<SearchScreen />);
  await type("mon");
  expect(screen.queryByText("No results found.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Retry tags" }));
  await fireEvent.press(screen.getByRole("button", { name: "Retry people" }));
  expect(mockRefresh.mock.calls).toEqual([["tags:search"], ["profiles:search"]]);
});

it.each(["tags:search", "profiles:search"])("keeps successful results visible when %s fails", async (failed) => {
  mockResults[failed] = new Error("Server unavailable");
  await render(<SearchScreen />);
  await type("mon");
  expect(
    screen.getByRole("button", {
      name: failed === "tags:search" ? "View Monica Reyes’s profile" : "#monet, 312 posts",
    }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("No results found.")).toBeNull();
  expect(
    screen.getByRole("button", { name: failed === "tags:search" ? "Retry tags" : "Retry people" }),
  ).toBeOnTheScreen();
});

it("keeps recent searches visible when popular tags fail and offers a retry", async () => {
  mockSettings.set("search.recent", JSON.stringify([{ kind: "tag", tag: "sketchsunday" }]));
  mockResults["tags:popular"] = new Error("Server unavailable");
  await render(<SearchScreen />);
  expect(await screen.findByRole("button", { name: "#sketchsunday" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry popular tags" }));
  expect(mockRefresh).toHaveBeenCalledWith("tags:popular");
});
