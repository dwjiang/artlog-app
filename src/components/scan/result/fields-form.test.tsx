import { fireEvent, render, screen } from "@testing-library/react-native";

import { draftFromCandidate } from "@/lib/result/snapshot";
import { LIMITS } from "@/shared/journal/limits";

import { lilies } from "./__fixtures__/scan";
import { FieldsForm } from "./fields-form";

it("pre-fills every field and reports edits by field", async () => {
  const onChange = jest.fn();
  await render(<FieldsForm draft={draftFromCandidate(lilies)} editable onChange={onChange} />);
  for (const label of ["Title", "Artist", "Date", "Medium", "Institution"]) {
    expect(screen.getByText(label)).toBeOnTheScreen();
  }
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("Water Lilies");
  expect(screen.getByLabelText("Institution").props.defaultValue).toBe("Metropolitan Museum of Art");
  await fireEvent.changeText(screen.getByLabelText("Artist"), "Monet");
  expect(onChange).toHaveBeenCalledWith("artist", "Monet");
});

it("leaves an unidentified card blank and locks the fields when told to", async () => {
  await render(<FieldsForm draft={draftFromCandidate(undefined)} editable={false} onChange={jest.fn()} />);
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("");
  expect(screen.getByLabelText("Title").props.editable).toBe(false);
});

it("preserves a long catalogue title when focused and left without an edit", async () => {
  const title = "A catalogue title with a detailed description ".repeat(6);
  const onChange = jest.fn();
  await render(<FieldsForm draft={draftFromCandidate({ title, artist: "Artist" })} editable onChange={onChange} />);
  expect(screen.getByDisplayValue(title)).toBeOnTheScreen();
  await fireEvent(screen.getByLabelText("Title"), "focus");
  await fireEvent(screen.getByLabelText("Title"), "blur");
  expect(onChange).not.toHaveBeenCalled();
});

it("limits a newly typed title", async () => {
  const onChange = jest.fn();
  await render(<FieldsForm draft={draftFromCandidate()} editable onChange={onChange} />);
  await fireEvent.changeText(screen.getByLabelText("Title"), "a".repeat(LIMITS.typedDetail + 1));
  expect(onChange).toHaveBeenLastCalledWith("title", "a".repeat(LIMITS.typedDetail));
});
