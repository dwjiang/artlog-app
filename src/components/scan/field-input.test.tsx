import { fireEvent, render, screen } from "@testing-library/react-native";
import { createRef } from "react";

import { FieldInput, type FieldInputRef } from "./field-input";

it.each([
  ["abcdef", "abcde"],
  ["abc🎨z", "abc🎨"],
  ["abcd🎨", "abcd"],
  ["🎨🎨🎨", "🎨🎨"],
])("limits %s by UTF-16 length without splitting an emoji", async (value, expected) => {
  const ref = createRef<FieldInputRef>();
  const onChangeText = jest.fn();
  const onBlur = jest.fn();
  await render(
    <FieldInput
      ref={ref}
      label="Note"
      defaultValue=""
      editable
      autoCapitalize="sentences"
      maxLength={5}
      onChangeText={onChangeText}
      onBlur={onBlur}
    />,
  );
  await fireEvent.changeText(screen.getByLabelText("Note"), value);
  expect(onChangeText).toHaveBeenLastCalledWith(expected);
  expect(ref.current?.getText()).toBe(expected);
  await fireEvent(screen.getByLabelText("Note"), "blur");
  expect(onChangeText).toHaveBeenLastCalledWith(expected);
  expect(onBlur).toHaveBeenCalledTimes(1);
});

it("hands the field's text to a form that missed it when the field loses focus, and stays quiet otherwise", async () => {
  const onChangeText = jest.fn();
  const field = (defaultValue: string) => (
    <FieldInput label="Title" defaultValue={defaultValue} editable autoCapitalize="words" onChangeText={onChangeText} />
  );
  const view = await render(field(""));
  await fireEvent.changeText(screen.getByLabelText("Title"), "The Last Day of Pompeii");
  await fireEvent(screen.getByLabelText("Title"), "blur");
  expect(onChangeText.mock.calls).toEqual([["The Last Day of Pompeii"], ["The Last Day of Pompeii"]]);
  await view.rerender(field("The Last Day of Pompeii"));
  await fireEvent(screen.getByLabelText("Title"), "blur");
  expect(onChangeText).toHaveBeenCalledTimes(2);
});
