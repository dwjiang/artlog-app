import { fireEvent, render, screen } from "@testing-library/react-native";

import { bridge, haystacks } from "./__fixtures__/scan";
import { NotRightSheet } from "./not-right-sheet";

const handlers = {
  onDismiss: jest.fn(),
  onPick: jest.fn(),
  onLabel: jest.fn(),
  onManual: jest.fn(),
  onSavePhoto: jest.fn(),
};
beforeEach(() => jest.clearAllMocks());

it("shows the runner-ups first and the label as the way out", async () => {
  await render(<NotRightSheet open runnerUps={[bridge, haystacks]} {...handlers} />);
  expect(screen.getByText("Other possible matches")).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", {
      name: "The Japanese Footbridge, Claude Monet, 31% confidence",
    }),
  );
  expect(handlers.onPick).toHaveBeenCalledWith(bridge);
  await fireEvent.press(screen.getByRole("button", { name: "Scan the museum label" }));
  expect(handlers.onLabel).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Enter details myself" }));
  expect(handlers.onManual).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Save just the photo" }));
  expect(handlers.onSavePhoto).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Back to result" }));
  expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
});

it("goes straight to the label without runner-ups and surfaces a notice", async () => {
  await render(<NotRightSheet open runnerUps={[]} notice="This device can’t send feedback yet." {...handlers} />);
  expect(screen.getByText("No other matches found")).toBeOnTheScreen();
  expect(screen.getByText("This device can’t send feedback yet.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Scan the museum label" })).toBeOnTheScreen();
});

it("renders nothing while closed", async () => {
  expect((await render(<NotRightSheet open={false} runnerUps={[bridge]} {...handlers} />)).toJSON()).toBeNull();
});
