import type { screen } from "@testing-library/react-native";

type HostElement = ReturnType<typeof screen.getByRole>;

export function scrollViewHolding(element: HostElement) {
  let node: HostElement | null = element;
  while (node && node.type !== "RCTScrollView") node = node.parent;
  if (!node) throw new Error("Not inside a scroll view");
  return node;
}
