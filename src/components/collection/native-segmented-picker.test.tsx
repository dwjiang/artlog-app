import { fireEvent, render, screen } from "@testing-library/react-native";
import { NativeSegmentedPicker } from "./native-segmented-picker";

it("keeps icon options labeled and exposes the selected visit view", async () => {
  const onChange = jest.fn();
  const options = [
    { value: "list", label: "List", icon: "list.bullet" },
    { value: "globe", label: "Globe", icon: "globe" },
  ] as const;
  await render(
    <NativeSegmentedPicker
      compact
      label="Visit view"
      value="globe"
      options={[...options]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("button", { name: "Globe", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "List", selected: false }));
  expect(onChange).toHaveBeenCalledWith("list");
  await screen.rerender(
    <NativeSegmentedPicker
      compact
      label="Visit view"
      value="list"
      options={[...options]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("button", { name: "List", selected: true })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Globe", selected: false })).toBeOnTheScreen();
});

it("preserves selection and blocks changes while disabled", async () => {
  const onChange = jest.fn();
  await render(
    <NativeSegmentedPicker
      label="Collection view"
      value="wall"
      disabled
      options={[
        { value: "wall", label: "Wall" },
        { value: "visits", label: "Visits" },
      ]}
      onChange={onChange}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Wall", selected: true, disabled: true }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Visits", disabled: true }));
  expect(onChange).not.toHaveBeenCalled();
});
