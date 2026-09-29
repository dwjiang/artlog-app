import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { LABEL_BUTTON, SaveBar } from "./save-bar";

const handlers = {
  onSave: jest.fn(),
  onViewSaved: jest.fn(),
};
beforeEach(() => jest.clearAllMocks());

it("keeps one save action in place while saving and allows retry after failure", async () => {
  const view = await render(<SaveBar canSave saving={false} {...handlers} />);
  await fireEvent.press(screen.getByRole("button", { name: "Save to collection" }));
  expect(handlers.onSave).toHaveBeenCalledTimes(1);
  await view.rerender(<SaveBar canSave saving {...handlers} />);
  expect(screen.getByRole("button", { name: "Save to collection", value: { text: "Saving…" } })).toBeDisabled();
  await view.rerender(<SaveBar canSave saving={false} error="Couldn’t save. Try again." {...handlers} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t save. Try again.");
  expect(screen.getByRole("button", { name: "Save to collection" })).toBeEnabled();
});

it("disables invalid details before saving and swaps to the collection link once saved", async () => {
  const view = await render(<SaveBar canSave={false} saving={false} {...handlers} />);
  expect(screen.getByRole("button", { name: "Save to collection" })).toBeDisabled();
  expect(screen.getByText("Shorten these details to save this work.")).toBeOnTheScreen();
  await view.rerender(<SaveBar canSave saving={false} savedId="saved-1" {...handlers} />);
  expect(screen.queryByRole("button", { name: "Save to collection" })).toBeNull();
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "View artwork" }));
  expect(handlers.onViewSaved).toHaveBeenCalledTimes(1);
});

it("takes another verb for cards that save without a result", async () => {
  await render(
    <SaveBar
      saveLabel="Save anyway"
      canSave
      saving={false}
      onSave={handlers.onSave}
      onViewSaved={handlers.onViewSaved}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save anyway" }));
  expect(handlers.onSave).toHaveBeenCalledTimes(1);
});

it("shows the visit above the actions until the work is saved", async () => {
  const visit = <Text>Visit: Today · The Met</Text>;
  const view = await render(<SaveBar canSave saving={false} {...handlers} visit={visit} />);
  expect(screen.getByText("Visit: Today · The Met")).toBeOnTheScreen();
  await view.rerender(<SaveBar canSave saving={false} savedId="saved-1" {...handlers} visit={visit} />);
  expect(screen.queryByText("Visit: Today · The Met")).toBeNull();
});
