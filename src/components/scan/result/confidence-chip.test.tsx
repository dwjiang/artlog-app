import { render, screen } from "@testing-library/react-native";

import { ConfidenceChip } from "./confidence-chip";

it.each([
  ["confident", "Match"],
  ["soft", "Maybe"],
  ["unidentified", "Unidentified"],
  ["unsupported", "Update required"],
  ["failed", "Identification failed"],
] as const)("describes %s confidence in words", async (kind, label) => {
  await render(<ConfidenceChip kind={kind} />);
  expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.queryAllByText("Match")).toHaveLength(kind === "confident" ? 1 : 0);
});

it.each([
  ["confident", 0.97, "Match, 97% confidence"],
  ["soft", 0.314, "Maybe, 31% confidence"],
] as const)("shows the %s probability beside the word", async (kind, probability, label) => {
  await render(<ConfidenceChip kind={kind} probability={probability} />);
  expect(screen.getByText(`${Math.round(probability * 100)}% confidence`)).toBeOnTheScreen();
  expect(screen.getByLabelText(label)).toBeOnTheScreen();
});

it.each(["unidentified", "failed"] as const)("keeps a percentage off a %s chip", async (kind) => {
  await render(<ConfidenceChip kind={kind} probability={0.2} />);
  expect(screen.queryByText("20% confidence")).toBeNull();
});

it.each([
  ["label", "Match, from the label"],
  ["manual", "Match, from your details"],
] as const)("says a linked %s match came from the owner instead of a percentage", async (source, label) => {
  await render(<ConfidenceChip kind="confident" probability={0.9} source={source} />);
  expect(screen.getByLabelText(label)).toBeOnTheScreen();
  expect(screen.queryByText("90% confidence")).toBeNull();
});
