import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";

import { dismissToast, useToast } from "@/lib/ui/toast";

import { SearchScreen } from "./search-screen";

const mockPush = jest.fn();
const mockArgs = jest.fn();
const mockRefresh = jest.fn();
const mockMutation = jest.fn();
const mockSettings = new Map<string, string>();
let mockOffline = false;
let mockSession: { status: string; key: string; profileId?: string; token?: string };
let mockResults: Record<string, unknown>;
let mockSaved = new Map<string, { localId: string }>();
jest.mock("convex/browser", () => ({
  ConvexHttpClient: function () {
    return { mutation: mockMutation };
  },
}));
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
  useSocialSession: () => ({ ...mockSession, offline: mockOffline }),
}));
jest.mock("@/lib/catalog/use-catalog-ready", () => ({
  useCatalogReady: () => ({ ready: !mockOffline, offline: mockOffline, scope: "catalog" }),
}));
jest.mock("@/lib/catalog/use-saved-catalog-works", () => ({
  useSavedCatalogWorks: () => mockSaved,
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
  mockMutation.mockReset().mockResolvedValue(null);
  mockSettings.clear();
  mockSaved = new Map();
  mockOffline = false;
  mockSession = { status: "signed-out", key: "guest" };
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
    "artists:search": [],
    "artworks:search": { page: [], cursor: null, isDone: true },
  };
});

afterEach(() => {
  dismissToast();
  jest.useRealTimers();
});

async function type(text: string) {
  await fireEvent.changeText(screen.getByLabelText("Artworks, artists and people"), text);
  await act(() => jest.advanceTimersByTime(250));
}

