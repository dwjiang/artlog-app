import { fireEvent, render, screen } from "@testing-library/react-native";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { VisitGlobe } from "./visit-globe";
const mockPush = jest.fn(),
  mockDismissTo = jest.fn(),
  mockFocus = jest.fn(),
  mockReset = jest.fn(),
  mockZoom = jest.fn(),
  mockSettle = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
  },
}));
jest.mock("../collection/saved-work-image", () => ({
  SavedWorkImage: ({ title }: { title: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text accessibilityRole="image">{title}</Text>;
  },
}));
jest.mock("./globe-canvas", () => {
  const React = jest.requireActual("react");
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    GlobeCanvas: React.forwardRef(function MockGlobe(
      {
        pins,
        onSelect,
      }: {
        pins: { id: string; label: string }[];
        onSelect: (id: string) => void;
      },
      ref: unknown,
    ) {
      React.useImperativeHandle(ref, () => ({
        focus: mockFocus,
        reset: mockReset,
        zoom: mockZoom,
        settle: mockSettle,
      }));
      return (
        <View>
          {pins.map((pin) => (
            <Pressable accessibilityRole="button" key={pin.id} onPress={() => onSelect(pin.id)}>
              <Text>Pin: {pin.id}</Text>
            </Pressable>
          ))}
        </View>
      );
    }),
  };
});
const visit = (localId: string, venueId: string, city: string): VisitSummary =>
  ({
    localId,
    venueId,
    venueName: venueId,
    city,
    cityKey: city,
    visitedOn: "2024-02-29",
    coordinates: { latitude: 40, longitude: -73 },
    works: [],
  }) as unknown as VisitSummary;
beforeEach(() => jest.clearAllMocks());
it("renders one pin per museum and opens the selected museum’s visits", async () => {
  await render(
    <VisitGlobe
      visits={[
        visit("1", "Met", "New York"),
        visit("2", "Met", "New York"),
        visit("3", "MoMA", "New York"),
        visit("4", "Louvre", "Paris"),
      ]}
      onList={jest.fn()}
    />,
  );
  expect(screen.getAllByRole("button", { name: /^Pin:/ })).toHaveLength(3);
  expect(screen.getByText("2 visits · 0 artworks")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Pin: Louvre" }));
  expect(screen.getByText("1 visit · 0 artworks")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "View visits to Louvre" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/visit-place",
    params: { placeKey: "Paris", name: "Louvre", venueId: "Louvre" },
  });
});
it("offers a larger globe while keeping the selected museum visible", async () => {
  await render(<VisitGlobe visits={[visit("1", "Met", "New York")]} onList={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Expand globe" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/visit-globe",
    params: { venueId: "Met" },
  });
  expect(screen.getByRole("button", { name: "View visits to Met" })).toBeOnTheScreen();
});
it("settles the globe before opening the expanded view so it starts from the live camera", async () => {
  await render(<VisitGlobe visits={[visit("1", "Met", "New York")]} onList={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Expand globe" }));
  expect(mockSettle).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/visit-globe",
    params: { venueId: "Met" },
  });
  expect(mockSettle.mock.invocationCallOrder[0]).toBeLessThan(mockPush.mock.invocationCallOrder[0]);
});
it("keeps visits without coordinates available through List", async () => {
  const onList = jest.fn();
  await render(<VisitGlobe visits={[{ ...visit("1", "Museum", "Paris"), coordinates: undefined }]} onList={onList} />);
  await fireEvent.press(screen.getByRole("button", { name: "Show List" }));
  expect(onList).toHaveBeenCalled();
});
it("dismisses the expanded modal into the museum visit browser", async () => {
  await render(<VisitGlobe visits={[visit("1", "Met", "New York")]} expanded onList={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "View visits to Met" }));
  expect(mockDismissTo).toHaveBeenCalledWith({
    pathname: "/visit-place",
    params: { placeKey: "New York", name: "Met", venueId: "Met" },
  });
});
