import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { Pressable, StyleSheet } from "react-native";

import { Gallery } from "@/constants/theme";
import { playToggleHaptic } from "@/lib/ui/haptics";

import { ListIcon, ListRow, ListSection } from "./list-row";

jest.mock("@/lib/ui/haptics");

it("opens a chosen row and highlights the letters that match the search", async () => {
  const onPress = jest.fn();
  await render(
    <ListSection title="Nearby">
      <ListRow
        first
        last
        title="MoMA · Museum of Modern Art"
        query="mo"
        subtitle="New York, United States"
        detail="0.3 mi"
        leading={<ListIcon name="building.columns" />}
        accessory="chevron"
        onPress={onPress}
      />
    </ListSection>,
  );

  expect(screen.getByRole("header", { name: "Nearby" })).toBeOnTheScreen();
  expect(screen.getByText("0.3 mi")).toBeOnTheScreen();
  const matches = screen.getAllByText("Mo");
  expect(matches).toHaveLength(2);
  for (const match of matches) {
    expect(StyleSheet.flatten(match.props.style)).toMatchObject({
      color: Gallery.accent,
      backgroundColor: Gallery.highlight,
    });
  }
  await fireEvent.press(screen.getByRole("button", { name: "MoMA · Museum of Modern Art" }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it("announces the selected choice and blocks taps while disabled", async () => {
  const onPress = jest.fn();
  await render(
    <>
      <ListRow first title="Kunstmuseum Basel" accessory="check" selected onPress={onPress} />
      <ListRow last title="Fondation Beyeler" accessory="check" disabled onPress={onPress} />
    </>,
  );

  expect(screen.getByRole("button", { name: "Kunstmuseum Basel" })).toBeSelected();
  const other = screen.getByRole("button", { name: "Fondation Beyeler" });
  expect(other).not.toBeSelected();
  expect(other).toBeDisabled();
  await fireEvent.press(other);
  expect(onPress).not.toHaveBeenCalled();
});

it("answers a multi-select tap with the toggle haptic for the state it moves to, and a single choice with none", async () => {
  const onPress = jest.fn();
  const view = await render(<ListRow first last title="Maya Chen" accessory="toggle" onPress={onPress} />);
  await fireEvent.press(screen.getByRole("button", { name: "Maya Chen" }));
  expect(playToggleHaptic).toHaveBeenLastCalledWith(true);

  await view.rerender(<ListRow first last title="Maya Chen" accessory="toggle" selected onPress={onPress} />);
  await fireEvent.press(screen.getByRole("button", { name: "Maya Chen" }));
  expect(playToggleHaptic).toHaveBeenLastCalledWith(false);

  await view.rerender(<ListRow first last title="Maya Chen" accessory="check" onPress={onPress} />);
  await fireEvent.press(screen.getByRole("button", { name: "Maya Chen" }));
  expect(playToggleHaptic).toHaveBeenCalledTimes(2);
  expect(onPress).toHaveBeenCalledTimes(3);
});

it("renders a row without a tap target when it has no action", async () => {
  await render(<ListRow first last title="Blocked person" subtitle="@blocked" />);

  expect(screen.getByText("Blocked person")).toBeOnTheScreen();
  expect(screen.queryByRole("button")).toBeNull();
});

it("keeps buttons in a tappable row reachable on their own", async () => {
  const open = jest.fn();
  const add = jest.fn();
  await render(
    <ListRow
      first
      last
      title="Ruth Asawa"
      accessibilityLabel="View Ruth Asawa’s profile"
      onPress={open}
      trailing={<Pressable accessibilityRole="button" accessibilityLabel="Add" onPress={add} />}
    />,
  );

  const row = screen.getByRole("button", { name: "View Ruth Asawa’s profile" });
  expect(within(row).queryByRole("button", { name: "Add" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Add" }));
  expect(add).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
  await fireEvent.press(row);
  expect(open).toHaveBeenCalledTimes(1);
});
