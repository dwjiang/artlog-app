import { render, screen } from "@testing-library/react-native";

import { PhotoVisibility } from "./photo-visibility";

let mockOwner = "account:a";
let mockScope: string | undefined = "scope-a";
let mockSession = { status: "ready", key: "a", offline: false };
let mockResult: {
  data?: {
    photoLocalId: string;
    wallPlacements: number;
    sharedVisits: number;
  }[];
  error?: Error;
} = {};
const mockQuery = jest.fn();
jest.mock("@/lib/account/owner-store", () => ({
  useLocalOwner: () => mockOwner,
  useServerScope: () => mockScope,
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => mockSession,
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (...args: unknown[]) => {
    mockQuery(...args);
    return mockResult;
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = "account:a";
  mockScope = "scope-a";
  mockSession = { status: "ready", key: "a", offline: false };
  mockResult = {};
});

it("shows the selected photo’s actual published visibility and updates after unsharing", async () => {
  mockResult = {
    data: [{ photoLocalId: "p", wallPlacements: 2, sharedVisits: 1 }],
  };
  const view = await render(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByText(/2 public wall placements · 1 shared visit/)).toBeOnTheScreen();
  mockResult = {
    data: [{ photoLocalId: "p", wallPlacements: 0, sharedVisits: 0 }],
  };
  await view.rerender(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByText("This photo is private.")).toBeOnTheScreen();
});

it("does not call a photo private before checking or while offline", async () => {
  const view = await render(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByLabelText("Checking photo visibility…")).toBeOnTheScreen();
  mockSession.offline = true;
  await view.rerender(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByText(/Photo visibility unavailable/)).toBeOnTheScreen();
  expect(screen.queryByText("This photo is private.")).toBeNull();
});

it("does not apply another photo’s sharing choices to the selected photo", async () => {
  mockResult = {
    data: [{ photoLocalId: "other", wallPlacements: 1, sharedVisits: 1 }],
  };
  await render(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByText("This photo is private.")).toBeOnTheScreen();
});

it("clears the old account’s visibility while the owner or server scope changes", async () => {
  mockResult = {
    data: [{ photoLocalId: "p", wallPlacements: 1, sharedVisits: 2 }],
  };
  const view = await render(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByText(/1 public wall placement · 2 shared visits/)).toBeOnTheScreen();
  mockOwner = "account:b";
  mockScope = undefined;
  mockSession = { status: "loading", key: "b", offline: false };
  await view.rerender(<PhotoVisibility savedId="s" photoId="p" />);
  expect(mockQuery.mock.calls.at(-1)?.slice(1)).toEqual(["skip", "b"]);
  expect(screen.getByLabelText("Checking photo visibility…")).toBeOnTheScreen();
  expect(screen.queryByText(/public wall placement/)).toBeNull();
  mockScope = "scope-b";
  mockSession.status = "ready";
  mockResult = { data: [] };
  await view.rerender(<PhotoVisibility savedId="s" photoId="p" />);
  expect(mockQuery.mock.calls.at(-1)?.slice(1)).toEqual([{ scope: "scope-b", savedLocalId: "s" }, "b"]);
  expect(screen.getByText("This photo is private.")).toBeOnTheScreen();
});

it("does not report a failed visibility check as private and treats absent public profiles as private", async () => {
  mockResult = { error: new Error("Network failed") };
  const view = await render(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByText(/Photo visibility unavailable/)).toBeOnTheScreen();
  expect(screen.queryByText("This photo is private.")).toBeNull();
  mockSession.status = "profile-required";
  await view.rerender(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByText("This photo is private.")).toBeOnTheScreen();
  expect(mockQuery.mock.calls.at(-1)?.[1]).toBe("skip");
});

it("shows local guest photos as private", async () => {
  mockOwner = "device:guest";
  await render(<PhotoVisibility savedId="s" photoId="p" />);
  expect(screen.getByText("This photo is private.")).toBeOnTheScreen();
  expect(mockQuery).not.toHaveBeenCalled();
});
