import { act, renderHook } from "@testing-library/react-native";
import { useGlobeSession } from "./globe-session";
it("shares the camera and museum between compact and expanded views without sharing across accounts", async () => {
  const compact = await renderHook(() => useGlobeSession("owner-a"));
  const expanded = await renderHook(() => useGlobeSession("owner-a"));
  const other = await renderHook(() => useGlobeSession("owner-b"));
  await act(() =>
    expanded.result.current.update({
      selectedId: "museum",
      camera: { yaw: 75, pitch: 30, zoom: 1.6 },
    }),
  );
  expect(compact.result.current.camera).toEqual({
    yaw: 75,
    pitch: 30,
    zoom: 1.6,
  });
  expect(compact.result.current.selectedId).toBe("museum");
  expect(other.result.current.camera).toBeUndefined();
  await expanded.unmount();
  expect(compact.result.current.camera?.zoom).toBe(1.6);
});
