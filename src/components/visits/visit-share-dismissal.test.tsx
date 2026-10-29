import { act, fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import { Alert, Text, View, type AlertButton } from "react-native";

import type { VisitSummary } from "@/lib/journal/visit-summaries";
import type { useVisitSharing } from "@/lib/visits/use-visit-sharing";

import { VisitShareLayout, VisitShareScreen } from "./visit-share-flow";

// Share visit's Cancel dismisses its own nested stack, so its guard must hold the route that holds that stack.
const mockVisit = {
  visibility: "public",
  localId: "visit",
  owner: "account:a",
  venueName: "Museum",
  visitedOn: "2024-02-29",
  reflection: null,
  works: [],
} as unknown as VisitSummary;
jest.mock("@/lib/journal/use-visits", () => ({
  useVisits: () => ({ owner: mockVisit.owner, visits: [mockVisit], loading: false }),
}));
const mockEdit = jest.fn();
jest.mock("@/lib/visits/use-visit-sharing", () => ({
  useVisitSharing: () =>
    ({
      acknowledged: { audience: "public", status: "private", removed: false, revision: 0, companions: [] },
      draft: {
        audience: "public",
        visitLocalId: "visit",
        revision: 0,
        saveLocalIds: [],
        color: "#CDD0CA",
        pattern: "stripe",
        companionIds: [],
      },
      profileRequired: false,
      conflict: false,
      busy: false,
      controller: { load: jest.fn(), edit: mockEdit, publish: jest.fn() },
      token: "token",
    }) as unknown as ReturnType<typeof useVisitSharing>,
}));
jest.mock("react-native-sortables", () => ({ __esModule: true, default: { Grid: () => null } }));
jest.mock("drizzle-orm/expo-sqlite", () => ({
  ...jest.requireActual("drizzle-orm/expo-sqlite"),
  useLiveQuery: () => ({ data: [] }),
}));
jest.mock("convex/react", () => ({ ...jest.requireActual("convex/react"), useMutation: () => jest.fn() }));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ key: "a", status: "ready", profileId: "me", offline: false, safetyChecks: true }),
}));
jest.mock("@/lib/social/use-friends", () => ({
  useFriends: () => ({ data: [], loading: false, error: undefined, refresh: jest.fn() }),
}));
jest.mock("@/lib/social/use-social-query", () => ({ useSocialQuery: () => ({ data: [], refresh: jest.fn() }) }));

let alert: jest.SpyInstance;
beforeEach(() => {
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const open = async () => {
  const view = await renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>Home</Text>,
      "visit-share/[visitId]/_layout": VisitShareLayout,
      "visit-share/[visitId]/index": VisitShareScreen,
      "visit-share/[visitId]/photos": () => <View />,
      "visit-share/[visitId]/companions": () => <View />,
    },
    { initialUrl: "/" },
  );
  await act(() => router.push("/visit-share/visit"));
  await screen.findByRole("button", { name: "Friends" });
  return view;
};

// The native header's Cancel isn't rendered under Jest; it calls `router.dismiss()`.
it("dismisses the whole flow from Cancel while the draft is as it opened", async () => {
  const view = await open();
  await act(() => router.dismiss());
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
});

it("asks before Cancel dismisses the whole flow with a changed draft, and dismisses it on Discard", async () => {
  const view = await open();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(mockEdit).toHaveBeenCalledWith({ audience: "friends" });
  await act(() => router.dismiss());
  expect(view.getPathname()).toBe("/visit-share/visit");
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  const [, , buttons] = alert.mock.lastCall as [string, undefined, AlertButton[]];
  await act(() => buttons.find((button) => button.text === "Discard Edits")?.onPress?.());
  expect(view.getPathname()).toBe("/");
});
