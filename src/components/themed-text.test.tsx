import { render, renderHook, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useWindowDimensions } from "react-native";

import { DisplayMaxFontSize, Fonts } from "@/constants/theme";

import { TextScaleLimit, ThemedText, useTextScale } from "./themed-text";

const maxScale = (text: string) => screen.getByText(text).props.maxFontSizeMultiplier;

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

describe("Dynamic Type limits", () => {
  it("stops every display-face heading at the same point size, whatever its role or size", async () => {
    await render(
      <>
        <ThemedText variant="display">Bedroom</ThemedText>
        <ThemedText variant="pageTitle">Collection</ThemedText>
        <ThemedText type="title">Nighthawks</ThemedText>
        <ThemedText variant="section">Up next</ThemedText>
        <ThemedText variant="display" style={{ fontSize: 28, lineHeight: 34 }}>
          Sunflowers
        </ThemedText>
        <ThemedText style={{ fontFamily: Fonts.display, fontSize: 19 }}>Arrangement</ThemedText>
      </>,
    );
    expect(maxScale("Bedroom")).toBeCloseTo(DisplayMaxFontSize / 30);
    expect(maxScale("Collection")).toBeCloseTo(DisplayMaxFontSize / 35);
    expect(maxScale("Nighthawks")).toBeCloseTo(DisplayMaxFontSize / 30);
    expect(maxScale("Up next")).toBeCloseTo(DisplayMaxFontSize / 20);
    expect(maxScale("Sunflowers")).toBeCloseTo(DisplayMaxFontSize / 28);
    expect(maxScale("Arrangement")).toBeCloseTo(DisplayMaxFontSize / 19);
  });

  it("keeps a heading's stricter cap and never shrinks display text set above the limit", async () => {
    await render(
      <>
        <ThemedText variant="display" maxFontSizeMultiplier={1.4}>
          Capped
        </ThemedText>
        <ThemedText variant="display" style={{ fontSize: 64, lineHeight: 70 }}>
          Huge
        </ThemedText>
      </>,
    );
    expect(maxScale("Capped")).toBe(1.4);
    expect(maxScale("Huge")).toBe(1);
  });

  it("lets body text follow Dynamic Type unless its caller caps it", async () => {
    await render(
      <>
        <ThemedText>Reading text</ThemedText>
        <ThemedText variant="metadata" maxFontSizeMultiplier={2}>
          Metadata
        </ThemedText>
      </>,
    );
    expect(maxScale("Reading text")).toBeUndefined();
    expect(maxScale("Metadata")).toBe(2);
  });

  it("caps all text inside a limit, keeping the stricter of nested limits and a text's own cap", async () => {
    await render(
      <TextScaleLimit max={2}>
        <ThemedText>Outer</ThemedText>
        <ThemedText maxFontSizeMultiplier={1.4}>Own</ThemedText>
        <ThemedText variant="section">Heading</ThemedText>
        <TextScaleLimit max={3}>
          <ThemedText>Looser inner</ThemedText>
        </TextScaleLimit>
        <TextScaleLimit max={1.2}>
          <ThemedText>Stricter inner</ThemedText>
        </TextScaleLimit>
      </TextScaleLimit>,
    );
    expect(maxScale("Outer")).toBe(2);
    expect(maxScale("Own")).toBe(1.4);
    expect(maxScale("Heading")).toBe(2);
    expect(maxScale("Looser inner")).toBe(2);
    expect(maxScale("Stricter inner")).toBe(1.2);
  });

  it("reports the scale text reaches, for icons that grow beside it", async () => {
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 3.571 });
    const limited = ({ children }: { children: ReactNode }) => <TextScaleLimit max={1.4}>{children}</TextScaleLimit>;
    expect((await renderHook(() => useTextScale())).result.current).toBe(3.571);
    expect((await renderHook(() => useTextScale(2))).result.current).toBe(2);
    expect((await renderHook(() => useTextScale(), { wrapper: limited })).result.current).toBe(1.4);
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1.2 });
    expect((await renderHook(() => useTextScale(2), { wrapper: limited })).result.current).toBe(1.2);
  });
});
