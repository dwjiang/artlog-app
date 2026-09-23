import { fireEvent, render, screen } from "@testing-library/react-native";

import { FieldsForm } from "./fields-form";
import { draftFromCandidate } from "@/lib/result/snapshot";
import { lilies } from "./__fixtures__/scan";

it("pre-fills every field and reports edits by field", async () => {
  const onChange = jest.fn();
  await render(<FieldsForm draft={draftFromCandidate(lilies)} editable onChange={onChange} />);
  for (const label of ["Title", "Artist", "Date", "Medium", "Institution"])
    expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("Water Lilies");
  expect(screen.getByLabelText("Institution").props.defaultValue).toBe(
    "Metropolitan Museum of Art",
  );
  await fireEvent.changeText(screen.getByLabelText("Artist"), "Monet");
  expect(onChange).toHaveBeenCalledWith("artist", "Monet");
});

it("leaves an unidentified card blank and locks the fields when told to", async () => {
  await render(
    <FieldsForm draft={draftFromCandidate(undefined)} editable={false} onChange={jest.fn()} />,
  );
  expect(screen.getByLabelText("Title").props.defaultValue).toBe("");
  expect(screen.getByLabelText("Title").props.editable).toBe(false);
});
