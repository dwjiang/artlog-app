import { fireEvent, render, screen } from "@testing-library/react-native";

import type { VisitSummary } from "@/lib/journal/visit-summaries";

import { VisitGlobe } from "./visit-globe";

const mockPush = jest.fn();
const mockDismissTo = jest.fn();
const mockReset = jest.fn();
const mockZoom = jest.fn();
const mockSettle = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
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
        onCluster,
      }: {
        pins: { id: string; label: string }[];
        onSelect: (id: string) => void;
        onCluster: (ids: string[]) => void;
      },
      ref: unknown,
    ) {
      React.useImperativeHandle(ref, () => ({
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
          <Pressable accessibilityRole="button" onPress={() => onCluster(pins.map((pin) => pin.id))}>
            <Text>Crowded pin</Text>
          </Pressable>
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

it("renders one pin per museum and opens a tapped museum’s visits", async () => {
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
  await fireEvent.press(screen.getByRole("button", { name: "Pin: Louvre" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/visit-place",
    params: { placeKey: "Paris", name: "Louvre", venueId: "Louvre" },
  });
});

it("settles the globe before opening the expanded view so it starts from the live camera", async () => {
  await render(<VisitGlobe visits={[visit("1", "Met", "New York")]} onList={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Expand globe" }));
  expect(mockSettle).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith("/visit-globe");
  expect(mockSettle.mock.invocationCallOrder[0]).toBeLessThan(mockPush.mock.invocationCallOrder[0]);
});

it("keeps visits without coordinates available through List", async () => {
  const onList = jest.fn();
  await render(<VisitGlobe visits={[{ ...visit("1", "Museum", "Paris"), coordinates: undefined }]} onList={onList} />);
  await fireEvent.press(screen.getByRole("button", { name: "Show List" }));
  expect(onList).toHaveBeenCalled();
});

it("dismisses the expanded modal into the tapped museum’s visits", async () => {
  await render(<VisitGlobe visits={[visit("1", "Met", "New York")]} expanded onList={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Pin: Met" }));
  expect(mockDismissTo).toHaveBeenCalledWith({
    pathname: "/visit-place",
    params: { placeKey: "New York", name: "Met", venueId: "Met" },
  });
});

it("dismisses the expanded modal into a museum chosen at a crowded pin", async () => {
  await render(
    <VisitGlobe visits={[visit("1", "Met", "New York"), visit("2", "MoMA", "New York")]} expanded onList={jest.fn()} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Crowded pin" }));
  await fireEvent.press(screen.getByRole("button", { name: "MoMA" }));
  expect(mockDismissTo).toHaveBeenCalledWith({
    pathname: "/visit-place",
    params: { placeKey: "New York", name: "MoMA", venueId: "MoMA" },
  });
});
