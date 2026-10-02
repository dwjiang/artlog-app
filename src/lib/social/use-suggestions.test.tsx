import { act, renderHook } from "@testing-library/react-native";
import type { getFunctionName } from "convex/server";

import { switchOwner } from "@/lib/account/owner-store";
import { dismissToast, useToast } from "@/lib/ui/toast";

import type { Suggestion } from "./types";
import type { SocialSession } from "./use-social-session";
import { useSuggestions } from "./use-suggestions";

const mockMutations: Record<string, jest.Mock> = {};
const mockOptions = jest.fn();
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("convex/browser", () => ({
  ConvexHttpClient: function (_url: string, options: object) {
    mockOptions(options);
    return {
      mutation: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
        const name = jest.requireActual<typeof import("convex/server")>("convex/server").getFunctionName(reference);
        return mockMutations[name](args);
      },
    };
  },
}));
let mockPeople: Suggestion[];
jest.mock("./use-social-query", () => ({
  useSocialQuery: () => ({ data: { friendCount: 1, people: mockPeople }, loading: false, refresh: jest.fn() }),
}));

const session = { status: "ready", key: "a", token: "token-a", profileId: "viewer-a", offline: false } as SocialSession;
const person = (name: string): Suggestion => ({
  profile: {
    profileId: name as never,
    name,
    username: name,
    avatar: "vermeer" as const,
    publishedWallCount: 0,
    relationship: { state: "none", revision: 0, requesterId: null, blocked: false, blockRevision: 0 },
  },
  reason: { kind: "museum", venueName: "MoMA" },
});

function useHarness(current = session) {
  return { suggestions: useSuggestions(current), toast: useToast() };
}

beforeEach(() => {
  jest.clearAllMocks();
  switchOwner("account:a", "scope-a");
  mockPeople = [person("maya"), person("priya")];
  mockMutations["suggestions:dismiss"] = jest.fn().mockResolvedValue(null);
  mockMutations["suggestions:restore"] = jest.fn().mockResolvedValue(null);
});

it("resets dismissals when the viewer changes and ignores the old Undo action", async () => {
  const { result, rerender } = await renderHook(useHarness, { initialProps: session });
  await act(async () => result.current.suggestions.dismiss(mockPeople[0]));
  const undo = result.current.toast!.action!.onPress;
  expect(result.current.suggestions.people.map((p) => p.profile.name)).toEqual(["priya"]);
  await act(() => switchOwner("account:b", "scope-b"));
  await rerender({ ...session, key: "b", token: "token-b", profileId: "viewer-b" as never });
  expect(result.current.suggestions.people.map((p) => p.profile.name)).toEqual(["maya", "priya"]);
  await act(async () => undo());
  expect(mockMutations["suggestions:restore"]).not.toHaveBeenCalled();
});

it.each(["resolve", "reject"] as const)("ignores an old viewer's late %s after a new dismissal", async (outcome) => {
  let settle!: () => void;
  mockMutations["suggestions:dismiss"].mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        settle = () => (outcome === "resolve" ? resolve(null) : reject(new Error("old request failed")));
      }),
  );
  const { result, rerender } = await renderHook(useHarness, { initialProps: session });
  await act(async () => result.current.suggestions.dismiss(mockPeople[0]));
  expect(mockOptions).toHaveBeenCalledWith(expect.objectContaining({ auth: "token-a" }));
  await act(() => switchOwner("account:b", "scope-b"));
  await rerender({ ...session, key: "b", token: "token-b", profileId: "viewer-b" as never });
  await act(async () => result.current.suggestions.dismiss(mockPeople[0]));
  const { toast } = result.current;
  await act(async () => settle());
  expect(result.current.toast).toBe(toast);
  expect(result.current.suggestions.people.map((p) => p.profile.name)).toEqual(["priya"]);
});
// A shown toast schedules its own dismissal; clearing it leaves no timer behind.
afterEach(() => dismissToast());

it("hides a dismissed person at once and brings them back with Undo", async () => {
  const { result } = await renderHook(useHarness);
  await act(async () => result.current.suggestions.dismiss(mockPeople[0]));
  expect(result.current.suggestions.people.map((p) => p.profile.name)).toEqual(["priya"]);
  expect(mockMutations["suggestions:dismiss"]).toHaveBeenCalledWith({ profileId: "maya" });
  expect(result.current.toast).toMatchObject({ message: "Suggestion hidden.", action: { label: "Undo" } });

  await act(async () => result.current.toast!.action!.onPress());
  expect(mockMutations["suggestions:restore"]).toHaveBeenCalledWith({ profileId: "maya" });
  expect(result.current.suggestions.people.map((p) => p.profile.name)).toEqual(["maya", "priya"]);
});

it("shows the person again with a retry when hiding fails", async () => {
  mockMutations["suggestions:dismiss"].mockRejectedValue(new Error("offline"));
  const { result } = await renderHook(useHarness);
  await act(async () => result.current.suggestions.dismiss(mockPeople[0]));
  expect(result.current.suggestions.people.map((p) => p.profile.name)).toEqual(["maya", "priya"]);
  expect(result.current.toast).toMatchObject({
    message: "Couldn’t hide this suggestion.",
    action: { label: "Retry" },
  });
});
