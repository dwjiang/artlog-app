import { fireEvent, render, screen } from "@testing-library/react-native";

import { CardHeader } from "./card-header";

it("keeps the artwork identity visible when its local image cannot load", async () => {
  await render(<CardHeader cropUri="file:///missing.jpg" artworkTitle="Water Lilies" kind="soft" />);
  await fireEvent(screen.getByLabelText("Your photo of this painting"), "error", {
    nativeEvent: { error: "Missing file" },
  });
  expect(screen.getByText("Photo unavailable")).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByText("Maybe")).toBeOnTheScreen();
});

it("recovers the image when a different capture replaces a missing image", async () => {
  const view = await render(<CardHeader cropUri="file:///missing.jpg" kind="confident" />);
  await fireEvent(screen.getByLabelText("Your photo of this painting"), "error", {
    nativeEvent: { error: "Missing file" },
  });
  await view.rerender(<CardHeader cropUri="file:///new.jpg" kind="confident" />);
  expect(screen.queryByText("Photo unavailable")).toBeNull();
  expect(screen.getByLabelText("Your photo of this painting")).toBeOnTheScreen();
});
