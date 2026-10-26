import path from "node:path";

import { getStateFromPath } from "expo-router/build/fork/getStateFromPath";
import { getNavigationConfig } from "expo-router/build/getLinkingConfig";
import { getExactRoutes } from "expo-router/build/getRoutes";
import { createSeededRootState } from "expo-router/build/global-state/createSeededNavigationState";
import { withLoadedLayouts } from "expo-router/build/layoutAnchor";
import { requireContext } from "expo-router/build/testing-library/context-stubs";
import type { PropsWithChildren } from "react";

jest.mock("./visits/visit-share-flow", () => ({
  VisitShareLayout: () => null,
}));
jest.mock("@/lib/widgets/widget-provider", () => ({
  WidgetProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock("@/lib/widgets/visit-activity-sync", () => ({ VisitActivitySync: () => null }));

const routes = getExactRoutes(requireContext(path.resolve(process.cwd(), "src/app")))!;
const config = getNavigationConfig(routes, true, { sitemap: true, notFound: true });

// Use the real route files, URL parser, and initial-state seeding (which adds layout anchors) without mounting
// native navigators.
function getRootState(url: string) {
  const state = withLoadedLayouts(() => createSeededRootState(getStateFromPath(url, config), routes));
  if (state instanceof Promise) throw new Error("Route layouts should load synchronously under Jest.");
  return state?.routes[0].state;
}

function getTabsState(path: string) {
  return getRootState(path)?.routes.find((route) => route.name === "(tabs)")?.state;
}

describe("App navigation", () => {
  it("opens Home at the root URL", () => {
    const tabs = getTabsState("/");
    expect(tabs?.routes[tabs.index ?? 0]).toMatchObject({
      name: "(home)",
      state: { routes: [{ name: "index" }] },
    });
  });

  it.each(["scan", "collection", "search"])("opens the %s tab at its own URL", (tab) => {
    const tabs = getTabsState(`/${tab}`);
    expect(tabs?.routes[tabs.index ?? 0]).toMatchObject({
      name: `(${tab})`,
      state: { routes: [{ name: tab }] },
    });
  });

  it.each([
    "settings",
    "widgets",
    "people",
    "create-profile",
    "artwork",
    "venue-picker",
    "queue",
    "visit-create",
    "visit-globe",
  ])("keeps the tabs underneath a directly opened %s", (sheet) => {
    const root = getRootState(`/${sheet}`);
    expect(root?.routes.map((route) => route.name)).toEqual(["(tabs)", sheet]);
    expect(root?.index).toBe(1);
  });

  it("opens a tag page over the tabs", () => {
    const root = getRootState("/tag/monet");
    expect(root?.routes.map((route) => route.name)).toEqual(["(tabs)", "tag/[tag]"]);
    expect(root?.routes[1]).toMatchObject({ params: { tag: "monet" } });
  });

  it("opens sharing with its nested photo choice route", () => {
    const root = getRootState("/visit-share/demo/photos?saveId=painting");
    expect(root?.routes.map((route) => route.name)).toEqual(["(tabs)", "visit-share/[visitId]"]);
    expect(root?.routes[1]).toMatchObject({
      params: { visitId: "demo" },
      state: { routes: [{ name: "photos", params: { saveId: "painting" } }] },
    });
  });

  it("opens a widget artwork at its visit with Home underneath for Back", () => {
    const root = getRootState("/saved/painting?visitId=museum-visit");
    expect(root?.routes.map((route) => route.name)).toEqual(["(tabs)", "saved/[savedId]"]);
    expect(root?.routes[1].params).toMatchObject({
      savedId: "painting",
      visitId: "museum-visit",
    });
  });

  // Artwork and visit details open above whichever tab is active, so a scan never switches to Collection.
  it.each([
    ["journal/demo", "journal/[visitId]", { visitId: "demo" }],
    ["saved/demo", "saved/[savedId]", { savedId: "demo" }],
  ])("opens %s above the tabs instead of inside Collection", (path, name, params) => {
    const root = getRootState(`/${path}`);
    expect(root?.routes.map((route) => route.name)).toEqual(["(tabs)", name]);
    expect(root?.index).toBe(1);
    expect(root?.routes[1].params).toMatchObject(params);
    expect(getTabsState(`/${path}`)?.routes.find((route) => route.name === "(collection)")?.state).toBeUndefined();
  });

  it.each(["result", "label"])("opens %s above the tabs with the capture identifier", (screen) => {
    const root = getRootState(`/${screen}/demo`);
    expect(root?.routes.map((route) => route.name)).toEqual(["(tabs)", `${screen}/[scanId]`]);
    expect(root?.index).toBe(1);
    expect(root?.routes[1].params).toMatchObject({ scanId: "demo" });
  });

  it("opens the artwork archive above the collection tab", () => {
    const root = getRootState("/all-artworks");
    expect(root?.routes.map((route) => route.name)).toEqual(["(tabs)", "all-artworks"]);
  });

  it.each(["visit/post-id", "profile/profile-id"])("opens %s above the tabs", (path) => {
    const root = getRootState(`/${path}`);
    expect(root?.routes[0].name).toBe("(tabs)");
    expect(root?.routes[1].name).toBe(path.startsWith("visit") ? "visit/[postId]" : "profile/[profileId]");
  });
});
