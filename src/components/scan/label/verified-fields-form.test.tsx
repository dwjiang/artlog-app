import { fireEvent, render, screen } from "@testing-library/react-native";

import { formStateFromFlow } from "@/lib/label/fields";

import type { LabelFlowDisplay } from "../../../../convex/lib/validators";
import { VerifiedFieldsForm } from "./verified-fields-form";

const flow: LabelFlowDisplay = {
  stage: "verified",
  evidence: ["tavily+image"],
  warnings: ["date_outside_lifespan"],
  moderation: "clear",
  updatedAt: 1,
  fields: {
    title: { value: "Water Lilies", evidence: "tavily+image", locked: true },
    artist: { value: "Claude Monet", evidence: "tavily+image", locked: true },
    date: { value: "1990", evidence: "weak", locked: false },
  },
};
const handlers = { onChange: jest.fn() };

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

it("lets verified fields be edited directly and reports each keystroke by field", async () => {
  await render(<VerifiedFieldsForm state={formStateFromFlow(flow)} warnings={flow.warnings} editable {...handlers} />);
  expect(screen.getByLabelText("Title").props.editable).toBe(true);
  expect(screen.getByLabelText("Date").props.editable).toBe(true);
  await fireEvent.changeText(screen.getByLabelText("Title"), "Nymphéas");
  expect(handlers.onChange).toHaveBeenCalledWith("title", "Nymphéas");
});

it("shows plausibility warnings and freezes everything when not editable", async () => {
  await render(
    <VerifiedFieldsForm state={formStateFromFlow(flow)} warnings={flow.warnings} editable={false} {...handlers} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("The date is outside the artist’s lifespan — please check");
  expect(screen.getByLabelText("Date").props.editable).toBe(false);
  expect(screen.queryByRole("button", { name: "Edit Title" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "More details" }));
  for (const label of ["Title", "Artist", "Date", "Accession number", "Medium", "Credit line"]) {
    expect(screen.getByText(label)).toBeOnTheScreen();
  }
});

it("keeps optional catalog details available without crowding the main review", async () => {
  const state = formStateFromFlow({
    ...flow,
    fields: {
      ...flow.fields,
      accession: { value: "A-42", evidence: "ocr", locked: false },
    },
  });
  await render(<VerifiedFieldsForm state={state} warnings={[]} editable {...handlers} />);
  expect(screen.queryByLabelText("Accession number")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "More details" }));
  expect(screen.getByLabelText("Accession number").props.defaultValue).toBe("A-42");
  await fireEvent.changeText(screen.getByLabelText("Accession number"), "A-43");
  expect(handlers.onChange).toHaveBeenCalledWith("accession", "A-43");
});
