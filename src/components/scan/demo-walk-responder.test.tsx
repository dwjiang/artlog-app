import { act, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { Tabs } from "expo-router/tabs";
import { renderRouter } from "expo-router/testing-library";
import { Text } from "react-native";

import { WALK_REQUEST_POLL_MS } from "@/lib/capture/demo-viewfinder";

import { DemoWalkResponder } from "./demo-walk-responder";

let mockRequestTime: number | undefined;
jest.mock("@/lib/capture/demo-viewfinder", () => ({
  WALK_REQUEST_POLL_MS: jest.requireActual("@/lib/capture/demo-viewfinder").WALK_REQUEST_POLL_MS,
  walkRequestTime: () => mockRequestTime,
}));

const routes = {
  _layout: () => (
    <>
      <Stack />
      <DemoWalkResponder />
    </>
  ),
  "(tabs)/_layout": () => (
    <Tabs>
      <Tabs.Screen name="(home)" />
      <Tabs.Screen name="(scan)" />
    </Tabs>
  ),
  "(tabs)/(home)/_layout": () => <Stack />,
  "(tabs)/(home)/index": () => <Text>Home</Text>,
  "(tabs)/(scan)/_layout": () => <Stack />,
  "(tabs)/(scan)/scan": () => <Text>Scan</Text>,
  "result/[scanId]": () => <Text>Result</Text>,
  artwork: () => <Text>Artwork</Text>,
  "visit-share/[visitId]/_layout": () => <Stack />,
  "visit-share/[visitId]/index": () => <Text>Share</Text>,
  "visit-share/[visitId]/photos": () => <Text>Share photos</Text>,
};

async function pickPainting(at: number) {
  mockRequestTime = at;
  await act(() => jest.advanceTimersByTime(WALK_REQUEST_POLL_MS));
}

beforeEach(() => {
  mockRequestTime = undefined;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it("opens Scan from another tab when the demo page picks a painting", async () => {
  const view = await renderRouter(routes, { initialUrl: "/" });
  await act(() => jest.advanceTimersByTime(WALK_REQUEST_POLL_MS * 4));
  expect(view.getPathname()).toBe("/");

  await pickPainting(1_000);

  expect(view.getPathname()).toBe("/scan");
  expect(screen.getByText("Scan")).toBeOnTheScreen();
});

it.each([
  ["a result and the artwork it opened", ["/result/one", "/artwork"]],
  ["a screen in its own stack", ["/result/one", "/visit-share/visit", "/visit-share/visit/photos"]],
])("closes %s to return to the Scan tab underneath", async (_case, pushes) => {
  const view = await renderRouter(routes, { initialUrl: "/scan" });
  for (const path of pushes) await act(() => router.push(path as never));

  await pickPainting(1_000);

  expect(view.getPathname()).toBe("/scan");
  expect(router.canDismiss()).toBe(false);
});

it("leaves the judge where they went while a picked painting waits, until the next pick", async () => {
  const view = await renderRouter(routes, { initialUrl: "/" });
  await pickPainting(1_000);
  await act(() => router.navigate("/"));
  await act(() => jest.advanceTimersByTime(WALK_REQUEST_POLL_MS * 4));
  expect(view.getPathname()).toBe("/");

  await pickPainting(2_000);

  expect(view.getPathname()).toBe("/scan");
});