it("offers popular tags and remembers the one opened", async () => {
  await render(<SearchScreen />);
  await act(() => jest.advanceTimersByTime(0));
  expect(screen.getByRole("header", { name: "Popular tags" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "#impressionism, 214 posts" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag/[tag]", params: { tag: "impressionism" } });
  expect(screen.getByRole("header", { name: "Recent" })).toBeOnTheScreen();
  expect(JSON.parse(mockSettings.get("search.recent")!)).toEqual([{ kind: "tag", tag: "impressionism" }]);
});

it("lists recent tags and people from earlier searches and reopens them, most recent first", async () => {
  const { relationship: _, ...person } = monica;
  mockSettings.set(
    "search.recent",
    JSON.stringify([
      { kind: "tag", tag: "sketchsunday" },
      { kind: "person", profile: person },
    ]),
  );
  await render(<SearchScreen />);
  expect(await screen.findByRole("button", { name: "#sketchsunday" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "View Monica Reyes’s profile" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "monica" } });
  expect(JSON.parse(mockSettings.get("search.recent")!)).toEqual([
    { kind: "person", profile: person },
    { kind: "tag", tag: "sketchsunday" },
  ]);
});

it("removes a recent search", async () => {
  const { relationship: _, ...person } = monica;
  mockSettings.set(
    "search.recent",
    JSON.stringify([
      { kind: "tag", tag: "sketchsunday" },
      { kind: "person", profile: person },
    ]),
  );
  await render(<SearchScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "Remove #sketchsunday from recent searches" }));
  expect(screen.queryByRole("button", { name: "#sketchsunday" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Remove Monica Reyes from recent searches" }));
  expect(screen.queryByRole("header", { name: "Recent" })).toBeNull();
  expect(JSON.parse(mockSettings.get("search.recent")!)).toEqual([]);
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
  expect(mockArgs).not.toHaveBeenCalledWith("artworks:search", expect.anything());
  expect(mockArgs).not.toHaveBeenCalledWith("artists:search", expect.anything());
  expect(screen.queryByRole("header", { name: "People" })).toBeNull();
});

const lilies = {
  artworkId: "lilies",
  title: "Water Lilies",
  artist: "Claude Monet",
  date: "1906",
  thumbnailUrl: "https://museum.example/lilies.jpg",
};
const wheat = { artworkId: "wheat", title: "Stacks of Wheat (End of Summer)", artist: "Claude Monet", date: "1890–91" };
const monet = {
  artistId: "monet",
  name: "Claude Monet",
  workCount: 214,
  coverUrl: "https://museum.example/lilies.jpg",
};

it("finds artists and artworks as you type, above tags and people", async () => {
  mockResults["artists:search"] = [monet];
  mockResults["artworks:search"] = { page: [lilies, wheat], cursor: null, isDone: true };
  await render(<SearchScreen />);
  await type("monet");
  expect(mockArgs).toHaveBeenCalledWith("artists:search", { query: "monet" });
  expect(mockArgs).toHaveBeenCalledWith("artworks:search", { query: "monet", limit: 8 });
  expect(screen.getAllByRole("header").map((header) => header.props.children)).toEqual([
    "Artists",
    "Artworks",
    "Tags",
    "People",
  ]);
  // Everything fits, so there is nothing more to see.
  expect(screen.queryByRole("button", { name: "See all: Artworks" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Claude Monet, 214 works" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/artist/[artistId]", params: { artistId: "monet" } });
  await fireEvent.press(
    screen.getByRole("button", { name: "Stacks of Wheat (End of Summer), Claude Monet · 1890–91" }),
  );
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/catalog/[artworkId]", params: { artworkId: "wheat" } });
  expect(JSON.parse(mockSettings.get("search.recent")!)).toEqual([
    { kind: "artwork", artwork: { artworkId: "wheat", title: "Stacks of Wheat (End of Summer)" } },
    { kind: "artist", artist: { artistId: "monet", name: "Claude Monet", coverUrl: monet.coverUrl } },
  ]);
});

it("opens your saved copy of an artwork you saved, and lists the rest under See all", async () => {
  mockSaved = new Map([["lilies", { localId: "save-1" }]]);
  mockResults["artworks:search"] = {
    page: [lilies, wheat, { ...wheat, artworkId: "w2" }, { ...wheat, artworkId: "w3" }],
    cursor: "next",
    isDone: false,
  };
  await render(<SearchScreen />);
  await type("monet");
  expect(screen.getAllByRole("button", { name: /Stacks of Wheat/ })).toHaveLength(2);
  await fireEvent.press(screen.getByRole("button", { name: "Water Lilies, Claude Monet · 1906, Saved" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/saved/[savedId]", params: { savedId: "save-1" } });
  await fireEvent.press(screen.getByRole("button", { name: "See all: Artworks" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/search-artworks", params: { query: "monet" } });
});

it("keeps later artwork matches reachable when the first page contains only hidden works", async () => {
  mockResults["tags:search"] = [];
  mockResults["profiles:search"] = { page: [], cursor: null, isDone: true };
  mockResults["artworks:search"] = { page: [], cursor: "next", isDone: false };
  await render(<SearchScreen />);
  await type("water lilies");
  expect(screen.queryByText("No results found.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "See all: Artworks" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/search-artworks", params: { query: "water lilies" } });
});

it("reopens recent artworks and artists", async () => {
  mockSettings.set(
    "search.recent",
    JSON.stringify([
      { kind: "artwork", artwork: { artworkId: "wheat", title: "Stacks of Wheat" } },
      { kind: "artist", artist: { artistId: "monet", name: "Claude Monet" } },
    ]),
  );
  await render(<SearchScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "Claude Monet" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/artist/[artistId]", params: { artistId: "monet" } });
  await fireEvent.press(screen.getByRole("button", { name: "Stacks of Wheat" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/catalog/[artworkId]", params: { artworkId: "wheat" } });
});

it("offers a retry when the catalog searches fail", async () => {
  mockResults["artists:search"] = new Error("Server unavailable");
  mockResults["artworks:search"] = new Error("Server unavailable");
  await render(<SearchScreen />);
  await type("monet");
  expect(screen.getByRole("button", { name: "#monet, 312 posts" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry artists" }));
  await fireEvent.press(screen.getByRole("button", { name: "Retry artworks" }));
  expect(mockRefresh.mock.calls).toEqual([["artists:search"], ["artworks:search"]]);
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

it("shows popular tags as artwork tiles once there are enough to fill the grid", async () => {
  const cover = {
    kind: "catalog",
    url: "https://museum.example/lilies.jpg",
    sourceUrl: "https://museum.example/lilies",
    rights: "public_domain",
    width: 600,
    height: 400,
  };
  mockResults["tags:popular"] = ["impressionism", "ukiyoe", "vangogh", "portraits"].map((tag, index) => ({
    tag,
    postCount: 40 - index,
    ...(index === 0 ? { cover } : {}),
  }));
  await render(<SearchScreen />);
  expect(screen.getByText("40 posts")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "#portraits, 37 posts" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag/[tag]", params: { tag: "portraits" } });
});

it("suggests people to add, falling back to the newest profiles without the viewer's own", async () => {
  mockResults["profiles:discover"] = { page: [monica], cursor: null, isDone: true };
  const view = await render(<SearchScreen />);
  expect(screen.getByRole("header", { name: "New on Artlog" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View Monica Reyes’s profile" })).toBeOnTheScreen();
  expect(screen.getByText("@monireyes")).toBeOnTheScreen();
  expect(screen.queryByText("Invite friends")).toBeNull();

  mockSession = { status: "ready", key: "account", profileId: "me", token: "token" };
  mockResults["suggestions:list"] = {
    friendCount: 0,
    people: [{ profile: monica, reason: { kind: "museum", venueName: "Art Institute of Chicago" } }],
  };
  mockArgs.mockClear();
  await view.rerender(<SearchScreen />);
  expect(screen.getByRole("header", { name: "Suggested" })).toBeOnTheScreen();
  expect(screen.getByText("Invite friends")).toBeOnTheScreen();
  expect(mockArgs).not.toHaveBeenCalledWith("profiles:discover", expect.anything());
  await fireEvent.press(screen.getByRole("button", { name: "See all" }));
  expect(mockPush).toHaveBeenCalledWith("/people");

  mockResults["suggestions:list"] = { friendCount: 0, people: [] };
  mockResults["profiles:discover"] = {
    page: [{ ...monica, profileId: "me", name: "Me" }, monica],
    cursor: null,
    isDone: true,
  };
  await view.rerender(<SearchScreen />);
  expect(screen.getByRole("header", { name: "New on Artlog" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "View Me’s profile" })).toBeNull();
  expect(screen.getByRole("button", { name: "View Monica Reyes’s profile" })).toBeOnTheScreen();
});

it("says how to search when there is nothing to show yet", async () => {
  mockResults["tags:popular"] = [];
  mockResults["profiles:discover"] = { page: [], cursor: null, isDone: true };
  await render(<SearchScreen />);
  expect(screen.getByText("Find artworks, artists and people.")).toBeOnTheScreen();
});

it.each(["resolve", "reject"] as const)(
  "keeps the last dismissed suggestion out of fallback cards while saving, then handles %s",
  async (outcome) => {
    let settle!: () => void;
    mockMutation.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          settle = () => (outcome === "resolve" ? resolve(null) : reject(new Error("Dismissal failed")));
        }),
    );
    mockSession = { status: "ready", key: "account", profileId: "me", token: "token" };
    mockResults["suggestions:list"] = {
      friendCount: 0,
      people: [{ profile: monica, reason: { kind: "museum", venueName: "MoMA" } }],
    };
    mockResults["profiles:discover"] = {
      page: [monica, { ...monica, profileId: "theo", name: "Theo" }],
      cursor: null,
      isDone: true,
    };
    const toast = await renderHook(useToast);
    await render(<SearchScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Hide Monica Reyes from suggestions" }));
    expect(screen.getByRole("header", { name: "New on Artlog" })).toBeOnTheScreen();
    expect(mockArgs).toHaveBeenCalledWith("profiles:discover", { limit: 11, excludeDismissed: true });
    expect(screen.getByRole("button", { name: "View Theo’s profile" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "View Monica Reyes’s profile" })).toBeNull();

    await act(async () => settle());
    expect(screen.queryByRole("button", { name: "View Monica Reyes’s profile" }) !== null).toBe(outcome === "reject");
    expect(toast.result.current?.action?.label).toBe(outcome === "resolve" ? "Undo" : "Retry");
    if (outcome === "resolve") {
      await act(async () => toast.result.current!.action!.onPress());
    }
    expect(screen.getByRole("header", { name: "Suggested" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "View Monica Reyes’s profile" })).toBeOnTheScreen();
  },
);

it("offers a retry when people discovery fails on an otherwise empty screen", async () => {
  mockResults["tags:popular"] = [];
  mockResults["profiles:discover"] = new Error("Discovery unavailable");
  const view = await render(<SearchScreen />);

  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load people.");
  expect(screen.queryByText("Find artworks, artists and people.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Retry people" }));
  expect(mockRefresh).toHaveBeenCalledWith("profiles:discover");

  mockResults["profiles:discover"] = { page: [monica], cursor: null, isDone: true };
  await view.rerender(<SearchScreen />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "View Monica Reyes’s profile" })).toBeOnTheScreen();
});
