import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { LABEL_BUTTON, SaveBar } from "./save-bar";

const handlers = {
  onSave: jest.fn(),
  onLabel: jest.fn(),
  onViewSaved: jest.fn(),
};
beforeEach(() => jest.clearAllMocks());

it("offers the label only when a handler is given", async () => {
  const view = await render(
    <SaveBar
      canSave
      saving={false}
      onSave={handlers.onSave}
      onViewSaved={handlers.onViewSaved}
    />,
  );
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "Save to collection" }),
  );
  expect(handlers.onSave).toHaveBeenCalledTimes(1);
  await view.rerender(<SaveBar canSave={false} saving={false} {...handlers} />);
  await fireEvent.press(screen.getByRole("button", { name: LABEL_BUTTON }));
  expect(handlers.onLabel).toHaveBeenCalledTimes(1);
});

it("disables invalid details before saving and swaps to the collection link once saved", async () => {
  const view = await render(
    <SaveBar canSave={false} saving={false} {...handlers} />,
  );
  expect(
    screen.getByRole("button", { name: "Save to collection" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Shorten these details to save this work."),
  ).toBeOnTheScreen();
  await view.rerender(
    <SaveBar canSave saving={false} savedId="saved-1" {...handlers} />,
  );
  expect(
    screen.queryByRole("button", { name: "Save to collection" }),
  ).toBeNull();
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  await fireEvent.press(screen.getByRole("link", { name: "View artwork" }));
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

it("offers label confirmation first for uncertain matches while retaining manual saving", async () => {
  const view = await render(
    <SaveBar
      saveLabel="Save with these details"
      canSave
      saving={false}
      labelFirst
      {...handlers}
    />,
  );
  const buttons = screen.getAllByRole("button");
  expect(buttons[0]).toHaveTextContent(LABEL_BUTTON);
  await fireEvent.press(buttons[0]);
  expect(handlers.onLabel).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    screen.getByRole("button", { name: "Save with these details" }),
  );
  expect(handlers.onSave).toHaveBeenCalledTimes(1);
  await view.rerender(
    <SaveBar
      saveLabel="Save with these details"
      canSave
      saving
      labelFirst
      {...handlers}
    />,
  );
  expect(screen.getByRole("button", { name: LABEL_BUTTON })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Save with these details" }),
  ).toBeDisabled();
});

it("shows the visit above the actions until the work is saved", async () => {
  const visit = <Text>Visit: Today · The Met</Text>;
  const view = await render(
    <SaveBar canSave saving={false} {...handlers} visit={visit} />,
  );
  expect(screen.getByText("Visit: Today · The Met")).toBeOnTheScreen();
  await view.rerender(
    <SaveBar
      canSave
      saving={false}
      savedId="saved-1"
      {...handlers}
      visit={visit}
    />,
  );
  expect(screen.queryByText("Visit: Today · The Met")).toBeNull();
});
