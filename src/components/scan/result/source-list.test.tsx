import { render, screen } from "@testing-library/react-native";

import { CompactBarMaxTextScale } from "@/constants/theme";

import { SourceList } from "./source-list";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

it("stops the source badges' initials growing at accessibility sizes, so they stay inside their circles", async () => {
  await render(
    <SourceList
      sources={[
        { number: 1, label: "Wikidata", url: "https://www.wikidata.org/wiki/Q1" },
        { number: 2, label: "Test Museum", url: "https://museum.example/lilies" },
      ]}
    />,
  );
  for (const initial of ["W", "T"]) {
    expect(screen.getByText(initial).props.maxFontSizeMultiplier).toBe(CompactBarMaxTextScale);
  }
});
