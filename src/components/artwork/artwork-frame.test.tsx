import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { ArtworkFrame } from "./artwork-frame";

jest.mock("expo-image", () => {
  const { View } = jest.requireActual("react-native");
  return { Image: (props: object) => <View {...props} /> };
});

const LABEL = "Your photo of this painting";

/** The frame is the picture's nearest drawn ancestor. */
function frameStyle() {
  let node = screen.getByLabelText(LABEL).parent;
  while (node && typeof node.type !== "string") node = node.parent;
  return StyleSheet.flatten(node?.props.style);
}

it("keeps an unmeasured picture at full height, then fits its shape", async () => {
  await render(<ArtworkFrame uri="file:///first.jpg" accessibilityLabel={LABEL} />);
  expect(frameStyle()).not.toHaveProperty("aspectRatio");
  expect(frameStyle().height).toBeGreaterThan(0);
  await fireEvent(screen.getByLabelText(LABEL), "load", { source: { width: 300, height: 200 } });
  expect(frameStyle()).toMatchObject({ aspectRatio: 1.5 });
});

it("opens a picture it has drawn before at that picture's shape", async () => {
  const first = await render(<ArtworkFrame uri="file:///crop.jpg" accessibilityLabel={LABEL} />);
  await fireEvent(screen.getByLabelText(LABEL), "load", { source: { width: 400, height: 200 } });
  await first.unmount();
  await render(<ArtworkFrame uri="file:///crop.jpg" accessibilityLabel={LABEL} />);
  expect(frameStyle()).toMatchObject({ aspectRatio: 2 });
  expect(frameStyle()).not.toHaveProperty("height");
});
