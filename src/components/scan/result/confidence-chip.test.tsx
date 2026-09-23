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
  if (kind !== "confident") expect(screen.queryByText("Match")).toBeNull();
});
