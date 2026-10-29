import { fireEvent, render, screen } from "@testing-library/react-native";

import { GalleryIconButton } from "./gallery-icon-button";

it("lays its button out in the 44 pt host it draws in, whatever safe area overlaps it", async () => {
  const onPress = jest.fn();
  await render(<GalleryIconButton label="Settings" icon="gearshape" onPress={onPress} />);
  const button = screen.getByRole("button", { name: "Settings" });
  expect(button.parent).toHaveStyle({ width: 44, height: 44 });
  expect(button.parent?.props.ignoreSafeArea).toBe("all");
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});
