import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { createRef } from "react";
import { Text, type ViewInstance } from "react-native";

import { useReducedMotion } from "@/hooks/use-reduced-motion";

import { MotionPressable } from "./motion-pressable";

jest.mock("@/hooks/use-reduced-motion", () => ({ useReducedMotion: jest.fn(() => false) }));

beforeEach(() => {
  jest.mocked(useReducedMotion).mockReturnValue(false);
});

it("gives feedback on contact, preserves caller transforms, and forwards press events", async () => {
  const onPress = jest.fn();
  const onPressIn = jest.fn();
  const onPressOut = jest.fn();
  await render(
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel="Save artwork"
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => ({
        backgroundColor: pressed ? "blue" : "white",
        transform: [{ translateY: 2 }],
      })}
    >
      <Text>Save</Text>
    </MotionPressable>,
  );
  const button = screen.getByRole("button", { name: "Save artwork" });
  const event = { nativeEvent: { locationX: 10, locationY: 10 } };

  await fireEvent(button, "pressIn", event);
  expect(onPressIn).toHaveBeenCalledWith(event);
  expect(button).toHaveStyle({ backgroundColor: "blue", transform: [{ translateY: 2 }, { scale: 0.97 }] });
  expect(onPress).not.toHaveBeenCalled();

  await fireEvent(button, "pressOut", event);
  expect(onPressOut).toHaveBeenCalledWith(event);
  expect(button).toHaveStyle({ backgroundColor: "white", transform: [{ translateY: 2 }, { scale: 1 }] });
  await fireEvent.press(button, event);
  expect(onPress).toHaveBeenCalledWith(
    expect.objectContaining({ nativeEvent: expect.objectContaining(event.nativeEvent) }),
  );
});

it("keeps render-prop children and long presses working through the native pressable", async () => {
  const onLongPress = jest.fn();
  await render(
    <MotionPressable accessibilityRole="button" accessibilityLabel="Artwork actions" onLongPress={onLongPress}>
      {({ pressed }) => <Text>{pressed ? "Holding artwork" : "Artwork"}</Text>}
    </MotionPressable>,
  );

  await userEvent.longPress(screen.getByRole("button", { name: "Artwork actions" }));
  expect(onLongPress).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Artwork")).toBeOnTheScreen();
});

it("blocks disabled activation and clears feedback when an action becomes disabled", async () => {
  const onPress = jest.fn();
  const props = { accessibilityRole: "button" as const, accessibilityLabel: "Save artwork", onPress };
  await render(<MotionPressable {...props} />);
  await fireEvent(screen.getByRole("button"), "pressIn");
  await screen.rerender(<MotionPressable {...props} disabled />);

  const disabled = screen.getByRole("button", { name: "Save artwork" });
  expect(disabled).toBeDisabled();
  expect(disabled).toHaveStyle({ transform: [{ scale: 1 }] });
  await fireEvent.press(disabled);
  expect(onPress).not.toHaveBeenCalled();

  await screen.rerender(<MotionPressable {...props} />);
  expect(screen.getByRole("button")).toHaveStyle({ transform: [{ scale: 1 }] });
});

it("replaces press scaling with opacity as the reduced-motion preference changes", async () => {
  const props = { accessibilityRole: "button" as const, accessibilityLabel: "Clear search", onPress: jest.fn() };
  const style = { opacity: 0.8, transform: [{ translateX: 3 }] };
  await render(<MotionPressable {...props} style={style} />);
  await fireEvent(screen.getByRole("button"), "pressIn");
  expect(screen.getByRole("button")).toHaveStyle({ transform: [{ translateX: 3 }, { scale: 0.97 }] });

  jest.mocked(useReducedMotion).mockReturnValue(true);
  await screen.rerender(<MotionPressable {...props} style={style} />);
  expect(screen.getByRole("button")).toHaveStyle({ opacity: 0.8 * 0.72, transform: [{ translateX: 3 }, { scale: 1 }] });
  await fireEvent(screen.getByRole("button"), "pressOut");
  expect(screen.getByRole("button")).toHaveStyle({ opacity: 0.8, transform: [{ translateX: 3 }, { scale: 1 }] });
});

it("forwards the native view ref used by link previews and measurement", async () => {
  const ref = createRef<ViewInstance>();
  await render(<MotionPressable ref={ref} accessibilityRole="button" accessibilityLabel="Open artwork" />);
  expect(ref.current).not.toBeNull();
  expect(ref.current?.measure).toEqual(expect.any(Function));
});
