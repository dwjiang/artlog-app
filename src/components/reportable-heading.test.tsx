import { render, screen } from "@testing-library/react-native";
import { StyleSheet, Text, useWindowDimensions } from "react-native";

import { CompactBarMaxTextScale } from "@/constants/theme";
import type { ContentReportTarget } from "@/lib/social/report";

import type { Id } from "../../convex/_generated/dataModel";
import { ReportableHeading } from "./reportable-heading";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 402, height: 874, scale: 3, fontScale: 1 })),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const report: ContentReportTarget = {
  kind: "audio",
  artworkId: "artwork-1" as Id<"artworks">,
  renderId: "render-1",
};
const LARGEST_TEXT_SCALE = 3.571;

// The flag is drawn, not read: VoiceOver hears only the button's label.
function flagWidth() {
  const [flag] = screen.getByRole("button", { name: "Report audio" }).children;
  return typeof flag === "string" ? undefined : StyleSheet.flatten(flag.props.style).width;
}

it("grows the flag with Report's text at the largest text size", async () => {
  jest.mocked(useWindowDimensions).mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1 });
  await render(
    <ReportableHeading report={report}>
      <Text>AI-generated voice</Text>
    </ReportableHeading>,
  );
  const width = flagWidth()!;
  jest.mocked(useWindowDimensions).mockReturnValue({
    width: 402,
    height: 874,
    scale: 3,
    fontScale: LARGEST_TEXT_SCALE,
  });
  await screen.rerender(
    <ReportableHeading report={report}>
      <Text>AI-generated voice</Text>
    </ReportableHeading>,
  );
  expect(flagWidth()).toBeCloseTo(width * LARGEST_TEXT_SCALE);
  expect(screen.getByText("Report").props.maxFontSizeMultiplier).toBeUndefined();
});

it("stops the flag where a capped heading stops Report's text", async () => {
  jest.mocked(useWindowDimensions).mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1 });
  await render(
    <ReportableHeading report={report} maxFontSizeMultiplier={CompactBarMaxTextScale}>
      <Text>Transcript</Text>
    </ReportableHeading>,
  );
  const width = flagWidth()!;
  jest.mocked(useWindowDimensions).mockReturnValue({
    width: 402,
    height: 874,
    scale: 3,
    fontScale: LARGEST_TEXT_SCALE,
  });
  await screen.rerender(
    <ReportableHeading report={report} maxFontSizeMultiplier={CompactBarMaxTextScale}>
      <Text>Transcript</Text>
    </ReportableHeading>,
  );
  expect(flagWidth()).toBeCloseTo(width * CompactBarMaxTextScale);
  expect(screen.getByText("Report").props.maxFontSizeMultiplier).toBe(CompactBarMaxTextScale);
});
