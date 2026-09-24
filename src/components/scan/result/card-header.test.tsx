import { fireEvent, render, screen } from "@testing-library/react-native";

import { CardHeader, photoFrameAspect } from "./card-header";

it("keeps the artwork identity visible when its local image cannot load", async () => {
  await render(
    <CardHeader
      cropUri="file:///missing.jpg"
      artworkTitle="Water Lilies"
      kind="soft"
    />,
  );
  await fireEvent(
    screen.getByLabelText("Your photo of this painting"),
    "error",
    {
      nativeEvent: { error: "Missing file" },
    },
  );
  expect(screen.getByText("Photo unavailable")).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByText("Maybe")).toBeOnTheScreen();
});

it("recovers the image when a different capture replaces a missing image", async () => {
  const view = await render(
    <CardHeader cropUri="file:///missing.jpg" kind="confident" />,
  );
  await fireEvent(
    screen.getByLabelText("Your photo of this painting"),
    "error",
    {
      nativeEvent: { error: "Missing file" },
    },
  );
  await view.rerender(
    <CardHeader cropUri="file:///new.jpg" kind="confident" />,
  );
  expect(screen.queryByText("Photo unavailable")).toBeNull();
  expect(
    screen.getByLabelText("Your photo of this painting"),
  ).toBeOnTheScreen();
});

it("offers crop adjustment on the photo only when a handler is given", async () => {
  const onAdjustCrop = jest.fn();
  const view = await render(
    <CardHeader cropUri="file:///crop.jpg" kind="confident" />,
  );
  expect(screen.queryByRole("button", { name: "Adjust crop" })).toBeNull();
  await view.rerender(
    <CardHeader
      cropUri="file:///crop.jpg"
      kind="confident"
      onAdjustCrop={onAdjustCrop}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Adjust crop" }));
  expect(onAdjustCrop).toHaveBeenCalledTimes(1);
});

it("fits the photo frame to the painting's shape within readable limits", () => {
  expect(photoFrameAspect(1270, 1000)).toBeCloseTo(1.27);
  expect(photoFrameAspect(800, 1000)).toBeCloseTo(0.8);
  expect(photoFrameAspect(500, 1000)).toBe(0.75);
  expect(photoFrameAspect(4000, 1000)).toBe(2);
  expect(photoFrameAspect(0, 0)).toBe(1.15);
});
