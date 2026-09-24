import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { CollectionVisits } from "./collection-visits";
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ status: "signed-out", key: "guest" }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({}),
}));
let mockMode: "list" | "globe" | undefined = "list";
jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock("./visit-globe", () => ({
  VisitGlobe: () => {
    const { Text } = jest.requireActual("react-native");
    return <Text>Globe canvas</Text>;
  },
}));
jest.mock("@/lib/journal/use-visit-view", () => ({
  useVisitView: () => ({ mode: mockMode, changeMode: jest.fn() }),
}));
jest.mock("../collection/saved-work-image", () => ({
  SavedWorkImage: () => null,
}));
const visit = {
  localId: "v",
  venueId: "m",
  venueName: "Museum",
  visitedOn: "2024-02-29",
  location: "Paris",
  works: [],
} as unknown as VisitSummary;
const props = {
  owner: "a",
  visits: [visit],
  header: <View />,
  loading: false,
  clearSearch: jest.fn(),
  onSearchChange: jest.fn(),
};
beforeEach(() => {
  mockMode = "list";
});

it.each(["list", "globe"] as const)(
  "offers one first-visit action before there is content for the %s view",
  async (mode) => {
    mockMode = mode;
    await render(<CollectionVisits {...props} visits={[]} search="" />);
    expect(screen.getByRole("header", { name: "No visits yet." })).toBeOnTheScreen();
    expect(screen.getAllByRole("button", { name: "Add visit" })).toHaveLength(1);
    expect(screen.queryByLabelText("Search your visits")).toBeNull();
    expect(screen.queryByRole("button", { name: "Globe" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Add visit" }));
    expect(router.push).toHaveBeenCalledWith("/visit-create");
  },
);
it("keeps the search field mounted through too-short, unmatched and matched queries", async () => {
  const view = await render(<CollectionVisits {...props} search="" />);
  const field = screen.getByLabelText("Search your visits");
  for (const search of ["m", "zzz", "mu"]) {
    await view.rerender(<CollectionVisits {...props} search={search} />);
    expect(screen.getByLabelText("Search your visits")).toBe(field);
  }
  expect(screen.getByText("Museum")).toBeOnTheScreen();
});
it("keeps the collection header and view controls mounted when switching between list and globe", async () => {
  const mounted = jest.fn();
  const unmounted = jest.fn();
  function Header() {
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return <View />;
  }
  const view = await render(<CollectionVisits {...props} header={<Header />} search="" />);
  const globeButton = screen.getByRole("button", { name: "Globe" });
  for (const mode of ["globe", "list", "globe"] as const) {
    mockMode = mode;
    await view.rerender(<CollectionVisits {...props} header={<Header />} search="" />);
    expect(screen.getByRole("button", { name: "Globe" })).toBe(globeButton);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  }
  expect(screen.getByText("Globe canvas")).toBeOnTheScreen();
});
it("shows loading instead of the globe until the view preference is read", async () => {
  mockMode = undefined;
  await render(<CollectionVisits {...props} search="" />);
  expect(screen.getByRole("progressbar", { name: "Loading your visits…" })).toBeOnTheScreen();
  expect(screen.queryByText("Loading your visits…")).toBeNull();
  expect(screen.queryByText("Globe canvas")).toBeNull();
  expect(screen.getByRole("button", { name: "Globe" })).toBeDisabled();
});

it("holds visits behind the loading state until their places are read", async () => {
  const unplaced = {
    ...visit,
    location: "",
    city: undefined,
    regionName: undefined,
    country: undefined,
  };
  const view = await render(<CollectionVisits {...props} visits={[unplaced]} loading search="" />);
  expect(screen.getByRole("progressbar", { name: "Loading your visits…" })).toBeOnTheScreen();
  expect(screen.queryByText(/Location unavailable/)).toBeNull();
  expect(screen.queryByText(/1 museum/)).toBeNull();
  mockMode = "globe";
  await view.rerender(<CollectionVisits {...props} visits={[unplaced]} loading search="" />);
  expect(screen.getByRole("progressbar", { name: "Loading your visits…" })).toBeOnTheScreen();
  expect(screen.queryByText("Globe canvas")).toBeNull();
  await view.rerender(<CollectionVisits {...props} visits={[visit]} search="" />);
  expect(screen.getByText("Globe canvas")).toBeOnTheScreen();
});

it("opens the Scan tab from the visits failure recovery action", async () => {
  await render(<CollectionVisits {...props} search="" error={new Error("Read failed")} />);
  await fireEvent.press(screen.getByRole("button", { name: "Go to Scan" }));
  expect(router.push).toHaveBeenCalledWith("/scan");
});
