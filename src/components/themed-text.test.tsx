import { render, screen } from "@testing-library/react-native";
import { useWindowDimensions } from "react-native";

import { ThemedText } from "./themed-text";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 })),
}));

describe("shared app text", () => {
  it("renders its children as visible text", async () => {
    await render(<ThemedText>Hello museum</ThemedText>);
    expect(screen.getByText("Hello museum")).toBeOnTheScreen();
  });

  it("gives unsized text the body role but leaves a caller-sized line at its natural height", async () => {
    await render(
      <>
        <ThemedText>Body copy</ThemedText>
        <ThemedText style={{ fontSize: 13 }}>Caption</ThemedText>
        <ThemedText style={[{ fontSize: 24 }, { color: "red" }]}>Numeral</ThemedText>
      </>,
    );
    expect(screen.getByText("Body copy")).toHaveStyle({
      fontSize: 16,
      lineHeight: 24,
    });
    expect(screen.getByText("Caption")).toHaveStyle({ fontSize: 13 });
    expect(screen.getByText("Caption")).not.toHaveStyle({ lineHeight: 24 });
    expect(screen.getByText("Numeral")).not.toHaveStyle({ lineHeight: 24 });
  });

  it("refreshes existing text measurements when Dynamic Type changes while the app is open", async () => {
    const ref = jest.fn();
    await render(
      <ThemedText ref={ref} variant="display">
        A long artist name — 藤田嗣治
      </ThemedText>,
    );
    const initialMountCalls = ref.mock.calls.length;
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 3.1 });
    await screen.rerender(
      <ThemedText ref={ref} variant="display">
        A long artist name — 藤田嗣治
      </ThemedText>,
    );
    expect(screen.getByText("A long artist name — 藤田嗣治")).toBeOnTheScreen();
    expect(ref.mock.calls.length).toBeGreaterThan(initialMountCalls);
    expect(ref.mock.calls.slice(initialMountCalls).some(([node]) => node === null)).toBe(true);
  });
});
