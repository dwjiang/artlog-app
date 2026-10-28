import { renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { horizontalSafeAreaPadding, safeAreaBleed, useSafeAreaWidth } from "./safe-area";

const RAIL_RIGHT = { left: 0, right: 84 };

it("pads each side by its inset when the style sets no padding", () => {
  expect(horizontalSafeAreaPadding(undefined, RAIL_RIGHT)).toEqual({ paddingLeft: 0, paddingRight: 84 });
});

it("adds the inset to the padding the style resolves to on each side", () => {
  expect(horizontalSafeAreaPadding({ padding: 10 }, RAIL_RIGHT)).toEqual({ paddingLeft: 10, paddingRight: 94 });
  expect(
    horizontalSafeAreaPadding([{ padding: 10 }, { paddingHorizontal: 20 }, { paddingLeft: 4 }], RAIL_RIGHT),
  ).toEqual({ paddingLeft: 4, paddingRight: 104 });
});

it("treats padding that is not in points as none", () => {
  expect(horizontalSafeAreaPadding({ paddingHorizontal: "5%" }, { left: 62, right: 62 })).toEqual({
    paddingLeft: 62,
    paddingRight: 62,
  });
});

it("runs a row out to the screen edges while its content starts and ends inside the safe area", () => {
  const row = { gap: 12, paddingHorizontal: 20 };
  const bleed = safeAreaBleed(row, { left: 62, right: 84 });
  expect(bleed.style).toEqual({ marginLeft: -62, marginRight: -84 });
  expect(bleed.contentContainerStyle).toEqual([row, { paddingLeft: 82, paddingRight: 104 }]);
});

it("measures a screen's room from its own frame, which excludes a sidebar beside the tab", async () => {
  // The open iPhone Duo: a 951-point window, a sidebar taking 300 points, and the rail inset on the right.
  const tab = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 300, y: 0, width: 651, height: 669 },
        insets: { top: 0, bottom: 0, left: 0, right: 84 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
  const { result } = await renderHook(() => useSafeAreaWidth(), { wrapper: tab });
  expect(result.current).toBe(567);
});
