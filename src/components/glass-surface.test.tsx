import { act, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, DeviceEventEmitter } from "react-native";
import { ThemedText } from "./themed-text";
import { GlassSurface } from "./glass-surface";

jest.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: () => true,
  GlassView: ({ children }: { children: import("react").ReactNode }) => {
    const { View } = jest.requireActual("react-native");
    return <View accessibilityLabel="Camera glass">{children}</View>;
  },
}));

it("replaces camera glass with an opaque backing when Reduce Transparency changes", async () => {
  jest
    .spyOn(AccessibilityInfo, "isReduceTransparencyEnabled")
    .mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event, listener) =>
      DeviceEventEmitter.addListener(event, listener),
    );
  await render(
    <GlassSurface>
      <ThemedText>Capture artwork</ThemedText>
    </GlassSurface>,
  );
  expect(screen.getByLabelText("Camera glass")).toBeOnTheScreen();
  await act(() => DeviceEventEmitter.emit("reduceTransparencyChanged", true));
  expect(screen.queryByLabelText("Camera glass")).toBeNull();
  expect(screen.getByText("Capture artwork")).toBeOnTheScreen();
  await screen.unmount();
  jest.restoreAllMocks();
});
