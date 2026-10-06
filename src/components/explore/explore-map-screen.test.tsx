import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform, ScrollView } from "react-native";

import { ExploreMapScreen } from "./explore-map-screen";

jest.mock("expo-router", () => ({
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
  router: { push: jest.fn() },
}));

jest.mock("expo-maps", () => {
  const { Pressable, View } = jest.requireActual("react-native");
  return {
    AppleMaps: {
      MapColorScheme: { LIGHT: "light" },
      View: ({
        markers,
        onMarkerClick,
      }: {
        markers: { id: string; title: string }[];
        onMarkerClick?: (marker: { id: string }) => void;
      }) => (
        <View>
          {markers.map((marker) => (
            <Pressable
              key={marker.id}
              accessibilityRole="button"
              accessibilityLabel={`${marker.title} pin`}
              onPress={() => onMarkerClick?.(marker)}
            />
          ))}
        </View>
      ),
    },
  };
});

afterEach(() => jest.restoreAllMocks());

it("reveals the selected museum at the top of the panel on every pin tap", async () => {
  jest.spyOn(Platform, "Version", "get").mockReturnValue("26.5");
  const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
  await render(<ExploreMapScreen />);
  expect(scrollTo).not.toHaveBeenCalled();

  for (const name of ["Smart Museum", "Wrightwood 659", "Wrightwood 659"]) {
    scrollTo.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: `${name} pin` }));

    const selected = screen.getByRole("button", { name: new RegExp(`^${name}`), selected: true });
    expect(screen.getAllByRole("button", { name: / mi · / })[0]).toBe(selected);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  }
});
