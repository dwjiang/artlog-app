import { useWindowDimensions } from "react-native";

/** Whether the window is wider than tall: an iPhone on its side, where stacked pinned bars leave little to scroll. */
export function useLandscape() {
  const { width, height } = useWindowDimensions();
  return width > height;
}
