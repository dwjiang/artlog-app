import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { StyleSheet } from "react-native";

import { BottomTabInset, Spacing } from "@/constants/theme";
import { dismissToast, showToast } from "@/lib/ui/toast";

import { ToastLayer, toastLayerBottom } from "./toast";
import { ToastPill } from "./toast-pill";

let mockSegments: string[] = [];
let mockVerticalBarEdge: "leading" | "trailing" | null = null;
jest.mock("expo-router", () => ({ useSegments: () => mockSegments }));
jest.mock("expo-status-bar", () => ({ useVerticalBarEdgeIOS: () => mockVerticalBarEdge }));

afterEach(() => {
  mockSegments = [];
  mockVerticalBarEdge = null;
  dismissToast();
});

function layerBottom(text: string) {
  let node = screen.getByText(text).parent;
  while (node && StyleSheet.flatten(node.props.style)?.bottom === undefined) node = node.parent;
  return StyleSheet.flatten(node?.props.style)?.bottom;
}

const resting = 54;

it("rests toasts at the bottom without a lift, and above a bottom bar that leaves no room under it", () => {
  expect(toastLayerBottom(resting, undefined, undefined)).toBe(resting);
  expect(toastLayerBottom(resting, { height: 96, room: 0 }, undefined)).toBe(104);
});

it("keeps toasts in the room under a raised bar once they are measured to fit, and lifts them above it otherwise", () => {
  const raised = { height: 300, room: 180 };
  expect(toastLayerBottom(resting, raised, undefined)).toBeUndefined();
  expect(toastLayerBottom(resting, raised, 118)).toBe(resting);
  expect(toastLayerBottom(resting, raised, 119)).toBe(308);
});

it("keeps an Undo pill mounted while transient messages arrive, replace one another, and dismiss", async () => {
  const mount = jest.fn();
  const undo = jest.fn();
  function UndoPill() {
    useEffect(mount, []);
    return <ToastPill message="Artwork removed" actions={[{ label: "Undo", onPress: undo }]} />;
  }
  await render(
    <ToastLayer offset={0}>
      <UndoPill />
    </ToastLayer>,
  );
  await act(() => showToast("Saved"));
  await act(() => showToast("Copied"));
  expect(screen.getByText("Copied")).toBeOnTheScreen();
  expect(screen.queryByText("Saved")).toBeNull();
  await act(() => dismissToast());
  expect(mount).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledTimes(1);
});

it.each([
  [["(tabs)"], null, BottomTabInset],
  [["(tabs)"], "leading" as const, 0],
  [["(tabs)"], "trailing" as const, 0],
  [["settings"], null, 0],
])("clears the tab bar only while it sits at the bottom: %j, vertical bar %s", async (segments, edge, offset) => {
  mockSegments = segments;
  mockVerticalBarEdge = edge;
  await render(<ToastLayer />);
  await act(() => showToast("Saved"));
  expect(layerBottom("Saved")).toBe(offset + Spacing.content);
});
