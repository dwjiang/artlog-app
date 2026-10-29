import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { Dimensions } from "react-native";

import { bridge, haystacks } from "./__fixtures__/scan";
import { NotRightSheet } from "./not-right-sheet";

const handlers = {
  onDismiss: jest.fn(),
  onOpen: jest.fn(),
  onLabel: jest.fn(),
  onManual: jest.fn(),
  onSavePhoto: jest.fn(),
};
beforeEach(() => jest.clearAllMocks());

const originalWindow = Dimensions.get("window");
afterEach(() => Dimensions.set({ window: originalWindow }));

it("keeps all recovery actions directly available alongside the paintings to open", async () => {
  await render(<NotRightSheet open runnerUps={[bridge, haystacks]} {...handlers} />);
  expect(screen.getByText("Other possible matches")).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", {
      name: "The Japanese Footbridge, Claude Monet, 1899, 31% confidence",
    }),
  );
  expect(handlers.onOpen).toHaveBeenCalledWith(bridge);
  await fireEvent.press(screen.getByRole("button", { name: "Scan the museum label" }));
  expect(handlers.onLabel).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Enter details manually" }));
  expect(handlers.onManual).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Save photo only" }));
  expect(handlers.onSavePhoto).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Close matches" }));
  expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
});

it("keeps recovery available without runner-ups and surfaces a notice", async () => {
  await render(<NotRightSheet open runnerUps={[]} notice="This device can’t send feedback yet." {...handlers} />);
  expect(screen.getByText("No other matches found")).toBeOnTheScreen();
  expect(screen.getByText("This device can’t send feedback yet.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Scan the museum label" })).toBeOnTheScreen();
});

it("only offers recovery actions that are available", async () => {
  await render(
    <NotRightSheet
      open
      runnerUps={[bridge]}
      onOpen={handlers.onOpen}
      onLabel={handlers.onLabel}
      onDismiss={handlers.onDismiss}
    />,
  );
  expect(screen.getByRole("button", { name: "Scan the museum label" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Enter details manually" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save photo only" })).toBeNull();
});

it("renders nothing while closed", async () => {
  expect((await render(<NotRightSheet open={false} runnerUps={[bridge]} {...handlers} />)).toJSON()).toBeNull();
});

it("scrolls the heading and recovery actions with the matches at accessibility text sizes", async () => {
  const standardWindow = { ...originalWindow, fontScale: 1 };
  Dimensions.set({ window: standardWindow });
  await render(<NotRightSheet open runnerUps={[bridge, haystacks]} {...handlers} />);
  const choices = () => within(screen.getByLabelText("Possible matches"));
  expect(choices().queryByRole("button", { name: "Save photo only" })).toBeNull();
  await act(() => Dimensions.set({ window: { ...originalWindow, fontScale: 3.12 } }));
  expect(choices().getByRole("header", { name: "Other possible matches" })).toBeOnTheScreen();
  for (const name of ["Scan the museum label", "Enter details manually", "Save photo only", "Close matches"]) {
    expect(choices().getByRole("button", { name })).toBeOnTheScreen();
  }
  await fireEvent.press(choices().getByRole("button", { name: /^The Japanese Footbridge,/ }));
  expect(handlers.onOpen).toHaveBeenCalledWith(bridge);
  await act(() => Dimensions.set({ window: standardWindow }));
  expect(choices().queryByRole("button", { name: "Save photo only" })).toBeNull();
});
