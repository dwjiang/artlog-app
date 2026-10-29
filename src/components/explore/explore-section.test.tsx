import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { ExploreShelf, shelfSnapProps } from "./explore-section";

describe("shelf snapping", () => {
  it("stops one item and its gap apart, quickly, at each item's leading edge", () => {
    expect(shelfSnapProps(216)).toEqual({ snapToInterval: 228, snapToAlignment: "start", decelerationRate: "fast" });
    expect(shelfSnapProps(264).snapToInterval).toBe(276);
  });

  it("snaps a shelf at the width of its items", async () => {
    await render(
      <ExploreShelf
        testID="shelf"
        itemWidth={216}
        data={["a", "b"]}
        keyExtractor={(item) => item}
        renderItem={({ item }) => <Text>{item}</Text>}
      />,
    );

    expect(screen.getByTestId("shelf")).toHaveProp("snapToInterval", 228);
    expect(screen.getByTestId("shelf")).toHaveProp("decelerationRate", "fast");
    expect(screen.getByTestId("shelf")).toHaveProp("horizontal", true);
  });
});
