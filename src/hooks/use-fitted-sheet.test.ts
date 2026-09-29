import { act, renderHook } from "@testing-library/react-native";
import { DeviceEventEmitter, Dimensions, type LayoutChangeEvent } from "react-native";

import { useFittedSheetHeight } from "./use-fitted-sheet";

const layout = (height: number) =>
  ({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }) as LayoutChangeEvent;

it("waits for the scroll content before fitting the sheet", async () => {
  const { result } = await renderHook(() => useFittedSheetHeight());
  await act(() => result.current.onHeaderLayout(layout(60)));
  expect(result.current.height).toBeUndefined();
});

it("fits the pinned header and footer around the scroll content, following content changes", async () => {
  const { result } = await renderHook(() => useFittedSheetHeight());
  await act(() => {
    result.current.onHeaderLayout(layout(60));
    result.current.onContentSizeChange(390, 300);
    result.current.onFooterLayout(layout(90));
  });
  expect(result.current.height).toBe(450);
  await act(() => result.current.onContentSizeChange(390, 120));
  expect(result.current.height).toBe(270);
});

it("stops at the tallest sheet the screen allows so long content scrolls", async () => {
  const { result } = await renderHook(() => useFittedSheetHeight());
  await act(() => result.current.onContentSizeChange(390, 5000));
  expect(result.current.height).toBe(Dimensions.get("window").height);
});

it("does not count the header and footer twice when they move into the scroll content", async () => {
  const { result, rerender } = await renderHook(
    ({ scrollAll }: { scrollAll: boolean }) => useFittedSheetHeight({ scrollAll }),
    { initialProps: { scrollAll: false } },
  );
  await act(() => {
    result.current.onHeaderLayout(layout(60));
    result.current.onContentSizeChange(390, 120);
    result.current.onFooterLayout(layout(90));
  });
  expect(result.current.height).toBe(270);
  await rerender({ scrollAll: true });
  await act(() => result.current.onContentSizeChange(390, 270));
  expect(result.current.height).toBe(270);
  await rerender({ scrollAll: false });
  await act(() => result.current.onContentSizeChange(390, 120));
  expect(result.current.height).toBe(270);
});

it("keeps long sheet content scrollable above the keyboard and expands after dismissal", async () => {
  const { result } = await renderHook(() => useFittedSheetHeight({ scrollAll: true }));
  await act(() => result.current.onContentSizeChange(390, 5000));
  await act(() =>
    DeviceEventEmitter.emit("keyboardWillChangeFrame", {
      endCoordinates: { screenX: 0, screenY: 450, width: 390, height: 350 },
    }),
  );
  expect(result.current.height).toBe(450);
  await act(() => DeviceEventEmitter.emit("keyboardDidHide", {}));
  expect(result.current.height).toBe(Dimensions.get("window").height);
});
